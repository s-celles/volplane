// VAR-006 pinned: the average of the last thermal and of the last circle. The headline claim
// under test is the NULL — every assertion that a fresh, straight-flying or descending glider
// gets `null` and not `0` is guarding the pilot against a number that looks like a dead thermal.
import { test, expect } from 'bun:test';
import { circlingTracker, lastCircleSpan } from './circling';
import type { TrackPoint } from 'soaring-core/types';

// A synthetic glider. It flies legs — a circle of radius 60 m and period 25 s (14.4°/s, well
// over TURN_MIN), or a straight leg at 30 m/s — with a constant climb rate on each, and the
// legs join continuously in position AND heading, because a teleport between them would forge a
// turn the glider never flew and the ±W heading smoothing would smear it either way.
const LAT0 = 45, LON0 = 6;
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const RADIUS = 60, PERIOD = 25, V_STRAIGHT = 30;

interface Leg { turn: boolean; durS: number; climb: number }
const circleLeg = (durS: number, climb: number): Leg => ({ turn: true, durS, climb });
const straightLeg = (durS: number, climb = -1): Leg => ({ turn: false, durS, climb });

function fly(legs: Leg[], startAlt = 1500, startSod = 36000): TrackPoint[] {
  const pts: TrackPoint[] = [];
  let x = 0, y = 0, alt = startAlt, sod = startSod, hdg = 0;   // hdg: math convention, radians
  const push = () => pts.push([LON0 + x / M_LON, LAT0 + y / M_LAT, alt, sod]);
  push();
  for (const leg of legs) {
    const v = leg.turn ? (2 * Math.PI * RADIUS) / PERIOD : V_STRAIGHT;
    const omega = leg.turn ? -(2 * Math.PI) / PERIOD : 0;      // right-hand circles
    for (let k = 0; k < leg.durS; k++) {
      hdg += omega;
      x += v * Math.cos(hdg);
      y += v * Math.sin(hdg);
      alt += leg.climb;
      sod += 1;
      push();
    }
  }
  return pts;
}

const feed = (pts: TrackPoint[]) => {
  const c = circlingTracker();
  for (const [lon, lat, alt, sod] of pts) c.add(sod, lon, lat, alt);
  return c;
};

test('a fresh tracker knows nothing, and says so', () => {
  const c = circlingTracker();
  // Null, not 0. This IS the requirement: an average of no climb is not a climb of 0.0 m/s.
  expect(c.lastThermal()).toBeNull();
  expect(c.lastCircle()).toBeNull();
  expect(c.circling()).toBe(false);
});

test('ten minutes of straight flight is not a thermal and is not a circle', () => {
  const c = feed(fly([straightLeg(600, -1)]));
  expect(c.lastThermal()).toBeNull();
  expect(c.lastCircle()).toBeNull();
  expect(c.circling()).toBe(false);
});

test('circling at +2 m/s: the last circle averages what the circle did', () => {
  const c = feed(fly([circleLeg(360, 2)]));
  expect(c.circling()).toBe(true);
  const circle = c.lastCircle()!;
  expect(circle).not.toBeNull();
  expect(circle.avgMs).toBeCloseTo(2.0, 1);
  expect(Math.abs(circle.avgMs - 2.0)).toBeLessThan(0.15);
  expect(Math.abs(circle.durationS - PERIOD)).toBeLessThan(2 * 3);
  // Still IN the climb: a thermal the glider has not left yet is not "the last thermal".
  expect(c.lastThermal()).toBeNull();
});

test('a climb, then a glide: the verdict survives the glide', () => {
  const c = feed(fly([circleLeg(300, 2), straightLeg(180, -1)]));
  const th = c.lastThermal()!;
  expect(th).not.toBeNull();
  expect(Math.abs(th.avgMs - 2.0)).toBeLessThan(0.2);
  expect(Math.abs(th.durationS - 300)).toBeLessThan(30);
  expect(th.gainM).toBeCloseTo(th.avgMs * th.durationS, 5);
  expect(c.circling()).toBe(false);
});

test('the memory outlives the ring: twenty minutes of glide later, the pilot can still ask', () => {
  // The climb is long gone from the buffer — every one of its fixes has been trimmed. The
  // question "what did the last one give?" is asked precisely when the day has gone quiet.
  const c = feed(fly([circleLeg(300, 2), straightLeg(1200, -1)]));
  const th = c.lastThermal()!;
  expect(th).not.toBeNull();
  expect(Math.abs(th.avgMs - 2.0)).toBeLessThan(0.2);
  expect(Math.abs(th.durationS - 300)).toBeLessThan(30);
  expect(c.lastCircle()).toBeNull();
});

test('a spiral descent is a circle, and it is not a thermal', () => {
  const c = feed(fly([circleLeg(300, -3), straightLeg(120, -1)]));
  // MIN_GAIN rejects every descent (gain ≤ 0), which is the kernel's own guard and the reason
  // a spiral dive never gets announced as "the last thermal, −3.0 m/s".
  expect(c.lastThermal()).toBeNull();
  // But the circle itself is a MEASUREMENT, and a sinking circle is a fact the pilot needs.
  // Negative here, never null and never clamped to 0.
  const still = feed(fly([circleLeg(300, -3)]));
  expect(Math.abs(still.lastCircle()!.avgMs - -3.0)).toBeLessThan(0.15);
  expect(still.lastThermal()).toBeNull();
  // And it is the circle, not the two minutes since: a span that ran on into the glide would
  // average the cruise in with the spiral and report a sink the glider never flew.
  expect(Math.abs(c.lastCircle()!.avgMs - -3.0)).toBeLessThan(0.15);
  expect(Math.abs(c.lastCircle()!.durationS - PERIOD)).toBeLessThan(2 * 3);
});

test('two thermals: it is the LAST one, not the strongest', () => {
  const legs = (a: number, b: number) =>
    fly([circleLeg(240, a), straightLeg(90, -1), circleLeg(240, b), straightLeg(60, -1)]);
  // Weak then strong.
  const up = feed(legs(1, 3));
  expect(Math.abs(up.lastThermal()!.avgMs - 3.0)).toBeLessThan(0.3);
  // Strong then weak — the case that actually separates "last" from "best". A tracker that kept
  // the strongest would still answer 3.0 here and send the pilot back into a thermal that has died.
  const down = feed(legs(3, 1));
  expect(Math.abs(down.lastThermal()!.avgMs - 1.0)).toBeLessThan(0.3);
  expect(down.lastThermal()!.endSod).toBeGreaterThan(up.lastThermal()!.endSod - 1);
});

test('lastCircleSpan: 200° of turn is not a circle', () => {
  // 200/360 of a period. Nearly a circle is null — the average would otherwise be taken over an
  // arc, and an arc through the core of a thermal averages the core, not the thermal.
  const partial = fly([straightLeg(60, -1), circleLeg(Math.round((200 / 360) * PERIOD), 2)]);
  expect(lastCircleSpan(partial)).toBeNull();
  // A circle and a half: the ±W heading baseline is clamped at the track's end, so the last few
  // samples of a track under-report their sweep and a track holding EXACTLY one turn can fall a
  // few degrees short. Erring on the side of null is the right way to be wrong here.
  const full = fly([straightLeg(60, -1), circleLeg(Math.round(1.5 * PERIOD), 2)]);
  const span = lastCircleSpan(full)!;
  expect(span).not.toBeNull();
  expect(span.toSod).toBeGreaterThan(span.fromSod);
  expect(Math.abs(span.toSod - span.fromSod - PERIOD)).toBeLessThan(2 * 3);
});

test('lastCircleSpan on a track too short to hold a heading is null, not a guess', () => {
  expect(lastCircleSpan([])).toBeNull();
  expect(lastCircleSpan([[LON0, LAT0, 1000, 36000]])).toBeNull();
});

// ---- a clock that goes BACKWARDS is a new flight, not a fix to be ignored ----
// The guard at the top of `add` refuses any fix that does not advance the clock — it has to, or
// the probes' binary search breaks. Read as "sod <= last", it also refuses an entire SESSION: the
// pilot replays an afternoon log (sods around 50000), then connects to the instrument the next
// morning (sods around 32000), and every live fix is silently dropped. The boxes then show the
// replayed flight's last thermal and last circle, in plain measured styling, with no badge and no
// dimming, for the whole of the real flight.

test('a session with EARLIER sods is a new flight — its fixes are not silently dropped', () => {
  const c = circlingTracker();
  // The afternoon replay: five minutes of climbing circles at +2 m/s.
  for (const [lon, lat, alt, sod] of fly([circleLeg(300, 2)], 1000, 50000))
    c.add(sod, lon, lat, alt);
  const replayed = c.lastCircle()!;
  expect(replayed.avgMs).toBeGreaterThan(1);

  // The next morning's live flight, over the same ground but SINKING. Every one of these fixes is
  // "older" than the replay, and every one of them used to be thrown away.
  for (const [lon, lat, alt, sod] of fly([circleLeg(300, -1.5)], 1000, 32000))
    c.add(sod, lon, lat, alt);

  const live = c.lastCircle()!;
  expect(live).not.toBeNull();
  expect(live.avgMs).toBeLessThan(0);              // THIS circle, which sank — not the replayed one
  expect(live.endSod).toBeLessThan(40000);         // and it is timed in this flight's clock
  // The thermal memory outlives the ring on purpose; it does not outlive the FLIGHT.
  expect(c.lastThermal()?.endSod ?? 0).toBeLessThan(40000);
});

test('a fix that merely repeats the clock is still ignored, as it must be', () => {
  const c = circlingTracker();
  const pts = fly([circleLeg(300, 2)], 1000, 36000);
  for (const [lon, lat, alt, sod] of pts) c.add(sod, lon, lat, alt);
  const before = c.lastCircle()!;
  const last = pts[pts.length - 1];
  c.add(last[3], last[0], last[1], last[2] + 500);   // same second, absurd height: refused whole
  expect(c.lastCircle()).toEqual(before);
});
