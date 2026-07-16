// ============ which way is up (CAR-002) ============
//
// The map has always been north-up, and has never known there was a choice. A pilot flying south
// reads a map on which everything he is about to meet is BELOW him and every turn he makes is
// mirrored. Track-up removes that translation: what is ahead of the glider is ahead on the screen,
// and left is left. It is the single change that makes a moving map readable at a glance.
//
// ---- the four tops, and what each one CLAIMS ----
//
//   north-up    the top is north. Always. Nothing to know, nothing to lose.
//   track-up    the top is where the glider is GOING over the ground.
//   heading-up  the top is where the glider is POINTING. This is not the same thing, and the
//               difference is the drift: 30 kt of crosswind on a glider at 90 kt is 19° of it.
//   target-up   the top is the goal. The one mode that still means something in a thermal.
//
// A mode is a CLAIM about what the top of the screen is. So the interesting cases are the ones where
// we cannot honour it:
//
//   · heading-up with no vane, no compass, no attitude source — and VOLPLANE has none today: nav.ts
//     carries `track` and nothing else. Substituting the track would be the worst possible failure,
//     because it is INVISIBLE and it is wrong by exactly the drift — that is, most in the crosswind
//     where knowing which way you point matters most. So we refuse, we fall back to north (which is
//     the one direction that is never a lie), and we SAY which.
//   · target-up with no goal. Same refusal.
//   · track-up standing on the grid. A GPS course-over-ground at 0 kt is noise, and a map that spins
//     on the launch point teaches the pilot the feature is broken.
//
// `refDeg` is null in each of those, never a plausible number (POT-007's discipline). `top` and
// `degraded` are what the screen must SHOW, so the pilot reads NORTH UP on the label and knows why.
//
// ---- and the thermal ----
//
// This is the trap that no amount of filtering solves, and it must be said plainly: a glider in a
// thermal sweeps 360° in 20–30 s, i.e. 12–18°/s. A track-up map follows it. THE WHOLE PICTURE SPINS,
// once every twenty seconds, for as long as the climb lasts. It is unreadable, and pilots describe it
// as making them sick. Smoothing cannot fix it — a low-pass of a ramp is still a ramp, lagging: the
// map spins just as fast, only later. The only cure is to STOP FOLLOWING, and that is what XCSoar
// arrived at too (its map orientation while circling is a separate setting, north-up by default).
//
// So: while `circling`, track-up and heading-up hold north. Target-up does NOT — the bearing to the
// goal barely moves while you turn, so the goal simply stays at the top of the screen through the
// whole climb, which is precisely the picture the pilot wants when he leaves it.

/** The four tops. `heading-up` is here even though nothing feeds it today (see the header): the mode
 *  that must be REFUSED honestly is a mode that has to exist. */
export type OrientMode = 'north-up' | 'track-up' | 'heading-up' | 'target-up';

/** Why the map is not doing what the mode says. Ids, not sentences: the words belong to the
 *  catalogue, and an instrument whose excuses live in the shell is an instrument that cannot be
 *  translated. */
export type Degraded =
  /** heading-up asked for, and there is no heading source aboard. */
  | 'no-heading'
  /** target-up asked for, and there is no goal. */
  | 'no-target'
  /** track-up asked for, and the glider is too slow for its course to mean anything. */
  | 'no-track'
  /** track-up or heading-up asked for, and the glider is circling: following it would spin the map. */
  | 'circling';

export interface OrientInput {
  mode: OrientMode;
  /** Course over the ground, degrees true (NavState.track). Null when no fix has carried one. */
  trackDeg: number | null;
  /** Ground speed (m/s). Not decoration: it is what says whether `trackDeg` is a direction or noise. */
  groundSpeedMs: number | null;
  /** Where the nose points, degrees true. Null unless something actually MEASURES it. Nothing does,
   *  today — and a heading derived from the track is not a heading, it is the track wearing its name. */
  headingDeg: number | null;
  /** Bearing to the active goal, degrees true. Null when there is no goal. */
  targetBearingDeg: number | null;
  /** Is the glider circling RIGHT NOW? `circling.ts` already answers this on every fix, and phase.ts
   *  already uses it. Here it is the guard against the spinning map. */
  circling: boolean;
}

/** The smoothing's memory. An ARGUMENT, not a closure: a hysteresis whose state you cannot see is a
 *  hysteresis you cannot test — the same rule phase.ts and gesture.ts are built on. */
export interface OrientState {
  /** The smoothed reference bearing (deg true). Null = we have never had one to smooth. */
  refDeg: number | null;
  /** The bearing actually AT THE TOP of the map right now — what the last frame drew. Null before the
   *  first frame, and that null is what makes the first orientation a SNAP rather than a three-second
   *  slew up from a north the pilot never asked for. */
  shownDeg: number | null;
  /** Is the map currently chasing the reference? The latch of the hysteresis: see DEADBAND_DEG. */
  chasing: boolean;
}

export const INITIAL: OrientState = { refDeg: null, shownDeg: null, chasing: false };

export interface Orientation {
  /** Feed this back next tick. */
  state: OrientState;
  /** THE ANSWER. Radians, clockwise (canvas y grows down, so `ctx.rotate(rotationRad)` about the map
   *  centre turns the picture clockwise on screen). Normalised to (−π, π] so a glider crossing north
   *  does not wind the angle up forever.
   *
   *  It is a number in every case, including the refused ones — but it never LIES, because a refused
   *  mode returns exactly 0 with `top: 'north-up'` and a `degraded` reason. Zero here means north, not
   *  "I do not know"; the thing we do not know is `refDeg`, and that is null. */
  rotationRad: number;
  /** The bearing now at the top, as DRAWN (smoothed, rate-limited). What the compass rose must point
   *  at — read it from here rather than recomputing, or the rose and the map will disagree by exactly
   *  the smoothing. */
  topDeg: number;
  /** What the top of the screen ACTUALLY is. Not what was asked for — what was achieved. */
  top: OrientMode;
  /** Null when the mode was honoured. Otherwise why it was not, and the screen must say so. */
  degraded: Degraded | null;
  /** The reference direction we could honestly compute, deg true — null when we could not. The mode's
   *  claim, before any smoothing, and the only field that is allowed to say "unknown". */
  refDeg: number | null;
}

// ---- the numbers, and what they cost ----

/** Below this ground speed a GPS course-over-ground is not a direction, it is the receiver's noise
 *  resolving a metre of drift into a bearing — it swings through the whole compass while the glider
 *  sits on the grid. Five m/s (18 km/h) is far under any flying speed and far over the wander of a
 *  glider being pushed, so it costs nothing in the air and saves the map from spinning on the ground. */
export const MIN_TRACK_MS = 5;

/** The low-pass on the reference, as a time constant (s). It is there for the fix-to-fix wobble: a
 *  GPS course jitters a few degrees at cruise, more in turbulence, and a map redrawn straight from it
 *  shivers. Three seconds kills that and costs three seconds of lag — invisible on an instrument you
 *  GLANCE at, whereas a one-second constant lets the shiver straight through.
 *
 *  It is NOT what stops the thermal spinning the map. Nothing of this kind could be: see the header. */
export const TAU_S = 3;

/** THE HYSTERESIS, and the reason this file has state at all.
 *
 *  The map does not move until the reference has drifted DEADBAND_DEG from what is drawn, and once it
 *  starts moving it keeps going until it is within RELEASE_DEG — two thresholds, not one, or the map
 *  would stop five degrees off and sit there, and every gust would restart it.
 *
 *  Five degrees: under the ±3–5° a GPS course wanders at cruise plus the yaw of a bumpy day, so the
 *  picture is still under a glance; and five degrees of error on the top of a map is a fraction of a
 *  degree of misplacement per screen-width, which no pilot can see. Ten would be visible on the
 *  compass rose; two would let the map creep continuously, which is exactly the motion the eye is
 *  built to catch and the thing that makes a moving map tiring. */
export const DEADBAND_DEG = 5;
export const RELEASE_DEG = 2;

/** And when it does move, it moves at a rate the eye can FOLLOW. A 180° reversal (a bad landout turn,
 *  or a mode switch) rotating instantly is a teleport: the pilot loses every landmark he had and has
 *  to re-read the whole picture. Thirty degrees a second turns that reversal in six seconds — slow
 *  enough to be followed, fast enough that the map is never meaningfully behind the glider (a 45°
 *  cruise turn is caught in a second and a half). It also caps what any single bad fix can do. */
export const MAX_SLEW_DEG_S = 30;

/** A gap longer than this means nobody was watching — the app was backgrounded, or the fixes stopped.
 *  Without the clamp, `MAX_SLEW × dt` over a two-minute gap is no limit at all and the map teleports
 *  on the first frame back, which is the one frame the pilot is looking hardest at. */
export const MAX_DT_S = 2;

// ---- circular arithmetic: the 359° → 1° trap ----

/** Degrees into [0, 360). */
export function normDeg(d: number): number {
  const x = d % 360;
  return x < 0 ? x + 360 : x;
}

/** The SIGNED short way from `from` to `to`, in (−180, 180]. This is the whole defence against the
 *  wrap: 359° → 1° is +2°, not −358°, and a map that got that wrong would take the long way round the
 *  compass — a full spin, on screen, because the glider crossed north. */
export function angDiffDeg(from: number, to: number): number {
  const d = normDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/** Blend `from` towards `to` by `alpha`, the short way. This IS the circular mean where it matters:
 *  the mean of 359° and 1° is 0°, and the arithmetic mean — 180° — would point the map backwards. */
function blendDeg(from: number, to: number, alpha: number): number {
  return normDeg(from + angDiffDeg(from, to) * alpha);
}

const finite = (x: number | null | undefined): number | null =>
  x != null && Number.isFinite(x) ? x : null;

/** The bearing the mode asks for — or null, when it cannot be had. The refusals live here, in one
 *  place, and none of them substitutes anything. */
function reference(i: OrientInput): { refDeg: number | null; degraded: Degraded | null } {
  switch (i.mode) {
    case 'north-up':
      return { refDeg: 0, degraded: null };

    case 'track-up': {
      // The thermal, before anything else: the track is perfectly well known in a climb, and that is
      // exactly the problem — following it spins the map.
      if (i.circling) return { refDeg: null, degraded: 'circling' };
      const t = finite(i.trackDeg);
      const gs = finite(i.groundSpeedMs);
      if (t === null || gs === null || gs < MIN_TRACK_MS) return { refDeg: null, degraded: 'no-track' };
      return { refDeg: normDeg(t), degraded: null };
    }

    case 'heading-up': {
      if (i.circling) return { refDeg: null, degraded: 'circling' };
      const h = finite(i.headingDeg);
      // AND WE DO NOT FALL BACK TO THE TRACK. It is the closest number to hand and it is the wrong
      // one: it differs by the drift, so the map would be most wrong in the crosswind, silently, in
      // the mode the pilot chose precisely because he wanted to know which way he was pointing.
      if (h === null) return { refDeg: null, degraded: 'no-heading' };
      return { refDeg: normDeg(h), degraded: null };
    }

    case 'target-up': {
      const b = finite(i.targetBearingDeg);
      if (b === null) return { refDeg: null, degraded: 'no-target' };
      // No circling guard: the bearing to a goal ten kilometres away barely moves while the glider
      // turns, so this is the one mode that survives a thermal — the goal stays at the top of the
      // screen all the way up, and that is the picture wanted at the moment of leaving.
      return { refDeg: normDeg(b), degraded: null };
    }
  }
}

/** One tick: the previous smoothing state, what the glider is doing, and how long since the last
 *  tick. Pure — `dtS` is passed, never read from a clock. */
export function orient(prev: OrientState, i: OrientInput, dtS: number): Orientation {
  // NORTH-UP IS EXACT AND IMMEDIATE. It is the pilot's "put it back": he taps it when the picture has
  // stopped making sense, and a north-up that slews into place over six seconds is a north-up that
  // does not answer the question he asked. Zero, now, and no state to remember.
  if (i.mode === 'north-up') {
    return {
      state: { refDeg: 0, shownDeg: 0, chasing: false },
      rotationRad: 0, topDeg: 0, top: 'north-up', degraded: null, refDeg: 0,
    };
  }

  const dt = Math.min(Math.max(finite(dtS) ?? 0, 0), MAX_DT_S);
  const { refDeg, degraded } = reference(i);
  // A refused mode aims at north — the one direction that cannot be wrong — and says so. It aims
  // there by SLEWING, unlike the north-up mode above: entering a thermal must not snap the picture a
  // quarter-turn while the pilot is looking outside at the wing tip.
  const wantDeg = refDeg ?? 0;

  const smoothed = prev.refDeg === null
    ? wantDeg                                                  // first ever reference: no lag from nowhere
    : blendDeg(prev.refDeg, wantDeg, 1 - Math.exp(-dt / TAU_S));

  let shown: number;
  let chasing: boolean;
  if (prev.shownDeg === null) {
    // The first frame is a SNAP. There is nothing on screen to be continuous with, and slewing up from
    // a north the pilot never chose would make the map's first act a lie in motion.
    shown = smoothed;
    chasing = false;
  } else {
    const err = angDiffDeg(prev.shownDeg, smoothed);
    chasing = prev.chasing ? Math.abs(err) > RELEASE_DEG : Math.abs(err) > DEADBAND_DEG;
    const step = chasing
      ? Math.sign(err) * Math.min(Math.abs(err), MAX_SLEW_DEG_S * dt)
      : 0;
    shown = normDeg(prev.shownDeg + step);
  }

  // Put `shown` at the top: a point at bearing B sits at screen (sin B, −cos B), and rotating the
  // canvas by θ carries it to (sin(B+θ), −cos(B+θ)) — so θ = −B is what brings it to the top. Hence
  // the minus, and it is the sign that decides whether the map turns with the glider or against it.
  const rot = -shown * Math.PI / 180;
  const wrapped = rot <= -Math.PI ? rot + 2 * Math.PI : rot;

  return {
    state: { refDeg: smoothed, shownDeg: shown, chasing },
    // `|| 0` for the negative zero: −0 is not 0 to Object.is, and a −0 would trip every test and any
    // caller comparing the rotation to see whether the map moved.
    rotationRad: wrapped || 0,
    topDeg: shown,
    top: degraded === null ? i.mode : 'north-up',
    degraded,
    refDeg,
  };
}

/** A screen delta (px, y down) back into MAP axes — for the shell, whose gestures arrive in the
 *  rotated frame.
 *
 *  This is CAR-002's quiet second bug: on a track-up map, dragging the finger right must pan the map
 *  right ON SCREEN, which is not east. Panning by the raw screen delta on a rotated canvas sends the
 *  map off sideways under the finger, and the pilot's only conclusion is that the map is broken. */
export function unrotatePx(dxPx: number, dyPx: number, rotationRad: number): [number, number] {
  const c = Math.cos(-rotationRad), s = Math.sin(-rotationRad);
  return [dxPx * c - dyPx * s, dxPx * s + dyPx * c];
}
