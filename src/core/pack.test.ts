// ============ what these tests pin ============
// The pack model's CLAIMS, per the spec:
//   OFF-003 — a pack is an area + a day, and its terrain need is an enumerable tile list;
//   OFF-008 — terrain is flight data and gates readiness; weather is enrichment and never does;
//   OFF-010 — completeness is data: per-kind status and counts a pre-flight screen can show;
//   OFF-011 — an absent or stale item is SAID, as 'missing'/'stale', not silently absorbed;
//   OFF-005 — validity is date + coverage, measured against the spec's day and area.
// Tile fixtures are hand-computed from the mercator formulae so a regression in tilesForArea
// cannot hide behind the same code that produced the expectation.

import { test, expect } from 'bun:test';
import { tileBBox, type BBox } from 'soaring-core/geo';
import {
  PACK_KINDS, packClass, tileKey, tilesForArea, completeness,
  WEATHER_MAX_AGE_MS, type PackSpec, type Held, type TileRef,
} from './pack';

// ---- fixtures ----

// Tile 10/526/369 covers 4.921875..5.2734375 E, 44.590..44.840 N. This bbox sits strictly
// inside it — no edge touches a tile boundary.
const ONE_TILE_AREA: BBox = { west: 5.0, east: 5.2, south: 44.65, north: 44.8 };

// The NE corner of that tile is (5.2734375 E, 44.84029 N); a bbox straddling it clips four
// tiles: x ∈ {526, 527}, y ∈ {368, 369}.
const CORNER_AREA: BBox = { west: 5.2, east: 5.3, south: 44.8, north: 44.9 };

const spec = (area: BBox): PackSpec => ({ id: 'p1', name: 'test pack', area, day: '2026-07-12' });

const allTilesHeld = (area: BBox, z: number): Set<string> =>
  new Set(tilesForArea(area, z).map(tileKey));

const NOW = Date.UTC(2026, 6, 12, 9, 0, 0);   // mid-morning of the flight day
const FRESH = { fetchedAt: NOW - 3_600_000, day: '2026-07-12' };

// ---- OFF-008: the classification is total and puts terrain on the flight side ----

test('packClass: terrain is flight data, weather is enrichment', () => {
  expect(packClass('terrain')).toBe('flight');
  expect(packClass('weather')).toBe('enrichment');
  // Every Phase-1 kind classifies — none falls through to an exception or an undefined.
  for (const k of PACK_KINDS) expect(['flight', 'enrichment']).toContain(packClass(k));
});

// ---- OFF-003: the tile need of an area ----

test('a bbox strictly inside one tile needs exactly that tile', () => {
  const tiles = tilesForArea(ONE_TILE_AREA, 10);
  expect(tiles).toEqual([{ z: 10, x: 526, y: 369 }]);
  // The fixture's premise, verified against soaring-core's own tile bounds: the area really
  // is strictly inside 10/526/369, so the single-tile answer is forced, not lucky.
  const b = tileBBox(526, 369, 10);
  expect(b.west).toBeLessThan(ONE_TILE_AREA.west);
  expect(b.east).toBeGreaterThan(ONE_TILE_AREA.east);
  expect(b.south).toBeLessThan(ONE_TILE_AREA.south);
  expect(b.north).toBeGreaterThan(ONE_TILE_AREA.north);
});

test('a bbox spanning a tile corner needs all four tiles around it', () => {
  const keys = tilesForArea(CORNER_AREA, 10).map(tileKey).sort();
  expect(keys).toEqual(['10/526/368', '10/526/369', '10/527/368', '10/527/369']);
});

test('a 2°×1° area at z=10 needs the hand-computed 7×5 rectangle', () => {
  // West 5.1 E: xf = (5.1+180)/360·1024 = 526.51 → 526. East 7.1 E: xf = 532.20 → 532.
  // North 45.1 N: yf = 367.96 → 367. South 44.1 N: yf = 371.95 → 371.
  // 7 columns × 5 rows, edge tiles included even though the area only clips them.
  const tiles = tilesForArea({ west: 5.1, east: 7.1, south: 44.1, north: 45.1 }, 10);
  expect(tiles).toHaveLength(35);
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  expect(Math.min(...xs)).toBe(526);
  expect(Math.max(...xs)).toBe(532);
  expect(Math.min(...ys)).toBe(367);
  expect(Math.max(...ys)).toBe(371);
});

test('tile indices are clamped to the pyramid', () => {
  // An area spilling past the world edge must not order tiles that do not exist.
  const tiles = tilesForArea({ west: -190, east: -160, south: -85, north: 85 }, 2);
  expect(tiles.length).toBeGreaterThan(0);
  for (const t of tiles) {
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.x).toBeLessThanOrEqual(3);
    expect(t.y).toBeLessThanOrEqual(3);
  }
});

// ---- OFF-010: completeness of a fully provisioned pack ----

test('every tile held + fresh same-day snapshot → everything held, ready', () => {
  const held: Held = { tiles: allTilesHeld(CORNER_AREA, 10), weather: FRESH };
  const c = completeness(spec(CORNER_AREA), held, 10, NOW);
  expect(c.items.map(i => i.status)).toEqual(['held', 'held']);
  expect(c.items.map(i => i.kind)).toEqual(['terrain', 'weather']);
  const terrain = c.items[0];
  expect(terrain.heldCount).toBe(4);
  expect(terrain.totalCount).toBe(4);
  expect(terrain.detail).toBeNull();          // nothing to explain → null, not ''
  expect(c.ready).toBe(true);
});

// ---- OFF-008 + OFF-010: a terrain hole is a flight-data hole ----

test('one tile missing → terrain partial, pack not ready', () => {
  const tiles = allTilesHeld(CORNER_AREA, 10);
  tiles.delete('10/527/369');
  const c = completeness(spec(CORNER_AREA), { tiles, weather: FRESH }, 10, NOW);
  const terrain = c.items.find(i => i.kind === 'terrain')!;
  expect(terrain.status).toBe('partial');
  expect(terrain.heldCount).toBe(3);
  expect(terrain.totalCount).toBe(4);
  expect(c.ready).toBe(false);
});

// ---- OFF-008: enrichment never blocks ----

test('no weather at all → weather missing, but the pack is still ready', () => {
  const c = completeness(spec(CORNER_AREA), { tiles: allTilesHeld(CORNER_AREA, 10), weather: null }, 10, NOW);
  const weather = c.items.find(i => i.kind === 'weather')!;
  expect(weather.status).toBe('missing');
  expect(weather.heldCount).toBe(0);
  expect(c.ready).toBe(true);
});

// ---- OFF-011: stale is said, with its reason ----

test('a snapshot for another day is stale, and says which day it is for', () => {
  const held: Held = { tiles: allTilesHeld(CORNER_AREA, 10), weather: { fetchedAt: NOW - 3_600_000, day: '2026-07-10' } };
  const c = completeness(spec(CORNER_AREA), held, 10, NOW);
  const weather = c.items.find(i => i.kind === 'weather')!;
  expect(weather.status).toBe('stale');
  expect(weather.detail).toContain('2026-07-10');
  expect(weather.detail).toContain('2026-07-12');
  expect(c.ready).toBe(true);                 // stale enrichment warns, never grounds
});

test('a snapshot fetched 3 days ago is stale even for the right day', () => {
  const held: Held = { tiles: allTilesHeld(CORNER_AREA, 10), weather: { fetchedAt: NOW - 3 * 86_400_000, day: '2026-07-12' } };
  const c = completeness(spec(CORNER_AREA), held, 10, NOW);
  expect(c.items.find(i => i.kind === 'weather')!.status).toBe('stale');
});

test('the 48 h age limit is a strict threshold', () => {
  // Exactly at the limit still counts — a pack built two evenings ahead is legitimate
  // provisioning (OFF-003), not negligence. One millisecond past, it is stale.
  const at = { fetchedAt: NOW - WEATHER_MAX_AGE_MS, day: '2026-07-12' };
  const past = { fetchedAt: NOW - WEATHER_MAX_AGE_MS - 1, day: '2026-07-12' };
  const tiles = allTilesHeld(CORNER_AREA, 10);
  expect(completeness(spec(CORNER_AREA), { tiles, weather: at }, 10, NOW).items[1].status).toBe('held');
  expect(completeness(spec(CORNER_AREA), { tiles, weather: past }, 10, NOW).items[1].status).toBe('stale');
});

// ---- degenerate areas: refuse, as data, without throwing ----

test('empty, inverted and antimeridian areas yield no tiles and a missing terrain item', () => {
  const bad: BBox[] = [
    { west: 5, east: 5, south: 44, north: 45 },       // zero width
    { west: 6, east: 5, south: 44, north: 45 },       // inverted (also antimeridian shape)
    { west: 5, east: 6, south: 45, north: 44 },       // inverted latitudes
    { west: 170, east: -170, south: -10, north: 10 }, // antimeridian crossing: out of scope
  ];
  for (const area of bad) {
    expect(tilesForArea(area, 10)).toEqual([]);
    const c = completeness(spec(area), { tiles: new Set<string>(), weather: null }, 10, NOW);
    const terrain = c.items.find(i => i.kind === 'terrain')!;
    expect(terrain.status).toBe('missing');
    expect(terrain.totalCount).toBe(0);
    expect(c.ready).toBe(false);              // a pack over no area carries no flight
  }
});

// ---- the key format is the shared spelling ----

test('tileKey spells z/x/y', () => {
  const t: TileRef = { z: 10, x: 526, y: 369 };
  expect(tileKey(t)).toBe('10/526/369');
});
