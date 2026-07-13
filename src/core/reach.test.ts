// The claim TER-005 exists for, as a test: a valley behind a ridge is UNREACHABLE, however
// low it lies and however cheerfully a range circle would include it. If this file ever goes
// green while `terrain` and `glide` mean the same thing, the distinction is dead.
import { test, expect } from 'bun:test';
import { DEFAULT_POLAR as PL } from 'soaring-core/polar';
import { reachable, reachOnBearing, reachableTo, headwindOn } from './reach';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';
import type { ElevSampler } from 'soaring-core/ports';

const LON = 8, LAT = 47;
const eastM = (m: number): number => LON + m / mPerLng(LAT);

/** Flat ground at 0 m — the case a range circle gets right. */
const flat: ElevSampler = () => 0;

/** A wall 10 km east: 2000 m of rock, 500 m thick. Behind it, sea level again — the valley
 *  a range circle happily promises and a glider cannot have. */
const ridge: ElevSampler = (lon) => {
  const m = (lon - LON) * mPerLng(LAT);
  return m > 10_000 && m < 10_500 ? 2000 : 0;
};

/** Ground nobody has loaded. */
const unknown: ElevSampler = () => null;

test('over flat ground the reach is the polar\'s own best glide', () => {
  // 1000 m up, 100 m safety: 900 m usable, at the ASK 21's best L/D.
  const ray = reachOnBearing(flat, LON, LAT, 1000, PL, 90, { safetyM: 100, stepM: 100 });
  expect(ray.limit).toBe('glide');
  const ld = ray.distanceM / 900;
  expect(ld).toBeGreaterThan(25);           // an ASK 21 does better than 1:25…
  expect(ld).toBeLessThan(38);              // …and worse than 1:38
});

test('a ridge cuts the glide short AND says it was the ridge (TER-005)', () => {
  // From 1500 m the glider has the height to cross 10 km of flat ground — and then some.
  // The wall is 2000 m: it is ABOVE the glider. Everything behind it is unreachable.
  const ray = reachOnBearing(ridge, LON, LAT, 1500, PL, 90, { safetyM: 100, stepM: 100 });
  expect(ray.limit).toBe('terrain');        // not 'glide': the mountain stopped us, not the height
  expect(ray.distanceM).toBeLessThan(10_500);
  expect(ray.distanceM).toBeGreaterThan(9_000);   // right up to the rock, not short of it

  // And the proof the distinction matters: on the SAME bearing over flat ground, that height
  // reaches far beyond the ridge. A range circle would paint the valley as reachable.
  const overFlat = reachOnBearing(flat, LON, LAT, 1500, PL, 90, { safetyM: 100, stepM: 100 });
  expect(overFlat.distanceM).toBeGreaterThan(30_000);
  expect(overFlat.distanceM).toBeGreaterThan(ray.distanceM * 2);
});

test('flat ground BELOW the glider is where the glide ran out — never a "ridge in the way"', () => {
  // The ridge test used to read `g + safetyM > alt - safetyM`, counting the clearance on both
  // sides: any ground less than 2 × safetyM under the glider came back as 'terrain'. With the
  // reserve the pilot actually sets (200 m), dead-flat ground 200 m below him was reported as a
  // mountain standing in his way — and everything behind it as unreachable.
  const ray = reachOnBearing(flat, LON, LAT, 200, PL, 90, { safetyM: 200, stepM: 100 });
  expect(ray.limit).toBe('glide');          // the glide ends here; nothing is IN THE WAY
  // The same march over a wall that really does stand above him still says 'terrain'. The
  // distinction is preserved, not weakened — that is the whole of TER-005.
  const blocked = reachOnBearing(ridge, LON, LAT, 1500, PL, 90, { safetyM: 200, stepM: 100 });
  expect(blocked.limit).toBe('terrain');
});

test('unloaded ground is UNKNOWN — not reachable, not unreachable (POT-007)', () => {
  const ray = reachOnBearing(unknown, LON, LAT, 1500, PL, 90, { stepM: 100 });
  expect(ray.limit).toBe('unknown');
  expect(ray.distanceM).toBe(0);            // we know nothing past our own position
});

test('the reach polygon has one ray per bearing, all ending somewhere real', () => {
  const rays = reachable(flat, LON, LAT, 1000, PL, { stepM: 200 }, 36);
  expect(rays.length).toBe(36);
  for (const r of rays) {
    expect(Number.isFinite(r.lon)).toBe(true);
    expect(Number.isFinite(r.lat)).toBe(true);
    expect(r.distanceM).toBeGreaterThan(0);
  }
});

test('a headwind shortens the reach and a tailwind lengthens it, on the same bearing', () => {
  const wind = { speed: 10, direction: 270 };          // FROM the west
  const east = reachOnBearing(flat, LON, LAT, 1000, PL, 90, { wind, stepM: 100 });   // tailwind
  const west = reachOnBearing(flat, LON, LAT, 1000, PL, 270, { wind, stepM: 100 });  // headwind
  const still = reachOnBearing(flat, LON, LAT, 1000, PL, 90, { stepM: 100 });
  expect(east.distanceM).toBeGreaterThan(still.distanceM);
  expect(west.distanceM).toBeLessThan(still.distanceM);
});

test('headwindOn: a wind FROM 270 is a headwind flying west, a tailwind flying east', () => {
  const w = { speed: 10, direction: 270 };
  expect(headwindOn(270, w)).toBeCloseTo(10, 6);       // flying INTO it
  expect(headwindOn(90, w)).toBeCloseTo(-10, 6);       // it pushes
  expect(headwindOn(0, w)).toBeCloseTo(0, 6);          // pure crosswind
});

test('PLA-007: a goal behind a ridge is not reachable, and the reason is the ridge', () => {
  const goal = { lon: eastM(20_000), lat: LAT };        // 20 km east, past the wall
  const r = reachableTo(ridge, LON, LAT, 1500, goal, PL, { stepM: 100 });
  expect(r.reachable).toBe(false);
  expect(r.limit).toBe('terrain');

  // The same goal over flat ground, same height: reachable, with a real margin in hand.
  const ok = reachableTo(flat, LON, LAT, 1500, goal, PL, { stepM: 100 });
  expect(ok.reachable).toBe(true);
  expect(ok.limit).toBe('glide');
  expect(ok.marginM!).toBeGreaterThan(0);
});

test('a goal over unmeasured ground answers UNKNOWN, never a cheerful yes', () => {
  const r = reachableTo(unknown, LON, LAT, 3000, { lon: eastM(5000), lat: LAT }, PL, { stepM: 100 });
  expect(r.reachable).toBe(false);
  expect(r.limit).toBe('unknown');
  expect(r.marginM).toBeNull();
});
