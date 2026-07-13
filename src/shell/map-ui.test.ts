// The map painter against a recording context: what reached the canvas, in what colour, and
// whether the range ring carried its still-air confession.
import { test, expect } from 'bun:test';
import { paintMap, RANGE_LABEL, REACH_LABEL, type MapPaint2D } from './map-ui';
import type { ReachRay } from '../core/reach';
import { EMPTY, type NavState } from '../core/nav';
import type { View } from './liftmap-ui';

function recorder() {
  const ops: string[] = [];
  const texts: string[] = [];
  const strokes: string[] = [];               // the colour each stroke went out in
  const ctx: MapPaint2D = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '',
    fillRect: () => ops.push('fillRect'),
    fillText: (t: string) => { ops.push('fillText'); texts.push(t); },
    beginPath: () => ops.push('beginPath'),
    moveTo: () => ops.push('moveTo'),
    lineTo: () => ops.push('lineTo'),
    arc: () => ops.push('arc'),
    stroke: () => { ops.push('stroke'); strokes.push(ctx.strokeStyle); },
    fill: () => ops.push('fill'),
    closePath: () => ops.push('closePath'),
  };
  return { ctx, ops, texts, strokes };
}

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
