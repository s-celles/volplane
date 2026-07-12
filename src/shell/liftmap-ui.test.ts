// ============ liftmap-ui: the claims of the paint pass and the mixer ============
// The painter's contract is small and all of it is pinned here: patches land where the
// projection says, disabled components leave no trace, the weights redistribute exactly as
// the kernel's blend says, and the POT-007 watermark is on EVERY frame — including the empty
// one. The recorder stands in for the canvas: the Paint2D interface is the whole surface the
// painter may touch, so an array of recorded ops IS the rendered picture.

import { test, expect } from 'bun:test';
import {
  paintLiftMap, project, mixerSvg, mixerHit, mixerVerts, legendHtml,
  WATERMARK, MIXER_PAD, type Paint2D, type View,
} from './liftmap-ui';
import type { LiftMap, LiftLayer, Patch } from '../core/liftmap';
import { simplexVerts } from 'soaring-core/lift/mix';
import { mPerLng } from 'soaring-core/geo';

// ---- the recorder ----

type RectOp = { x: number; y: number; w: number; h: number; alpha: number; fill: string };
type TextOp = { t: string; x: number; y: number };

// The globalAlpha setter is itself an assertion: the painter must never hand the canvas a
// non-finite alpha (claim 6), and checking at the assignment catches it wherever it happens.
function recorder(): { ctx: Paint2D; rects: RectOp[]; texts: TextOp[] } {
  const rects: RectOp[] = [];
  const texts: TextOp[] = [];
  let alpha = 1;
  const ctx: Paint2D = {
    fillStyle: '',
    font: '',
    get globalAlpha() { return alpha; },
    set globalAlpha(v: number) {
      expect(Number.isFinite(v)).toBe(true);
      alpha = v;
    },
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, alpha, fill: this.fillStyle }); },
    fillText(t, x, y) { texts.push({ t, x, y }); },
  };
  return { ctx, rects, texts };
}

// ---- fixtures: hand-built maps, because the painter must not care where they came from ----

const layer = (patches: Patch[]): LiftLayer => ({ patches, readiness: 1, active: true });
const empty = (): LiftLayer => ({ patches: [], readiness: 1, active: true });

const mapOf = (p: Partial<Record<'thermal' | 'slope' | 'converg' | 'wave', Patch[]>>): LiftMap => ({
  modelled: true,
  components: {
    thermal: p.thermal ? layer(p.thermal) : empty(),
    slope: p.slope ? layer(p.slope) : empty(),
    converg: p.converg ? layer(p.converg) : empty(),
    wave: p.wave ? layer(p.wave) : empty(),
  },
});

const VIEW: View = { centre: { lon: 6, lat: 45 }, widthM: 20000, wPx: 400, hPx: 300 };
const ALL_ON = [true, true, true, true];
const EVEN = [1, 1, 1, 1];

// The kernel's swatches, as the painter serialises them — the fillStyle a layer must carry.
const SLOPE_FILL = 'rgb(150,200,90)';
const THERMAL_FILL = 'rgb(235,140,60)';
const CONVERG_FILL = 'rgb(110,190,165)';

// ---- claim 1: patches land where the projection says, and the watermark is always there ----

test('one slope patch at the view centre paints one rect centred on the canvas, plus the watermark', () => {
  const { ctx, rects, texts } = recorder();
  const map = mapOf({ slope: [{ lon: 6, lat: 45, sizeM: 500, color: [150, 200, 90, 255] }] });
  paintLiftMap(ctx, map, VIEW, ALL_ON, EVEN);
  expect(rects.length).toBe(1);
  expect(Math.abs(rects[0].x + rects[0].w / 2 - VIEW.wPx / 2)).toBeLessThan(1);
  expect(Math.abs(rects[0].y + rects[0].h / 2 - VIEW.hPx / 2)).toBeLessThan(1);
  expect(rects[0].fill).toBe(SLOPE_FILL);
  expect(texts.map(t => t.t)).toContain(WATERMARK);
});

test('POT-007: the watermark is painted even over a map with zero patches', () => {
  const { ctx, rects, texts } = recorder();
  paintLiftMap(ctx, mapOf({}), VIEW, ALL_ON, EVEN);
  expect(rects.length).toBe(0);
  expect(texts.length).toBe(1);
  expect(texts[0].t).toBe(WATERMARK);
});

// ---- claim 2: a disabled component paints nothing, and its weight goes to the others ----

test('disabling a component removes its patches and raises the remaining layers to the blend', () => {
  const map = mapOf({
    slope: [{ lon: 6, lat: 45, sizeM: 500, color: [150, 200, 90, 255] }],
    converg: [{ lon: 6.01, lat: 45, sizeM: 500, color: [110, 190, 165, 255] }],
  });

  const a = recorder();
  paintLiftMap(a.ctx, map, VIEW, ALL_ON, EVEN);
  const slopeBefore = a.rects.find(r => r.fill === SLOPE_FILL)!;
  expect(a.rects.some(r => r.fill === CONVERG_FILL)).toBe(true);
  expect(slopeBefore.alpha).toBeCloseTo(0.25, 6);          // four enabled, even mix

  const b = recorder();
  paintLiftMap(b.ctx, map, VIEW, [true, true, false, false], EVEN);
  expect(b.rects.some(r => r.fill === CONVERG_FILL)).toBe(false);
  const slopeAfter = b.rects.find(r => r.fill === SLOPE_FILL)!;
  expect(slopeAfter.alpha).toBeCloseTo(0.5, 6);            // two enabled: 0.25 → 0.5
  expect(slopeAfter.alpha).toBeGreaterThan(slopeBefore.alpha);
});

// ---- claim 3: the projection, and the clip ----

test('a point 1000 m east of centre lands proportionally right of centre', () => {
  const lonEast = VIEW.centre.lon + 1000 / mPerLng(VIEW.centre.lat);
  const [x, y] = project(VIEW, lonEast, VIEW.centre.lat);
  expect(x).toBeCloseTo(VIEW.wPx / 2 + 1000 * (VIEW.wPx / VIEW.widthM), 6);
  expect(y).toBeCloseTo(VIEW.hPx / 2, 6);
});

test('a patch outside the view paints nothing — but the watermark still appears', () => {
  const lonFar = VIEW.centre.lon + 30000 / mPerLng(VIEW.centre.lat);   // 3× the half-width
  const map = mapOf({ thermal: [{ lon: lonFar, lat: 45, sizeM: 500, color: [235, 140, 60, 255] }] });
  const { ctx, rects, texts } = recorder();
  paintLiftMap(ctx, map, VIEW, ALL_ON, EVEN);
  expect(rects.length).toBe(0);
  expect(texts.map(t => t.t)).toContain(WATERMARK);
});

// ---- claim 4: the mixer hit-test ----

test('mixerHit at a vertex gives that component weight 1 and the others 0', () => {
  const V = mixerVerts(ALL_ON, 200);
  const w = mixerHit(V[0][0], V[0][1], ALL_ON, 200);       // vertex 0 = thermal (mixer order)
  expect(w.length).toBe(4);
  expect(Math.abs(w[0] - 1)).toBeLessThan(1e-6);
  for (const i of [1, 2, 3]) expect(Math.abs(w[i])).toBeLessThan(1e-6);
});

test('mixerHit clamps a drag point outside the polygon: weights still sum to 1, none negative', () => {
  const w = mixerHit(-500, -500, ALL_ON, 200);
  expect(Math.abs(w.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-6);
  for (const v of w) expect(v).toBeGreaterThanOrEqual(0);
});

test('a disabled component has no vertex and keeps weight 0 in the returned array', () => {
  const on = [true, false, true, true];                    // slope off
  const V = mixerVerts(on, 200);
  const w = mixerHit(V[1][0], V[1][1], on, 200);           // vertex 1 is converg once slope is gone
  expect(w[1]).toBe(0);
  expect(Math.abs(w[2] - 1)).toBeLessThan(1e-6);
});

// ---- claim 5: the mixer widget, pinned against the kernel's geometry ----

test('mixerSvg with 2 enabled components draws a segment on the simplexVerts endpoints', () => {
  const on = [true, true, false, false];
  const svg = mixerSvg(on, [0.5, 0.5, 0, 0], 200);
  const V = simplexVerts(2, 100, 100, 100 - MIXER_PAD);
  expect(svg).toContain('<line');
  expect(svg).not.toContain('<polygon');
  expect(svg).toContain(`x1="${V[0][0]}"`);
  expect(svg).toContain(`x2="${V[1][0]}"`);
  expect(svg).toContain('thermal');
  expect(svg).toContain('slope');
});

test('mixerSvg with 4 enabled components draws a 4-vertex polygon matching simplexVerts', () => {
  const svg = mixerSvg(ALL_ON, EVEN, 200);
  const V = simplexVerts(4, 100, 100, 100 - MIXER_PAD);
  const m = svg.match(/<polygon[^>]*points="([^"]+)"/);
  expect(m).not.toBeNull();
  const pts = m![1].split(' ').map(p => p.split(',').map(Number));
  expect(pts.length).toBe(4);
  pts.forEach(([x, y], i) => {
    expect(x).toBeCloseTo(V[i][0], 1);
    expect(y).toBeCloseTo(V[i][1], 1);
  });
  // Four vertex swatches, one per component, in the kernel's colours.
  expect((svg.match(/mixer-vertex/g) || []).length).toBe(4);
  expect(svg).toContain(THERMAL_FILL);
});

// ---- claim 6: a NaN never reaches the canvas ----
// The recorder's globalAlpha setter asserts finiteness on EVERY assignment above; this case
// feeds the painter the poison directly — a patch whose colour carries a NaN alpha and a mix
// full of NaN — and expects silence, not a crash and not a rect.

test('a NaN in a patch colour or in the mix paints nothing and never assigns a NaN alpha', () => {
  const map = mapOf({ slope: [{ lon: 6, lat: 45, sizeM: 500, color: [150, 200, 90, NaN] }] });
  const a = recorder();
  paintLiftMap(a.ctx, map, VIEW, ALL_ON, EVEN);
  expect(a.rects.length).toBe(0);
  expect(a.texts.map(t => t.t)).toContain(WATERMARK);

  const sane = mapOf({ slope: [{ lon: 6, lat: 45, sizeM: 500, color: [150, 200, 90, 255] }] });
  const b = recorder();
  paintLiftMap(b.ctx, sane, VIEW, ALL_ON, [NaN, NaN, NaN, NaN]);
  expect(b.rects.length).toBe(0);
  expect(b.texts.map(t => t.t)).toContain(WATERMARK);
});

// ---- the legend ----

test('legendHtml lists exactly the enabled components, each carrying the .modelled class', () => {
  const html = legendHtml([true, false, true, false]);
  expect(html).toContain('thermal');
  expect(html).toContain('converg');
  expect(html).not.toContain('slope');
  expect(html).not.toContain('wave');
  expect((html.match(/legend-row modelled/g) || []).length).toBe(2);
  expect(html).toContain(`background:${THERMAL_FILL}`);
});

test('legendHtml tells unknown terrain, no driver and a quiet sky apart (POT-007)', () => {
  // Three empty layers, three different facts. The canvas paints them identically — the
  // legend is the last place the distinction can reach the pilot, so it must.
  const layer = (readiness: number, active: boolean) => ({ patches: [], readiness, active });
  const map = {
    modelled: true as const,
    components: {
      thermal: layer(0.4, true),      // the ground is 60% unknown here
      slope: layer(1, false),         // there was nothing to model with (no wind)
      converg: layer(1, true),        // the model looked and found nothing
      wave: layer(1, true),
    },
  };
  const html = legendHtml([true, true, true, true], map);
  expect(html).toContain('terrain 40% known');
  expect(html).toContain('inactive — nothing to model with');
  // The genuinely quiet layers carry NO note: silence is their honest answer.
  expect((html.match(/legend-note/g) || []).length).toBe(2);   // thermal + slope; none on converg/wave
});

test('legendHtml without a map says nothing it does not know', () => {
  expect(legendHtml([true, true, true, true])).not.toContain('legend-note');
});
