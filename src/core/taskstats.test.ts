// What the task owes, pinned as CLAIMS (TSK-007, TSK-006's clock).
//
// Most of these tests are about NULL, and that is the point. Every figure on this panel has an
// arithmetic form that would happily produce a number before the number means anything — a
// speed of 0.0 before the start, an ETA of Infinity at a standstill, a "required speed" of
// 10^9 m/s one second after the minimum time expires. Each of those is a plausible-looking
// digit in front of a pilot, and POT-007 says the dash is the honest answer. So the assertions
// below are `toBeNull()`, deliberately and repeatedly, and never `toBe(0)`.
import { test, expect } from 'bun:test';
import { simpleTask, aatTask, freshProgress, freshAat, type Waypoint, type TaskProgress, type AatProgress } from './task';
import { taskStats, isAat } from './taskstats';
import { distM, M_PER_LAT } from 'soaring-core/geo';

// Due north of each other, so the flat-earth distances are exact and round: the arithmetic
// under test is the ratio, not the geodesy.
const LEG_M = 45000;
const S: Waypoint = { name: 'START', lon: 6.0, lat: 46.0 };
const T1: Waypoint = { name: 'TP1', lon: 6.0, lat: 46.0 + LEG_M / M_PER_LAT };
const F: Waypoint = { name: 'FINISH', lon: 6.0, lat: 46.0 + 2 * LEG_M / M_PER_LAT };

const START_SOD = 36000;   // 10:00 UTC
const at = (wp: { lon: number; lat: number }, sod: number): { lon: number; lat: number; sod: number } =>
  ({ lon: wp.lon, lat: wp.lat, sod });

/** Progress as a VALUE — the fold in task.ts is pinned by task.test.ts, and re-flying fixes
 *  through it here would test the validator a second time instead of the arithmetic on top. */
const progress = (next: number, validatedAt: (number | null)[]): TaskProgress => ({ next, validatedAt });

test('with no fix, the task owes nothing it can name', () => {
  const t = simpleTask([S, T1, F]);
  const s = taskStats(t, freshProgress(t), freshAat(t), null);
  expect(s.remainingM).toBeNull();
  expect(s.achievedMs).toBeNull();
  expect(s.etaS).toBeNull();
  expect(s.elapsedS).toBeNull();
  expect(s.overUnderS).toBeNull();
  expect(s.requiredMs).toBeNull();
});

test('before the start validates, every TIME figure is null — and the distance ahead is still a fact', () => {
  const t = simpleTask([S, T1, F]);
  const s = taskStats(t, freshProgress(t), freshAat(t), at(S, START_SOD));
  // The five that depend on a clock that has not started. Null, not zero: a speed on task of
  // 0.0 km/h reads as "you are going nowhere", and the truth is "the question is not open yet".
  expect(s.achievedMs).toBeNull();
  expect(s.etaS).toBeNull();
  expect(s.elapsedS).toBeNull();
  expect(s.overUnderS).toBeNull();
  expect(s.requiredMs).toBeNull();
  // The one that does not: the glider is sitting on the start gate and the whole task lies
  // ahead of it. That is 90 km, measured, and hiding it behind a dash would hide a number we
  // have. (This is the documented reading of the header; it is pinned here so a future edit
  // has to argue with a test rather than with a comment.)
  expect(s.remainingM).toBeCloseTo(2 * LEG_M, 0);
});

test('speed on task is the scorer\'s distance over the task clock', () => {
  const t = simpleTask([S, T1, F]);
  // Start at 10:00, TP1 rounded 30 minutes later: 45 km credited in 1800 s.
  const p = progress(2, [START_SOD, START_SOD + 1800, null]);
  const s = taskStats(t, p, freshAat(t), at(T1, START_SOD + 1800));
  expect(s.elapsedS).toBe(1800);
  expect(s.achievedMs!).toBeCloseTo(25, 2);        // 45000 / 1800
});

test('what is left is measured from HERE, through every point not yet rounded', () => {
  const t = simpleTask([S, T1, F]);
  const p = progress(1, [START_SOD, null, null]);  // started, TP1 ahead
  const pos = { lon: 6.05, lat: 46.1 };            // off the leg, mid-air
  const s = taskStats(t, p, freshAat(t), at(pos, START_SOD + 600));
  const expected = distM(pos.lon, pos.lat, T1.lon, T1.lat) + distM(T1.lon, T1.lat, F.lon, F.lat);
  expect(s.remainingM!).toBeCloseTo(expected, 0);  // to within a metre
});

test('the ETA prices what is left at the speed actually made — and does not exist without one', () => {
  const t = simpleTask([S, T1, F]);
  const p = progress(2, [START_SOD, START_SOD + 1800, null]);
  const s = taskStats(t, p, freshAat(t), at(T1, START_SOD + 1800));
  expect(s.etaS!).toBeCloseTo(s.remainingM! / s.achievedMs!, 0);   // within a second

  // The same glider one second after crossing the start line: nothing credited, no speed, and
  // therefore no ETA. Not Infinity, not a huge number — nothing.
  const fresh = taskStats(t, progress(1, [START_SOD, null, null]), freshAat(t), at(S, START_SOD));
  expect(fresh.achievedMs).toBeNull();             // elapsed 0: the ratio has no denominator
  expect(fresh.etaS).toBeNull();

  // And a glider that HAS a clock but has been credited nothing (still inside the start sector,
  // no turnpoint yet) makes 0 m/s — which is a measured zero, but still no ETA to speak of.
  const stopped = taskStats(t, progress(1, [START_SOD, null, null]), freshAat(t), at(S, START_SOD + 300));
  expect(stopped.achievedMs).toBe(0);
  expect(stopped.etaS).toBeNull();
});

test('a finished task owes zero distance and zero time — an earned zero, not a dash', () => {
  const t = simpleTask([S, T1, F]);
  const p = progress(3, [START_SOD, START_SOD + 1800, START_SOD + 3600]);
  const s = taskStats(t, p, freshAat(t), at(F, START_SOD + 3600));
  expect(s.remainingM).toBe(0);
  expect(s.etaS).toBe(0);
  expect(s.elapsedS).toBe(3600);
  expect(s.achievedMs!).toBeCloseTo(25, 2);        // 90 km in an hour: the whole task's speed
});

test('AAT: the minimum time says whether the task will run long, and what speed lands on it', () => {
  const t = aatTask([S, T1, F]);
  expect(isAat(t)).toBe(true);
  const MIN = 10800;                               // a 3-hour AAT

  // In the area at TP1, rounded, heading for the finish an hour and a half in.
  const best = { lon: 6.0, lat: T1.lat };
  const a: AatProgress = [null, best, null];
  const p = progress(2, [START_SOD, START_SOD + 5400, null]);
  const s = taskStats(t, p, a, at(T1, START_SOD + 5400), { minTaskTimeS: MIN });

  expect(s.elapsedS).toBe(5400);
  expect(s.overUnderS!).toBeCloseTo(s.elapsedS! + s.etaS! - MIN, 3);
  // 45 km in 90 min = 8.33 m/s; the remaining 45 km costs another 90 min ⇒ dead on 3 h.
  expect(s.overUnderS!).toBeCloseTo(0, 0);
  // The speed that lands exactly on the minimum time, over the time still available.
  expect(s.requiredMs!).toBeCloseTo(s.remainingM! / (MIN - s.elapsedS!), 6);

  // The same 45 km taken two hours: the task comes home LATE, and the sign says so.
  const slowP = progress(2, [START_SOD, START_SOD + 7200, null]);
  const slow = taskStats(t, slowP, a, at(T1, START_SOD + 7200), { minTaskTimeS: MIN });
  expect(slow.overUnderS!).toBeGreaterThan(0);
  // Taken an hour: home EARLY — and on an AAT, early is distance given away.
  const fastP = progress(2, [START_SOD, START_SOD + 3600, null]);
  const fast = taskStats(t, fastP, a, at(T1, START_SOD + 3600), { minTaskTimeS: MIN });
  expect(fast.overUnderS!).toBeLessThan(0);

  // Once the minimum time has run out there is no speed that lands on it. Null — never
  // Infinity, never a five-digit km/h nobody can fly.
  const late = taskStats(t, p, a, at(T1, START_SOD + MIN), { minTaskTimeS: MIN });
  expect(late.requiredMs).toBeNull();
  const later = taskStats(t, p, a, at(T1, START_SOD + MIN + 600), { minTaskTimeS: MIN });
  expect(later.requiredMs).toBeNull();
  // …but the task still owes distance and time, and still says it will run long.
  expect(later.remainingM!).toBeGreaterThan(0);
  expect(later.overUnderS!).toBeGreaterThan(0);
});

test('AAT: no minimum time given, no AAT figures', () => {
  const t = aatTask([S, T1, F]);
  const p = progress(2, [START_SOD, START_SOD + 5400, null]);
  const s = taskStats(t, p, freshAat(t), at(T1, START_SOD + 5400));
  expect(s.overUnderS).toBeNull();
  expect(s.requiredMs).toBeNull();
});

test('TSK-007: the REQUIRED speed is priced on a racing task too, not only on an AAT', () => {
  // TSK-007 is a Must and it is not qualified by task type: "vitesse sur tâche réalisée ET
  // requise", permanently. The required speed used to be forced to null for anything without an
  // assigned area — so on the commonest task there is, the pilot asking "am I fast enough to get
  // home in the time I have" was shown nothing at all, and the task time he had typed in was
  // silently discarded.
  const t = simpleTask([S, T1, F]);
  expect(isAat(t)).toBe(false);
  const p = progress(2, [START_SOD, START_SOD + 1800, null]);
  const s = taskStats(t, p, freshAat(t), at(T1, START_SOD + 1800), { minTaskTimeS: 10800 });
  // 3 h set, 30 min flown: what is left must be covered in the 2.5 h that remain.
  expect(s.requiredMs!).toBeCloseTo(s.remainingM! / (10800 - 1800), 6);
  expect(s.achievedMs!).toBeCloseTo(25, 2);
  // The over/under stays an AAT figure: only there is coming home early a mistake with a remedy
  // (fly deeper into the areas). On a racing task there is nowhere to spend the spare time.
  expect(s.overUnderS).toBeNull();
});

test('no task time given: the required speed is a DASH, never a zero and never a hurry', () => {
  const t = simpleTask([S, T1, F]);
  const p = progress(2, [START_SOD, START_SOD + 1800, null]);
  const s = taskStats(t, p, freshAat(t), at(T1, START_SOD + 1800));
  expect(s.requiredMs).toBeNull();      // nobody told us the time; we do not invent one
});
