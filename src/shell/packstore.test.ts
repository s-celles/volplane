// ============ the persistence claims, pinned ============
// All on memKV, which is not a mock: it is the shipped degraded mode, so every claim pinned
// here holds in the environment OFF-004 worries about. Two claims carry the suite. First,
// what is saved comes back (OFF-002) and what was never saved is null or the default — never
// a throw, never an invented record. Second, the budget executor (OFF-006) deletes exactly
// what core's plan names and nothing a pin protects.
import { expect, test } from 'bun:test';
import { memKV } from './store';
import { Z } from './terrain';
import { tileKey, tilesForArea, type PackSpec } from '../core/pack';
import type { Shelf } from '../core/shelf';
import {
  enforceBudget,
  heldForShelf,
  loadFlightFile,
  loadSettings,
  loadShelf,
  saveFlightFile,
  saveSettings,
  saveShelf,
  tileInventory,
} from './packstore';

/** A small alpine box — one or two tiles at Z, and the tests derive the exact list with
 *  tilesForArea rather than hardcoding tile numbers the projection could make a lie. */
const spec = (id: string): PackSpec => ({
  id,
  name: `Pack ${id}`,
  day: '2026-07-14',
  area: { west: 6.0, east: 6.02, south: 45.0, north: 45.02 },
});

// ---- shelf (OFF-002) ----

test('the shelf round-trips through the store', async () => {
  const kv = memKV();
  const shelf: Shelf = [
    { spec: spec('a'), pinned: true, addedAt: 1_000, lastUsedAt: 2_000 },
    { spec: spec('b'), pinned: false, addedAt: 1_500, lastUsedAt: 1_500 },
  ];
  await saveShelf(kv, shelf);
  expect(await loadShelf(kv)).toEqual(shelf);
});

test('an empty store is an empty shelf, not a throw', async () => {
  expect(await loadShelf(memKV())).toEqual([]);
});

test('bytes that are not JSON at the shelf key still load as an empty shelf', async () => {
  const kv = memKV();
  await kv.put('shelf', new TextEncoder().encode('{definitely not json'));
  expect(await loadShelf(kv)).toEqual([]);
});

// ---- settings (OFF-002) ----

test('settings round-trip: what was saved comes back', async () => {
  const kv = memKV();
  await saveSettings(kv, { cacheBudgetMB: 350 });
  expect(await loadSettings(kv)).toEqual({ cacheBudgetMB: 350 });
});

test('garbage settings answer with the factory defaults, never a throw', async () => {
  const kv = memKV();
  await kv.put('settings', new TextEncoder().encode('{not json'));
  expect(await loadSettings(kv)).toEqual(await loadSettings(memKV()));
});

// ---- flight files (OFF-002) ----

test('a flight file never stored is null, not an empty file', async () => {
  expect(await loadFlightFile(memKV(), 'airspace')).toBeNull();
  expect(await loadFlightFile(memKV(), 'task')).toBeNull();
});

test('a stored flight file comes back byte-identical, and kinds do not bleed', async () => {
  const kv = memKV();
  // Accents, CRLF, non-Latin — the text a real OpenAir file drags in. Byte-identical means
  // the store did not "helpfully" normalize anything the parser might one day care about.
  const f = { name: 'france-2026.txt', text: 'AC D\r\nAN TMA Genève\n* 高度 ±500m\n' };
  await saveFlightFile(kv, 'airspace', f);
  expect(await loadFlightFile(kv, 'airspace')).toEqual(f);
  expect(await loadFlightFile(kv, 'task')).toBeNull();
});

// ---- heldForShelf (OFF-009) ----

test('heldForShelf measures each pack under its own id', async () => {
  const kv = memKV();
  const a = spec('a');
  const owed = tilesForArea(a.area, Z).map(tileKey);
  expect(owed.length).toBeGreaterThan(0);   // the premise: this area really owes tiles
  await kv.put(`tile/${owed[0]}`, new Uint8Array(10));

  const held = await heldForShelf(
    [{ spec: a, pinned: false, addedAt: 0, lastUsedAt: 0 }],
    kv,
  );
  expect(held.get('a')?.tiles.has(owed[0])).toBe(true);
  // No snapshot was ever provisioned: null, not a zeroed forecast (POT-007's principle).
  expect(held.get('a')?.weather).toBeNull();
});

// ---- inventory and budget (OFF-006) ----

test('tileInventory sums the bytes actually put, and only tiles', async () => {
  const kv = memKV();
  await kv.put('tile/12/1/1', new Uint8Array(100));
  await kv.put('tile/12/1/2', new Uint8Array(250));
  await kv.put('wx/some-pack', new Uint8Array(999));   // weather is outside the budget
  await kv.put('shelf', new Uint8Array(50));           // bookkeeping is not cargo

  const inv = await tileInventory(kv);
  expect(inv.map(e => e.key).sort()).toEqual(['tile/12/1/1', 'tile/12/1/2']);
  expect(inv.reduce((sum, e) => sum + e.bytes, 0)).toBe(350);
});

test('enforceBudget deletes orphans, spares every pinned tile, and admits overBudget', async () => {
  const kv = memKV();
  const pinnedPack = spec('pinned');
  const owed = tilesForArea(pinnedPack.area, Z).map(t => `tile/${tileKey(t)}`);
  expect(owed.length).toBeGreaterThan(0);
  for (const k of owed) await kv.put(k, new Uint8Array(100));
  await kv.put('tile/12/0/0', new Uint8Array(100));    // an orphan: no pack owes it

  const shelf: Shelf = [{ spec: pinnedPack, pinned: true, addedAt: 0, lastUsedAt: 0 }];
  const plan = await enforceBudget(kv, shelf, 10);     // a budget nothing pinned can fit

  // The orphan goes; the pinned pack's tiles are not even candidates (OFF-007 outranks
  // OFF-006); and the plan SAYS the ceiling is unreachable instead of pretending otherwise.
  expect(plan.evict).toEqual(['tile/12/0/0']);
  expect(plan.overBudget).toBe(true);

  // The deletes really happened — a deleted key reads as never-stored, and every owed key
  // still answers with its bytes.
  expect(await kv.get('tile/12/0/0')).toBeNull();
  for (const k of owed) expect(await kv.get(k)).not.toBeNull();
});
