// ============ the terrain alarm (TER-008) ============
// The one alarm that must never be discounted. It looks along the track the glider is actually
// flying, prices the descent against the polar and the wind, and says whether the ground gets
// in the way inside the horizon the pilot chose.
//
// C3 is satisfied by construction: every input here is MEASURED — a DEM sample, a fitted polar,
// a wind estimate, a GPS track. No modelled field (POT) may ever reach this file, because a
// modelled field may never trigger a safety behaviour, and this file IS a safety behaviour.
//
// The hard clause of TER-008 is not the geometry, it is "LÀ OÙ le relief est chargé". Where the
// DEM has not loaded, there is no relief to collide with — there is an absence of measurement.
// An alarm raised over that absence is the alarm the pilot learns to silence, and once silenced
// it is silenced over the ridge too. So an unloaded hole answers `unmeasured`: a visual note
// that the ground ahead is UNKNOWN (POT-007's "—", in alarm form). It never sounds, it never
// escalates, and it is never an alarm.

import type { ElevSampler } from 'soaring-core/ports';
import type { Polar } from 'soaring-core/polar';
import { reachOnBearing, headwindOn, type ReachOptions } from './reach';
import type { NavState } from './nav';

/** How far ahead the pilot wants to be warned, in SECONDS. Time-to-impact is what he can act
 *  on — 1.8 km means nothing at 30 m/s until you have divided it. */
export const DEFAULT_HORIZON_S = 60;

/** The clearance the MARCH keeps over the ground, and it is this alarm's own number — NOT the
 *  pilot's final-glide reserve.
 *
 *  The two look interchangeable and are opposites. The arrival reserve (200 m by default) is a
 *  height the pilot wants IN HAND over a field he is gliding to; feeding it to a collision march
 *  turns "I keep 200 m spare at the airfield" into "anything within 200 m of my flight path is a
 *  collision" — and the glider is within 200 m of the ground on every circuit, every winch launch
 *  and every low ridge beat. That is a permanent level-3 siren over dead-flat ground, which is the
 *  alarm the pilot mutes on his first flight; and once muted it is muted over the rock too.
 *
 *  So the collision clearance is small and fixed: tens of metres, the height at which the ground
 *  ahead genuinely is in the way. */
export const TERRAIN_CLEARANCE_M = 60;

/** Below this AGL the glider is landing, not colliding. A field arrival, a winch launch and a low
 *  save all end with the ground very close on purpose; alarming there teaches nothing.
 *
 *  It sits well ABOVE TERRAIN_CLEARANCE_M, and that is the point: the march stops as soon as the
 *  glide slope comes within the clearance of the ground, so a floor below the clearance would let
 *  the two cross and the alarm would fire on the glider's own height rather than on anything
 *  ahead of it. Above 150 m the descent over a one-minute horizon (a couple of hundred metres of
 *  height at best glide) plus the clearance still fits under the glider — flat ground at circuit
 *  height is silent, as it must be. */
export const MIN_AGL_M = 150;
/** A glider not moving over the ground is not flying into anything — it is on a trailer, on a
 *  grid, or the fix has gone stale. */
export const MIN_GS_MS = 10;
/** Hysteresis: how long an alarm outlives the fix that raised it. A ridge sitting exactly on the
 *  horizon flickers in and out at 1 Hz, and an alarm that flickers is an alarm the eye stops
 *  believing. */
export const CLEAR_HOLD_S = 8;

export type TerrainVerdict =
  | { kind: 'clear' }
  /** The DEM ends inside the horizon. VISUAL only, and it says exactly that — the ground ahead
   *  is not flat, it is UNMEASURED. It NEVER sounds and it is NEVER an alarm (TER-008's
   *  "LÀ OÙ le relief est chargé", POT-007's null discipline). */
  | { kind: 'unmeasured'; distanceM: number }
  | {
      kind: 'alarm';
      /** 3 when the impact is inside half the horizon — the pilot must turn now, not think.
       *  2 is the same fact with time in hand. The tone belongs to `alarmtone`; we own the level. */
      level: 2 | 3;
      distanceM: number;
      timeToImpactS: number | null;
      /** 'terrain' = a ridge stands in the way; 'glide' = the descent itself reaches the ground
       *  inside the horizon. Two different mistakes and two different escapes (TER-005). */
      cause: 'terrain' | 'glide';
      /** The track the march was flown on, so the banner can point at the thing. */
      bearing: number;
    };

const CLEAR: TerrainVerdict = { kind: 'clear' };

export interface TerrainAheadOptions {
  /** Seconds ahead to look. Anything that is not a positive number — an emptied settings box
   *  reads as 0 in every browser — is NOT a licence to switch the alarm off: it means the pilot
   *  told us nothing, and we fall back to DEFAULT_HORIZON_S. A safety alarm that can be disabled
   *  silently, by a backspace, with nothing on the screen saying so, is worse than one with no
   *  setting at all. */
  horizonS?: number;
  /** Is the glider CIRCLING? Then it is not flying the straight ray this file marches: it is
   *  flying a circle, and the track sweeps the whole compass once a turn. A thermal turned next
   *  to a ridge would sweep the ray onto the rock once per circle, alarm, and (through
   *  chooseVoice) take the vario away from the pilot for the whole climb — in the one place he
   *  needs it most, on the one alarm he must never learn to discount. There is no collision to
   *  predict from an instantaneous heading the glider is already turning away from. */
  circling?: boolean;
  /** The wind to price the descent against — FROM direction, as everywhere in this app. */
  wind?: { speed: number; direction: number } | null;
  /** Accepted, and honestly inert for now. The march in reach.ts prices the descent at BEST
   *  GLIDE, the flattest slope the glider owns; a cruise at MC > 0 is steeper and would meet
   *  low ground sooner. That under-fires the 'glide' cause only — the 'terrain' cause, the one
   *  that kills, is untouched: a ridge standing above the glider stops the march at the rock
   *  whatever the slope. Steepening the march belongs in reach.ts, not in a second copy here (C4). */
  mc?: number;
}

/** Does the ground get in the way of the track we are on, inside the horizon?
 *
 *  The march already answers this exactly — it walks the glide slope out along a bearing and
 *  stops where the ground meets it, distinguishing the ridge from the run-out and both from the
 *  hole. All this function does is bound the march by the horizon (in metres the glider will
 *  actually cover) and read the three answers as three different duties. */
export function terrainAhead(
  elev: ElevSampler, s: NavState, polar: Polar, o: TerrainAheadOptions = {},
): TerrainVerdict {
  // `??` would only catch null and undefined, and the number that actually arrives from an
  // emptied text field is 0 — which sails through it and, tested as `horizonS > 0`, used to
  // return CLEAR for the rest of the flight with no banner, no tone and nothing on screen
  // admitting the alarm was off.
  const horizonS = o.horizonS != null && o.horizonS > 0 ? o.horizonS : DEFAULT_HORIZON_S;
  const { fix, groundSpeed: gs, track, agl } = s;

  // No input, no alarm. Every one of these gates is a thing we do not KNOW, and an alarm we
  // cannot justify from a measurement is an invented one (POT-007). Silence is the honest
  // answer; the screen already says "—" for each missing field.
  if (!fix || fix.alt == null) return CLEAR;
  if (track == null || gs == null || gs < MIN_GS_MS) return CLEAR;
  if (agl == null || agl < MIN_AGL_M) return CLEAR;
  // Circling: no straight ray to march, and nothing to say. See the option's own comment.
  if (o.circling) return CLEAR;
  // A headwind that swallows the glider's fastest speed is a wind estimate that has gone wrong,
  // not a collision: the march would stop dead at zero metres and shout about ground the glider
  // is nowhere near. We do not alarm on a broken input.
  if (o.wind && headwindOn(track, o.wind) >= polar.vMax) return CLEAR;

  // The horizon is a TIME; the march wants a DISTANCE. The conversion is the ground speed the
  // glider is actually making — the same speed that will carry it into the rock.
  const horizonM = horizonS * gs;
  // The clearance is OURS and there is no knob for it: see TERRAIN_CLEARANCE_M. The one number
  // this file must never be handed is the pilot's arrival reserve, and the surest way to keep it
  // out is to have nowhere to put it.
  const march: ReachOptions = {
    wind: o.wind ?? null, maxM: horizonM, safetyM: TERRAIN_CLEARANCE_M,
  };
  const ray = reachOnBearing(elev, fix.lon, fix.lat, fix.alt, polar, track, march);

  // THE HEADLINE. The DEM stopped before the horizon did. There is no relief here to collide
  // with — there is no relief here at all, and we say so instead of pretending flat ground or,
  // far worse, crying wolf over a hole.
  if (ray.limit === 'unknown') return { kind: 'unmeasured', distanceM: ray.distanceM };

  // The march ran the full horizon without meeting the ground: nothing ahead, for as far as the
  // pilot asked to be told about.
  if (ray.distanceM >= horizonM) return CLEAR;

  const timeToImpactS = ray.distanceM / gs;
  return {
    kind: 'alarm',
    level: timeToImpactS <= horizonS / 2 ? 3 : 2,
    distanceM: ray.distanceM,
    timeToImpactS,
    cause: ray.limit,
    bearing: ray.bearing,
  };
}

/** The hysteresis box: same shape as rollingVario — a factory, clocked by seconds-of-day, so a
 *  replay alarms identically to a live flight.
 *
 *  It holds an alarm for CLEAR_HOLD_S past the fix that raised it. A ridge sitting on the edge
 *  of the horizon, or a track wandering a few degrees either side of it, would otherwise raise
 *  and drop the alarm every second — and an alarm that blinks is one the pilot learns to look
 *  past. The hold outranks `unmeasured` too: losing the DEM does not cancel a rock we measured
 *  a second ago. */
export function terrainAlarm(): { add(sod: number, v: TerrainVerdict): TerrainVerdict } {
  let held: TerrainVerdict | null = null;
  let heldAt = 0;
  return {
    add(sod: number, v: TerrainVerdict): TerrainVerdict {
      if (v.kind === 'alarm') {
        held = v;
        heldAt = sod;
        return v;
      }
      const dt = sod - heldAt;
      // dt < 0 means the clock went backwards (a new replay, a day rollover): we hold nothing
      // we cannot time honestly.
      if (held && dt >= 0 && dt < CLEAR_HOLD_S) return held;
      held = null;
      return v;
    },
  };
}
