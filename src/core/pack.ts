// ============ the data pack (OFF-003, OFF-005, OFF-008, OFF-010, OFF-011) ============
// A pack is a promise made before the flight: for THIS area, on THIS day, the briefing data
// will be there with no network under it (OFF-003). This file is the promise, not the goods —
// it says what a pack needs, classifies each need, and measures what is missing. The shell
// does the fetching and the storing; nothing here touches a byte of tile.
//
// The measurement is the point. OFF-010 wants the pilot to SEE, before takeoff, whether the
// cache can carry the flight — so completeness comes back as data, not as a boolean buried in
// a log. And OFF-008 draws the line that shapes everything below: 'flight' data is owed,
// 'enrichment' data is offered. Only the first kind can make a pack not-ready.

import { lonLatToTile, mPerLng, M_PER_LAT, type BBox } from 'soaring-core/geo';

// ---- kinds and their class ----

/** What a Phase-1 pack is made of. Imagery and waypoints join in later phases (Phase 4 for
 *  waypoints); adding a kind here forces `packClass` to say which side of OFF-008 it is on —
 *  the switch stops compiling until it does. */
export type PackKind = 'terrain' | 'weather';

/** Every kind a Phase-1 pack carries — the derived need-list of any PackSpec. */
export const PACK_KINDS: readonly PackKind[] = ['terrain', 'weather'];

export type PackClass = 'flight' | 'enrichment';

/** OFF-008, as a function. Terrain is flight data: the AGL, the reachable fields, the whole
 *  first screen stand on it, and it is GUARANTEED offline. Weather is enrichment: a briefing
 *  is better with it and legal without it — a missing forecast warns, never grounds. */
export function packClass(kind: PackKind): PackClass {
  switch (kind) {
    case 'terrain': return 'flight';
    case 'weather': return 'enrichment';
  }
}

// ---- the promise ----

/** A pack is a chosen area and a chosen day (OFF-003) — nothing about what is downloaded,
 *  only what was asked for. The day is ISO yyyy-mm-dd: a flight day, not an instant. */
export interface PackSpec {
  id: string;
  name: string;
  area: BBox;
  day: string;
  /** The ask as the pilot TYPED it, when known. The area is derived from these; the originals
   *  ride along because the area alone cannot give them back — a radius derived from the area
   *  and rounded for a form field, re-provisioned, is a DIFFERENT area silently replacing the
   *  shelved one under the same id (a confirmed finding). Optional, because shelves persisted
   *  before these fields existed still normalize; 'open' falls back to deriving for them. */
  centre?: { lon: number; lat: number };
  radiusKm?: number;
}

/** Build the spec for "radiusKm around (lon, lat) on day" — the ONE spelling of that fold,
 *  shared by the briefing form and by the shelf's 'open', so an opened pack and a typed one
 *  are the same value and re-provisioning an opened pack rebuilds the IDENTICAL spec, byte
 *  for byte. The id folds day and centre at 2 decimals (≈ 1 km — packs a village apart share
 *  their cache); the area is the radius turned into degrees at this latitude; the typed ask
 *  is carried verbatim (see PackSpec.centre). */
export function specFor(lon: number, lat: number, radiusKm: number, day: string): PackSpec {
  const dLat = radiusKm * 1000 / M_PER_LAT;
  const dLon = radiusKm * 1000 / mPerLng(lat);
  return {
    id: `${day}:${lon.toFixed(2)}:${lat.toFixed(2)}`,
    name: `${radiusKm} km around ${lat.toFixed(2)}, ${lon.toFixed(2)} on ${day}`,
    area: { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat },
    day,
    centre: { lon, lat },
    radiusKm,
  };
}

// ---- tiles: the unit terrain is counted in ----

export interface TileRef { z: number; x: number; y: number }

/** The one spelling of a tile identity, shared by this file, the store and the tests. A pack
 *  that keys tiles one way and counts them another reports phantom holes. */
export const tileKey = (t: TileRef): string => `${t.z}/${t.x}/${t.y}`;

/** Every tile an area needs at a zoom — INCLUDING edge tiles the area only clips. A tile that
 *  is 5% inside the area is 100% needed: the glider drifts to the edge and the ground there
 *  must still be known. So both corners floor to their tile and the whole rectangle between
 *  them is enumerated, clamped to the pyramid's [0, 2^z-1].
 *
 *  Areas that cross the antimeridian (west > east), and empty or inverted ones, come back as
 *  []: no tile list is better than a wrong one, and the caller must refuse or split such an
 *  area rather than let this function guess what was meant. */
export function tilesForArea(area: BBox, z: number): TileRef[] {
  if (!(area.west < area.east) || !(area.south < area.north)) return [];
  const max = 2 ** z - 1;
  const clamp = (v: number) => Math.min(max, Math.max(0, Math.floor(v)));
  // North-west corner is the smallest (x, y) in web mercator — y grows SOUTHWARD.
  const nw = lonLatToTile(area.west, area.north, z);
  const se = lonLatToTile(area.east, area.south, z);
  const x0 = clamp(nw.xf), x1 = clamp(se.xf);
  const y0 = clamp(nw.yf), y1 = clamp(se.yf);
  const out: TileRef[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      out.push({ z, x, y });
  return out;
}

// ---- what the store reports ----

/** What is actually on disk, as the shell reports it. `weather` is null when NO snapshot is
 *  held — null, not a snapshot with zeroed fields, because an absent forecast and an empty
 *  forecast are different facts and only one of them is true (POT-007's principle). */
export interface Held {
  /** Tile identities in `tileKey` form. */
  tiles: Set<string>;
  weather: { fetchedAt: number; day: string } | null;
}

// ---- the measurement ----

/** How old a weather snapshot may be before it stops counting as held. A forecast is a
 *  perishable claim about a specific atmosphere: by 48 h the model has been re-run several
 *  times and the snapshot describes a sky nobody will fly under. Two days — not one — because
 *  a pack is legitimately built the evening before the evening before (OFF-003 says "par
 *  avance"), and punishing that with a stale flag would teach pilots to ignore the flag. */
export const WEATHER_MAX_AGE_MS = 48 * 3_600_000;

export interface CompletenessItem {
  kind: PackKind;
  cls: PackClass;
  /** 'stale' is OFF-011's word: something IS held, and it must not be mistaken for current. */
  status: 'held' | 'partial' | 'missing' | 'stale';
  heldCount: number;
  totalCount: number;
  /** The reason, when counts alone cannot carry it. Null when there is nothing to explain —
   *  never an empty string pretending to be one. */
  detail: string | null;
}

export interface Completeness {
  items: CompletenessItem[];
  /** True only when every 'flight'-class item is fully held. Enrichment shortfalls appear in
   *  `items` — that is their warning (OFF-011) — but they NEVER hold the pack back (OFF-008):
   *  a pilot must not be told the pack is unfit because a forecast is old. */
  ready: boolean;
}

/** Measure a pack: the spec says what is owed, `held` says what is there, and the answer is
 *  data the pre-flight screen can show verbatim (OFF-010) — coverage, gaps and staleness, per
 *  kind, with the flight/enrichment class attached so the UI can rank the alarm honestly. */
export function completeness(spec: PackSpec, held: Held, z: number, now: number): Completeness {
  const need = tilesForArea(spec.area, z);
  const have = need.filter(t => held.tiles.has(tileKey(t))).length;
  const terrain: CompletenessItem = {
    kind: 'terrain',
    cls: packClass('terrain'),
    // An unenumerable area (empty, inverted, antimeridian) owes tiles we cannot even list —
    // that is 'missing', not 'held-vacuously': a pack over no area carries no flight.
    status: need.length === 0 || have === 0 ? 'missing'
      : have < need.length ? 'partial'
      : 'held',
    heldCount: have,
    totalCount: need.length,
    detail: need.length === 0 ? 'area yields no tiles (empty or antimeridian-crossing)' : null,
  };

  const w = held.weather;
  const wrongDay = w != null && w.day !== spec.day;
  const tooOld = w != null && now - w.fetchedAt > WEATHER_MAX_AGE_MS;
  const weather: CompletenessItem = {
    kind: 'weather',
    cls: packClass('weather'),
    status: w == null ? 'missing' : wrongDay || tooOld ? 'stale' : 'held',
    heldCount: w == null ? 0 : 1,
    totalCount: 1,
    detail: wrongDay ? `snapshot is for ${w.day}, flight day is ${spec.day}`
      : tooOld ? 'snapshot fetched more than 48 h ago'
      : null,
  };

  const items = [terrain, weather];
  return { items, ready: items.every(i => i.cls !== 'flight' || i.status === 'held') };
}
