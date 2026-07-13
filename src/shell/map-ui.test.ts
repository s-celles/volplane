// The map painter against a recording context: what reached the canvas, in what colour, and
// whether the range ring carried its still-air confession.
import { test, expect } from 'bun:test';
import {
  paintMap as paintMapT, UNLOADED_FILL, LANDABLE_COLOR,
  type MapPaint2D,
} from './map-ui';
import { translator } from '../core/i18n';

// IHM-006: the canvas labels are catalogue entries now — the claims are unchanged, the words
// have one home. The tests read them back through the same catalogue the painter writes from.
const en = translator('en');
const paintMap = (
  ctx: Parameters<typeof paintMapT>[0], view: Parameters<typeof paintMapT>[1],
  input: Parameters<typeof paintMapT>[2],
): void => paintMapT(ctx, view, input, en);
const RANGE_LABEL = en('map.range');
const REACH_LABEL = en('map.reach');
const TERRAIN_UNLOADED_LABEL = (pct: number): string => en('map.terrainUnloaded', { pct });
const LANDABLE_SCOPE_LABEL = (judged: number, inRadius: number, radiusM: number): string =>
  en('map.landableScope', { judged, inRadius, dist: `${Math.round(radiusM / 1000)} km` });
const LANDABLES_STALE_LABEL = en('map.landablesStale');
import type { ReachRay } from '../core/reach';
import type { Alternate, LandState } from '../core/landables';
import type { Poi, PoiCat } from '../core/cup';
import { EMPTY, type NavState } from '../core/nav';
import type { View } from './liftmap-ui';

function recorder() {
  const ops: string[] = [];
  const texts: string[] = [];
  const strokes: string[] = [];               // the colour each stroke went out in
  const fills: string[] = [];                 // …and each fill/fillRect
  const ctx: MapPaint2D = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '',
    fillRect: () => { ops.push('fillRect'); fills.push(ctx.fillStyle); },
    fillText: (t: string) => { ops.push('fillText'); texts.push(t); },
    beginPath: () => ops.push('beginPath'),
    moveTo: () => ops.push('moveTo'),
    lineTo: () => ops.push('lineTo'),
    arc: () => ops.push('arc'),
    stroke: () => { ops.push('stroke'); strokes.push(ctx.strokeStyle); },
    fill: () => { ops.push('fill'); fills.push(ctx.fillStyle); },
    closePath: () => ops.push('closePath'),
  };
  return { ctx, ops, texts, strokes, fills };
}

/** A landable, already judged by core — the painter is never allowed to re-judge one. */
const point = (name: string, lon: number, cat: PoiCat): Poi =>
  ({ name, code: name, country: 'FR', lon, lat: 47, elevM: 500, cat, rwdirDeg: null, rwlenM: null, freq: null, desc: '', raw: null });

const field = (name: string, lon: number, state: LandState, cat: PoiCat = 'outlanding'): Alternate =>
  ({ point: point(name, lon, cat), state, marginM: state === 'indeterminate' ? null : 300, distanceM: 4000, bearingDeg: 90, limit: 'glide' });

/** A reach polygon whose bearings end for the three different reasons. */
const ray = (bearing: number, limit: ReachRay['limit']): ReachRay =>
  ({ bearing, limit, distanceM: 5000, lon: 8 + bearing / 1000, lat: 47 });

const view: View = { centre: { lon: 8, lat: 47 }, widthM: 20000, wPx: 400, hPx: 400 };
const fix: NavState = { ...EMPTY, fix: { sod: 43200, lat: 47, lon: 8, alt: 1500 }, track: 90 };

test('an empty sky paints only the background', () => {
  const { ctx, ops } = recorder();
  paintMap(ctx, view, { state: EMPTY, trail: [], spaces: [], traffic: [], goal: null, rangeM: null });
  expect(ops).toEqual(['fillRect']);
});

test('the glide range ring never appears without its still-air label', () => {
  const { ctx, texts, ops } = recorder();
  paintMap(ctx, view, { state: fix, trail: [], spaces: [], traffic: [], goal: null, rangeM: 8000 });
  expect(ops.filter(o => o === 'arc').length).toBeGreaterThanOrEqual(1);
  expect(texts).toContain(RANGE_LABEL);
});

test('the reach polygon SUPERSEDES the still-air circle, and says so', () => {
  const { ctx, texts } = recorder();
  paintMap(ctx, view, {
    state: fix, trail: [], spaces: [], traffic: [], goal: null,
    rangeM: 8000,                                   // a circle IS available…
    reach: [ray(0, 'glide'), ray(90, 'glide'), ray(180, 'glide'), ray(270, 'glide')],
  });
  expect(texts).toContain(REACH_LABEL);             // …and the terrain-aware reach wins
  expect(texts).not.toContain(RANGE_LABEL);
});

test('a ridge segment is painted as a WALL, not as open glide (TER-005)', () => {
  const { ctx, strokes } = recorder();
  paintMap(ctx, view, {
    state: fix, trail: [], spaces: [], traffic: [], goal: null, rangeM: null,
    reach: [
      ray(0, 'glide'), ray(60, 'glide'),         // 0→60: open glide, both ends
      ray(120, 'terrain'), ray(180, 'terrain'),  // the wall
      ray(240, 'unknown'), ray(300, 'glide'),    // the unmeasured
    ],
  });
  // Red for the wall, grey for the unmeasured, green for the open glide — three different
  // facts, three different colours, exactly as TER-005 demands.
  expect(strokes).toContain('#e05252');
  expect(strokes).toContain('#8b93a1');
  expect(strokes).toContain('#4caf78');
});

test('a segment running from open glide INTO a ridge is the ridge — the worse end wins', () => {
  // Rounding such an edge down to green would sell the mountain: the pilot would read an open
  // corridor where half of it is rock.
  const { ctx, strokes } = recorder();
  paintMap(ctx, view, {
    state: fix, trail: [], spaces: [], traffic: [], goal: null, rangeM: null,
    reach: [ray(0, 'glide'), ray(90, 'terrain'), ray(180, 'glide'), ray(270, 'glide')],
  });
  expect(strokes.filter(c => c === '#e05252').length).toBe(2);   // BOTH edges touching the ridge
  expect(strokes).toContain('#4caf78');                          // 180→270 is genuinely open
});

test('with no reach marched, the circle still flies — and still confesses its still air', () => {
  const { ctx, texts } = recorder();
  paintMap(ctx, view, {
    state: fix, trail: [], spaces: [], traffic: [], goal: null, rangeM: 8000, reach: null,
  });
  expect(texts).toContain(RANGE_LABEL);
});

test('airspace, trail, traffic and goal each reach the canvas', () => {
  const { ctx, ops } = recorder();
  paintMap(ctx, view, {
    state: fix,
    trail: [[7.99, 47], [8, 47]],
    spaces: [{ name: 'T', class: 'D', floor: null, ceiling: null, polygon: [[7.9, 46.9], [8.1, 46.9], [8.1, 47.1]] }],
    traffic: [{ id: 'X', alarm: 2, relNorth: 500, relEast: 0, relVertical: 0, track: null, groundSpeed: null, climbRate: null, at: 43200 }],
    goal: { lon: 8.05, lat: 47 },
    rangeM: null,
  });
  expect(ops.filter(o => o === 'stroke').length).toBeGreaterThanOrEqual(3);   // space + trail + goal
  expect(ops.filter(o => o === 'fill').length).toBeGreaterThanOrEqual(2);     // glider + traffic dot
});

// ---- TER-001: the ground ----

const base = { state: fix, trail: [] as [number, number][], spaces: [], traffic: [], goal: null, rangeM: null };
const flat = { elev: () => 800, epoch: 1 };
const nothing = { elev: () => null, epoch: 1 };

test('the map paints the ground before it paints anything on it (TER-001)', () => {
  const { ctx, ops } = recorder();
  paintMap(ctx, view, {
    ...base, terrain: flat,
    spaces: [{ name: 'T', class: 'D', floor: null, ceiling: null, polygon: [[7.9, 46.9], [8.1, 46.9], [8.1, 47.1]] }],
  });
  // Background, then a raster of cells, and only THEN the first line drawn over it. A ridge
  // painted on top of the airspace it is supposed to lie under is a ridge nobody sees.
  expect(ops[0]).toBe('fillRect');
  const firstStroke = ops.indexOf('stroke');
  const rectsBefore = ops.slice(0, firstStroke).filter(o => o === 'fillRect').length;
  expect(rectsBefore).toBeGreaterThan(100);
});

test('unloaded ground stays visibly unloaded — not flat, not sea', () => {
  const { ctx, fills, texts } = recorder();
  paintMap(ctx, view, { ...base, terrain: nothing });
  // Nothing from the hypsometric ramp reached the canvas: no cell claims to be ground.
  expect(fills.filter(c => c.startsWith('rgb('))).toHaveLength(0);
  expect(fills).toContain(UNLOADED_FILL);                     // the hatch, instead
  expect(texts).toContain(TERRAIN_UNLOADED_LABEL(100));       // …and the number, said out loud
});

test('a measured DEM is painted in its own colours, and says nothing about missing ground', () => {
  const { ctx, fills, texts } = recorder();
  paintMap(ctx, view, { ...base, terrain: flat });
  expect(fills.filter(c => c.startsWith('rgb(')).length).toBeGreaterThan(100);
  expect(fills).not.toContain(UNLOADED_FILL);
  expect(texts.some(t => t.includes('NOT loaded'))).toBe(false);
});

test('the shade raster is not recomputed while the epoch and the view hold still', () => {
  let calls = 0;
  const counted = (): number => { calls++; return 800; };

  const a = recorder();
  paintMap(a.ctx, view, { ...base, terrain: { elev: counted, epoch: 7 } });
  const first = calls;
  expect(first).toBeGreaterThan(0);

  const b = recorder();
  paintMap(b.ctx, view, { ...base, terrain: { elev: counted, epoch: 7 } });
  expect(calls).toBe(first);                     // same ground, same window: not one sample more
  expect(b.ops.filter(o => o === 'fillRect').length).toBeGreaterThan(100);   // …but still painted

  const c = recorder();
  paintMap(c.ctx, view, { ...base, terrain: { elev: counted, epoch: 8 } });  // a tile landed
  expect(calls).toBeGreaterThan(first);
});

test('a different DEM at the same epoch is a different DEM — the cache does not confuse them', () => {
  // A pack swapped for an empty one, the epoch untouched. Handing back the old hillshade here
  // would draw measured ground the new sampler knows nothing about: a wrong shade is worse than
  // no shade, because it is drawn with confidence.
  const a = recorder();
  paintMap(a.ctx, view, { ...base, terrain: { elev: () => 800, epoch: 3 } });
  expect(a.fills.some(c => c.startsWith('rgb('))).toBe(true);

  const b = recorder();
  paintMap(b.ctx, view, { ...base, terrain: { elev: () => null, epoch: 3 } });
  expect(b.fills.some(c => c.startsWith('rgb('))).toBe(false);
  expect(b.texts).toContain(TERRAIN_UNLOADED_LABEL(100));
});

// ---- LND-003: the three states ----

test('an indeterminate field is never painted as reachable (LND-003)', () => {
  const { ctx, strokes, fills, texts } = recorder();
  paintMap(ctx, view, {
    ...base,
    landables: [
      field('REACHABLE', 8.01, 'reachable'),
      field('OUT OF GLIDE', 8.02, 'unreachable', 'airfield-gliding'),
      field('UNMEASURED', 8.03, 'indeterminate', 'airfield-gliding'),
    ],
  });
  const marks = [...strokes, ...fills];
  expect(marks).toContain(LANDABLE_COLOR.indeterminate);
  expect(marks).toContain(LANDABLE_COLOR.unreachable);
  // The one green mark on the map is the one field core called reachable. The unmeasured field
  // borrowing that green — the field whose ground the DEM never answered for — is the failure
  // this test exists to make impossible.
  expect(marks.filter(c => c === LANDABLE_COLOR.reachable)).toHaveLength(1);
  expect(texts).toContain('REACHABLE');          // only the top reachable field is named
  expect(texts).not.toContain('UNMEASURED');
});

// ---- LND-002: the layer draws what was ASKED, and says where the asking stopped ----

test('the landable layer states its own boundary — a bare corner is "not asked", not "nothing there"', () => {
  // The rings only ever cover the fields core marched: the nearest few, inside a search radius
  // that is a COST bound. Zoom out to 200 km with a French .cup and the outer half of the frame is
  // empty of rings while being full of airfields the file knows about — and the layer LOOKS
  // authoritative, so the pilot reads that emptiness as an answer. It is not one.
  const { ctx, texts, strokes } = recorder();
  paintMap(ctx, view, {
    ...base,
    landables: [field('SERRES', 8.01, 'reachable')],
    landableScope: { radiusM: 80_000, judged: 30, inRadius: 52 },
  });

  expect(texts).toContain(LANDABLE_SCOPE_LABEL(30, 52, 80_000));
  expect(texts.some(t => t.includes('30 of 52'))).toBe(true);   // the number, not just a hint
  expect(strokes).toContain(LANDABLE_COLOR.indeterminate);      // the boundary, in the unmeasured grey
});

test('no scope, no claim: a map with no landable question asked draws no boundary', () => {
  const { ctx, texts } = recorder();
  paintMap(ctx, view, { ...base, landables: [field('SERRES', 8.01, 'reachable')] });
  expect(texts.some(t => t.includes('judged within'))).toBe(false);
});

// ---- SYS-002: the rings age with the link ----

test('a stale fix dims the rings and withdraws the name — an offer is not made from an old fix', () => {
  // Naming the top reachable field is an OFFER. Made from a fix that stopped arriving two minutes
  // ago, it is an offer about a position and a height the glider no longer has. The verdicts keep
  // their colours (a thing that WAS measured is not unmeasured now — repainting them grey would
  // collapse them into 'indeterminate', which means something else), but they stop looking current.
  const { ctx, texts } = recorder();
  paintMap(ctx, view, {
    ...base,
    landables: [field('SERRES', 8.01, 'reachable')],
    landableScope: { radiusM: 80_000, judged: 1, inRadius: 1 },
    stale: true,
  });

  expect(texts).toContain(LANDABLES_STALE_LABEL);
  expect(texts).not.toContain('SERRES');          // the offer is withdrawn, not merely faded
});

test('a live link names the top field and says nothing about staleness', () => {
  const { ctx, texts } = recorder();
  paintMap(ctx, view, {
    ...base,
    landables: [field('SERRES', 8.01, 'reachable')],
    landableScope: { radiusM: 80_000, judged: 1, inRadius: 1 },
  });
  expect(texts).toContain('SERRES');
  expect(texts).not.toContain(LANDABLES_STALE_LABEL);
});
