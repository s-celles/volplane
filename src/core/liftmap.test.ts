// ============ the lift map, pinned to its claims ============
// What is pinned here is POT-007 made mechanical: an unknown ground is an empty layer (never
// a flat one), an unknown wind is null (never a calm one), a map is `modelled: true` by
// construction, and the calibration refuses to guess from too few climbs. The physics itself
// is soaring-core's and is tested there (C4) — these tests pin the COMPOSITION.
//
// C3, stated where it can be read: everything this module exports is DISPLAY data. Nothing
// in it feeds an alert, a glide computation, or any safety behaviour — a modelled field that
// triggered anything would be a model passing for a measurement.
import { test, expect } from 'bun:test';
import { syntheticWx, type Wx } from 'soaring-core/weather';
import { M_PER_LAT, mPerLng } from 'soaring-core/geo';
import { MIN_RATIOS, CAL_MIN, CAL_MAX } from 'soaring-core/lift/calib';
import { liftWeight } from 'soaring-core/lift/mix';
import { BIN_COLORS } from 'soaring-core/liftviz';
import type { ElevSampler } from 'soaring-core/ports';
import type { TrackPoint } from 'soaring-core/types';
import {
  computeLiftMap, windProfileOf, dniOf, probeFromTrack, calibrateFromTrack, applyWeights,
  type LiftKey, type Patch,
} from './liftmap';

// ---- the synthetic world ----
// A gaussian ridge running north–south through the centre, in a westerly airstream: the
// simplest terrain that gives every component something distinct to say. Analytic, so the
// sampler answers everywhere and there are no fixtures at all.
const LAT = 45.0, LON = 6.0;
const BASE = 400, A = 1200, SIGMA = 1500;
const R = 12000;
const DAY = Date.UTC(2026, 5, 21);         // summer solstice: the sun is high at midday
const KEYS: LiftKey[] = ['thermal', 'slope', 'converg', 'wave'];

const dxM = (lon: number): number => (lon - LON) * mPerLng(LAT);
const ridgeElev: ElevSampler = (lon) => {
  const x = dxM(lon);
  return BASE + A * Math.exp(-(x * x) / (2 * SIGMA * SIGMA));
};
const flatElev: ElevSampler = () => 500;
const nullElev: ElevSampler = () => null;

// 8 m/s from the west, sheared, over a stably-stratified layer: enough wind for the slope
// and the wave gates, N ≈ 0.012 s⁻¹ for a plausible lee wavelength.
const westerly = (): Wx => syntheticWx({ wind: 8, dir: 270, shear: 2, nStab: 0.012, tsurf: 15, rh: 40 }, BASE);
// The synthetic atmosphere carries no radiation (sw/diff are NaN — honest: not forecast).
// The sunny variant grafts a clear summer midday onto it, for the thermal field.
const sunny = (ref = BASE): Wx => {
  const wx = syntheticWx({ wind: 8, dir: 270, shear: 2, nStab: 0.012, tsurf: 15, rh: 40 }, ref);
  for (const h of wx.hours) { h.sw = 800; h.diff = 100; }
  return wx;
};

const isLift = (c: Patch['color']): boolean =>
  BIN_COLORS.slice(0, 3).some(b => b.every((v, i) => v === c[i]));
const isSink = (c: Patch['color']): boolean =>
  BIN_COLORS.slice(3).some(b => b.every((v, i) => v === c[i]));

// ---- 1. unknown ground: an empty map, never an invented one (POT-007) ----

test('unknown terrain everywhere yields empty layers at readiness 0, and no throw', () => {
  // The sun is up and the wind blows — every driver is present. Only the GROUND is unknown,
  // and that alone must silence every layer: a model with no terrain has nothing to say, and
  // a patch over invented elevation-0 ground would be a fabricated measurement.
  const map = computeLiftMap({ lon: LON, lat: LAT }, R, nullElev, sunny(), 12, DAY, 1);
  expect(map.modelled).toBe(true);
  for (const key of KEYS) {
    expect(map.components[key].patches).toEqual([]);
    expect(map.components[key].readiness).toBe(0);
  }
});

// ---- 2. no forecast: null wind, empty fields, but still a (tagged) map ----

test('windProfileOf(null) answers null at every altitude — an unknown wind is not a calm one', () => {
  const prof = windProfileOf(null, 12);
  for (const alt of [0, 800, 2500, 6000]) expect(prof(alt)).toBeNull();
});

test('wx null: every layer is empty, and the map still comes back tagged modelled', () => {
  // Night, so the sun cannot stand in for the missing wind (the slope's anabatic term would
  // otherwise honestly light up a sunny calm day — which is physics, not a leak).
  const map = computeLiftMap({ lon: LON, lat: LAT }, R, ridgeElev, null, 0, DAY, 1);
  expect(map.modelled).toBe(true);
  for (const key of KEYS) {
    expect(map.components[key].patches).toEqual([]);
    expect(map.components[key].active).toBe(false);
  }
});

// ---- 3. the ridge in a westerly: slope on the windward face, wave in the lee ----

test('slope lift paints the upwind face, wave stands downwind, and they disagree in location', () => {
  // Midnight on purpose: no sun means no anabatic term, so the slope field is PURELY
  // wind · ∇terrain and the sign check below is exact — west face up, east face down.
  const map = computeLiftMap({ lon: LON, lat: LAT }, R, ridgeElev, westerly(), 0, DAY, 1);
  const slope = map.components.slope, wave = map.components.wave;
  expect(slope.active).toBe(true);
  expect(slope.patches.length).toBeGreaterThan(0);
  expect(wave.active).toBe(true);
  expect(wave.patches.length).toBeGreaterThan(0);

  // Hand-picked cells at ±σ, where the gaussian's gradient peaks: the westerly rides UP the
  // west face (lift colour) and down the sheltered east face (sink colour).
  const nearest = (ps: Patch[], xm: number): Patch =>
    ps.reduce((best, p) =>
      Math.abs(dxM(p.lon) - xm) + Math.abs((p.lat - LAT) * M_PER_LAT) <
      Math.abs(dxM(best.lon) - xm) + Math.abs((best.lat - LAT) * M_PER_LAT) ? p : best);
  expect(isLift(nearest(slope.patches, -SIGMA).color)).toBe(true);
  expect(isSink(nearest(slope.patches, +SIGMA).color)).toBe(true);

  // The wave is a LEE phenomenon: rising bars well downwind of the crest, where the slope
  // field — a pure gradient — can only ever show sink. The two disagreeing in location is
  // exactly why the map carries them as separate components.
  expect(wave.patches.some(p => isLift(p.color) && dxM(p.lon) > 2000)).toBe(true);
  expect(slope.patches.some(p => isLift(p.color) && dxM(p.lon) > 2000)).toBe(false);
});

// ---- 4. calibration (POT-006): grounded in real climbs, or refusing to guess ----

// A circling climb is what the detector calls a thermal: full turns (10°/s over two
// minutes), a real gain, a real strength. Between climbs the glider cruises straight —
// long enough that the runs never merge.
function addClimb(pts: TrackPoint[], lon0: number, t0: number, climb: number, alt0: number): void {
  const rM = 100, period = 36, dur = 120;
  for (let t = 0; t <= dur; t += 2) {
    const a = 2 * Math.PI * t / period;
    pts.push([lon0 + rM * Math.cos(a) / mPerLng(LAT), LAT + rM * Math.sin(a) / M_PER_LAT, alt0 + climb * t, t0 + t]);
  }
}

function track(nClimbs: number, climb: number): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const spacing = 0.05;                       // ° lon between climbs ≈ 3.9 km ≫ the 500 m merge radius
  let t = 12 * 3600, alt = 1000;              // midday, so the sun is up at every climb's time
  for (let k = 0; k < nClimbs; k++) {
    addClimb(pts, LON + k * spacing, t, climb, alt);
    t += 122; alt += climb * 120;
    if (k < nClimbs - 1) {                    // straight cruise to the next thermal
      for (let s = 2; s < 120; s += 2)
        pts.push([LON + (k + s / 120) * spacing, LAT, alt, t + s]);
      t += 120;
    }
  }
  return pts;
}

test('probeFromTrack: null below two points, linear in between', () => {
  expect(probeFromTrack([])).toBeNull();
  expect(probeFromTrack([[6, 45, 1000, 100]])).toBeNull();
  const p = probeFromTrack([[6, 45, 1000, 100], [6.02, 45.02, 1200, 200]])!;
  expect(p.rstart).toBe(100);
  expect(p.rend).toBe(200);
  const [lon, lat, alt] = p.at(150);
  expect(lon).toBeCloseTo(6.01, 10);
  expect(lat).toBeCloseTo(45.01, 10);
  expect(alt).toBeCloseTo(1100, 10);
  expect(p.at(0)[2]).toBe(1000);              // clamped, never extrapolated
  expect(p.at(999)[2]).toBe(1200);
});

test('three observed climbs are too few: the factor is exactly 1 (MIN_RATIOS refusal)', () => {
  // Pin the kernel's threshold this claim depends on: 3 climbs < MIN_RATIOS.
  expect(MIN_RATIOS).toBe(4);
  const c = calibrateFromTrack(track(3, 2.0), flatElev, DAY, sunny(500), 12);
  expect(c.factor).toBe(1);
  // And the refusal is LEGIBLE: usable stays under the kernel's threshold, so a caller can
  // tell this ×1.00 from a genuinely neutral day's ×1.00 (the finding that forced Calibration
  // to carry its count).
  expect(c.usable).toBeLessThan(MIN_RATIOS);
});

test('five real climbs over known ground move the factor off 1, inside the clamp', () => {
  const c = calibrateFromTrack(track(5, 2.0), flatElev, DAY, sunny(500), 12);
  expect(c.factor).not.toBe(1);
  expect(c.factor).toBeGreaterThanOrEqual(CAL_MIN);
  expect(c.factor).toBeLessThanOrEqual(CAL_MAX);
  expect(c.usable).toBeGreaterThanOrEqual(MIN_RATIOS);   // the display's gate, satisfied honestly
});

test('no track and no forecast both refuse to guess', () => {
  expect(calibrateFromTrack([], flatElev, DAY, sunny(500), 12)).toEqual({ factor: 1, usable: 0 });
  expect(calibrateFromTrack(track(5, 2.0), flatElev, DAY, null, 12)).toEqual({ factor: 1, usable: 0 });
});

// ---- 5. the blend (POT-005): a disabled component is absent, the rest renormalise ----

test('applyWeights drops a disabled component and renormalises over the enabled rest', () => {
  const map = computeLiftMap({ lon: LON, lat: LAT }, R, ridgeElev, westerly(), 0, DAY, 1);
  const on = [true, false, true, true];       // slope off (LIFT_COMPS order: thermal, slope, converg, wave)
  const mix = [0.4, 0.3, 0.2, 0.1];
  const layers = applyWeights(map, on, mix);
  expect(layers.some(l => l.key === 'slope')).toBe(false);
  // One numeric case pinned against the kernel's own liftWeight, so this module can never
  // drift into doing its own simplex maths (C4).
  const th = layers.find(l => l.key === 'thermal')!;
  expect(th.alpha).toBe(liftWeight('thermal', on, mix));
  expect(th.alpha).toBeCloseTo(0.4 / 0.7, 12);
  expect(layers.reduce((s, l) => s + l.alpha, 0)).toBeCloseTo(1, 12);
  // The layer's patches pass through untouched — the weight is the renderer's alpha, not a filter.
  expect(th.patches).toBe(map.components.thermal.patches);
});

// ---- 6. no NaN ever reaches a patch ----

test('every emitted patch field is finite, across all four layers of a full sunny map', () => {
  // Midday with radiation, wind and stability: all four components computing at once — the
  // configuration with the most ways to leak a NaN.
  const map = computeLiftMap({ lon: LON, lat: LAT }, R, ridgeElev, sunny(), 12, DAY, 1);
  expect(map.components.thermal.patches.length).toBeGreaterThan(0);
  let walked = 0;
  for (const key of KEYS) {
    const layer = map.components[key];
    expect(Number.isFinite(layer.readiness)).toBe(true);
    for (const p of layer.patches) {
      walked++;
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.sizeM)).toBe(true);
      for (const v of p.color) expect(Number.isFinite(v)).toBe(true);
    }
  }
  expect(walked).toBeGreaterThan(0);
});

// ---- the tag is structural, not conventional (POT-007) ----

test('a lift map cannot exist untagged: modelled is the literal true', () => {
  const map = computeLiftMap({ lon: LON, lat: LAT }, R, nullElev, null, 0, DAY, 1);
  // The compile-time half of the claim: `modelled` is typed as the literal `true`, so this
  // assignment is the compiler refusing an untagged map, not just a runtime check.
  const tag: true = map.modelled;
  expect(tag).toBe(true);
});
