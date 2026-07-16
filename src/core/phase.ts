// ============ the phase of the flight, and the six numbers that belong to it ============
//
// A soaring flight has three phases and the pilot's question changes completely between them:
//
//   CIRCLING     "is this thermal worth staying in?"     — the average, the gain, the last circle
//   CRUISE       "how fast, and where is the next one?"  — netto, speed to fly, the wind
//   FINAL GLIDE  "am I holding the slope?"               — the arrival height, and nothing else
//
// This app has ALWAYS known which phase it was in. `circling.ts` answers `circling()` on every fix,
// and the flight screen uses it — for the wind rose, and for the terrain alarm, which must not march
// a straight ray out of a turning glider. It has never used it for the SCREEN.
//
// So the pilot had three pages named `cruise`, `climb` and `finalGlide`, and to move between them he
// tapped a tab eight-tenths of a rem tall, IN A THERMAL. The data was under his hand the whole time.
//
// ---- what switches, and what must NEVER switch ----
//
// The CONTENT of the boxes changes. Their POSITIONS do not, and this is the whole discipline: a
// pilot reads an instrument by knowing WHERE a number lives, not by reading its label. A layout that
// reflows under him has taken away the only thing that made it glanceable.
//
// Six slots. Always six, always in the same places, always the same order. The phase decides what
// stands in them.
//
// ---- and the pilot may turn it off ----
//
// This is not unanimous among pilots, and the dissent is a good argument: a field that changes its
// IDENTITY in silence, under your eyes, is worse than a deliberate swipe — you read the number
// before you read the label, and the number now means something else. So the phase is SHOWN on the
// screen (the pilot learns why the number moved), and the switching can be turned off.

import type { BoxId } from './infobox';
import type { MsgId } from './i18n';

export type Phase = 'circling' | 'cruise' | 'finalGlide';

export interface PhaseInput {
  /** Is the glider circling RIGHT NOW? `circling.ts` already answers this, on every fix. */
  circling: boolean;
  /** Height above the goal on arrival, reserve already spent — or null when there is no goal, or
   *  the maths cannot promise an arrival at all (headwind ≥ speed to fly). */
  arrivalM: number | null;
}

/** Enter final glide the moment the goal is REACHABLE — arrival at or above zero, with the reserve
 *  already taken out of it. That is the instant the pilot's question changes: up to here he is
 *  hunting for the next climb, and from here he is holding a slope.
 *
 *  Leave it only when he is well below — see LEAVE_M. */
const ENTER_M = 0;

/** And DO NOT LEAVE IT AT ZERO. An arrival height hovering around the reserve would flip the whole
 *  screen back and forth at 1 Hz, and a pilot cannot read an instrument that is changing its mind.
 *
 *  Fifty metres of hysteresis: once he is on the slope, he stays on the final-glide screen until he
 *  has genuinely fallen off it. Falling off it is exactly when he most needs to see that he has. */
const LEAVE_M = -50;

/** The phase, from the previous one and what the glider is doing now. Pure — the previous phase is
 *  an argument, not a closure, because a hysteresis you cannot see the state of is a hysteresis you
 *  cannot test. */
export function nextPhase(prev: Phase, i: PhaseInput): Phase {
  // Circling wins over everything. A glider in a turn is climbing, whatever else is true of it, and
  // no arrival number is worth reading while the horizon is going round.
  if (i.circling) return 'circling';
  // No goal, or a goal the maths cannot reach at all: there is no slope to hold.
  if (i.arrivalM === null) return 'cruise';
  if (prev === 'finalGlide') return i.arrivalM < LEAVE_M ? 'cruise' : 'finalGlide';
  return i.arrivalM >= ENTER_M ? 'finalGlide' : 'cruise';
}

/** The phase's own name, as a catalogue id. Spelt here and nowhere else: a phase whose label lived
 *  in the shell would be a phase the catalogue cannot reach, and a half-translated instrument is
 *  worse than an untranslated one — the half that stays English is the half he reads under load. */
export const PHASE_TITLE: Readonly<Record<Phase, MsgId>> = {
  circling: 'phase.circling',
  cruise: 'phase.cruise',
  finalGlide: 'phase.finalGlide',
};

/** How far above or below the glide slope, as a fraction of the bar's half-height: −1 … +1.
 *
 *  The BAR is the instrument and the number is the caption, not the other way round. A pilot glancing
 *  at a marginal final glide reads a direction and a colour in peripheral vision, in a fraction of
 *  the time it takes to read three digits — and reads them right while being thrown about.
 *
 *  Clamped at ±FULL_M so a comfortable glide does not draw a bar off the top of the screen and stop
 *  meaning anything. Beyond ±300 m the exact number has stopped mattering: you have it, or you very
 *  much do not. */
export const FULL_M = 300;

export function glideBar(arrivalM: number | null): { frac: number; state: 'above' | 'below' } | null {
  if (arrivalM === null) return null;      // no goal, no slope, no bar. Never a bar at zero.
  const frac = Math.max(-1, Math.min(1, arrivalM / FULL_M));
  return { frac, state: arrivalM >= 0 ? 'above' : 'below' };
}
