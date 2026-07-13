// ============ cache budget: ceiling + eviction plan (OFF-006, OFF-007) ============
// The cache has a settable ceiling, and OFF-006 uses a precise word for how it is kept:
// DETERMINISTIC. Same inventory, same shelf, same budget — same plan, byte for byte. A cache
// that evicts differently on Tuesday than on Monday cannot be reasoned about, and a pilot who
// pinned a pack for tomorrow's flight cannot be asked to trust a coin flip.
//
// So this file is a planner, not an executor. It looks at what the shell says is stored, at
// what the shelf says is owed, and answers with a list of keys to delete and the totals that
// justify it. It deletes nothing — the shell executes plans; core decides them (C5). And the
// one rule that outranks the ceiling is OFF-007: a tile owed by a pinned pack is NEVER in the
// list, even when sparing it leaves the cache over budget. In that case the plan says so
// (`overBudget: true`) instead of quietly breaking the pin — the same refusal discipline as
// POT-007: report the fact, never fake the number.
//
// Weather snapshots ('wx/…', 'wxmeta/…') are deliberately OUTSIDE this budget. That is a
// decision, not an oversight: a snapshot is a few hundred KB where a pack's tiles are tens of
// MB, and weather already answers to its own clock — WEATHER_MAX_AGE_MS retires it by
// staleness, which is the axis a forecast actually spoils along. Evicting it by bytes would
// buy almost no room and cost a briefing. The same goes for the shelf and settings records
// themselves: bookkeeping is not cargo.

import { tilesForArea, tileKey, type PackSpec } from './pack';

// ---- the unit the ceiling speaks ----

/** The one conversion between the MB the pilot types (and reads back) and the bytes this
 *  planner compares. Decimal, because the label says MB. The gauge and the enforcement MUST
 *  share this constant: a display dividing by one factor while the ceiling multiplied by
 *  another gave the two a 4.9% disagreement about the same cache — the usage line could never
 *  visibly reach the ceiling it was printed against, and tiles were evicted under a gauge
 *  still reading "under budget" (a confirmed finding). */
export const BYTES_PER_MB = 1e6;

// ---- what the planner is told ----

/** One stored tile, as the shell inventories it: the KV key ('tile/z/x/y') and its size.
 *  The shell measures; core never guesses a byte count (POT-007's principle applies to disk
 *  space as much as to altitude). */
export interface CacheEntry {
  key: string;
  bytes: number;
}

/** The shape of a shelf entry, as this planner needs it — structurally identical to the
 *  shelf module's ShelfEntry. The shape is the contract, not the import: the planner cares
 *  that a pack has an area (to enumerate what it owes), a pin (OFF-007), and a last-used
 *  time (to rank the unpinned), and nothing else about how the shelf keeps its books. */
export interface PackHolding {
  spec: PackSpec;
  pinned: boolean;
  lastUsedAt: number;
}

// ---- who owes what ----

/** Walk the shelf and turn pack promises into per-tile claims. A key owed by ANY pinned pack
 *  is pinned — one pilot's pin protects the tile no matter how many casual packs also touch
 *  it. Among unpinned owners, a key carries the NEWEST lastUsedAt: a tile two packs share is
 *  as fresh as its freshest owner, because deleting it would hurt the pack still in use.
 *
 *  Freshness is per-OWNER, not per-tile, and that granularity is deliberate: the store does
 *  not record when each tile was last read (a per-tile LRU would mean a write on every render
 *  of the moving map), so the honest signal we have is when the pack was last opened — and we
 *  use that rather than inventing finer data we do not hold. */
export function ownership(
  shelf: readonly PackHolding[],
  z: number,
): { pinnedKeys: Set<string>; ownerLastUsed: Map<string, number> } {
  const pinnedKeys = new Set<string>();
  const ownerLastUsed = new Map<string, number>();
  for (const holding of shelf) {
    for (const t of tilesForArea(holding.spec.area, z)) {
      const key = `tile/${tileKey(t)}`;
      if (holding.pinned) {
        pinnedKeys.add(key);
      } else {
        const prev = ownerLastUsed.get(key);
        if (prev == null || holding.lastUsedAt > prev) ownerLastUsed.set(key, holding.lastUsedAt);
      }
    }
  }
  return { pinnedKeys, ownerLastUsed };
}

// ---- the plan ----

export interface EvictionPlan {
  /** KV keys to delete, in the order the policy chose them. The shell executes this verbatim. */
  evict: string[];
  /** What the inventory holds now, before any deletion. */
  usedBytes: number;
  /** What remains if the plan is executed. */
  keptBytes: number;
  /** The part of keptBytes that pins put beyond this planner's reach. */
  pinnedBytes: number;
  /** True when even a full sweep of the evictable cannot get under the ceiling — the pinned
   *  data alone exceeds the budget. The plan still spares every pinned tile (OFF-007 outranks
   *  OFF-006) and this flag is how the UI tells the pilot the ceiling is unreachable, instead
   *  of the cache silently ignoring either the pin or the setting. */
  overBudget: boolean;
}

/** Decide what to evict so the cache fits under `budgetBytes`, without touching a pinned tile.
 *
 *  The order is fixed and total: FIRST orphans — tiles owed by no shelf entry at all, the
 *  leftovers of deleted packs and of the Fly screen's opportunistic caching, which nobody
 *  promised to keep — THEN tiles owed only by unpinned packs, stalest owner first, so the
 *  pack the pilot has not opened in weeks yields before the one from yesterday. Every tie,
 *  everywhere, breaks on lexicographic key compare: 'deterministic' is OFF-006's own word,
 *  and a plan that depends on inventory order is not a plan, it is a mood. */
export function planEviction(
  entries: readonly CacheEntry[],
  shelf: readonly PackHolding[],
  z: number,
  budgetBytes: number,
): EvictionPlan {
  const { pinnedKeys, ownerLastUsed } = ownership(shelf, z);

  const usedBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  const pinnedBytes = entries
    .filter(e => pinnedKeys.has(e.key))
    .reduce((sum, e) => sum + e.bytes, 0);

  const orphans: CacheEntry[] = [];
  const owned: CacheEntry[] = [];
  for (const e of entries) {
    if (pinnedKeys.has(e.key)) continue;            // OFF-007: not even a candidate
    (ownerLastUsed.has(e.key) ? owned : orphans).push(e);
  }

  const byKey = (a: CacheEntry, b: CacheEntry) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  orphans.sort(byKey);
  owned.sort((a, b) => {
    const stale = ownerLastUsed.get(a.key)! - ownerLastUsed.get(b.key)!;
    return stale !== 0 ? stale : byKey(a, b);
  });

  const evict: string[] = [];
  let keptBytes = usedBytes;
  for (const e of [...orphans, ...owned]) {
    if (keptBytes <= budgetBytes) break;
    evict.push(e.key);
    keptBytes -= e.bytes;
  }

  return { evict, usedBytes, keptBytes, pinnedBytes, overBudget: keptBytes > budgetBytes };
}
