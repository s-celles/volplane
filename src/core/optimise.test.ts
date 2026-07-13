// The scorers, pinned against geometry the test CONTROLS — a flight whose right answer is
// known before the code runs. The FAI shape rule is the sharp one: a long thin triangle is
// NOT a triangle, however many kilometres it flew, and a scorer that forgets that hands the
// pilot a number the league will refuse.
import { test, expect } from 'bun:test';
import { freeDistance, faiTriangle, decimate, SCORING } from './optimise';
import { distM, mPerLng, M_PER_LAT } from 'soaring-core/geo';
import type { TrackPoint } from 'soaring-core/types';

const LON = 6, LAT = 45;
const at = (eastM: number, northM: number, t: number): TrackPoint =>
  [LON + eastM / mPerLng(LAT), LAT + northM / M_PER_LAT, 1000, t];

/** Fly a straight line between two points, one fix every ~1 km. */
function leg(from: [number, number], to: [number, number], t0: number, out: TrackPoint[]): number {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const n = Math.max(2, Math.round(d / 1000));
  for (let i = 1; i <= n; i++)
    out.push(at(from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n, t0 + i * 10));
  return t0 + n * 10;
}

test('decimate keeps the ends and honours the cap', () => {
  const pts: TrackPoint[] = Array.from({ length: 500 }, (_, i) => at(i * 100, 0, i));
  const d = decimate(pts, 50);
  expect(d.length).toBe(50);
  expect(d[0]).toEqual(pts[0]);
  expect(d[d.length - 1]).toEqual(pts[pts.length - 1]);
  expect(decimate(pts.slice(0, 10), 50).length).toBe(10);   // shorter than the cap: untouched
});

test('free distance finds the out-and-back, and scores it per the named barème', () => {
  // 50 km east and back: the free distance is the whole 100 km, through two legs.
  const pts: TrackPoint[] = [at(0, 0, 0)];
  let t = leg([0, 0], [50_000, 0], 0, pts);
  leg([50_000, 0], [0, 0], t, pts);

  const r = freeDistance(pts)!;
  expect(r.rules).toBe('olc-2024');
  expect(r.distanceM / 1000).toBeCloseTo(100, 0);
  expect(r.points).toBeCloseTo(100 * SCORING['olc-2024'].freeKmPoints, 0);
  expect(r.legs.length).toBeLessThanOrEqual(SCORING['olc-2024'].freePoints);
  // The geometry CNC-002 asks for: the turn really is out at 50 km.
  const east = r.legs.map(([lon]) => (lon - LON) * mPerLng(LAT));
  expect(Math.max(...east) / 1000).toBeCloseTo(50, 0);
});

test('a straight flight scores its own length, not more', () => {
  const pts: TrackPoint[] = [at(0, 0, 0)];
  leg([0, 0], [80_000, 0], 0, pts);
  const r = freeDistance(pts)!;
  expect(r.distanceM / 1000).toBeCloseTo(80, 0);
});

test('one fix is a place, not a flight', () => {
  expect(freeDistance([at(0, 0, 0)])).toBeNull();
  expect(faiTriangle([at(0, 0, 0), at(1000, 0, 1)])).toBeNull();
});

test('a fair triangle is found, closed, and its shape passes the 28% rule (CNC-003)', () => {
  // A near-equilateral 3 × 60 km triangle: every leg is ~33% of the perimeter.
  const A: [number, number] = [0, 0], B: [number, number] = [60_000, 0], C: [number, number] = [30_000, 52_000];
  const pts: TrackPoint[] = [at(0, 0, 0)];
  let t = leg(A, B, 0, pts);
  t = leg(B, C, t, pts);
  leg(C, A, t, pts);

  const r = faiTriangle(pts)!;
  expect(r.faiValid).toBe(true);
  expect(r.legs.length).toBe(3);
  expect(r.minLegFraction).toBeGreaterThanOrEqual(SCORING['olc-2024'].faiMinLegFraction);
  expect(r.distanceM / 1000).toBeCloseTo(180, -1);          // ~180 km of perimeter
  expect(r.points).toBeCloseTo((r.distanceM / 1000) * SCORING['olc-2024'].faiKmPoints, 3);
});

test('a long thin out-and-back is NOT an FAI triangle, whatever its distance (CNC-003)', () => {
  // 100 km out, 100 km back, with a 2 km jink: a huge flight and a degenerate shape. The
  // shortest leg is ~1% of the perimeter — the rule refuses it, and the search must too.
  const pts: TrackPoint[] = [at(0, 0, 0)];
  let t = leg([0, 0], [100_000, 0], 0, pts);
  t = leg([100_000, 0], [100_000, 2_000], t, pts);
  leg([100_000, 2_000], [0, 0], t, pts);

  const free = freeDistance(pts)!;
  expect(free.distanceM / 1000).toBeGreaterThan(190);       // the distance is real…

  const tri = faiTriangle(pts);
  // …and the triangle is either refused outright, or is a legal one strictly smaller than the
  // degenerate perimeter. What must NEVER happen is the thin shape being scored as a triangle.
  if (tri !== null) {
    expect(tri.minLegFraction).toBeGreaterThanOrEqual(SCORING['olc-2024'].faiMinLegFraction);
    expect(tri.distanceM).toBeLessThan(free.distanceM);
  }
});

test('the barème is a named value, and the result carries the name it was scored under', () => {
  const pts: TrackPoint[] = [at(0, 0, 0)];
  leg([0, 0], [40_000, 0], 0, pts);
  expect(freeDistance(pts, 'olc-2024')!.rules).toBe('olc-2024');
  expect(SCORING['olc-2024'].faiMinLegFraction).toBe(0.28);   // pin the era's own number
});

test('the optimiser agrees with the kernel about how far two fixes are apart', () => {
  // Make the geodesy earn its place: a 40 km straight flight measures 40 km both ways.
  const pts: TrackPoint[] = [at(0, 0, 0)];
  leg([0, 0], [40_000, 0], 0, pts);
  const r = freeDistance(pts)!;
  const a = pts[0], b = pts[pts.length - 1];
  expect(r.distanceM).toBeCloseTo(distM(a[0], a[1], b[0], b[1]), 0);
});
