import { test, expect } from 'bun:test';
import {
  proposeMc, mcWorthShowing, autoMcTracker,
  MAX_CLIMBS, MIN_CLIMBS, HORIZON_S, NUDGE_MS, type Climb,
} from './automc';

/** A finished climb: average, and the second of the day it ended on. */
const c = (avgMs: number, endSod: number): Climb => ({ avgMs, endSod });

// ---- what the module REFUSES to say -------------------------------------------------------

test('TWO CLIMBS IS NOT A DAY — it says null, not zero, and not a plausible number', () => {
  // The whole discipline of this app in one assertion: a box a pilot can see is empty beats a box
  // he will never re-check. Zero is a REAL MacCready setting ("the day is over, fly best glide"),
  // so returning it for want of an answer would be a lie he could act on.
  expect(proposeMc([], 40000)).toBeNull();
  expect(proposeMc([c(2.0, 39000)], 40000)).toBeNull();
  expect(proposeMc([c(2.0, 39000), c(2.2, 39600)], 40000)).toBeNull();
  // and the third one unlocks it — MIN_CLIMBS, not two, not one
  const p = proposeMc([c(2.0, 39000), c(2.2, 39600), c(1.8, 39900)], 40000);
  expect(p?.mcMs).toBeCloseTo(2.0);
  expect(p?.fromClimbs).toBe(3);
});

test('AN HOUR WITHOUT A CLIMB AND WE HAVE NO OPINION — the morning does not vote at four o\'clock', () => {
  // The failure that hurts: four good climbs before lunch, then an hour of scratching along a ridge
  // finding nothing. The count cap has no clock, so on its own it would still be handing him the
  // morning's confident MC at the exact moment the day has stopped working under him.
  const morning = [c(2.5, 36000), c(2.8, 36600), c(2.4, 37200), c(2.6, 37800)];
  expect(proposeMc(morning, 37900)).not.toBeNull();          // still warm
  expect(proposeMc(morning, 37800 + HORIZON_S + 1)).toBeNull();   // all aged out: "—", and he can see it
});

test('a climb the kernel would not even call a climb does not vote', () => {
  // Below airmass.MIN_STRENGTH (0.3 m/s) is not a thermal, it is buoyant air the glider sank
  // through a little slower. Three of them would otherwise propose an MC of 0.2 — a number that
  // looks measured and means nothing.
  expect(proposeMc([c(0.1, 39000), c(0.2, 39300), c(0.05, 39600)], 39700)).toBeNull();
});

test('one NaN does not poison the median — it is dropped, and it does not count towards the three', () => {
  const p = proposeMc([c(NaN, 39000), c(2.0, 39300), c(2.2, 39600)], 39700);
  expect(p).toBeNull();                     // two real climbs left: still not a day
});

test('climbs from the FUTURE are a broken clock, not evidence', () => {
  // A replayed afternoon log left in the list while the instrument runs live. Averaging across two
  // flights is how a pilot ends up flying yesterday's MacCready.
  expect(proposeMc([c(3.0, 50000), c(3.2, 50600), c(3.4, 51200)], 32000)).toBeNull();
});

// ---- the estimate itself ------------------------------------------------------------------

test('ONE MONSTER CLIMB DOES NOT SET THE MC FOR THE REST OF THE FLIGHT', () => {
  // The reason this file uses a median. Four honest 1.5s and one 6.0 m/s core under a decaying
  // cu-nim: the mean says 2.5 and has him flying too fast on every glide for the next hour, low on
  // arrival and low on options. The median shrugs at the outlier — exactly as the pilot does when
  // he says "yes, but that one doesn't count".
  const p = proposeMc([c(1.4, 38000), c(1.5, 38600), c(1.6, 39200), c(1.5, 39800), c(6.0, 40400)], 40500);
  expect(p?.mcMs).toBeCloseTo(1.5);
  expect(p!.mcMs).toBeLessThan(2.0);        // a mean would be 2.4
});

test('the day getting BETTER does move it — this is not a fixed number', () => {
  // The dual of the test above: robust is not deaf. When the whole sample climbs, so does the MC.
  const p = proposeMc([c(3.0, 39000), c(3.4, 39400), c(3.2, 39800)], 39900);
  expect(p?.mcMs).toBeCloseTo(3.2);
});

test('only the last MAX_CLIMBS vote, even when all of them are fresh', () => {
  // Eight climbs inside the horizon on a fast day. The three oldest — weak, from the start of the
  // run — must not drag down an MC that describes what is happening NOW.
  const climbs = [
    c(0.5, 39000), c(0.6, 39100), c(0.5, 39200),          // the start of the run, weak
    c(3.0, 39300), c(3.2, 39400), c(3.1, 39500), c(3.3, 39600), c(3.2, 39700),
  ];
  const p = proposeMc(climbs, 39800);
  expect(p?.fromClimbs).toBe(MAX_CLIMBS);
  expect(p?.mcMs).toBeCloseTo(3.2);
});

test('the proposal lands on the pilot\'s own 0.1 knob — no false precision, no 1.7000000000000002', () => {
  // Four thermals cannot support three decimals, and a number that looks computed to the millimetre
  // borrows an authority it has not earned.
  const p = proposeMc([c(1.73, 39000), c(1.66, 39300), c(1.71, 39600), c(1.68, 39900)], 40000);
  expect(p!.mcMs).toBe(1.7);                // exactly, not 1.7000000000000002
  expect(p!.mcMs * 10 % 1).toBeCloseTo(0);
});

test('it says what it rests on — three climbs from before lunch is a different claim from three in the last ten minutes', () => {
  const p = proposeMc([c(2.0, 38000), c(2.2, 38600), c(2.1, 39200)], 40000);
  expect(p?.fromClimbs).toBe(3);
  expect(p?.spanS).toBe(2000);              // the OLDEST voter ended 2000 s ago: judge for yourself
});

// ---- it proposes, it does not impose ------------------------------------------------------

test('IT NEVER SETS ANYTHING — a suggestion within NUDGE_MS is not worth the pilot\'s glance', () => {
  // A field that lights up every time a thermal ends is a field the eye learns to skip, and then it
  // is not there on the day the number really has moved.
  const p = proposeMc([c(2.0, 39000), c(2.1, 39300), c(2.0, 39600)], 39700)!;
  expect(p.mcMs).toBeCloseTo(2.0);
  expect(mcWorthShowing(2.0, p)).toBe(false);
  expect(mcWorthShowing(2.0 - (NUDGE_MS - 0.1), p)).toBe(false);
  expect(mcWorthShowing(1.0, p)).toBe(true);          // a whole metre per second out: look at this
});

test('no proposal, nothing to show — the shell is never told to nag about a null', () => {
  expect(mcWorthShowing(2.0, null)).toBe(false);
  expect(mcWorthShowing(null, null)).toBe(false);
});

test('a pilot who has not set an MC at all is worth telling', () => {
  const p = proposeMc([c(2.0, 39000), c(2.1, 39300), c(2.0, 39600)], 39700);
  expect(mcWorthShowing(null, p)).toBe(true);
});

// ---- the accumulator the flight loop feeds ------------------------------------------------

test('THE SAME THERMAL OFFERED ON EVERY FIX IS STILL ONE THERMAL', () => {
  // circling.lastThermal() returns the SAME climb on every fix for as long as it is the last one —
  // twenty minutes of glide at 1 Hz is twelve hundred offers of one climb. A history built naively
  // from that has one thermal voting a thousand times, and the "median" is just the last climb.
  const t = autoMcTracker();
  for (let i = 0; i < 600; i++) t.add(c(4.0, 39600));     // one strong climb, offered all glide long
  t.add(c(1.0, 40200));
  t.add(c(1.2, 40800));
  expect(t.climbs().length).toBe(3);
  expect(t.propose(40900)?.mcMs).toBeCloseTo(1.2);        // the median of 4.0, 1.0, 1.2 — not 4.0
});

test('a climb RE-DETECTED after the ring scrolled updates it, it does not become a second climb', () => {
  // circling re-detects the same thermal with a truncated start as its 15-minute ring rolls: same
  // climb, slightly different endSod (the resampling grid moves it by a step or two) and a weaker
  // average. Counting it twice would let one thermal cast two votes out of three.
  const t = autoMcTracker();
  t.add(c(3.0, 39600));
  t.add(c(2.6, 39603));            // same climb, +3 s (inside GAP), now looks weaker
  expect(t.climbs().length).toBe(1);
  expect(t.climbs()[0].avgMs).toBeCloseTo(2.6);   // the freshest record of it wins
});

test('YESTERDAY\'S FLIGHT DOES NOT SET TODAY\'S MC — the clock going backwards is a new flight', () => {
  // Replay an afternoon log (sod ≈ 50000), then plug into the instrument next morning (sod ≈ 32000).
  // Without the reset, the pilot is offered the replayed flight's MacCready, in confident measured
  // styling, for his first climb of the day.
  const t = autoMcTracker();
  t.add(c(4.0, 50000));
  t.add(c(4.2, 50600));
  t.add(c(4.1, 51200));
  expect(t.propose(51300)).not.toBeNull();
  t.add(c(1.0, 32000));            // live, next morning
  expect(t.climbs().length).toBe(1);
  expect(t.propose(32100)).toBeNull();     // one climb of a new day: no opinion. Not 4.1.
});

test('the accumulator keeps only climbs, not junk', () => {
  const t = autoMcTracker();
  t.add(c(NaN, 39000));
  t.add(c(-1.0, 39300));
  t.add(c(0.1, 39600));            // below the kernel's MIN_STRENGTH
  expect(t.climbs().length).toBe(0);
  expect(t.propose(39700)).toBeNull();
});

test('the constants are the ones the file argues for', () => {
  // If someone widens the memory to twenty climbs, the morning starts voting in the afternoon again
  // and the whole point of the horizon is gone. These numbers are the module.
  expect(MIN_CLIMBS).toBeGreaterThanOrEqual(3);
  expect(MAX_CLIMBS).toBeGreaterThan(MIN_CLIMBS);
  expect(MAX_CLIMBS).toBeLessThanOrEqual(8);
  expect(HORIZON_S).toBeGreaterThanOrEqual(1800);
  expect(HORIZON_S).toBeLessThanOrEqual(5400);
});
