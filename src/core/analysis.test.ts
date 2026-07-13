// ANA-003's claim, tested the only way it can be trusted: fly a glider that obeys the polar
// EXACTLY, and demand the measurement find the book value back. If the achieved ratio drifts
// from the polar on a synthetic flight that flew the polar, the estimator is wrong — and on a
// real flight nobody would ever know.
import { test, expect } from 'bun:test';
import { DEFAULT_POLAR as PL, sinkAt } from 'soaring-core/polar';
import { barograph, climbs, effectiveGlide, theoreticalBestLD } from './analysis';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';
import type { TrackPoint } from 'soaring-core/types';

const LON = 6, LAT = 45;

/** A glider gliding due east at `v` m/s through still air, sinking exactly as the polar says.
 *  Its achieved L/D is v / |sink(v)| by construction — the number the test demands back. */
function straightGlide(v: number, seconds: number, alt0 = 2000): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const sink = -sinkAt(PL, v);
  for (let t = 0; t <= seconds; t++) {
    pts.push([LON + v * t / mPerLng(LAT), LAT, alt0 - sink * t, 43200 + t]);
  }
  return pts;
}

test('the barograph is the flight, and its gain is the climbing only', () => {
  const pts: TrackPoint[] = [];
  for (let t = 0; t <= 100; t++) pts.push([LON, LAT, 1000 + (t < 50 ? t * 2 : (100 - t) * 2), 43200 + t]);
  const b = barograph(pts)!;
  expect(b.samples.length).toBe(101);
  expect(b.maxAltM).toBeCloseTo(1100, 6);          // up 100 m…
  expect(b.minAltM).toBeCloseTo(1000, 6);          // …and back down
  expect(b.gainM).toBeCloseTo(100, 6);             // the gain counts the climb ONLY
  expect(b.startSod).toBe(43200);
  expect(b.endSod).toBe(43300);
});

test('a track too short to be a flight has no barograph — null, not an empty chart', () => {
  expect(barograph([])).toBeNull();
  expect(barograph([[6, 45, 1000, 0]])).toBeNull();
});

test('ANA-003: a glider that flies the polar measures the polar back', () => {
  const v = 30;                                     // m/s through the air, straight and level
  const e = effectiveGlide(straightGlide(v, 600), PL);
  expect(e.segments).toBeGreaterThanOrEqual(1);
  const expected = v / -sinkAt(PL, v);              // the L/D this glide has, by construction
  expect(e.achievedLD!).toBeCloseTo(expected, 0);
  // And the model is reported SEPARATELY, never fused into one number.
  expect(e.theoreticalLD).toBeCloseTo(theoreticalBestLD(PL), 6);
  expect(e.ratio!).toBeCloseTo(expected / e.theoreticalLD, 2);
  expect(e.windCorrected).toBe(false);              // no wind given: the caveat is in the value
});

test('the best-glide speed measures the polar\'s OWN best ratio — the top of the curve', () => {
  const best = theoreticalBestLD(PL);
  const e = effectiveGlide(straightGlide(24.6, 600), PL);   // ≈ the ASK 21's best-glide speed
  expect(e.achievedLD!).toBeGreaterThan(best * 0.97);       // within 3% of the book
  expect(e.ratio!).toBeGreaterThan(0.97);
  expect(e.ratio!).toBeLessThan(1.03);
});

test('a tailwind flatters the ground ratio — and the wind correction takes it back', () => {
  // The same glider, the same air, but 10 m/s of tailwind: over the ground it goes further
  // per metre down, and an uncorrected measurement would credit the GLIDER for the day.
  const v = 30, wind = 10;
  const pts: TrackPoint[] = [];
  const sink = -sinkAt(PL, v);
  for (let t = 0; t <= 600; t++)
    pts.push([LON + (v + wind) * t / mPerLng(LAT), LAT, 2000 - sink * t, 43200 + t]);

  const raw = effectiveGlide(pts, PL);
  const corrected = effectiveGlide(pts, PL, { speed: wind, direction: 270 });  // FROM the west
  const truth = v / sink;

  expect(raw.achievedLD!).toBeGreaterThan(truth * 1.2);     // the day, credited to the glider
  expect(corrected.achievedLD!).toBeCloseTo(truth, 0);      // the glider, alone
  expect(corrected.windCorrected).toBe(true);
});

test('circling is not a glide: a thermal must not price the cruise', () => {
  // Pure circling, descending on average (a sinking turn). If the estimator counted it, the
  // achieved L/D would collapse toward the circling sink and look like a broken glider.
  const pts: TrackPoint[] = [];
  for (let t = 0; t <= 300; t += 2) {
    const a = 2 * Math.PI * t / 30;
    pts.push([
      LON + 80 * Math.cos(a) / mPerLng(LAT),
      LAT + 80 * Math.sin(a) / M_PER_LAT,
      2000 - 0.8 * t, 43200 + t,
    ]);
  }
  const e = effectiveGlide(pts, PL);
  expect(e.achievedLD).toBeNull();                  // nothing straight to measure: honest null
  expect(e.ratio).toBeNull();
});

test('the climb history is the kernel\'s detector, and an empty sky yields an empty list', () => {
  expect(climbs(straightGlide(30, 600)).length).toBe(0);   // a straight glide holds no thermals
  expect(climbs([]).length).toBe(0);
});
