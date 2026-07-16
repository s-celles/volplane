import { test, expect } from 'bun:test';
import {
  initZoom, stepZoom, pilotZoom, pilotReset, spiralTargetM,
  SPIRAL_WIDTH_M, ENTER_MS, LEAVE_MS, MAX_RATE_PER_S,
  type ZoomState,
} from './mapzoom';

const CRUISE = 20_000;

const start = (widthM = CRUISE): ZoomState => {
  const s = initZoom(widthM, 0);
  if (s === null) throw new Error('the fixture itself is wrong');
  return s;
};

/** Fly `secs` seconds of `circling`, one tick per second — what the shell does on every fix. */
const fly = (s: ZoomState, circling: boolean | null, secs: number): ZoomState => {
  let out = s;
  for (let i = 1; i <= secs; i++) out = stepZoom(out, { circling, tMs: out.tMs + 1_000 });
  return out;
};

// ---- the loan ----

test('a sustained spiral brings the ground closer, and the pilot never asked for anything', () => {
  // CAR-004 in one line. At 20 km across, a 200 m circle is four pixels and the map is a decoration.
  const s = fly(start(), true, 60);
  expect(s.spiral).toBe(true);
  expect(s.widthM).toBeCloseTo(SPIRAL_WIDTH_M, 6);
});

test('AND GIVES IT BACK — the pilot rolls out and finds the width HE chose, to the metre', () => {
  // The whole feature lives or dies here. A map that hands back some other width has stolen his
  // choice, and he will never trust the automatism again — he will pinch on every climb, which is
  // precisely the workload CAR-004 removes.
  const climbing = fly(start(17_345), true, 60);
  expect(climbing.widthM).toBeCloseTo(SPIRAL_WIDTH_M, 6);
  const out = fly(climbing, false, 60);
  expect(out.spiral).toBe(false);
  expect(out.widthM).toBeCloseTo(17_345, 6);
});

test('THE AUTOMATISM NEVER WIDENS THE MAP — a pilot already closer in is left alone', () => {
  // He is flying a ridge at 1 km across. If "the spiral scale" were applied as a scale, rolling into
  // a thermal would push the ground AWAY from him — an automatism sold as "closer in the climb"
  // doing the exact opposite of its name.
  const s = fly(start(1_000), true, 60);
  expect(s.spiral).toBe(true);
  expect(s.widthM).toBeCloseTo(1_000, 6);
  expect(spiralTargetM(1_000, true)).toBe(1_000);
});

// ---- the pilot always wins ----

test('A PINCH INSIDE THE THERMAL DETACHES THE AUTOMATISM — it never zooms twice against the same hand', () => {
  // He wants to see the gaggle: he pinches out to 6 km, mid-climb. An automatism that slid the map
  // back to 2 km underneath him would be fighting a human being for the controls of an instrument,
  // and it would win, because it never gets tired. He would stop using the map.
  let s = fly(start(), true, 60);            // engaged, at the spiral width
  s = pilotZoom(s, 6_000);
  expect(s.detached).toBe(true);
  expect(s.widthM).toBe(6_000);              // his gesture is INSTANT — an eased pinch is a broken pinch
  s = fly(s, true, 120);                     // two more minutes of circling: the automatism stays out
  expect(s.widthM).toBeCloseTo(6_000, 6);
});

test('and his pinch in the thermal does NOT become his cruise width — rolling out gives back 20 km', () => {
  // The trap in the "respectful" reading. Half of those pinches are "let me look at that glider for
  // a second"; adopting 6 km as the cruise width strands him at a scale showing no landing field and
  // no next thermal, at the moment he leaves the climb and needs both. The map keeps ONE promise:
  // rolling out always gives you back the width you cruise at.
  let s = fly(start(CRUISE), true, 60);
  s = pilotZoom(s, 6_000);
  expect(s.pilotWidthM).toBe(CRUISE);        // his choice was REMEMBERED, not overwritten
  s = fly(s, false, 60);
  expect(s.widthM).toBeCloseTo(CRUISE, 6);
});

test('a zoom in the CRUISE is a new standing choice — and the next thermal returns to THAT', () => {
  let s = pilotZoom(start(), 40_000);        // he opens the map up to look at the day ahead
  expect(s.pilotWidthM).toBe(40_000);
  expect(s.detached).toBe(false);            // outside a spiral there is nothing to detach from
  s = fly(s, true, 60);
  expect(s.widthM).toBeCloseTo(SPIRAL_WIDTH_M, 6);
  s = fly(s, false, 120);
  expect(s.widthM).toBeCloseTo(40_000, 6);
});

test('the detachment dies with the climb — one pinch must not disable CAR-004 for the rest of the day', () => {
  // A detachment that outlived its thermal would silently switch the feature off for the whole
  // flight, because of a gesture made two hours ago, with nothing on screen to say so.
  let s = fly(start(), true, 60);
  s = pilotZoom(s, 8_000);
  s = fly(s, false, 60);                     // rolls out
  expect(s.detached).toBe(false);
  s = fly(s, true, 60);                      // and the NEXT thermal is helped again
  expect(s.widthM).toBeCloseTo(SPIRAL_WIDTH_M, 6);
});

test('RESET re-arms the automatism — half a reset is worse than none', () => {
  // He double-taps because he has stopped understanding what he is looking at. Handing him back the
  // width while leaving the map quietly refusing to help him in this very thermal is half a reset.
  let s = fly(start(), true, 60);
  s = pilotZoom(s, 9_000);                   // detached
  s = pilotReset(s, CRUISE);
  expect(s.detached).toBe(false);
  expect(s.pilotWidthM).toBe(CRUISE);
  s = fly(s, true, 30);                      // still circling: the automatism takes it straight back down
  expect(s.widthM).toBeCloseTo(SPIRAL_WIDTH_M, 6);
});

// ---- the hysteresis: what must NOT make the map move ----

test('A 180° TURN ONTO A STREET IS NOT A CLIMB — a few seconds of turning does not zoom the map', () => {
  // circling() reads true through any sustained turn: a reversal, a steep turn to clear the airspace
  // behind, the first half-turn of a probe he abandons. Zooming in on each of them is a strobe light
  // on the panel.
  const s = fly(start(), true, Math.floor(ENTER_MS / 1000) - 1);
  expect(s.spiral).toBe(false);
  expect(s.widthM).toBe(CRUISE);             // not one metre of movement
});

test('RE-CENTRING A THERMAL MUST NOT ZOOM THE MAP OUT — straightening for a few seconds is technique', () => {
  // Moving the circle upwind means rolling wings-level for a second or two, and a pilot doing that
  // is more inside the climb than at any other moment. A map that widened on every re-centre would
  // punish exactly the technique it exists to support.
  let s = fly(start(), true, 60);
  s = fly(s, false, 4);                      // straighten, reposition…
  s = fly(s, true, 10);                      // …and roll back in
  expect(s.spiral).toBe(true);
  expect(s.widthM).toBeCloseTo(SPIRAL_WIDTH_M, 6);
});

test('leaving is slower to believe than entering — the dwells are deliberately asymmetric', () => {
  expect(LEAVE_MS).toBeGreaterThan(ENTER_MS);
  const climbing = fly(start(), true, 60);
  const half = fly(climbing, false, Math.floor(LEAVE_MS / 1000) - 1);
  expect(half.spiral).toBe(true);            // still committed to the climb
  const gone = fly(half, false, 2);
  expect(gone.spiral).toBe(false);
});

// ---- no jerk ----

test('NOBODY IS TELEPORTED — the scale never changes faster than MAX_RATE_PER_S', () => {
  // A map that snaps from 20 km to 2 km between two frames is a new map to interpret, head-down, in
  // a turn: the pilot loses the picture he had at the moment he can least afford to rebuild it.
  let s = fly(start(), true, Math.ceil(ENTER_MS / 1000));   // engaged, not yet moved far
  for (let i = 0; i < 20; i++) {
    const before = s.widthM;
    const next = stepZoom(s, { circling: true, tMs: s.tMs + 500 });   // half-second frames
    const ratio = before / next.widthM;
    expect(ratio).toBeLessThanOrEqual(Math.sqrt(MAX_RATE_PER_S) + 1e-9);
    s = next;
  }
  expect(s.widthM).toBeCloseTo(SPIRAL_WIDTH_M, 6);          // and it does ARRIVE, exactly
});

test('the slide is a function of TIME, not of fixes — 60 frames in a second do not zoom 60 times', () => {
  // The shell draws at 60 Hz and the beacons arrive at 1 Hz. A slide driven per-call would rip the
  // scale apart on the first frame burst.
  let s = fly(start(200_000), true, Math.ceil(ENTER_MS / 1000) + 4);   // engaged, still mid-slide
  const from = s.widthM;
  expect(from).toBeGreaterThan(SPIRAL_WIDTH_M * MAX_RATE_PER_S);       // room left to slide for a whole second
  for (let i = 0; i < 60; i++) s = stepZoom(s, { circling: true, tMs: s.tMs + 1000 / 60 });
  expect(from / s.widthM).toBeCloseTo(MAX_RATE_PER_S, 3);   // exactly one second's worth of zoom
});

// ---- and what it REFUSES ----

test('UNKNOWN IS NOT "NOT CIRCLING" — a dropped fix does not throw away the pilot\'s picture', () => {
  // No fix, no track: the detector has no answer. That is a fact about US, not about the glider.
  // Zooming back out on it would take the map away from a pilot who is still turning in the core.
  let s = fly(start(), true, 60);
  const inThermal = s.widthM;
  s = fly(s, null, 120);                     // two minutes of silence, mid-climb
  expect(s.spiral).toBe(true);
  expect(s.widthM).toBeCloseTo(inThermal, 6);
  expect(s.sinceMs).toBe(null);              // and no countdown was ever started on a shrug
});

test('and it can never ENGAGE on ignorance — an automatism overriding a human needs evidence', () => {
  const s = fly(start(), null, 300);         // five minutes of "we do not know"
  expect(s.spiral).toBe(false);
  expect(s.widthM).toBe(CRUISE);
  expect(spiralTargetM(CRUISE, null)).toBe(null);   // never a plausible number for "I do not know"
});

test('spiralTargetM says NULL, never a comfortable default, when it has no opinion', () => {
  expect(spiralTargetM(CRUISE, false)).toBe(null);  // not circling: the pilot's width stands
  expect(spiralTargetM(CRUISE, null)).toBe(null);   // unknown
  expect(spiralTargetM(NaN, true)).toBe(null);      // nothing to be closer than
  expect(spiralTargetM(0, true)).toBe(null);        // a zero width is not a width. NOT a fallback.
  expect(spiralTargetM(-5, true)).toBe(null);
});

test('a nonsense width is REFUSED, not repaired — the map stays where the pilot last saw it', () => {
  // A pinch factor computed from a division by zero, a restored setting that came back NaN. Silently
  // healing it to "something plausible" puts the map at a scale nobody chose and nobody can see is
  // wrong.
  expect(initZoom(0, 0)).toBe(null);
  expect(initZoom(NaN, 0)).toBe(null);
  expect(initZoom(-1, 0)).toBe(null);
  const s = start();
  expect(pilotZoom(s, NaN).widthM).toBe(CRUISE);
  expect(pilotZoom(s, 0).pilotWidthM).toBe(CRUISE);
  expect(pilotReset(s, NaN).pilotWidthM).toBe(CRUISE);
  expect(stepZoom(s, { circling: true, tMs: NaN })).toBe(s);
});

test('A CLOCK THAT GOES BACKWARDS IS A DIFFERENT FLIGHT, not a negative time step', () => {
  // Replay yesterday's log after this morning's, or restart a replay: rewinding the ease would run
  // the zoom backwards, and carrying the dwell across would credit the new flight with the old
  // one's seconds — the map would commit to a thermal that has not been flown yet.
  let s = fly(start(), true, 3);             // a dwell is pending
  expect(s.sinceMs).not.toBe(null);
  s = stepZoom(s, { circling: true, tMs: s.tMs - 30_000 });
  expect(s.sinceMs).toBe(null);              // forgotten
  expect(s.tMs).toBe(-27_000);               // and the new clock adopted
  expect(s.widthM).toBe(CRUISE);             // the width did not run backwards
  expect(s.pilotWidthM).toBe(CRUISE);        // his choice survives the timeline, as it must
});
