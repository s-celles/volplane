// The map painter against a recording context: what reached the canvas, in what colour, and
// whether the range ring carried its still-air confession.
import { test, expect } from 'bun:test';
import { paintMap, RANGE_LABEL, type MapPaint2D } from './map-ui';
import { EMPTY, type NavState } from '../core/nav';
import type { View } from './liftmap-ui';

function recorder() {
  const ops: string[] = [];
  const texts: string[] = [];
  const ctx: MapPaint2D = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '',
    fillRect: () => ops.push('fillRect'),
    fillText: (t: string) => { ops.push('fillText'); texts.push(t); },
    beginPath: () => ops.push('beginPath'),
    moveTo: () => ops.push('moveTo'),
    lineTo: () => ops.push('lineTo'),
    arc: () => ops.push('arc'),
    stroke: () => ops.push('stroke'),
    fill: () => ops.push('fill'),
    closePath: () => ops.push('closePath'),
  };
  return { ctx, ops, texts };
}

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
