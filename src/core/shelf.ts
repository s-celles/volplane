// ============ the pack shelf (OFF-002, OFF-003, OFF-007, OFF-009, OFF-010) ============
// A pack (pack.ts) is one promise; the shelf is the collection of promises the pilot keeps.
// OFF-003 says "paquets" — plural — and today the app has exactly one implicit pack living in
// form inputs, gone at the next launch. This file gives packs a place to live: a plain value
// the shell can serialize verbatim (OFF-002) and the pre-flight screen can enumerate (OFF-010).
//
// Two rules shape everything here. First, every operation returns a NEW array and never touches
// its input — the shell decides whether to save by diffing old against new, and a mutating op
// would make that diff lie. Second, nothing here acts: `updateOffers` is OFF-009 as data, a list
// of packs worth refreshing, and whether the network is up or the pilot says yes is strictly
// the shell's business. An offer imposed is not an offer.

import { tileKey, tilesForArea, WEATHER_MAX_AGE_MS, type Held, type PackSpec } from './pack';

// ---- the shelf ----

/** One pack on the shelf. `pinned` is OFF-007: the pilot's explicit promise-to-self that this
 *  pack must never be evicted. `addedAt` and `lastUsedAt` exist for the eviction policy and
 *  the sort — they are bookkeeping, not measurements, so 0 is an honest "unknown epoch" for
 *  them in a way it never is for flight data. */
export interface ShelfEntry {
  spec: PackSpec;
  pinned: boolean;
  addedAt: number;
  lastUsedAt: number;
}

/** The whole shelf. A plain array of plain values — JSON.stringify/parse round-trips it
 *  exactly, which is the shape OFF-002 demands: what persists must come back. */
export type Shelf = ShelfEntry[];

// ---- pure ops ----

/** Add a pack, or refresh it if its id is already shelved. A re-upsert takes the new spec and
 *  marks the pack used NOW, but PRESERVES `pinned` and `addedAt`: editing a pack's area must
 *  not silently unpin it, and a pack is as old as its first shelving, not its last edit. */
export function upsertPack(shelf: Shelf, spec: PackSpec, now: number): Shelf {
  const known = shelf.some(e => e.spec.id === spec.id);
  if (!known) return [...shelf, { spec, pinned: false, addedAt: now, lastUsedAt: now }];
  return shelf.map(e => e.spec.id === spec.id ? { ...e, spec, lastUsedAt: now } : e);
}

/** Mark a pack as used. Unknown ids fall through unchanged — touching what is not there is
 *  not an error, it is just nothing. */
export function touchPack(shelf: Shelf, id: string, now: number): Shelf {
  return shelf.map(e => e.spec.id === id ? { ...e, lastUsedAt: now } : e);
}

export function setPinned(shelf: Shelf, id: string, pinned: boolean): Shelf {
  return shelf.map(e => e.spec.id === id ? { ...e, pinned } : e);
}

/** Remove a pack — unless it is pinned, in which case the shelf comes back unchanged. This is
 *  OFF-007's "jamais évincés" applied to the shelf itself: a pin means untouchable, and
 *  unpinning first is the pilot's explicit act, never a side effect of a delete. */
export function removePack(shelf: Shelf, id: string): Shelf {
  const target = shelf.find(e => e.spec.id === id);
  if (target?.pinned) return shelf;
  return shelf.filter(e => e.spec.id !== id);
}

// ---- the order the pilot sees ----

/** Pinned packs first, then most recently used, ties broken by id. The tie-break matters:
 *  the UI renders this order verbatim (OFF-010), and a list that reshuffles between renders
 *  for no visible reason reads as a glitch — determinism is a feature the pilot can feel. */
export function sortedShelf(shelf: Shelf): Shelf {
  return [...shelf].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.lastUsedAt !== b.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
    return a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0;
  });
}

// ---- reading the shelf back off disk ----

const str = (v: unknown): v is string => typeof v === 'string';
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Rebuild a shelf from untrusted JSON. This is core's side of OFF-002: what was persisted
 *  must come back, or be visibly absent — never crash the briefing. So an entry whose spec is
 *  broken beyond identity (id, name, day not strings; area corners not finite numbers) is
 *  DROPPED, because a pack we cannot even name or place is not a pack. Bookkeeping damage is
 *  repaired instead of fatal: a mangled timestamp becomes 0 (oldest possible, so the pack
 *  sorts last, not first), a mangled pin becomes false (an unremembered pin must not protect
 *  a pack the pilot never chose to protect). Garbage in, smaller honest shelf out — never
 *  a throw. */
export function normalizeShelf(raw: unknown): Shelf {
  if (!Array.isArray(raw)) return [];
  const out: Shelf = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item == null) continue;
    const e = item as Record<string, unknown>;
    const s = e.spec;
    if (typeof s !== 'object' || s == null) continue;
    const spec = s as Record<string, unknown>;
    const a = spec.area;
    if (typeof a !== 'object' || a == null) continue;
    const area = a as Record<string, unknown>;
    if (!str(spec.id) || !str(spec.name) || !str(spec.day)) continue;
    if (!fin(area.west) || !fin(area.east) || !fin(area.south) || !fin(area.north)) continue;
    // The typed ask (centre, radiusKm) is carried through when intact and dropped when not —
    // it is a convenience for 'open', never identity, so a mangled copy costs the pilot a
    // re-derived (rounded) form fill, not the pack.
    const c = spec.centre as Record<string, unknown> | undefined;
    const centre = typeof c === 'object' && c != null && fin(c.lon) && fin(c.lat)
      ? { lon: c.lon, lat: c.lat } : null;
    const r = spec.radiusKm;
    const radiusKm = fin(r) && r > 0 ? r : null;
    out.push({
      spec: {
        id: spec.id,
        name: spec.name,
        day: spec.day,
        area: { west: area.west, east: area.east, south: area.south, north: area.north },
        ...(centre ? { centre } : {}),
        ...(radiusKm != null ? { radiusKm } : {}),
      },
      pinned: typeof e.pinned === 'boolean' ? e.pinned : false,
      addedAt: fin(e.addedAt) ? e.addedAt : 0,
      lastUsedAt: fin(e.lastUsedAt) ? e.lastUsedAt : 0,
    });
  }
  return out;
}

// ---- OFF-009: the offer ----

/** Why a pack deserves a refresh. Terrain does not rot, but it can be INCOMPLETE — an
 *  interrupted download, a 404'd tile — and missing terrain is the one hole that grounds a
 *  pack (OFF-008), so it must be the first thing an update proposes to fix. OFF-009 says
 *  "proposer la mise à jour des paquets", not "des snapshots météo": offering only for stale
 *  weather inverted the priority, proposing nothing for the pack that could not carry the
 *  flight while proposing for one that could (a confirmed finding). The weather reasons reuse
 *  pack.ts's own staleness convention so the offer and the completeness screen never disagree
 *  about the same snapshot. */
export interface UpdateOffer {
  id: string;
  reason: 'tiles-missing' | 'tiles-partial' | 'weather-missing' | 'weather-stale' | 'weather-wrong-day';
}

/** OFF-009 as data: "QUAND la connexion réapparaît, PROPOSER — sans l'imposer". This function
 *  decides what is worth proposing; it neither knows nor cares whether the network is up or
 *  what the pilot answers — those are the shell's business, and keeping them out of core is
 *  what makes "sans l'imposer" testable. A pack absent from `heldById` holds nothing, so it
 *  is offered rather than silently skipped: the shell not knowing about a pack is exactly the
 *  situation an update fixes. One reason per pack, ranked by OFF-008's own hierarchy: tile
 *  holes first (flight data — they ground the pack), weather second (enrichment); within
 *  weather, wrong-day outranks stale as in pack.ts, because a snapshot for the wrong day is
 *  useless however fresh it is. `z` is the zoom the tile promise is counted at — the same one
 *  completeness measures with, so the offer and the chip cannot disagree about a hole.
 *  Offers follow `sortedShelf` order, so the proposal list and the shelf the pilot sees line
 *  up one-to-one. */
export function updateOffers(
  shelf: Shelf,
  heldById: ReadonlyMap<string, Held>,
  z: number,
  now: number,
): UpdateOffer[] {
  const out: UpdateOffer[] = [];
  for (const e of sortedShelf(shelf)) {
    const held = heldById.get(e.spec.id) ?? null;
    const need = tilesForArea(e.spec.area, z);
    const have = held == null ? 0 : need.filter(t => held.tiles.has(tileKey(t))).length;
    // An area that yields no tiles owes none — re-downloading cannot fix a degenerate area,
    // so such a pack falls through to the weather checks instead of an unfixable tile offer.
    if (need.length > 0 && have === 0) { out.push({ id: e.spec.id, reason: 'tiles-missing' }); continue; }
    if (have < need.length) { out.push({ id: e.spec.id, reason: 'tiles-partial' }); continue; }
    const w = held?.weather ?? null;
    if (w == null) out.push({ id: e.spec.id, reason: 'weather-missing' });
    else if (w.day !== e.spec.day) out.push({ id: e.spec.id, reason: 'weather-wrong-day' });
    else if (now - w.fetchedAt > WEATHER_MAX_AGE_MS) out.push({ id: e.spec.id, reason: 'weather-stale' });
  }
  return out;
}
