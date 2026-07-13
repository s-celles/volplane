// ============ what the glider can actually reach (TER-005, PLA-007) ============
// The map's range ring is a lie of omission: it says "still air, no wind" and draws a circle,
// but a glider does not glide into a mountain. This file replaces the circle with the truth —
// march out along each bearing, lose height at the polar's rate against the wind actually
// blowing, and stop where the glide slope meets the ground.
//
// TER-005 is a DISTINCTION, not a number: a bearing can end for two entirely different
// reasons, and a pilot must be able to tell them apart. Running out of height in free air
// means the glide simply ends there. Being cut short by an interposed ridge means everything
// behind that ridge is unreachable — including ground that is lower than the glider and looks
// perfectly reachable on a range circle. That is the case that kills, and it is the whole
// reason this file exists.
//
// And the third answer, which is not a failure: UNKNOWN. Where the DEM has not loaded, the
// march stops and SAYS so. A reach polygon drawn through unloaded terrain would be exactly
// the invented promise POT-007 forbids — the ground it flies over is not "flat", it is
// unmeasured.
//
// C3 holds: everything here is measured terrain and a measured polar. No modelled lift field
// may ever widen this polygon.

import type { ElevSampler } from 'soaring-core/ports';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';
import { glideRatio } from './glide';
import type { Polar } from 'soaring-core/polar';

/** Why a bearing's reach ended. The three answers are three different facts, and the screen
 *  must never paint them alike. */
export type ReachLimit =
  /** The glide ran out in free air — the honest edge of the range. */
  | 'glide'
  /** An interposed ridge cut it short: the ground beyond is UNREACHABLE however low it lies.
   *  This is TER-005, and it is the one a range circle silently gets wrong. */
  | 'terrain'
  /** The DEM has not loaded out there. Not reachable, not unreachable — unmeasured. */
  | 'unknown';

export interface ReachRay {
  /** Degrees true, the bearing marched. */
  bearing: number;
  /** Metres reachable along it — 0 when the glider cannot leave its own position that way. */
  distanceM: number;
  limit: ReachLimit;
  /** The end point, for the polygon the map draws. */
  lon: number;
  lat: number;
}

export interface ReachOptions {
  /** Height (m) to keep above the ground on arrival — the same reserve the final glide
   *  keeps. Reaching a ridge with 0 m in hand is not reaching it. */
  safetyM?: number;
  /** How finely the ray is walked (m). 200 m is well under the DEM's own ~20 m/px at z12
   *  and cheap enough to run every fix. */
  stepM?: number;
  /** How far to look before giving up (m). Beyond a glider's best glide from any sane
   *  altitude, the march is wasted work. */
  maxM?: number;
  /** The wind to price the glide against — FROM direction, as everywhere in this app. */
  wind?: { speed: number; direction: number } | null;
}

export const DEFAULT_BEARINGS = 72;                 // every 5°
const DEFAULTS = { safetyM: 100, stepM: 200, maxM: 60_000 };

/** The wind's headwind component (m/s, positive = against) on a given bearing. A wind FROM
 *  270° is a headwind on a course of 270° and a tailwind on 090°. */
export function headwindOn(bearing: number, wind: { speed: number; direction: number }): number {
  return wind.speed * Math.cos((wind.direction - bearing) * Math.PI / 180);
}

/** March one bearing out from the glider until the glide slope meets the ground, the ground
 *  becomes unknown, or the height simply runs out.
 *
 *  The loop is the whole point: it tests the ground at EVERY step, not only at the far end.
 *  Testing only the destination is what makes a range circle claim a valley behind a ridge —
 *  the arithmetic says "you have the height for 30 km", and the mountain at 12 km says no. */
export function reachOnBearing(
  elev: ElevSampler, lon: number, lat: number, alt: number,
  polar: Polar, bearing: number, o: ReachOptions = {},
): ReachRay {
  const { safetyM, stepM, maxM } = { ...DEFAULTS, ...o };
  const head = o.wind ? headwindOn(bearing, o.wind) : 0;
  // Best glide against this wind: the speed to fly is MC 0 here on purpose — reach is a
  // question about the furthest the glider can go, and that is best glide, not the ring's
  // cruise speed. glideRatio answers null when the wind eats the whole airspeed: a bearing
  // the glider cannot make ground on at all.
  const v = bestGlideSpeed(polar, head);
  const ld = glideRatio(polar, v, head);
  const rad = bearing * Math.PI / 180;
  const dLon = Math.sin(rad) / mPerLng(lat), dLat = Math.cos(rad) / M_PER_LAT;
  const end = (d: number, limit: ReachLimit): ReachRay =>
    ({ bearing, distanceM: d, limit, lon: lon + d * dLon, lat: lat + d * dLat });

  if (ld == null || !(ld > 0)) return end(0, 'glide');   // parked, or blown backwards

  for (let d = stepM; d <= maxM; d += stepM) {
    const h = alt - d / ld;                              // the glide slope's height here
    const g = elev(lon + d * dLon, lat + d * dLat);
    if (g == null) return end(d - stepM, 'unknown');     // the DEM stops; so do we, honestly
    if (h < g + safetyM) {
      // The slope met the ground. WHICH ground decides the verdict, and the difference is
      // TER-005: ground at or above the glider's own altitude is a RIDGE in the way; ground
      // far below is simply where the glide ran out.
      const blocked = g + safetyM > alt - safetyM;
      return end(d - stepM, blocked ? 'terrain' : 'glide');
    }
  }
  return end(maxM, 'glide');
}

/** The speed that flies furthest against a headwind: the classic wind-corrected best glide,
 *  the tangent from the wind's own origin. Solved the same way speedToFly solves its
 *  tangency — maximise (V − head) / s(V) over the polar's envelope. */
function bestGlideSpeed(pl: Polar, head: number): number {
  let best = pl.vMin, bestLd = -Infinity;
  for (let v = pl.vMin; v <= pl.vMax; v += 0.25) {
    const ld = glideRatio(pl, v, head);
    if (ld != null && ld > bestLd) { bestLd = ld; best = v; }
  }
  return best;
}

/** The whole reachable set, one ray per bearing — the polygon that replaces the range circle.
 *  Cheap enough for the flight loop: 72 bearings × 300 steps of arithmetic and a cached tile
 *  lookup. */
export function reachable(
  elev: ElevSampler, lon: number, lat: number, alt: number,
  polar: Polar, o: ReachOptions = {}, bearings = DEFAULT_BEARINGS,
): ReachRay[] {
  const out: ReachRay[] = [];
  for (let i = 0; i < bearings; i++)
    out.push(reachOnBearing(elev, lon, lat, alt, polar, i * 360 / bearings, o));
  return out;
}

/** Is a named place reachable, and if not, WHY? PLA-007's honest half: the final glide to a
 *  goal, tested against the terrain actually in the way rather than against a straight line
 *  drawn over it. Null altitude, or unknown ground on the path, answers 'unknown' — never a
 *  cheerful "reachable" over terrain nobody measured. */
export function reachableTo(
  elev: ElevSampler, lon: number, lat: number, alt: number,
  goal: { lon: number; lat: number }, polar: Polar, o: ReachOptions = {},
): { reachable: boolean; limit: ReachLimit; marginM: number | null } {
  const bearing = bearingTo(lon, lat, goal.lon, goal.lat);
  const dist = flatDist(lon, lat, goal.lon, goal.lat);
  const ray = reachOnBearing(elev, lon, lat, alt, polar, bearing, { ...o, maxM: Math.max(dist, 1) });
  const short = ray.distanceM < dist;
  if (short && ray.limit === 'unknown') {
    return { reachable: false, limit: 'unknown', marginM: null };
  }
  // A ridge stopped the march, so there IS no arrival: the ground behind that wall cannot be
  // had at any height, and the straight-line arithmetic below — which knows nothing of the
  // mountain — would hand back a cheerful "+900 m in hand" over it. That number is not small,
  // not conservative and not a margin: it is a measurement of a glide nobody can fly. The
  // caller gets the fact (terrain) and no number, because none exists (POT-007).
  if (short && ray.limit === 'terrain') {
    return { reachable: false, limit: 'terrain', marginM: null };
  }
  // The margin is what is left over the GOAL's own ground once the glide is flown — the
  // number the arrival box shows, but now earned against every metre of ground in between.
  const gElev = elev(goal.lon, goal.lat);
  const { safetyM } = { ...DEFAULTS, ...o };
  const head = o.wind ? headwindOn(bearing, o.wind) : 0;
  const ld = glideRatio(polar, bestGlideSpeed(polar, head), head);
  const margin = gElev == null || ld == null ? null : alt - dist / ld - gElev - safetyM;
  return {
    reachable: ray.distanceM >= dist && (margin == null || margin >= 0),
    limit: ray.distanceM >= dist ? 'glide' : ray.limit,
    marginM: margin,
  };
}

// Flat-earth helpers, deliberately the same projection the rays march on — a reach that
// measured itself with one geodesy and drew itself with another would disagree with its own
// polygon at the edges.
const flatDist = (aLon: number, aLat: number, bLon: number, bLat: number): number =>
  Math.hypot((bLon - aLon) * mPerLng(aLat), (bLat - aLat) * M_PER_LAT);

const bearingTo = (aLon: number, aLat: number, bLon: number, bLat: number): number =>
  (Math.atan2((bLon - aLon) * mPerLng(aLat), (bLat - aLat) * M_PER_LAT) * 180 / Math.PI + 360) % 360;
