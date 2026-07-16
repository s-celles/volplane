// ============ the map zooms in when he circles — and gives it back (CAR-004) ============
//
// In a thermal the pilot's map is about a hundred metres of air: where the last surge was, which
// side of the trail is going up, where the other glider in the gaggle is. At 20 km across, all of
// that is four pixels wide and the map is a decoration. So CAR-004: a close scale AS LONG AS the
// glider spirals.
//
// ---- the trap, which is not the zooming in ----
//
// Zooming in is easy. GIVING IT BACK is where an automatism turns into an opponent.
//
// The pilot has a width. He chose it — with the buttons, with a pinch, with the wheel — and it is
// the width he wants for cruising. An automatism that zooms in for the climb and then hands back
// SOME OTHER width has stolen his choice; one that keeps re-deciding the width while his fingers are
// on the glass is fighting him for the controls of an instrument, and he will lose that fight
// because it never gets tired. Both failures end the same way: he stops trusting the map and starts
// pinching it back on every climb, which is exactly the workload CAR-004 exists to remove.
//
// Hence the three rules of this module:
//
//   1. THE PILOT'S WIDTH IS REMEMBERED, NOT OVERWRITTEN. The spiral scale is a loan. `pilotWidthM`
//      is the only thing the automatism may not touch, and rolling out returns to it exactly.
//   2. THE PILOT ALWAYS WINS THE ARGUMENT. A zoom gesture INSIDE a spiral DETACHES the automatism
//      for the rest of that climb: from that instant it stops driving the width and stops having an
//      opinion. It never zooms twice against the same hand.
//   3. NOBODY IS TELEPORTED. The width slides between scales at a bounded rate (MAX_RATE_PER_S). A
//      map that snaps from 20 km to 4 km between two frames is a map the pilot has to re-read from
//      scratch — he loses the picture he had, at the moment he is head-down in a turn.
//
// ---- and the automatism NEVER WIDENS THE MAP ----
//
// A pilot flying at 3 km across, tighter than the spiral scale, rolls into a thermal. If the
// "spiral scale" were applied as a scale, the map would zoom OUT on him — an automatism advertised
// as "closer in the climb" that pushes the ground away in the climb. So the target is
// `min(pilot, SPIRAL_WIDTH_M)`: the automatism may only ever bring the ground CLOSER.
//
// ---- what a spiral is, and what "we do not know" is ----
//
// `circling.ts` already answers `circling()` on every fix, on the ecosystem's own rule, and this
// module does not re-derive it — it takes it as an argument, along with the clock. Time is an
// argument and never a call to Date.now(): a hysteresis whose state you cannot see is a hysteresis
// you cannot test, and this one has two dwell timers.
//
// And `null` — no fix, no track, the detector cannot say — IS NOT `false`. It is not a fact about
// the glider, it is a fact about US. An automatism that overrides a human being has to justify
// itself with evidence, and no evidence is not evidence of anything: on `null` this module CHANGES
// NOTHING. It cannot engage on ignorance (that would zoom the map in on a guess) and it will not
// disengage on ignorance either (one dropped fix in a thermal must not throw the pilot's picture
// away). It simply holds its ground until the detector speaks again.

/** The width the map is loaned while the glider spirals: 2 km across.
 *
 *  A thermal core is 100–300 m wide and a circle 120–250 m in diameter, so 2 km puts the whole turn
 *  in the middle third of the screen with the last two circles of trail around it — which is the
 *  actual instrument: not the glider, but the SHAPE of where the lift was. Much tighter and the
 *  trail leaves the screen at every gust; much wider and the circles collapse into a blob again. */
export const SPIRAL_WIDTH_M = 2_000;

/** A turn must be SUSTAINED for this long before the map commits to it.
 *
 *  `circling()` is already a sustained-turn-rate judgement, so this is not a noise filter — it is a
 *  filter on INTENT. A 180° reversal onto a street, a steep turn to clear the airspace behind, the
 *  first half-turn of a probe into a bubble he immediately abandons: all of those read as circling
 *  for a few seconds, and none of them is a climb. Zooming in on each of them and back out again is
 *  a strobe light on the panel. */
export const ENTER_MS = 6_000;

/** And a rollout must be SUSTAINED for longer still before the map gives the width back.
 *
 *  Deliberately longer than ENTER_MS, and that asymmetry is the whole point: re-centring a thermal
 *  means straightening for a second or two to move the circle upwind, and a pilot doing that is
 *  more inside the climb than at any other moment. A map that zoomed out on every re-centre would
 *  punish exactly the technique it is meant to support. Leaving a thermal, by contrast, is not
 *  something anyone does in under ten seconds — waiting is free. */
export const LEAVE_MS = 12_000;

/** The width may change by at most this factor per second while the automatism is driving.
 *
 *  Not an aesthetic: a scale change is a re-read. Bounded at ×2 per second, the 20 km → 2 km loan
 *  takes ~3.3 s and the eye tracks the ground the whole way — the pilot keeps the picture he had.
 *  A step change gives him a NEW map to interpret, head-down, in a turn.
 *
 *  It bounds a RATIO, not a number of metres, because scale is felt logarithmically: 20 km → 10 km
 *  and 4 km → 2 km are the same gesture to the eye and must take the same time. */
export const MAX_RATE_PER_S = 2;

const LOG_RATE = Math.log(MAX_RATE_PER_S);

export interface ZoomState {
  /** THE PILOT'S CHOICE. The automatism reads it and never writes it. This is the width the map
   *  returns to when the glider rolls out, however long the climb lasted and whatever he did to the
   *  zoom inside it. */
  readonly pilotWidthM: number;
  /** What the map should draw NOW — somewhere between the two while it is sliding. */
  readonly widthM: number;
  /** The DEBOUNCED verdict: is the glider spiralling, as far as the map is concerned? Not the raw
   *  `circling()` of this second — that one flickers, and the map may not. */
  readonly spiral: boolean;
  /** When the raw flag first started disagreeing with `spiral`, so the dwell can be measured. Null
   *  while they agree — i.e. nothing is pending. */
  readonly sinceMs: number | null;
  /** The pilot took the zoom back during THIS spiral. The automatism is out of the argument until
   *  the glider rolls out. */
  readonly detached: boolean;
  /** The clock as last seen. Held here rather than read, so the whole hysteresis is inspectable. */
  readonly tMs: number;
}

export interface ZoomInput {
  /** Is the glider spiralling? From `circling.ts`. `null` when there is no answer — no fix, no
   *  track yet, replay not started. NOT `false`: see the header. */
  circling: boolean | null;
  /** Monotonic milliseconds. An argument, never a clock read. */
  tMs: number;
}

/** A width the map could actually be drawn at. Rejects the rest rather than repairing it: a NaN
 *  width that we quietly turned into 20 km is a map at a scale nobody chose and nobody can see is
 *  wrong. */
const usable = (w: number): boolean => Number.isFinite(w) && w > 0;

/** The width the automatism ASKS FOR, or null when it has no opinion.
 *
 *  Null in three cases, and they are all the same case: it has no business speaking. Not spiralling
 *  — the pilot's width stands. Not KNOWN to be spiralling — see the header, ignorance is not a
 *  reason to move a pilot's map. And an unusable pilot width — there is nothing to be closer than.
 *
 *  Never a plausible default. A caller that gets a number from this has been told something. */
export function spiralTargetM(pilotWidthM: number, circling: boolean | null): number | null {
  if (circling !== true) return null;
  if (!usable(pilotWidthM)) return null;
  // MIN, not assignment: the automatism may only bring the ground closer, never push it away.
  return Math.min(pilotWidthM, SPIRAL_WIDTH_M);
}

/** Start from the width the pilot is looking at. Refuses to start from nonsense — an unusable width
 *  here would be baked into `pilotWidthM` and every later restore would return to it. */
export function initZoom(pilotWidthM: number, tMs: number): ZoomState | null {
  if (!usable(pilotWidthM) || !Number.isFinite(tMs)) return null;
  return { pilotWidthM, widthM: pilotWidthM, spiral: false, sinceMs: null, detached: false, tMs };
}

/** Where the width is heading right now. */
function goalM(s: ZoomState): number {
  // Detached inside the spiral: the pilot has the zoom, and the automatism has NO destination at
  // all — not even the one it would have chosen. Holding `widthM` is how it stays out of the way.
  if (s.spiral && s.detached) return s.widthM;
  if (s.spiral) return Math.min(s.pilotWidthM, SPIRAL_WIDTH_M);
  return s.pilotWidthM;
}

/** Slide `from` towards `to`, at most MAX_RATE_PER_S for `dtS` seconds, in log space — and land
 *  EXACTLY on it, because a clamp that undershoots forever leaves the map at 2.03 km and the next
 *  comparison against the target will never be equal. */
function ease(from: number, to: number, dtS: number): number {
  const step = LOG_RATE * dtS;
  const delta = Math.log(to / from);
  if (Math.abs(delta) <= step) return to;
  return from * Math.exp(Math.sign(delta) * step);
}

/** One tick. Pure: everything it knows is in `prev` and `input`.
 *
 *  Called on every frame the shell draws, not only on every fix — the slide is a function of TIME,
 *  and a map that only moved when a beacon arrived would slide at 1 Hz, in visible steps, which is
 *  the jerk this module exists to avoid. */
export function stepZoom(prev: ZoomState, input: ZoomInput): ZoomState {
  const { tMs } = input;
  if (!Number.isFinite(tMs)) return prev;

  const dtMs = tMs - prev.tMs;
  // A clock that goes BACKWARDS is not a negative time step, it is a DIFFERENT TIMELINE — an IGC
  // replay restarted, yesterday's log after this morning's. Rewinding the ease would run the zoom
  // backwards; carrying the dwell across would credit the new flight with the old one's seconds.
  // Adopt the new clock, forget what was pending, keep the widths (the pilot still chose his).
  if (dtMs < 0) return { ...prev, sinceMs: null, tMs };

  // UNKNOWN CHANGES NOTHING about the spiral. The width still slides — a slide already begun on
  // evidence is not retracted because the next fix was late — but no timer runs and no verdict
  // flips on a shrug.
  if (input.circling === null) {
    return { ...prev, widthM: ease(prev.widthM, goalM(prev), dtMs / 1000), tMs };
  }

  let { spiral, sinceMs, detached } = prev;
  if (input.circling === spiral) {
    sinceMs = null;                                  // the pending change, if any, was a blip
  } else if (sinceMs === null) {
    sinceMs = tMs;                                   // the dwell starts now
  } else if (tMs - sinceMs >= (input.circling ? ENTER_MS : LEAVE_MS)) {
    spiral = input.circling;
    sinceMs = null;
    // Rolling out ends the argument as well as the loan: the pilot's next spiral gets the
    // automatism back. A detachment that outlived its climb would silently disable CAR-004 for the
    // rest of the flight because of one pinch two hours ago — and nothing on screen would say so.
    if (!spiral) detached = false;
  }

  const next: ZoomState = { ...prev, spiral, sinceMs, detached, tMs };
  return { ...next, widthM: ease(prev.widthM, goalM(next), dtMs / 1000) };
}

/** THE PILOT PINCHED, or hit a zoom button, or turned the wheel. `widthM` is what HE asked for.
 *
 *  Applied INSTANTLY, with no easing: his gesture is a direct manipulation, and a pinch that arrives
 *  a second late is a broken instrument, not a smooth one. The easing is for the width the MACHINE
 *  chose; the width the hand chose is already where the hand put it.
 *
 *  Outside a spiral this redefines his standing choice. INSIDE one it does not: it detaches the
 *  automatism and holds his width for the rest of the climb, and rolling out still returns to the
 *  width he set for cruising.
 *
 *  That last rule is a decision and it deserves its argument. The alternative — a pinch in the
 *  thermal becomes the new cruise width — sounds respectful and is a trap: half of these pinches are
 *  "let me look at the gaggle for a second", and adopting a 1 km cruise width from one of them
 *  strands the pilot at a scale that shows him no landing field and no next thermal, at the exact
 *  moment he leaves the climb and needs both. So the map keeps one promise instead of guessing:
 *  ROLLING OUT ALWAYS GIVES YOU BACK THE WIDTH YOU CRUISE AT. If he wants a new one, he sets it in
 *  the cruise, where the same gesture means exactly that. */
export function pilotZoom(s: ZoomState, widthM: number): ZoomState {
  // Refused, not repaired: a pinch computed from a division by zero must leave the map where it is.
  if (!usable(widthM)) return s;
  if (s.spiral) return { ...s, widthM, detached: true };
  return { ...s, widthM, pilotWidthM: widthM };
}

/** PUT IT BACK — the double tap (`gesture.ts` calls it `reset`).
 *
 *  It re-arms the automatism as well as restoring the width, and that is not a side effect: a pilot
 *  reaching for reset has stopped understanding what he is looking at, and handing him back a map
 *  that is still quietly refusing to help him in the next thermal would be half a reset. So if he
 *  resets INSIDE a climb, the map will slide straight back down to the spiral width — which is the
 *  automatic behaviour, which is what he just asked for. */
export function pilotReset(s: ZoomState, defaultWidthM: number): ZoomState {
  if (!usable(defaultWidthM)) return s;
  return { ...s, pilotWidthM: defaultWidthM, detached: false };
  // NB: `widthM` is NOT snapped here — it eases to the goal from wherever it is. The reset is not a
  // gesture on the scale itself, it is a change of INTENT, and the eye should be able to follow it.
}
