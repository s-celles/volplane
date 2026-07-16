import { test, expect } from 'bun:test';
import { M_PER_LAT, mPerLng } from 'soaring-core/geo';
import {
  requiredGlide, achievedGlide, compareGlide, glideWindow,
  WINDOW_S, MIN_SPAN_S, MIN_LOSS_M, STRAIGHT_MIN, MARGIN_FRAC,
  type GlideSample,
} from './finesse';

// Tracks are built due north from a fixed longitude, so a metre of ground is a metre of latitude
// and the numbers in the tests are the numbers a pilot would compute on the back of his hand.
const LON = 6.0;
const LAT0 = 45.0;
const north = (m: number): number => LAT0 + m / M_PER_LAT;
const east = (m: number): number => LON + m / mPerLng(LAT0);

/** A straight glide: `n` seconds at `groundMs` over the ground, sinking `sinkMs`. */
function straight(n: number, o: { sod0?: number; alt0?: number; groundMs?: number; sinkMs?: number; d0?: number } = {}): GlideSample[] {
  const { sod0 = 0, alt0 = 1500, groundMs = 30, sinkMs = 1, d0 = 0 } = o;
  const out: GlideSample[] = [];
  for (let i = 0; i <= n; i++)
    out.push({ sod: sod0 + i, lon: LON, lat: north(d0 + i * groundMs), altM: alt0 - i * sinkMs });
  return out;
}

// ============ REQUIRED — the number with no model in it ============

test('the required finesse is distance over the height you may actually spend', () => {
  // 10 km out, 1000 m above the field. Ten. Nothing in this number came from a polar, a wind
  // estimate or a MacCready ring, and that is exactly why it can be used to check them.
  expect(requiredGlide(10_000, 1500, 500)).toBeCloseTo(10, 6);
});

test('THE RESERVE IS SPENT BEFORE THE DIVISION, or it is not a reserve at all', () => {
  // Same geometry, but 300 m of it is promised to the circuit. The finesse that must be FLOWN is
  // 14.3, not 10 — and a computer that subtracted the reserve after dividing would have told the
  // pilot he needed 10 and let him arrive at the hedge with his reserve spent on the glide.
  expect(requiredGlide(10_000, 1500, 500, 300)).toBeCloseTo(10_000 / 700, 6);
});

test('A GOAL YOU CANNOT REACH AT ANY FINESSE GETS NO NUMBER — not a big one, not a negative one', () => {
  // Below the field. There is no glide ratio, however large, that flies uphill. Printing −25, or
  // 9999, next to a required-finesse label is worse than printing nothing: the pilot reads the
  // digits before the sign, under load, with one hand on the stick.
  expect(requiredGlide(10_000, 400, 500)).toBeNull();
  expect(requiredGlide(10_000, 500, 500)).toBeNull();          // exactly level with it: still no
  expect(requiredGlide(10_000, 700, 500, 200)).toBeNull();     // the reserve ate the last metre
});

test('and standing ON the goal gets no number either — never a confident zero', () => {
  // 0/h is 0, and "you need a glide ratio of 0" is precisely the message that must never appear in
  // front of a pilot who is in fact 40 km out with a broken distance behind him.
  expect(requiredGlide(0, 1500, 500)).toBeNull();
  expect(requiredGlide(-1, 1500, 500)).toBeNull();
});

test('a NaN in, a null out — no arithmetic on rubbish', () => {
  expect(requiredGlide(NaN, 1500, 500)).toBeNull();
  expect(requiredGlide(10_000, 1500, NaN)).toBeNull();
});

// ============ ACHIEVED — the number with no model in it either ============

test('a straight glide at 30 m/s losing 1 m/s is a ground finesse of 30', () => {
  const a = achievedGlide(straight(60));
  expect(a).not.toBeNull();
  expect(a!.ld).toBeCloseTo(30, 1);
  expect(a!.heightLostM).toBeCloseTo(60, 6);
  expect(a!.distanceM).toBeCloseTo(1800, 0);   // the evidence, carried out so it can be checked
  expect(a!.spanS).toBe(60);
});

test('A CLIMBING GLIDER HAS NO GLIDE RATIO — the module refuses, it does not report a negative', () => {
  // A negative finesse is a category error. And −38 beside a required 38, glanced at in a thermal,
  // reads as 38: the pilot would believe the glide was being flown while he was still going up.
  const climb = straight(60, { sinkMs: -2 });
  expect(achievedGlide(climb)).toBeNull();
});

test('and a glider that is barely sinking has no MEASURABLE glide ratio', () => {
  // 0.2 m/s of net sink over the minute is 12 m of height against a few metres of GPS altitude
  // noise. The true quotient is ~150, and it is about to stop being true the moment he leaves the
  // rising air. "—" is the honest box; "L/D 150" is a story.
  const inLift = straight(60, { sinkMs: 0.2 });
  expect(inLift[0].altM - inLift[60].altM).toBeLessThan(MIN_LOSS_M);
  expect(achievedGlide(inLift)).toBeNull();
});

test('A GLIDER CIRCLING IN A THERMAL HAS NO GLIDE RATIO — the single most common way this box lies', () => {
  // Three complete circles, 100 m radius, 20 s each: 1885 m of track flown, 90 m of height lost.
  // Path over height is 21 — a perfectly respectable-looking glide ratio, reported to a pilot who
  // is going precisely nowhere. The straightness guard is what stops it.
  const s: GlideSample[] = [];
  const R = 100, PERIOD = 20;
  for (let i = 0; i <= 60; i++) {
    const th = 2 * Math.PI * i / PERIOD;
    s.push({
      sod: i,
      lon: east(R * Math.sin(th)),
      lat: north(R * (1 - Math.cos(th))),
      altM: 1500 - 1.5 * i,
    });
  }
  // The lie the guard exists to stop: path over height is a respectable-looking 21.
  const path = 3 * 2 * Math.PI * R;
  expect(path / 90).toBeGreaterThan(20);
  expect(achievedGlide(s)).toBeNull();
});

test('a gentle course change is still a glide — the guard must not refuse honest flying', () => {
  // Half the window on one heading, half on a heading 60° off. Net over path is ~0.87: a real
  // glide, flown by a pilot dodging a cloud shadow, and a box that went blank on that would teach
  // him the instrument is unreliable and he would stop looking at it.
  const s: GlideSample[] = [];
  let x = 0, y = 0;                          // metres east, metres north
  for (let i = 0; i <= 60; i++) {
    s.push({ sod: i, lon: east(x), lat: north(y), altM: 1500 - i });
    const hdg = i < 30 ? 0 : 60 * Math.PI / 180;
    x += 30 * Math.sin(hdg);
    y += 30 * Math.cos(hdg);
  }
  const a = achievedGlide(s);
  expect(a).not.toBeNull();
  expect(a!.ld).toBeGreaterThan(20);
});

test('THIRTY SECONDS AFTER SWITCH-ON IT STILL SAYS NOTHING — the moment a fresh number is most believed', () => {
  // Twenty seconds of fixes. The quotient exists; it is ±20 % and it is shorter than the aircraft's
  // own pitch response, so a pull-up would show up in it as a collapsed glide.
  expect(achievedGlide(straight(20))).toBeNull();
  expect(achievedGlide(straight(MIN_SPAN_S))).not.toBeNull();   // and the floor is where we said
});

test('a five-minute-old thermal does not poison the glide the pilot is flying NOW', () => {
  // This is the window earning its keep. A buffer that fed everything it held to the quotient would
  // see 200 s of climb followed by 60 s of glide, find a NET GAIN of height, and go blank — or,
  // with the signs the other way, report the day's average instead of this minute's glide.
  const old: GlideSample[] = [];
  for (let i = 0; i < 200; i++) old.push({ sod: i, lon: LON, lat: north(0), altM: 1000 + i });  // climbing
  const now = straight(60, { sod0: 200, alt0: 1200, d0: 0 });
  const a = achievedGlide([...old, ...now]);
  expect(a).not.toBeNull();
  expect(a!.ld).toBeCloseTo(30, 1);
  expect(a!.spanS).toBe(WINDOW_S);
});

test('WE DO NOT DRAW A STRAIGHT LINE ACROSS A GPS DROPOUT', () => {
  // Fifteen seconds of lost signal. The glider may have flown straight through it; it may equally
  // have banked hard under the wing that shadowed the antenna. Joining the two ends and calling the
  // chord "distance flown" asserts the first, and the assertion is free to be wrong. We keep only
  // the contiguous tail — here 25 s of it, which is under the floor, so we say nothing at all.
  const s = straight(100).filter(p => p.sod < 60 || p.sod >= 75);
  expect(achievedGlide(s)).toBeNull();
});

test('but the tail after the hole is used, when there is enough of it', () => {
  // Same dropout, earlier. 55 s of unbroken flight since — that is a glide, and it is measurable.
  const s = straight(100).filter(p => p.sod < 30 || p.sod >= 45);
  const a = achievedGlide(s);
  expect(a).not.toBeNull();
  expect(a!.spanS).toBe(55);                 // NOT 60: we report what we actually watched
  expect(a!.ld).toBeCloseTo(30, 1);
});

test('a frozen GPS repeating one position is not a glider descending on the spot', () => {
  // Ground distance nil, height falling: the quotient is a confident 0.0 sitting beside a required
  // 38 — an alarm about entirely the wrong thing. In the aircraft this is a dead receiver, not a
  // hovering sailplane.
  const s = straight(60, { groundMs: 0 });
  expect(achievedGlide(s)).toBeNull();
});

test('a repeated or out-of-order timestamp cannot make a NaN', () => {
  // Replay sources and NMEA multiplexers both do this. Nothing may come out of it but a number or
  // a null — never a division by a zero span.
  const s = straight(60);
  s.push({ ...s[60], sod: s[60].sod });                       // a duplicate second
  const a = achievedGlide(s);
  expect(a === null || Number.isFinite(a.ld)).toBe(true);
  expect(achievedGlide([s[0], s[0]])).toBeNull();
});

// ============ THE COMPARISON — the reading PLA-006 exists for ============

test('needing 38 and getting 24 is LOSING, and it is the whole point of the file', () => {
  // The arrival height, computed from a polar that no longer describes this glider on this day, is
  // still saying "+200 m". These two numbers, neither of which contains a model, say otherwise.
  const c = compareGlide(38, 24);
  expect(c.verdict).toBe('losing');
  expect(c.marginFrac!).toBeCloseTo((24 - 38) / 38, 6);
});

test('and getting 45 where 30 is needed is HOLDING', () => {
  expect(compareGlide(30, 45).verdict).toBe('holding');
  expect(compareGlide(30, 45).marginFrac!).toBeCloseTo(0.5, 6);
});

test('a two per cent margin is MARGINAL, not holding — we cannot measure two per cent', () => {
  // The achieved ratio carries some 5–7 % of its own noise. A verdict flipping between HOLDING and
  // LOSING at 1 Hz around the line teaches the pilot to stop reading the box, which costs more than
  // the box was ever worth.
  expect(compareGlide(30, 30.6).verdict).toBe('marginal');
  expect(compareGlide(30, 29.4).verdict).toBe('marginal');
  expect(compareGlide(30, 30 * (1 + MARGIN_FRAC) + 0.01).verdict).toBe('holding');
  expect(compareGlide(30, 30 * (1 - MARGIN_FRAC) - 0.01).verdict).toBe('losing');
});

test('WE NEVER SAY YOU ARE MAKING IT WHEN WE DO NOT KNOW', () => {
  // The most dangerous thing this module could do is fall back to the polar, or to the last known
  // achieved ratio, or to "probably fine". A missing half means no verdict.
  expect(compareGlide(38, null).verdict).toBeNull();          // circling: no achieved ratio yet
  expect(compareGlide(null, 24).verdict).toBeNull();          // no goal, or the goal is above us
  expect(compareGlide(null, null).verdict).toBeNull();
  expect(compareGlide(38, null).marginFrac).toBeNull();
  expect(compareGlide(0, 24).verdict).toBeNull();             // a required 0 would divide by zero
});

// ============ THE WINDOW WITH ITS BUFFER ============

test('the window answers from pushed fixes exactly as it does from an array', () => {
  const w = glideWindow();
  expect(w.achieved()).toBeNull();                            // nothing yet, and it says so
  for (const s of straight(60)) w.add(s);
  expect(w.achieved()!.ld).toBeCloseTo(30, 1);
});

test('SOD GOING BACKWARDS FORGETS THE FLIGHT — at midnight, and on a replay seek', () => {
  // `sod` wraps 86399 → 0. A buffer that glued the two together would compute a span of minus a day
  // and a glide ratio out of a nightmare. Thirty seconds of "—" is the right price for not knowing
  // what time it is.
  const w = glideWindow();
  for (const s of straight(60, { sod0: 86_340 })) w.add(s);   // a glide across midnight
  expect(w.achieved()).not.toBeNull();
  w.add({ sod: 0, lon: LON, lat: north(2000), altM: 1400 });  // …and the day rolls over
  expect(w.achieved()).toBeNull();
});

test('the buffer does not grow without bound over a five-hour flight', () => {
  const w = glideWindow();
  for (const s of straight(18_000)) w.add(s);                 // five hours at 1 Hz
  expect(w.achieved()!.ld).toBeCloseTo(30, 1);                // still right
  w.reset();
  expect(w.achieved()).toBeNull();                            // and forgettable on command
});

test('a bad fix changes nothing at all', () => {
  const w = glideWindow();
  for (const s of straight(60)) w.add(s);
  const before = w.achieved()!;
  w.add({ sod: 61, lon: NaN, lat: NaN, altM: 1439 });
  expect(w.achieved()).toEqual(before);
});

// ============ THE NUMBERS THIS FILE EXISTS TO GET RIGHT ============

test('the window is a minute: long enough to be a measurement, short enough to be news', () => {
  // Five seconds is noise — three metres of GPS altitude error on five metres of height lost, and
  // shorter than one pull-up. Five minutes is history — ten kilometres of ground, a thermal turn,
  // and a quarter of a whole final glide. Anything outside 30…120 s has abandoned one argument or
  // the other.
  expect(WINDOW_S).toBeGreaterThanOrEqual(30);
  expect(WINDOW_S).toBeLessThanOrEqual(120);
  expect(MIN_SPAN_S).toBeLessThanOrEqual(WINDOW_S);
  expect(MIN_LOSS_M).toBeGreaterThanOrEqual(10);              // below this it is altitude noise
  expect(STRAIGHT_MIN).toBeGreaterThan(0.5);                  // below this a circle would pass
  expect(STRAIGHT_MIN).toBeLessThan(1);                       // at 1 no real glide would pass
});
