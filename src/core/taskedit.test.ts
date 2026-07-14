// The task builder edits a LIST OF WAYPOINTS. It knows nothing about sectors, and these tests pin
// that ignorance: the shapes come from `simpleTask`, which is where they are defined and where
// `inSector` judges them. A builder with its own idea of a sector would be a second rule book, and
// the map would draw one while the scorer judged by the other.

import { test, expect } from 'bun:test';
import {
  taskWaypoints, withWaypoints, editWaypoints, taskProblems, taskLengthM, RULE_VERSIONS,
} from './taskedit';
import { inSector, type Waypoint } from './task';

const A: Waypoint = { name: 'START', lon: 6, lat: 45 };
const B: Waypoint = { name: 'TP1', lon: 6.4, lat: 45.3 };
const C: Waypoint = { name: 'TP2', lon: 6.1, lat: 45.5 };

// ---- the task is derived, never invented ----

test('the sectors come from the kernel: a start is a GATE, a turnpoint is a cylinder', () => {
  const t = withWaypoints([A, B, C], 'fai-2024')!;
  expect(t.points.map(p => p.sector.kind)).toEqual(['line', 'cylinder', 'line']);
  // And they are the SAME shapes inSector judges by — this file added nothing.
  expect(inSector(t.points[1], B.lon, B.lat, A, C)).toBe(true);
});

test('two points are the fewest a task can have — one point is not a shorter task', () => {
  expect(withWaypoints([], 'fai-2024')).toBeNull();
  expect(withWaypoints([A], 'fai-2024')).toBeNull();
  expect(withWaypoints([A, B], 'fai-2024')).not.toBeNull();
});

test('the round trip is exact', () => {
  expect(taskWaypoints(withWaypoints([A, B, C], 'fai-2024'))).toEqual([A, B, C]);
  expect(taskWaypoints(null)).toEqual([]);
});

// ---- the edits ----

test('a point is APPENDED, never inserted at a guess', () => {
  // A pilot builds a task in the order he will fly it. A builder that put the point somewhere else
  // would be deciding his route for him.
  expect(editWaypoints([A, B], 'add', 0, C)).toEqual([A, B, C]);
});

test('remove, up and down', () => {
  expect(editWaypoints([A, B, C], 'remove', 1)).toEqual([A, C]);
  expect(editWaypoints([A, B, C], 'up', 2)).toEqual([A, C, B]);
  expect(editWaypoints([A, B, C], 'down', 0)).toEqual([B, A, C]);
});

test('an edit off the end of the list is a NO-OP, not a throw', () => {
  // The screen repaints, and between the paint and the tap the list may have moved under the pilot's
  // finger. A builder that threw there would take the whole app down over a mistimed touch.
  expect(editWaypoints([A, B], 'remove', 9)).toEqual([A, B]);
  expect(editWaypoints([A, B], 'up', 0)).toEqual([A, B]);
  expect(editWaypoints([A, B], 'down', 1)).toEqual([A, B]);
  expect(editWaypoints([A, B], 'add', 0)).toEqual([A, B]);      // nothing to add
});

// ---- TSK-009: what is WRONG, not merely 'invalid' ----

test('a zero-length leg is named, and it is the one that would have killed the start gate', () => {
  // Two consecutive points at the same place is a leg with no COURSE — and a start LINE has no course
  // to stand across. inSector refuses it, correctly, and the pilot would have seen a gate that never
  // opens and never known why. Caught here, where he can still fix it.
  const dup: Waypoint = { name: 'TP1 again', lon: 6.4, lat: 45.3 };
  const problems = taskProblems([A, B, dup, C]);
  expect(problems.length).toBe(1);
  expect(problems[0].id).toBe('task.problem.zeroLeg');
  expect(problems[0].index).toBe(2);
  expect(problems[0].params).toEqual({ from: 'TP1', to: 'TP1 again' });
});

test('a single point is too short — and an EMPTY list is not a broken task', () => {
  expect(taskProblems([A]).map(p => p.id)).toEqual(['task.problem.tooShort']);
  expect(taskProblems([])).toEqual([]);      // nothing declared is not the same as declared wrong
});

test('a real task has nothing wrong with it', () => {
  expect(taskProblems([A, B, C])).toEqual([]);
});

// ---- what the pilot is drawing ----

test('the length is the line he drew, and it is null before there is one', () => {
  expect(taskLengthM([A])).toBeNull();
  const d = taskLengthM([A, B, C])!;
  expect(d).toBeGreaterThan(70_000);       // ~50 km + ~30 km, roughly
  expect(d).toBeLessThan(110_000);
});

test('the rule versions come from the kernel, never spelled again here', () => {
  expect(RULE_VERSIONS).toContain('fai-2024');
  expect(RULE_VERSIONS.length).toBeGreaterThan(0);
});
