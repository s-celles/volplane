// ============ what these tests pin ============
// The shelf's CLAIMS, per the spec:
//   OFF-007 — a pinned pack refuses removal; the pin is the pilot's mark, not a hint;
//   OFF-002 — normalizeShelf round-trips what was persisted, INCLUDING the typed ask
//             (centre, radiusKm) that makes 'open' lossless, and repairs garbage silently;
//   OFF-009 — updateOffers proposes for EVERYTHING a re-provision would fix: a pack with
//             tile holes is offered BEFORE a pack with old weather, because tiles are flight
//             data (OFF-008) and a snapshot is enrichment — offering weather-only inverted
//             that priority (a confirmed finding: the pack that could not carry the flight
//             got no proposal while the flight-ready one did).
import { test, expect } from 'bun:test';
import { specFor, tileKey, tilesForArea, WEATHER_MAX_AGE_MS, type Held, type PackSpec } from './pack';
import {
  normalizeShelf, removePack, updateOffers, upsertPack, type Shelf, type ShelfEntry,
} from './shelf';

const Z = 10;

// The four-tile corner area pack.test.ts verified by hand — enough tiles to hold a hole.
const spec = (id: string): PackSpec => ({
  id, name: `Pack ${id}`, day: '2026-07-12',
  area: { west: 5.2, east: 5.3, south: 44.8, north: 44.9 },
});
const entry = (id: string, over: Partial<ShelfEntry> = {}): ShelfEntry =>
  ({ spec: spec(id), pinned: false, addedAt: 0, lastUsedAt: 0, ...over });

const NOW = Date.UTC(2026, 6, 12, 9, 0, 0);
const FRESH = { fetchedAt: NOW - 3_600_000, day: '2026-07-12' };
const STALE = { fetchedAt: NOW - WEATHER_MAX_AGE_MS - 3_600_000, day: '2026-07-12' };
const allTiles = (id: string): Set<string> =>
  new Set(tilesForArea(spec(id).area, Z).map(tileKey));

// ---- OFF-009: tile holes are offered, and outrank weather ----

test('a pack with a tile hole is offered even when its weather is fresh (OFF-009)', () => {
  const tiles = allTiles('a');
  expect(tiles.size).toBeGreaterThan(1);         // the premise: a hole can exist
  tiles.delete([...tiles][0]);
  const held = new Map<string, Held>([['a', { tiles, weather: FRESH }]]);
  expect(updateOffers([entry('a')], held, Z, NOW)).toEqual([{ id: 'a', reason: 'tiles-partial' }]);
});

test('a pack holding nothing is offered as tiles-missing — tiles outrank weather (OFF-008)', () => {
  const held = new Map<string, Held>([['a', { tiles: new Set(), weather: null }]]);
  expect(updateOffers([entry('a')], held, Z, NOW)).toEqual([{ id: 'a', reason: 'tiles-missing' }]);
  // A pack the shell knows nothing about held nothing — same answer, not a silent skip.
  expect(updateOffers([entry('a')], new Map(), Z, NOW)).toEqual([{ id: 'a', reason: 'tiles-missing' }]);
});

test('with terrain complete, the weather reasons apply as before', () => {
  const held = (w: Held['weather']) => new Map<string, Held>([['a', { tiles: allTiles('a'), weather: w }]]);
  expect(updateOffers([entry('a')], held(STALE), Z, NOW)).toEqual([{ id: 'a', reason: 'weather-stale' }]);
  expect(updateOffers([entry('a')], held({ ...FRESH, day: '2026-07-10' }), Z, NOW))
    .toEqual([{ id: 'a', reason: 'weather-wrong-day' }]);
  expect(updateOffers([entry('a')], held(null), Z, NOW)).toEqual([{ id: 'a', reason: 'weather-missing' }]);
  expect(updateOffers([entry('a')], held(FRESH), Z, NOW)).toEqual([]);
});

test('the confirmed inversion: the grounded pack is proposed, not only the flight-ready one', () => {
  const holed = allTiles('a');
  holed.delete([...holed][0]);
  const held = new Map<string, Held>([
    ['a', { tiles: holed, weather: FRESH }],        // NOT flight-ready: terrain partial
    ['b', { tiles: allTiles('b'), weather: STALE }], // flight-ready, old snapshot
  ]);
  const offers = updateOffers([entry('a'), entry('b')], held, Z, NOW);
  expect(offers).toContainEqual({ id: 'a', reason: 'tiles-partial' });
  expect(offers).toContainEqual({ id: 'b', reason: 'weather-stale' });
});

// ---- OFF-007: the pin refuses removal ----

test('removePack leaves a pinned pack on the shelf, untouched', () => {
  const shelf: Shelf = [entry('a', { pinned: true })];
  expect(removePack(shelf, 'a')).toEqual(shelf);
  expect(removePack([entry('a')], 'a')).toEqual([]);
});

// ---- OFF-002: the typed ask survives persistence ----

test('normalizeShelf round-trips centre and radiusKm through JSON, so open stays lossless', () => {
  const s = specFor(6.123, 45.678, 12.75, '2026-07-12');
  const shelf = upsertPack([], s, 1_000);
  const back = normalizeShelf(JSON.parse(JSON.stringify(shelf)));
  expect(back).toEqual(shelf);
  expect(back[0].spec.centre).toEqual({ lon: 6.123, lat: 45.678 });
  expect(back[0].spec.radiusKm).toBe(12.75);
});

test('a mangled ask is dropped, not repaired into a lie — the pack itself survives', () => {
  const raw = [{
    spec: {
      ...spec('a'),
      centre: { lon: 'six', lat: 45 },   // not numbers: not an ask
      radiusKm: -3,                      // a negative radius is nobody's ask
    },
    pinned: false, addedAt: 0, lastUsedAt: 0,
  }];
  const back = normalizeShelf(JSON.parse(JSON.stringify(raw)));
  expect(back).toHaveLength(1);
  expect(back[0].spec.centre).toBeUndefined();
  expect(back[0].spec.radiusKm).toBeUndefined();
});
