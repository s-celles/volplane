import { test, expect } from 'bun:test';
import {
  orient, unrotatePx, angDiffDeg, INITIAL,
  DEADBAND_DEG, RELEASE_DEG, MAX_SLEW_DEG_S, MIN_TRACK_MS,
  type OrientInput, type OrientMode, type OrientState, type Orientation,
} from './orient';

const IN: OrientInput = {
  mode: 'track-up',
  trackDeg: null,
  groundSpeedMs: 30,          // 108 km/h: a glider on the move
  headingDeg: null,
  targetBearingDeg: null,
  circling: false,
};

const inp = (over: Partial<OrientInput>): OrientInput => ({ ...IN, ...over });

/** Run the module for `n` seconds at 1 Hz, the rate the fixes actually arrive at. */
function run(mode: OrientMode, n: number, at: (s: number) => Partial<OrientInput>,
             from: OrientState = INITIAL): Orientation[] {
  let st = from;
  const out: Orientation[] = [];
  for (let s = 0; s < n; s++) {
    const o = orient(st, inp({ mode, ...at(s) }), 1);
    st = o.state;
    out.push(o);
  }
  return out;
}

const deg = (o: Orientation): number => o.topDeg;

// ---- the refusals. These are the tests this file exists for. ----

test('HEADING-UP WITHOUT A HEADING SOURCE DOES NOT SILENTLY BECOME TRACK-UP', () => {
  // Nothing aboard measures the heading — nav.ts carries `track` and nothing else. The track is the
  // closest number to hand and it is the WRONG one: it differs from the heading by the drift, so the
  // map would be most wrong in the crosswind, in the very mode the pilot chose because he wanted to
  // know which way he was pointing. Refuse, hold north, and say which.
  const o = orient(INITIAL, inp({ mode: 'heading-up', trackDeg: 270, headingDeg: null }), 1);
  expect(o.refDeg).toBeNull();               // unknown is null, never a plausible 270
  expect(o.degraded).toBe('no-heading');
  expect(o.top).toBe('north-up');            // and the screen must SAY north-up
  expect(o.rotationRad).toBe(0);
});

test('a heading that IS measured is honoured, drift and all', () => {
  // 30 kt of crosswind: the glider points 250° and goes 270°. The two modes must differ, or the
  // heading source was never worth reading.
  const h = orient(INITIAL, inp({ mode: 'heading-up', trackDeg: 270, headingDeg: 250 }), 1);
  const t = orient(INITIAL, inp({ mode: 'track-up', trackDeg: 270, headingDeg: 250 }), 1);
  expect(h.refDeg).toBe(250);
  expect(t.refDeg).toBe(270);
  expect(h.rotationRad).not.toBeCloseTo(t.rotationRad, 3);
});

test('TARGET-UP WITH NO GOAL REFUSES — it does not point at nothing', () => {
  const o = orient(INITIAL, inp({ mode: 'target-up', targetBearingDeg: null, trackDeg: 90 }), 1);
  expect(o.refDeg).toBeNull();
  expect(o.degraded).toBe('no-target');
  expect(o.top).toBe('north-up');
  expect(o.rotationRad).toBe(0);
});

test('TRACK-UP ON THE GRID REFUSES — a course at 0 kt is the receiver talking to itself', () => {
  // Standing still, the GPS resolves a metre of drift into a bearing and it swings through the whole
  // compass. A map that spun on the launch point would teach the pilot the feature is broken before
  // he ever flew with it.
  const o = orient(INITIAL, inp({ trackDeg: 137, groundSpeedMs: 0.4 }), 1);
  expect(o.refDeg).toBeNull();
  expect(o.degraded).toBe('no-track');
  expect(o.rotationRad).toBe(0);
  // And just above the threshold it is a direction again.
  const fly = orient(INITIAL, inp({ trackDeg: 137, groundSpeedMs: MIN_TRACK_MS + 1 }), 1);
  expect(fly.refDeg).toBe(137);
  expect(fly.degraded).toBeNull();
});

test('a fix with no track at all is a refusal, not a zero', () => {
  const o = orient(INITIAL, inp({ trackDeg: null, groundSpeedMs: 30 }), 1);
  expect(o.refDeg).toBeNull();
  expect(o.degraded).toBe('no-track');
});

// ---- north-up ----

test('north-up is 0. Always. Whatever the glider is doing.', () => {
  const o = orient(INITIAL, inp({
    mode: 'north-up', trackDeg: 200, headingDeg: 190, targetBearingDeg: 45, circling: true,
  }), 1);
  expect(o.rotationRad).toBe(0);
  expect(o.topDeg).toBe(0);
  expect(o.degraded).toBeNull();
});

test('north-up is IMMEDIATE — it is the pilot\'s "put it back"', () => {
  // He taps it when the picture has stopped making sense. A north-up that slews into place over six
  // seconds does not answer the question he asked.
  const turned = run('track-up', 20, () => ({ trackDeg: 180 }));
  expect(deg(turned[19])).toBeCloseTo(180, 0);
  const back = orient(turned[19].state, inp({ mode: 'north-up', trackDeg: 180 }), 1);
  expect(back.rotationRad).toBe(0);          // not "on its way to 0"
});

// ---- the wrap. 359° -> 1° is two degrees, not three hundred and fifty-eight. ----

test('359 to 1 is +2 degrees — the arithmetic mean would point the map BACKWARDS', () => {
  expect(angDiffDeg(359, 1)).toBe(2);
  expect(angDiffDeg(1, 359)).toBe(-2);
  expect(angDiffDeg(0, 180)).toBe(180);      // the tie goes forward, and it is stable
  expect(angDiffDeg(10, 350)).toBe(-20);
});

test('a glider crossing north does not send the map the LONG WAY ROUND', () => {
  // Start drawn at 350°, ask for 10°. The short way is +20°; the arithmetic difference is −340° and
  // would spin the whole picture through south, on screen, because the glider crossed north.
  let st: OrientState = { refDeg: 350, shownDeg: 350, chasing: false };
  const seen: number[] = [];
  for (let s = 0; s < 15; s++) {
    const o = orient(st, inp({ trackDeg: 10 }), 1);
    st = o.state;
    seen.push(o.topDeg);
  }
  // Never anywhere near south: every drawn bearing stays within 25° of north.
  for (const d of seen) expect(Math.min(d, 360 - d)).toBeLessThan(25);
  expect(Math.min(...seen.map(d => Math.abs(angDiffDeg(d, 10))))).toBeLessThan(3);
});

test('the rotation stays inside (-pi, pi] instead of winding up', () => {
  for (const t of [0, 1, 90, 179, 180, 181, 270, 359]) {
    const o = orient(INITIAL, inp({ trackDeg: t }), 1);
    expect(o.rotationRad).toBeGreaterThan(-Math.PI - 1e-9);
    expect(o.rotationRad).toBeLessThanOrEqual(Math.PI + 1e-9);
  }
});

test('the sign puts the reference AT THE TOP, not at the bottom', () => {
  // Track east (90°). The map must turn 90° anticlockwise on screen — ctx.rotate(-pi/2) — so that
  // east comes up. Get this sign wrong and the map turns with the glider instead of against it, and
  // everything ahead of him appears behind him.
  const o = orient(INITIAL, inp({ trackDeg: 90 }), 1);
  expect(o.rotationRad).toBeCloseTo(-Math.PI / 2, 6);
  // And the check that matters: rotate the map by it, and the point due east lands at the top.
  const [x, y] = rot(1, 0, o.rotationRad);   // east is screen (+1, 0) on a north-up canvas
  expect(x).toBeCloseTo(0, 6);
  expect(y).toBeCloseTo(-1, 6);              // top: canvas y grows DOWN
});

const rot = (x: number, y: number, a: number): [number, number] =>
  [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

// ---- the smoothing, and the thermal ----

test('THE MAP DOES NOT SPIN IN A THERMAL — this is the mode that makes pilots sick', () => {
  // 15°/s for half a minute: a normal climb. A track-up map that follows it turns the whole picture
  // right round, twice, and no amount of low-pass filtering helps — a filtered ramp is still a ramp.
  // So circling STOPS the following: the map holds north and the label says why.
  const o = run('track-up', 30, s => ({ trackDeg: (s * 15) % 360, circling: true }));
  expect(o[29].degraded).toBe('circling');
  expect(o[29].top).toBe('north-up');
  expect(o[29].topDeg).toBeCloseTo(0, 1);
  // and not one frame of the climb was drawn anywhere but north
  for (const f of o) expect(Math.abs(f.rotationRad)).toBeLessThan(0.02);
});

test('but the map is not SNAPPED north the instant he starts circling', () => {
  // Entering a thermal is the moment he is looking at the wing tip, not the screen. A quarter-turn
  // teleport under his eyes is exactly the disorientation the whole feature exists to remove: the
  // rate limit unwinds it over a few seconds instead.
  const cruise = run('track-up', 20, () => ({ trackDeg: 90 }));
  expect(deg(cruise[19])).toBeCloseTo(90, 0);
  const first = orient(cruise[19].state, inp({ trackDeg: 95, circling: true }), 1);
  expect(first.topDeg).toBeGreaterThan(90 - MAX_SLEW_DEG_S - 1);   // still nearly east, still readable
  expect(first.topDeg).toBeLessThan(90);                           // but on its way back to north
});

test('TARGET-UP SURVIVES THE THERMAL — the goal stays at the top all the way up', () => {
  // The bearing to a goal ten kilometres away barely moves while the glider turns. So this is the one
  // mode that means something in a climb, and it must NOT be suppressed by the circling guard.
  const o = run('target-up', 30, () => ({ targetBearingDeg: 120, circling: true }));
  expect(o[29].degraded).toBeNull();
  expect(o[29].top).toBe('target-up');
  expect(deg(o[29])).toBeCloseTo(120, 0);
});

test('a JITTERING track does not twitch the map — the hysteresis holds it still', () => {
  // A GPS course wanders a few degrees at cruise and more in turbulence. A map redrawn straight from
  // it shivers, and a shivering map is a tiring map: the eye is built to catch exactly that motion.
  const o = run('track-up', 12, s => ({ trackDeg: 90 + [0, 3, -2, 4, -3, 1][s % 6] }));
  const settled = o.slice(4);
  const first = settled[0].rotationRad;
  for (const f of settled) expect(f.rotationRad).toBe(first);      // not "close to" — IDENTICAL
});

test('and a REAL turn does turn the map — the deadband is not a wall', () => {
  // It comes to rest within RELEASE_DEG of the new track and stops there, deliberately: chasing the
  // last two degrees would be chasing the noise, and the map would never be still. Two degrees on the
  // top of a map is invisible; a map that never settles is not.
  const o = run('track-up', 25, s => ({ trackDeg: s < 5 ? 90 : 180 }));
  expect(deg(o[4])).toBeCloseTo(90, 0);
  expect(Math.abs(angDiffDeg(deg(o[24]), 180))).toBeLessThanOrEqual(RELEASE_DEG);
});

test('a 180 degree reversal is not a TELEPORT', () => {
  // The map is rotated by half a turn: every landmark the pilot had is now somewhere else. Done in a
  // frame it costs him the whole picture; done at MAX_SLEW_DEG_S the eye follows it round.
  const o = run('track-up', 3, s => ({ trackDeg: s === 0 ? 0 : 180 }));
  const step = Math.abs(angDiffDeg(o[0].topDeg, o[1].topDeg));
  expect(step).toBeLessThanOrEqual(MAX_SLEW_DEG_S + 1e-9);
});

test('A LONG GAP DOES NOT TELEPORT THE MAP EITHER', () => {
  // The app was backgrounded for two minutes. `MAX_SLEW x dt` over a 120 s dt is no limit at all —
  // and the first frame back is the one the pilot is looking hardest at.
  const st: OrientState = { refDeg: 0, shownDeg: 0, chasing: false };
  const o = orient(st, inp({ trackDeg: 180 }), 120);
  expect(Math.abs(angDiffDeg(0, o.topDeg))).toBeLessThanOrEqual(MAX_SLEW_DEG_S * 2 + 1e-9);
});

test('a dt of zero, or of nonsense, moves nothing', () => {
  const st: OrientState = { refDeg: 90, shownDeg: 90, chasing: false };
  for (const dt of [0, -5, NaN, Infinity]) {
    const o = orient(st, inp({ trackDeg: 180 }), dt);
    expect(o.topDeg).toBe(90);
  }
});

test('THE FIRST FIX SNAPS — the map does not slew up from a north nobody asked for', () => {
  // There is nothing on screen to be continuous with. Slewing would make the map's first act six
  // seconds of motion that means nothing.
  const o = orient(INITIAL, inp({ trackDeg: 210 }), 1);
  expect(o.topDeg).toBe(210);
  expect(o.rotationRad).toBeCloseTo(-210 * Math.PI / 180 + 2 * Math.PI, 6);
});

test('the drawn bearing and the rotation are ONE number, so the rose cannot disagree with the map', () => {
  const o = run('track-up', 8, () => ({ trackDeg: 145 }));
  for (const f of o) {
    const fromTop = -f.topDeg * Math.PI / 180;
    const wrapped = fromTop <= -Math.PI ? fromTop + 2 * Math.PI : fromTop;
    expect(f.rotationRad).toBeCloseTo(wrapped, 9);
  }
});

test('DEADBAND_DEG is the number this file exists for', () => {
  // Too small and the map creeps continuously under the pilot's eyes — the one motion the eye cannot
  // ignore. Too large and the top of the map is visibly not where it claims, and the compass rose
  // shows it.
  expect(DEADBAND_DEG).toBeGreaterThanOrEqual(3);
  expect(DEADBAND_DEG).toBeLessThanOrEqual(10);
});

// ---- the gesture, on a map that is no longer north-up ----

test('DRAGGING RIGHT ON A TRACK-UP MAP PANS RIGHT ON SCREEN, not east', () => {
  // CAR-002's quiet second bug. On a rotated canvas, panning by the raw screen delta sends the map
  // off sideways under the finger and the pilot concludes the map is broken.
  const o = orient(INITIAL, inp({ trackDeg: 90 }), 1);      // east at the top: rotation = -90 deg
  const [mx, my] = unrotatePx(10, 0, o.rotationRad);        // finger goes 10 px right
  // Right on a map whose top is east is SOUTH on the ground: in unrotated map pixels, +y (down).
  expect(mx).toBeCloseTo(0, 6);
  expect(my).toBeCloseTo(10, 6);
});

test('and on a north-up map it changes nothing at all', () => {
  expect(unrotatePx(7, -3, 0)).toEqual([7, -3]);
});
