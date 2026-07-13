// THE-001/THE-002 pinned. Two claims, and they are separable on purpose: the MAP of the lift
// around the circle (THE-001) and the ADVICE drawn from it (THE-002). A flat rose must still
// produce the map and must refuse the advice — a system that always points somewhere is the
// failure mode this file exists to prevent. Everything else here is the same guard as the rest
// of the instrument: an unsampled sector is null, never a confident 0.0 m/s of dead air.
import { test, expect } from 'bun:test';
import { circleRose, BINS, MIN_BINS, MIN_CONTRAST_MS } from './circleassist';

// A synthetic circling glider, parameterised BY ANGLE — so the test knows the true centre and
// the true bearing-from-centre of every fix exactly, and can state what the assistant ought to
// answer without re-deriving it from the assistant's own maths. Radius 60 m, period 25 s
// (14.4°/s, well over the kernel's TURN_MIN), right-hand circles, one fix a second.
const LAT0 = 45, LON0 = 6;
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const RADIUS = 60, PERIOD = 25, T0 = 36000;

/** Bearing, degrees true, from the circle's centre to the glider at time `sod`. Clockwise from
 *  north — the glider starts due north of the centre and turns right. */
const bearingAt = (sod: number): number => (((sod - T0) * 360) / PERIOD) % 360;

const posAt = (sod: number): [number, number] => {
  const b = (bearingAt(sod) * Math.PI) / 180;
  return [LON0 + (RADIUS * Math.sin(b)) / M_LON, LAT0 + (RADIUS * Math.cos(b)) / M_LAT];
};

/** Fly `durS` seconds of circle from `t0`, feeding whatever vario `vz(sod, bearing)` says. */
function circle(r: ReturnType<typeof circleRose>, t0: number, durS: number,
                vz: (sod: number, bearing: number) => number | null, alt0 = 1500, climb = 2): number {
  let sod = t0;
  for (let k = 0; k <= durS; k++) {
    sod = t0 + k;
    const [lon, lat] = posAt(sod);
    r.add(sod, lon, lat, alt0 + climb * (sod - T0), vz(sod, bearingAt(sod)));
  }
  return sod;
}

/** Signed angular distance between two bearings, degrees (−180..180). */
const off = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

/** Lift strongest on the side `peak`: a smooth cosine bump, +1.5 m/s there, −1.5 opposite. */
const lobe = (peak: number) => (_sod: number, brg: number): number =>
  2 + 1.5 * Math.cos(((brg - peak) * Math.PI) / 180);

test('straight flight has no circle, and therefore no rose', () => {
  const r = circleRose();
  for (let k = 0; k <= 180; k++)
    r.add(T0 + k, LON0 + (30 * k) / M_LON, LAT0, 1500 - k, 1.0);
  // Not "a rose with no advice" — no rose at all. THE-001 is gated on being IN a spiral.
  expect(r.rose(T0 + 180)).toBeNull();
});

test('half a circle is not a circle: no closed turn, no centre, no rose', () => {
  const r = circleRose();
  const end = circle(r, T0, Math.round(PERIOD / 2), lobe(90));
  expect(r.rose(end)).toBeNull();
});

test('THE-002: lift strongest on the east side sends the pilot east', () => {
  const r = circleRose();
  const end = circle(r, T0, 180, lobe(90));
  const rose = r.rose(end)!;
  expect(rose).not.toBeNull();
  const best = rose.best!;
  expect(best).not.toBeNull();
  // Within one bin of 090. Naming the sector is the whole of THE-002 — a degree-accurate bearing
  // would be a precision the evidence does not have.
  expect(off(best.bearing, 90)).toBeLessThanOrEqual(360 / BINS);
  expect(best.vzMs).toBeGreaterThan(2 + MIN_CONTRAST_MS);
});

test('THE-001 without THE-002: a uniform circle is mapped, and no advice is given', () => {
  const r = circleRose();
  const end = circle(r, T0, 180, () => 2.0);
  const rose = r.rose(end)!;
  expect(rose).not.toBeNull();
  // The map exists: every sector of the circle was flown and every sector holds its measurement.
  expect(rose.bins).toHaveLength(BINS);
  for (const b of rose.bins) {
    expect(b.vzMs).not.toBeNull();
    expect(b.vzMs!).toBeCloseTo(2.0, 1);
    expect(b.weight).toBeGreaterThan(0);
  }
  expect(rose.samples).toBeGreaterThan(100);
  // And the advice does not. The rose is flat: the strongest bin is merely the luckiest one, and
  // pointing at it would walk the pilot out of a thermal he had already centred.
  expect(rose.best).toBeNull();
});

test('a sector never sampled is null, never 0.0 m/s of dead air', () => {
  // The vario only reads on the eastern half of the circle. The western bins were flown but hold
  // no evidence, and "no evidence" must not render as "no lift" — that is a fabricated
  // measurement, and the pilot would fly away from it.
  const r = circleRose();
  const end = circle(r, T0, 180, (_s, brg) => (brg < 180 ? 2.5 : null));
  const rose = r.rose(end)!;
  const west = rose.bins.filter(b => b.bearing > 180 && b.bearing < 360);
  expect(west.length).toBeGreaterThan(0);
  for (const b of west) {
    expect(b.vzMs).toBeNull();
    expect(b.vzMs).not.toBe(0);
    expect(b.weight).toBe(0);
  }
  for (const b of rose.bins.filter(x => x.bearing > 0 && x.bearing < 180))
    expect(b.vzMs).toBeCloseTo(2.5, 5);
});

test('decay: the assistant follows the thermal it is in NOW, not the one it was in', () => {
  // Two minutes of east-strong, then two minutes of west-strong. A rose that weighted all four
  // minutes equally would average the two lobes into a flat, opinionless disc — and the pilot,
  // sitting in the western core, would be told nothing while the vario sang at him.
  const r = circleRose();
  const mid = circle(r, T0, 120, lobe(90));
  const end = circle(r, mid + 1, 120, lobe(270));
  const best = r.rose(end)!.best!;
  expect(best).not.toBeNull();
  expect(off(best.bearing, 270)).toBeLessThanOrEqual(360 / BINS);
});

test('a circle flown with no vario at all: null, and not one 0.0 anywhere', () => {
  const r = circleRose();
  const end = circle(r, T0, 180, () => null);
  const rose = r.rose(end);
  // No reading is not a reading of zero. The rose is null (the dash), or — were it ever built —
  // every bin is null and no advice is offered. What must NEVER appear is a 0.0 m/s bin.
  if (rose !== null) {
    expect(rose.best).toBeNull();
    for (const b of rose.bins) expect(b.vzMs).toBeNull();
    expect(rose.samples).toBe(0);
  } else {
    expect(rose).toBeNull();
  }
});

test('the est badge is on the rose, and the compiler cannot be talked out of it', () => {
  const r = circleRose();
  const end = circle(r, T0, 180, lobe(90));
  const rose = r.rose(end)!;
  // `est: true` is a LITERAL type (liftmap's `modelled: true` trick): an untagged rose does not
  // compile, so no caller can pass this reconstruction off with the vario's plain authority.
  const est: true = rose.est;
  expect(est).toBe(true);
  // And the centre is the reference the bearings are measured from: the middle of the turn.
  expect(Math.abs(rose.centre.lat - LAT0) * M_LAT).toBeLessThan(RADIUS / 4);
  expect(Math.abs(rose.centre.lon - LON0) * M_LON).toBeLessThan(RADIUS / 4);
});

// ---- THE-001's actual gate: "TANT QUE le planeur est en spirale" ----
// `rose()` used to require only that a closed 360° existed SOMEWHERE in the 180 s window. It does
// for minutes after the pilot has rolled out and gone: the rose kept drawing, with a live arrow
// and "shift towards 040° · 2.3 m/s", while the glider cruised six kilometres away from the air it
// was describing. The refusal the UI promises ("not circling — no rose") never fired.

/** Roll out and cruise straight at 40 m/s on the heading the circle left off with, sinking. */
function cruiseAway(r: ReturnType<typeof circleRose>, t0: number, durS: number, alt0: number): number {
  const [lon0, lat0] = posAt(t0);
  let sod = t0;
  for (let k = 1; k <= durS; k++) {
    sod = t0 + k;
    r.add(sod, lon0 + (40 * k) / M_LON, lat0, alt0 - 1.2 * k, -1.2);
  }
  return sod;
}

test('THE-001: the rose dies with the climb — rolled out, there is NO rose', () => {
  const r = circleRose();
  const end = circle(r, T0, 120, lobe(90));
  expect(r.rose(end)).not.toBeNull();                    // still turning: advice stands

  // He leaves. The circle he closed is still sitting in the window, and the old code went on
  // pointing at it.
  const t1 = cruiseAway(r, end, 30, 1500);
  expect(r.rose(t1)).toBeNull();
  const t2 = cruiseAway(r, t1, 60, 1500);                // 90 s and ~3.6 km later
  expect(r.rose(t2)).toBeNull();
});

test('and it comes back when he does: rolling into the NEXT thermal maps that one', () => {
  const r = circleRose();
  const first = circle(r, T0, 120, lobe(90));
  const gone = cruiseAway(r, first, 40, 1500);
  expect(r.rose(gone)).toBeNull();
  // A new climb, lift strongest in the WEST this time. The cruise fixes in between carry the
  // vario's sink; binned by bearing from this circle's centre they would pile a wall of −1.2 m/s
  // into one sector and forge the contrast that is supposed to keep a flat rose quiet.
  const back = circle(r, gone + 1, 120, lobe(270));
  const rose = r.rose(back)!;
  expect(rose).not.toBeNull();
  expect(off(rose.best!.bearing, 270)).toBeLessThanOrEqual(360 / BINS);
});

// ---- the two silences are two different facts (POT-007) ----

test('a half-sampled circle says UNDER-SAMPLED, and never "the lift is even"', () => {
  // The vario reads over one 90° arc of the turn and nowhere else — a dropout, or the first
  // circle of a climb logged at one fix per five seconds. Fewer than MIN_BINS sectors carry
  // evidence, so there is no advice; but "even lift" would be a measurement of eight sectors
  // nobody has flown, printed in plain words under the very wedges drawn hollow to deny it.
  const r = circleRose();
  const end = circle(r, T0, 180, (_s, brg) => (brg >= 45 && brg < 135 ? 2.5 : null));
  const rose = r.rose(end)!;
  expect(rose.best).toBeNull();
  expect(rose.noAdvice).toBe('under-sampled');
  expect(rose.bins.filter(b => b.vzMs !== null).length).toBeLessThan(MIN_BINS);
});

test('a mapped circle with even lift says FLAT — that one IS a measurement', () => {
  const r = circleRose();
  const end = circle(r, T0, 180, () => 2.0);
  const rose = r.rose(end)!;
  expect(rose.best).toBeNull();
  expect(rose.noAdvice).toBe('flat');                    // the circle was flown; the lift is even
  expect(rose.bins.filter(b => b.vzMs !== null).length).toBeGreaterThanOrEqual(MIN_BINS);
});

test('advice given means no silence to explain', () => {
  const r = circleRose();
  const end = circle(r, T0, 180, lobe(90));
  const rose = r.rose(end)!;
  expect(rose.best).not.toBeNull();
  expect(rose.noAdvice).toBeNull();
});

// ---- a clock that goes backwards is a new flight ----

test('a session with EARLIER sods is a new flight, not a stream of fixes to drop', () => {
  const r = circleRose();
  const done = circle(r, 50000, 180, lobe(90));          // the afternoon replay
  expect(r.rose(done)!.best!.bearing).toBeCloseTo(90, 0);
  // The next morning, live, with the lift on the other side. Every fix is "older" than the replay.
  const end = circle(r, 32000, 180, lobe(270));
  const rose = r.rose(end)!;
  expect(rose).not.toBeNull();                            // not frozen on the replayed circle
  expect(off(rose.best!.bearing, 270)).toBeLessThanOrEqual(360 / BINS);
});
