import { test, expect } from 'bun:test';
import { trailColour, TRAIL_CLAMP_MS, TRAIL_SMOOTH_S, TRAIL_LEGEND } from './trailcolour';

/** Read the colour back apart, so the tests can assert on what the PILOT sees — a hue, a lightness —
 *  and not on a string. A test that pins the string passes for the wrong reason and fails for the
 *  wrong one too. */
const hsl = (css: string | null): { h: number; s: number; l: number } => {
  expect(css).not.toBeNull();
  const m = /^hsl\((\d+), (\d+)%, (\d+)%\)$/.exec(css!);
  expect(m).not.toBeNull();
  return { h: +m![1], s: +m![2], l: +m![3] };
};

// ---- what the module REFUSES to answer ----

test('NO VARIO IS NOT ZERO — an unknown climb rate gets no colour at all', () => {
  // The one that matters. Neutral is a MEASUREMENT: it says the air was still. If "I have no vario"
  // came back as the same pale white, the map would be making a claim about the air that nobody
  // made, on the one part of the screen the pilot uses to judge the day after the fact.
  expect(trailColour(null)).toBeNull();
});

test('a NaN climb rate gets no colour — the guard is isFinite, not != null', () => {
  // This is how it actually arrives: a climb rate differentiated between two fixes with identical
  // altitudes and identical timestamps. NaN sails through every < and > comparison, survives the
  // clamp untouched, and would come out of a naive ramp as a confident, perfectly neutral white.
  expect(trailColour(NaN)).toBeNull();
  expect(trailColour(Infinity)).toBeNull();
  expect(trailColour(-Infinity)).toBeNull();
});

// ---- the convention the pilot already owns ----

test('CLIMB IS WARM AND SINK IS COLD — inverting this gets the map misread in a thermal', () => {
  expect(hsl(trailColour(3)).h).toBeLessThan(70);          // amber
  expect(hsl(trailColour(-3)).h).toBeGreaterThan(180);     // blue
});

test('still air is NEUTRAL — near-zero air must not look like it is doing something', () => {
  // A trail that shows a colour at 0.1 m/s is a trail that shows a thermal in the instrument's own
  // noise, and the pilot turns back for nothing.
  expect(hsl(trailColour(0)).s).toBeLessThanOrEqual(20);
  expect(hsl(trailColour(0.1)).s).toBeLessThanOrEqual(20);
  expect(hsl(trailColour(-0.1)).s).toBeLessThanOrEqual(20);
});

test('...and neutral is not GREY: it must not collide with the no-vario trail', () => {
  // The shell paints an unknown segment in plain grey. If "still air" were also grey, the two would
  // be one colour on the map and the distinction this module exists to protect would be gone.
  expect(hsl(trailColour(0)).s).toBeGreaterThan(0);
  expect(hsl(trailColour(0)).l).toBeGreaterThan(65);       // a pale near-white, not a mid grey
});

// ---- the colour-blind pilot, and the sun ----

test('LIGHTNESS CARRIES THE ANSWER TOO — the trail survives being seen in greyscale', () => {
  // One man in twelve cannot separate red from green and gliding does not screen for it. If hue were
  // the only channel, this trail would be a solid, uniform band for him: no lift, no sink, no day.
  // So lightness must rise monotonically over the WHOLE range, sink → still → climb.
  let prev = -Infinity;
  for (let v = -TRAIL_CLAMP_MS; v <= TRAIL_CLAMP_MS; v += 0.25) {
    const { l } = hsl(trailColour(v));
    expect(l).toBeGreaterThanOrEqual(prev);
    prev = l;
  }
  // And the span has to be big enough to actually SEE, not just big enough to pass a monotonicity
  // check: two up and two down must not be the same shade of grey.
  expect(hsl(trailColour(2)).l - hsl(trailColour(-2)).l).toBeGreaterThanOrEqual(8);
});

test('nothing on the ramp goes dark — a segment that vanishes into the map is not a trail', () => {
  // The map is dark terrain and the cockpit is a greenhouse in full sun. A saturated deep blue looks
  // superb on a desk and is a black line on a hillside at noon, exactly where the strong sink is.
  for (let v = -TRAIL_CLAMP_MS; v <= TRAIL_CLAMP_MS; v += 0.25)
    expect(hsl(trailColour(v)).l).toBeGreaterThanOrEqual(55);
});

test('THE RAMP NEVER PASSES THROUGH GREEN — green already means "you can reach that field"', () => {
  // The bug this catches is the obvious implementation: interpolate hue from blue (222°) to amber
  // (42°) and it walks through 130° — green — at about +2.5 m/s, the single most important value on
  // the scale. Endpoint tests never see it. Green is LND-003's word for a reachable airfield, and
  // green/amber is precisely the pair a deuteranope cannot separate.
  for (let v = -TRAIL_CLAMP_MS; v <= TRAIL_CLAMP_MS; v += 0.1) {
    const { h, s } = hsl(trailColour(v));
    if (s < 25) continue;                     // near-white: the hue is not visible, so it cannot lie
    expect(h > 75 && h < 175).toBe(false);
  }
});

test('strong climb is the most salient thing on the map, because it is what you turn back for', () => {
  const climb = hsl(trailColour(5));
  const still = hsl(trailColour(0));
  expect(climb.l).toBeGreaterThan(still.l);
  expect(climb.s).toBeGreaterThan(80);
});

// ---- the clamp ----

test('BEYOND ±5 M/S THE SHADE STOPS TEACHING ANYTHING, so it stops changing', () => {
  // And it means a freak fix — a vario spike through a gust front, a bad pressure sample — draws
  // itself at the end of the ramp instead of re-scaling the pilot's whole reading of the day.
  expect(trailColour(5)).toBe(trailColour(9));
  expect(trailColour(5)).toBe(trailColour(500));
  expect(trailColour(-5)).toBe(trailColour(-12));
});

test('but just inside the clamp still moves — the ramp is not saturated early', () => {
  expect(trailColour(4)).not.toBe(trailColour(5));
  expect(trailColour(-4)).not.toBe(trailColour(-5));
});

// ---- and the rest ----

test('the same climb rate is always the same colour — the trail must not shimmer between frames', () => {
  expect(trailColour(2.4)).toBe(trailColour(2.4));
  expect(trailColour(-0.7)).toBe(trailColour(-0.7));
});

test('every colour is a CSS colour a canvas will actually accept', () => {
  for (let v = -8; v <= 8; v += 0.5) expect(trailColour(v)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
});

test('the legend covers both ends and reads in order — a scale with no key means nothing', () => {
  // The pilot who has not been told invents his own meaning, and it will not be ours. The ends
  // especially: they are clamped, so they mean "at least this much".
  expect(TRAIL_LEGEND.map(e => e.ms)).toEqual([-5, -2.5, 0, 2.5, 5]);
  expect(TRAIL_LEGEND[0].css).toBe(trailColour(-TRAIL_CLAMP_MS)!);
  expect(TRAIL_LEGEND[4].css).toBe(trailColour(TRAIL_CLAMP_MS)!);
  for (const e of TRAIL_LEGEND) expect(e.css).not.toBeNull();
});

test('the smoothing window is short enough to leave the lift WHERE IT WAS', () => {
  // A raw 1 Hz vario paints confetti and cannot be read at all. The infoboxes' 30 s average would
  // smear a good core over half a kilometre of the cruise that followed it and show the pilot a
  // thermal he has already flown out of — which, on a map, is a lie about a place.
  expect(TRAIL_SMOOTH_S).toBeGreaterThanOrEqual(4);
  expect(TRAIL_SMOOTH_S).toBeLessThanOrEqual(12);
});
