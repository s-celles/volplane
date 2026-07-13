// ============ what survives a restart: shelf, settings, flight files (OFF-002) ============
// store.ts gives the app four verbs over bytes; this file spells out which records those
// verbs carry between launches. Everything here READS local-first and fetches nothing, ever
// (OFF-004) — a function in this file that touched the network would be a function that can
// fail with the radio dead, and the whole point of persistence is that it cannot.
//
// The load side shares one stance with openStore: a corrupted disk record costs the pilot
// that record's content, never his startup. Every loader catches the parse and answers with
// the normalized default — a missing shelf is an empty shelf, mangled settings are the
// factory settings, a rotten flight file is an absent one. What it never does is throw a
// storage detail into the briefing screen.
//
// This file also executes the cache budget (OFF-006). Core plans, shell deletes: planEviction
// is deterministic and pure, and the only thing added here is the kv.del loop — so every
// question about WHAT gets evicted is answerable in core's tests, and the only question left
// for this file is whether the deletes happened.

import { normalizeShelf, type Shelf } from '../core/shelf';
import { normalizeSettings, type Settings } from '../core/config';
import { planEviction, type CacheEntry, type EvictionPlan } from '../core/cachebudget';
import type { Held } from '../core/pack';
import { heldFor } from './provision';
import { getJson, putJson, type KV } from './store';
import { Z } from './terrain';

// ---- the key layout ----
// Flat keys, hierarchy spelled with prefixes — store.ts's own convention. Singletons get a
// bare word; the two flight files share the 'flight/' prefix so keys('flight/') enumerates
// them, the same way 'tile/' enumerates the terrain cache.

export const SHELF_KEY = 'shelf';
export const SETTINGS_KEY = 'settings';

export type FlightFileKind = 'airspace' | 'task';
export const flightFileKey = (kind: FlightFileKind): string => `flight/${kind}`;

// ---- the shelf record (OFF-002) ----

/** The shelf as the last session left it, or an empty shelf when nothing (or garbage) is
 *  stored. normalizeShelf already repairs untrusted shapes; the try/catch is for the step
 *  before shape — bytes that are not JSON at all, which getJson answers with a throw. */
export async function loadShelf(kv: KV): Promise<Shelf> {
  try {
    return normalizeShelf(await getJson(kv, SHELF_KEY));
  } catch {
    return [];
  }
}

export async function saveShelf(kv: KV, shelf: Shelf): Promise<void> {
  await putJson(kv, SHELF_KEY, shelf);
}

// ---- the settings record (OFF-002) ----

/** The settings as the last session left them, with the same never-throw stance as
 *  loadShelf: a corrupted disk record costs the pilot his preferences, never his startup —
 *  garbage bytes answer with the factory defaults, via core's own normalizer (C4: the shape
 *  and the repair are core's; only the bytes are ours). */
export async function loadSettings(kv: KV): Promise<Settings> {
  try {
    return normalizeSettings(await getJson(kv, SETTINGS_KEY));
  } catch {
    return normalizeSettings(null);
  }
}

export async function saveSettings(kv: KV, s: Settings): Promise<void> {
  await putJson(kv, SETTINGS_KEY, s);
}

// ---- flight files: airspace and task (OFF-002) ----

/** A file the pilot loaded, kept as the RAW text plus the name it arrived under. Raw, not
 *  parse results, for the same reason provision.ts stores the raw wx payload: parsing belongs
 *  to the reader, and raw bytes cannot rot when parseOpenAir improves. The name is not
 *  decoration — it is how the pilot recognises, next season, which airspace file this is. */
export interface FlightFile {
  name: string;
  text: string;
}

export async function saveFlightFile(kv: KV, kind: FlightFileKind, f: FlightFile): Promise<void> {
  await putJson(kv, flightFileKey(kind), f);
}

/** The stored file, or null when none was ever stored — store.ts's one honesty rule: absent
 *  is null, never an empty file the parser would then dutifully parse to nothing. A record
 *  too damaged to yield both name and text is treated as absent for the same reason: half a
 *  file is not a file the pilot chose. */
export async function loadFlightFile(kv: KV, kind: FlightFileKind): Promise<FlightFile | null> {
  try {
    const raw = await getJson<unknown>(kv, flightFileKey(kind));
    if (typeof raw !== 'object' || raw === null) return null;
    const f = raw as Record<string, unknown>;
    if (typeof f.name !== 'string' || typeof f.text !== 'string') return null;
    return { name: f.name, text: f.text };
  } catch {
    return null;
  }
}

// ---- measuring the shelf (OFF-009) ----

/** What the store holds for every pack on the shelf, keyed by spec.id — exactly the map
 *  core's updateOffers wants, so the offer list and the completeness screen are computed
 *  from the same measurement. Sequential heldFor calls on purpose: each one sweeps the tile
 *  key list, and this runs at briefing time where clarity beats a saved millisecond. */
export async function heldForShelf(shelf: Shelf, kv: KV): Promise<Map<string, Held>> {
  const out = new Map<string, Held>();
  for (const e of shelf) out.set(e.spec.id, await heldFor(e.spec, kv));
  return out;
}

// ---- the budget, executed (OFF-006) ----

/** Inventory the tile cache: every 'tile/…' key with its measured size. The store records no
 *  sizes, so this reads the whole cache — ~50 KB × hundreds of tiles — to measure it. That
 *  cost is acceptable exactly once per provisioning or management action, and NOWHERE near
 *  the 1 Hz flight loop; a per-key size ledger in store.ts is the fix if it ever hurts, not
 *  a cache of this function's answer going stale. A key that vanishes between keys() and
 *  get() is simply not inventoried — it is already what eviction would have made it. */
export async function tileInventory(kv: KV): Promise<CacheEntry[]> {
  const out: CacheEntry[] = [];
  for (const key of await kv.keys('tile/')) {
    const bytes = await kv.get(key);
    if (bytes !== null) out.push({ key, bytes: bytes.byteLength });
  }
  return out;
}

/** Bring the tile cache under `budgetBytes`: measure, let core plan, execute the plan. The
 *  deletes run sequentially and a failed del is SKIPPED, not fatal — the key stays, the next
 *  enforcement inventories it again and sweeps it then; one stubborn key must not abort the
 *  rest of the plan. The plan comes back so the UI can show what happened, and in particular
 *  `overBudget`: when pins alone exceed the ceiling, the honest outcome is a cache still over
 *  budget and a screen that says why — never a broken pin (OFF-007 outranks OFF-006). */
export async function enforceBudget(
  kv: KV,
  shelf: Shelf,
  budgetBytes: number,
): Promise<EvictionPlan> {
  const plan = planEviction(await tileInventory(kv), shelf, Z, budgetBytes);
  for (const key of plan.evict) {
    try {
      await kv.del(key);
    } catch {
      // Left in place for the next sweep — see above.
    }
  }
  return plan;
}
