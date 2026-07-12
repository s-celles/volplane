// ============ what these tests pin ============
// The provisioning CLAIMS, per the spec:
//   OFF-003 — downloading a pack stores every tile the area owes, plus the weather snapshot,
//             and a cut download resumes instead of refetching what is already held;
//   OFF-004 — the flight-side reads (loadWeather, terrainStore-over-KV) touch NO network:
//             both are exercised here with fetch dead or absent, which in bun is not a
//             simulation of the offline case but the case itself;
//   OFF-005 — fetchedAt and day are recorded beside the snapshot, so validity can be shown;
//   OFF-010 — heldFor feeds core/pack.completeness and the missing tile comes out BY NAME;
//   WX-001  — the snapshot request carries core/briefing's exact variable list.
// Everything runs against memKV and an injected fetchFn — no sockets anywhere.

import { test, expect } from 'bun:test';
import UPNG from 'upng-js';
import { lonLatToTile, sampleTerrarium, type BBox } from 'soaring-core/geo';
import { completeness, tileKey, tilesForArea, type PackSpec } from '../core/pack';
import { OPEN_METEO_HOURLY } from '../core/briefing';
import { getJson, memKV, putJson, type KV } from './store';
import { downloadPack, heldFor, loadWeather, type WxMeta } from './provision';
import { terrainStore, URL_TPL, Z } from './terrain';

// ---- fixtures ----

// z12 tile 2105/1478 covers ~5.010..5.098 E, ~44.68..44.75 N; this bbox sits strictly inside
// it. The premise (exactly one tile owed) is asserted in the first test rather than trusted.
const ONE_TILE_AREA: BBox = { west: 5.03, east: 5.07, south: 44.7, north: 44.71 };

// Same band stretched east past the 2105/2106 tile boundary at ~5.098 E: two tiles owed.
const TWO_TILE_AREA: BBox = { west: 5.03, east: 5.12, south: 44.7, north: 44.71 };

const spec = (area: BBox): PackSpec => ({ id: 'p1', name: 'test pack', area, day: '2026-07-12' });

const NOW = Date.UTC(2026, 6, 11, 19, 0, 0);   // the evening before the flight day

// A real 1×1 terrarium PNG, encoded with the same library the store decodes with. The pixel
// (128, 100, 0) spells 100 m — a value the decode side can be held to, not just "some bytes".
// UPNG's encode half is untyped in our minimal .d.ts (the shell never encodes), so the test
// asserts the shape here instead. forbidPlte, because UPNG 2.1.0's decoder trips over its
// own sub-8-bit palette encoding of tiny images — and a real terrarium tile is truecolor
// anyway, so the truecolor fixture is also the more faithful one.
const TILE_PNG: Uint8Array = new Uint8Array(
  (UPNG as unknown as {
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels: number[], forbidPlte: boolean): ArrayBuffer;
  }).encode([new Uint8Array([128, 100, 0, 255]).buffer as ArrayBuffer], 1, 1, 0, [], true),
);

// A minimal Open-Meteo payload parseOpenMeteo accepts: one hour, surface fields only.
const OM_PAYLOAD = {
  elevation: 450,
  hourly: {
    time: ['2026-07-12T10:00'],
    temperature_2m: [25],
    relative_humidity_2m: [40],
    wind_speed_10m: [3],
    wind_direction_10m: [270],
    shortwave_radiation: [700],
    diffuse_radiation: [120],
    boundary_layer_height: [1800],
  },
};

/** A fetch that serves TILE_PNG for tile URLs and OM_PAYLOAD for the forecast URL, logging
 *  every request — the log is how the resume test counts to zero. */
function fakeFetch(log: string[], failTiles: Set<string> = new Set()): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    log.push(url);
    if (url.includes('api.open-meteo.com')) return new Response(JSON.stringify(OM_PAYLOAD));
    const m = url.match(/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m && failTiles.has(`${m[1]}/${m[2]}/${m[3]}`)) return new Response('gone', { status: 500 });
    return new Response(TILE_PNG.slice());
  }) as typeof fetch;
}

const tileFetches = (log: string[]) => log.filter(u => u.includes('terrarium')).length;

// ---- OFF-003: the download stores what the pack owes ----

test('downloadPack stores every owed tile plus wx and wxmeta, and progress completes', async () => {
  const s = spec(ONE_TILE_AREA);
  const owed = tilesForArea(s.area, Z);
  expect(owed).toHaveLength(1);   // the fixture's premise, not an assumption

  const kv = memKV();
  const progress: Array<[number, number]> = [];
  const res = await downloadPack(s, kv, fakeFetch([]), (d, t) => progress.push([d, t]), () => NOW);

  expect(res).toEqual({ ok: 2, failed: 0 });   // 1 tile + 1 snapshot
  expect(await kv.get(`tile/${tileKey(owed[0])}`)).toEqual(TILE_PNG);
  // The snapshot is the RAW payload — bytes the parser reads later, not a pre-digested form.
  expect(JSON.parse(new TextDecoder().decode((await kv.get('wx/p1'))!))).toEqual(OM_PAYLOAD);
  // OFF-005: validity is recorded — the injected clock and the spec's day, nothing invented.
  expect(await getJson<WxMeta>(kv, 'wxmeta/p1')).toEqual({ fetchedAt: NOW, day: '2026-07-12' });
  // The bar reaches the end: last report is (total, total).
  expect(progress[progress.length - 1]).toEqual([2, 2]);
});

test('the snapshot request carries core-briefing variables and the flight day (WX-001)', async () => {
  const log: string[] = [];
  await downloadPack(spec(ONE_TILE_AREA), memKV(), fakeFetch(log), () => {}, () => NOW);
  const wxUrl = log.find(u => u.includes('api.open-meteo.com'))!;
  expect(wxUrl).toContain(`hourly=${OPEN_METEO_HOURLY.join(',')}`);
  expect(wxUrl).toContain('start_date=2026-07-12');
  expect(wxUrl).toContain('end_date=2026-07-12');
});

test('a second download over the same store fetches ZERO tiles (resume)', async () => {
  const s = spec(TWO_TILE_AREA);
  expect(tilesForArea(s.area, Z)).toHaveLength(2);

  const kv = memKV();
  await downloadPack(s, kv, fakeFetch([]), () => {}, () => NOW);

  const log: string[] = [];
  const res = await downloadPack(s, kv, fakeFetch(log), () => {}, () => NOW);
  expect(tileFetches(log)).toBe(0);
  // The held tiles still count as ok — they ARE held, which is all ok claims.
  expect(res).toEqual({ ok: 3, failed: 0 });
  // The forecast, by contrast, is refetched: a tile does not age, a forecast does (OFF-011).
  expect(log.filter(u => u.includes('api.open-meteo.com'))).toHaveLength(1);
});

test('one failing tile is counted, the others land, nothing throws', async () => {
  const s = spec(TWO_TILE_AREA);
  const [good, bad] = tilesForArea(s.area, Z);

  const kv = memKV();
  const res = await downloadPack(s, kv, fakeFetch([], new Set([tileKey(bad)])), () => {}, () => NOW);

  expect(res.failed).toBe(1);
  expect(res.ok).toBe(2);   // the good tile and the snapshot
  expect(await kv.get(`tile/${tileKey(good)}`)).toEqual(TILE_PNG);
  // The failed tile is genuinely absent — not present-but-empty, which would poison the
  // resume logic AND the completeness count at once.
  expect(await kv.get(`tile/${tileKey(bad)}`)).toBeNull();
});

// ---- OFF-004: the flight-side weather read never needs a network ----

test('loadWeather reads the parsed Wx from the store with fetch counting zero', async () => {
  const s = spec(ONE_TILE_AREA);
  const kv = memKV();
  await kv.put('wx/p1', new TextEncoder().encode(JSON.stringify(OM_PAYLOAD)));

  // Kill the global fetch and count the corpse's visitors: the offline read is only proven
  // offline if a network attempt would have been SEEN, not merely believed absent.
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error('network is dead'); }) as unknown as typeof fetch;
  try {
    const wx = await loadWeather(s, kv, 500);
    expect(calls).toBe(0);
    expect(wx).not.toBeNull();
    expect(wx!.ref).toBe(450);   // the payload's elevation, not the fallback
    expect(wx!.hours).toHaveLength(1);
    expect(wx!.hours[0].cloudbase).not.toBeNull();
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loadWeather of a never-provisioned pack is null — not an empty forecast', async () => {
  expect(await loadWeather(spec(ONE_TILE_AREA), memKV(), 500)).toBeNull();
});

// ---- OFF-010: held → completeness, and the hole has a name ----

test('heldFor reports the stored subset and completeness names the missing tile', async () => {
  const s = spec(TWO_TILE_AREA);
  const [have, miss] = tilesForArea(s.area, Z);

  const kv = memKV();
  await kv.put(`tile/${tileKey(have)}`, TILE_PNG);
  // A tile of some OTHER pack must not count as coverage of this one.
  await kv.put('tile/12/0/0', TILE_PNG);
  await putJson(kv, 'wxmeta/p1', { fetchedAt: NOW, day: '2026-07-12' });

  const held = await heldFor(s, kv);
  expect(held.tiles).toEqual(new Set([tileKey(have)]));
  expect(held.weather).toEqual({ fetchedAt: NOW, day: '2026-07-12' });

  // The whole OFF-010 chain in one breath: what the shell holds, measured by the core,
  // comes back as a per-kind report — and the difference NAMES the tile the pilot lacks.
  const c = completeness(s, held, Z, NOW);
  const terrain = c.items.find(i => i.kind === 'terrain')!;
  expect(terrain.status).toBe('partial');
  expect(terrain.heldCount).toBe(1);
  expect(terrain.totalCount).toBe(2);
  expect(c.ready).toBe(false);
  const missing = tilesForArea(s.area, Z).map(tileKey).filter(k => !held.tiles.has(k));
  expect(missing).toEqual([tileKey(miss)]);
});

// ---- OFF-004 again, terrain side: the ground comes off the disk with the network dead ----

test('terrainStore over a provisioned KV serves the tile with fetch throwing', async () => {
  const lon = 5.05, lat = 44.705;
  const { xf, yf } = lonLatToTile(lon, lat, Z);
  const key = `${Z}/${Math.floor(xf)}/${Math.floor(yf)}`;

  const kv: KV = memKV();
  await kv.put(`tile/${key}`, TILE_PNG);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('network is dead'); }) as unknown as typeof fetch;
  try {
    let fired = 0;
    const store = terrainStore(() => { fired++; }, URL_TPL, Date.now, kv);
    store.ensure(lon, lat);

    // The KV read is async behind a sync lookup; give the microtask queue a beat.
    for (let i = 0; i < 100 && store.lookup(Z, Math.floor(xf), Math.floor(yf)) === null; i++) {
      await new Promise(r => setTimeout(r, 5));
    }

    const tile = store.lookup(Z, Math.floor(xf), Math.floor(yf));
    expect(tile).not.toBeNull();
    expect(tile!.w).toBe(1);
    expect(sampleTerrarium(tile!, 0, 0)).toBe(100);   // the pixel we encoded, byte-exact
    expect(fired).toBeGreaterThanOrEqual(1);

    // The 8 neighbours were NOT on disk and the network is dead: they stay UNKNOWN — null,
    // never zero — exactly the honest degradation OFF-004 demands.
    expect(store.lookup(Z, Math.floor(xf) + 1, Math.floor(yf))).toBeNull();
  } finally {
    globalThis.fetch = realFetch;
  }
});
