// The task validator, pinned where regulation bites: sectors are versioned VALUES, order is
// law, and a validated turnpoint never un-validates.
import { test, expect } from 'bun:test';
import {
  simpleTask, aatTask, freshProgress, advance, freshAat, advanceAat, scoredDistanceM,
  inSector, RULES, type Waypoint,
} from './task';
import { distM } from 'soaring-core/geo';

const A: Waypoint = { name: 'A', lon: 6.0, lat: 46.0 };
const B: Waypoint = { name: 'B', lon: 6.2, lat: 46.0 };   // ~15 km east of A
const C: Waypoint = { name: 'C', lon: 6.2, lat: 46.15 };  // ~17 km north of B

test('a simple task validates in order, and only in order', () => {
  const t = simpleTask([A, B, C]);
  let p = freshProgress(t);
  // Flying through B's cylinder FIRST validates nothing: the start has not been crossed.
  p = advance(t, p, B.lon, B.lat, 1000);
  expect(p.next).toBe(0);
  // Cross the start line (perpendicular to the A→B leg, at A)…
  p = advance(t, p, A.lon, A.lat, 1100);
  expect(p.next).toBe(1);
  expect(p.validatedAt[0]).toBe(1100);
  // …then B's 500 m cylinder…
  p = advance(t, p, B.lon + 0.003, B.lat, 2000);          // ~230 m east of B: inside
  expect(p.next).toBe(2);
  // …then finish at C.
  p = advance(t, p, C.lon, C.lat, 3000);
  expect(p.next).toBe(3);                                 // == points.length: complete
});

test('a validated point never un-validates, and progress is identity when nothing happens', () => {
  const t = simpleTask([A, B, C]);
  let p = freshProgress(t);
  p = advance(t, p, A.lon, A.lat, 1100);
  const after = advance(t, p, 5.5, 45.5, 1200);           // far from everything
  expect(after).toBe(p);                                  // same OBJECT: nothing to repaint
  expect(after.validatedAt[0]).toBe(1100);
});

test('the cylinder radius comes from the NAMED rules version, not a constant in code', () => {
  const t = simpleTask([A, B, C], 'fai-2024');
  expect(t.rules).toBe('fai-2024');
  const cyl = t.points[1].sector;
  expect(cyl).toEqual({ kind: 'cylinder', radiusM: RULES['fai-2024'].tpCylinderM });
  // 600 m from B is OUTSIDE a 500 m beer can — the metre that decides a contest.
  expect(inSector(t.points[1], B.lon + 600 / 76800, B.lat, A, C)).toBe(false);
  expect(inSector(t.points[1], B.lon + 400 / 76800, B.lat, A, C)).toBe(true);
});

test('the FAI quadrant opens away from the task and refuses without its legs', () => {
  const tp = { wp: B, sector: { kind: 'faiQuadrant', radiusM: 3000 } as const };
  // Legs A→B→C turn the task at B: inbound from the west, outbound to the north. The
  // quadrant's axis points away from the bisector — roughly south-east.
  expect(inSector(tp, B.lon + 0.02, B.lat - 0.015, A, C)).toBe(true);    // SE of B: inside
  expect(inSector(tp, B.lon - 0.02, B.lat + 0.015, A, C)).toBe(false);   // NW: the task side
  expect(inSector(tp, B.lon + 0.02, B.lat - 0.015, null, C)).toBe(false); // no leg, no verdict
});

test('a start line stands across the first leg, not around the point', () => {
  const t = simpleTask([A, B, C]);
  const start = t.points[0];
  // 400 m NORTH of A (across the eastbound leg): on the line.
  expect(inSector(start, A.lon, A.lat + 400 / 111320, null, B)).toBe(true);
  // 900 m EAST of A (along the leg): past the gate, not on it.
  expect(inSector(start, A.lon + 900 / 76800, A.lat, null, B)).toBe(false);
});

// ---- AAT scoring: the distance achieved through assigned areas ----

// A straight west–east AAT at lat 46: start, one 20 km area, finish, half a degree apart
// (~38.7 km per leg). Depth into the area is due-east distance along the course.
const S: Waypoint = { name: 'S', lon: 6.0, lat: 46.0 };
const M: Waypoint = { name: 'M', lon: 6.5, lat: 46.0 };
const F: Waypoint = { name: 'F', lon: 7.0, lat: 46.0 };

test("the 'fai-2024' entry carries the 20 km AAT area default, frozen", () => {
  expect(RULES['fai-2024'].aatAreaM).toBe(20000);
  const t = aatTask([S, M, F]);
  expect(t.rules).toBe('fai-2024');
  expect(t.points[0].sector).toEqual({ kind: 'line', lengthM: 1000 });
  expect(t.points[1].sector).toEqual({ kind: 'aatArea', radiusM: 20000 });
  expect(t.points[2].sector).toEqual({ kind: 'line', lengthM: 1000 });
});

test('scored distance is null before the start, a real zero just after it', () => {
  const t = aatTask([S, M, F]);
  let p = freshProgress(t);
  const a = freshAat(t);
  // Unstarted: NO scored distance — a dash, never a fake zero.
  expect(scoredDistanceM(t, p, a)).toBeNull();
  p = advance(t, p, S.lon, S.lat, 1000);
  expect(p.next).toBe(1);
  // Started and nothing else: a real number, and that number is 0.
  expect(scoredDistanceM(t, p, a)).toBe(0);
});

test('deeper into the area raises the score; a shallower later fix never lowers it', () => {
  const t = aatTask([S, M, F]);
  let p = freshProgress(t);
  let a = freshAat(t);
  p = advance(t, p, S.lon, S.lat, 1000);

  // Enter the area ~11.6 km short of its centre: entry validates the point AND plants the
  // first scoring fix — the pilot's real position, never the invented centre.
  const entry = { lon: 6.35, lat: 46.0 };
  p = advance(t, p, entry.lon, entry.lat, 2000);
  expect(p.next).toBe(2);
  a = advanceAat(t, p, a, entry.lon, entry.lat);
  const atEntry = scoredDistanceM(t, p, a);
  expect(atEntry).toBeCloseTo(distM(S.lon, S.lat, entry.lon, entry.lat), 6);

  // Push ~19 km deeper along the course: the score follows the pilot east.
  const deep = { lon: 6.6, lat: 46.0 };
  a = advanceAat(t, p, a, deep.lon, deep.lat);
  const atDeep = scoredDistanceM(t, p, a);
  expect(atDeep).toBeCloseTo(distM(S.lon, S.lat, deep.lon, deep.lat), 6);
  expect(atDeep!).toBeGreaterThan(atEntry!);

  // Turn back: a shallower fix inside the same area changes NOTHING — identity, the very
  // same array, so there is nothing to repaint. What happened, happened.
  const shallow = advanceAat(t, p, a, 6.45, 46.0);
  expect(shallow).toBe(a);
  expect(scoredDistanceM(t, p, shallow)).toBe(atDeep!);

  // Finish: the score is start → best fix → finish, through the point actually reached.
  p = advance(t, p, F.lon, F.lat, 3000);
  expect(p.next).toBe(3);
  const done = scoredDistanceM(t, p, a);
  expect(done).toBeCloseTo(
    distM(S.lon, S.lat, deep.lon, deep.lat) + distM(deep.lon, deep.lat, F.lon, F.lat), 6);
});

test('a fix outside the area, or before the area validates, scores nothing', () => {
  const t = aatTask([S, M, F]);
  let p = freshProgress(t);
  const a = freshAat(t);
  // Inside the area geometrically, but the start has not been crossed: task order is law
  // for scoring exactly as it is for validation.
  expect(advanceAat(t, p, a, M.lon, M.lat)).toBe(a);
  p = advance(t, p, S.lon, S.lat, 1000);
  p = advance(t, p, M.lon, M.lat, 2000);
  // 25 km east of the centre: outside a 20 km area — identity again.
  expect(advanceAat(t, p, a, M.lon + 25000 / 76800, M.lat)).toBe(a);
});

test('a task with no areas scores exactly its validated wp-to-wp legs', () => {
  const t = simpleTask([A, B, C]);
  let p = freshProgress(t);
  let a = freshAat(t);
  p = advance(t, p, A.lon, A.lat, 1000);
  p = advance(t, p, B.lon, B.lat, 2000);
  a = advanceAat(t, p, a, B.lon, B.lat);              // harmless on a cylinder task
  expect(scoredDistanceM(t, p, a)).toBeCloseTo(distM(A.lon, A.lat, B.lon, B.lat), 6);
  p = advance(t, p, C.lon, C.lat, 3000);
  expect(scoredDistanceM(t, p, a)).toBeCloseTo(
    distM(A.lon, A.lat, B.lon, B.lat) + distM(B.lon, B.lat, C.lon, C.lat), 6);
});

// ============ the picture and the rule are ONE description (CAR-005) ============
// A turnpoint is not a circle. It is a cylinder, or a GATE crossed perpendicular to the course, or a
// ninety-degree FAI QUADRANT that opens AWAY from the task. A pilot shown a circle where the rules
// put a quadrant flies to a place that looks valid on his screen and validates nothing — and finds
// out at the scoring desk.
//
// So `sectorOutline` and `inSector` must not be two descriptions kept in step by goodwill. These
// tests fly a point across the drawn outline and demand that the rule agrees with the picture at
// every step. If the shape ever drifts from the rule, the build says so.

import { sectorOutline, type TaskPoint } from './task';

/** Metres east/north of a point, back to (lon, lat) — the inverse of what the outline gives. */
function offset(wp: Waypoint, east: number, north: number): { lon: number; lat: number } {
  const mPerLat = 111_132;
  const mPerLon = 111_320 * Math.cos(wp.lat * Math.PI / 180);
  return { lon: wp.lon + east / mPerLon, lat: wp.lat + north / mPerLat };
}

const HOME: Waypoint = { name: 'HOME', lon: 6, lat: 45 };
const NORTH: Waypoint = { name: 'N', lon: 6, lat: 45.4 };
const EAST: Waypoint = { name: 'E', lon: 6.6, lat: 45 };

test('a CYLINDER: every drawn vertex is inside, and a step beyond each one is out', () => {
  const tp: TaskPoint = { wp: HOME, sector: { kind: 'cylinder', radiusM: 3000 } };
  const outline = sectorOutline(tp, NORTH, EAST)!;
  expect(outline.length).toBeGreaterThan(16);

  for (const [e, n] of outline) {
    const inside = offset(HOME, e * 0.98, n * 0.98);
    const outside = offset(HOME, e * 1.05, n * 1.05);
    expect(inSector(tp, inside.lon, inside.lat, NORTH, EAST)).toBe(true);
    expect(inSector(tp, outside.lon, outside.lat, NORTH, EAST)).toBe(false);
  }
});

test('an FAI QUADRANT is NOT a circle, and the drawing knows which 90° it is', () => {
  const tp: TaskPoint = { wp: HOME, sector: { kind: 'faiQuadrant', radiusM: 3000 } };
  const outline = sectorOutline(tp, NORTH, EAST)!;

  // Every drawn point (bar the apex) is in the sector, just inside the radius.
  for (const [e, n] of outline.slice(1)) {
    const p = offset(HOME, e * 0.98, n * 0.98);
    expect(inSector(tp, p.lon, p.lat, NORTH, EAST)).toBe(true);
  }

  // And the OTHER three quadrants are not: a circle of the same radius would have swallowed them,
  // and that circle is exactly the lie this test exists to prevent.
  let outsideTheWedge = 0;
  for (let brg = 0; brg < 360; brg += 10) {
    const a = brg * Math.PI / 180;
    const p = offset(HOME, 2500 * Math.sin(a), 2500 * Math.cos(a));
    if (!inSector(tp, p.lon, p.lat, NORTH, EAST)) outsideTheWedge++;
  }
  expect(outsideTheWedge).toBeGreaterThan(20);      // ~3/4 of the circle is NOT the sector
});

test('a START LINE is a gate across the course — a rectangle, not a cylinder', () => {
  const tp: TaskPoint = { wp: HOME, sector: { kind: 'line', lengthM: 2000 } };
  const outline = sectorOutline(tp, null, NORTH)!;
  expect(outline.length).toBe(4);

  for (const [e, n] of outline) {
    const p = offset(HOME, e * 0.95, n * 0.95);
    expect(inSector(tp, p.lon, p.lat, null, NORTH)).toBe(true);
  }
  // Far along the course, well inside a cylinder of the same size, and OUT of the gate.
  const along = offset(HOME, 0, 900);
  expect(inSector(tp, along.lon, along.lat, null, NORTH)).toBe(false);
});

test('a shape that needs a leg it has not got is NOT drawn — a map does not invent a rule', () => {
  // A start line with nothing to stand across is a misbuilt task. Drawing it as a giant cylinder
  // would be the map making up a sector the rules never gave it.
  expect(sectorOutline({ wp: HOME, sector: { kind: 'line', lengthM: 2000 } }, null, null)).toBeNull();
  expect(sectorOutline({ wp: HOME, sector: { kind: 'faiQuadrant', radiusM: 3000 } }, NORTH, null)).toBeNull();
});
