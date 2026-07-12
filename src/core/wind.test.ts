// The estimator against a wind the test CONTROLS — the miniature of the Condor bench: build
// a circling climb, push it sideways at a known speed, and ask whether the estimate reads
// the truth back. The detector, the drift and the estimator all sit in the loop, so a broken
// convention anywhere (direction TO vs FROM is the classic) fails here by ~180°.
import { test, expect } from 'bun:test';
import { windEstimator, BAND_M } from './wind';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';

const LAT = 47, LON = 8;

/** Feed `est` a circling climb centred near (LON, LAT) drifting with wind (uMs, vMs), from
 *  t0 for `dur` seconds, climbing at `climb` m/s from alt0. Same shape the airmass detector
 *  is tuned for: 100 m radius, 36 s turns, 2 s fixes. */
function circle(
  est: ReturnType<typeof windEstimator>,
  uMs: number, vMs: number, t0: number, dur: number, alt0: number, climb = 1.5,
): void {
  const rM = 100, period = 36;
  for (let t = 0; t <= dur; t += 2) {
    const a = 2 * Math.PI * t / period;
    const cx = LON + uMs * t / mPerLng(LAT), cy = LAT + vMs * t / M_PER_LAT;
    est.add(cx + rM * Math.cos(a) / mPerLng(LAT), cy + rM * Math.sin(a) / M_PER_LAT,
            alt0 + climb * t, t0 + t);
  }
}

test('a climb drifting east at 5 m/s reads back as wind FROM 270° at 5 m/s', () => {
  const est = windEstimator();
  circle(est, 5, 0, 12 * 3600, 300, 1000);
  const w = est.estimate();
  expect(w).not.toBeNull();
  expect(w!.speed).toBeCloseTo(5, 0);
  expect(w!.direction).toBeCloseTo(270, -1);   // FROM the west — the meteorological word
});

test('a southerly drift is a wind from 180°, not 0° — the TO/FROM trap, pinned', () => {
  const est = windEstimator();
  circle(est, 0, 4, 12 * 3600, 300, 1000);     // drifting NORTH → wind FROM the south
  expect(est.estimate()!.direction).toBeCloseTo(180, -1);
});

test('no circling, no estimate — a straight glide says nothing about the wind', () => {
  const est = windEstimator();
  for (let t = 0; t <= 600; t += 2)
    est.add(LON + 30 * t / mPerLng(LAT), LAT, 1500, 12 * 3600 + t);
  expect(est.estimate()).toBeNull();           // unknown, never invented calm
});

test('the profile ladders by altitude band, freshest per rung (VEN-003/004)', () => {
  const est = windEstimator();
  circle(est, 3, 0, 12 * 3600, 300, 800);            // low band: from the west
  circle(est, 0, -6, 12 * 3600 + 900, 300, 2300);    // high band: from the north
  const ladder = est.profile();
  expect(ladder.length).toBeGreaterThanOrEqual(2);
  const low = ladder[0], high = ladder[ladder.length - 1];
  expect(low.band[0]).toBeLessThan(high.band[0]);
  expect(low.direction).toBeCloseTo(270, -1);
  expect(high.direction).toBeCloseTo(0, -1);
  expect(high.band[1] - high.band[0]).toBe(BAND_M);
});

test('every estimate carries its evidence: climb count, time, band', () => {
  const est = windEstimator();
  circle(est, 5, 0, 12 * 3600, 300, 1000);
  const w = est.estimate()!;
  expect(w.climbs).toBeGreaterThanOrEqual(1);
  expect(w.at).toBeGreaterThan(12 * 3600);
  expect(w.band[0]).toBeLessThanOrEqual(1000 + 1.5 * 150);
});
