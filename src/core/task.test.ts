// The task validator, pinned where regulation bites: sectors are versioned VALUES, order is
// law, and a validated turnpoint never un-validates.
import { test, expect } from 'bun:test';
import { simpleTask, freshProgress, advance, inSector, RULES, type Waypoint } from './task';

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
