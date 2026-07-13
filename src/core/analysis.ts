// ============ what the flight actually did (ANA-001, ANA-003) ============
// After the flight, three questions a pilot asks himself: how did the height go (the
// barograph), where did the lift come from (the climb history — the kernel's own detector),
// and did the glider glide as well as the book says (the effective polar).
//
// ANA-003 is the interesting one, and it is a MEASUREMENT against a MODEL: the achieved glide
// ratio is a fact about this flight, the polar's is a claim about the glider. Presenting one
// as the other is exactly what this project refuses everywhere else, so the result carries
// both, separately, and their ratio — never a single "your L/D" that hides which is which.
//
// The honest caveat, stated in the type rather than a footnote: an IGC file has no airspeed.
// The achieved ratio is computed over GROUND distance, so wind flatters a downwind glide and
// punishes an upwind one. Without a wind estimate the number is indicative; with one it can
// be corrected, and `effectiveGlide` takes it when the caller has it.

import { sampleProbe, rates } from 'soaring-core/probe';
import { detectClimbs, type Thermal } from 'soaring-core/airmass';
import { distM } from 'soaring-core/geo';
import { sinkAt, type Polar } from 'soaring-core/polar';
import type { TrackPoint } from 'soaring-core/types';
import { probeFromTrack } from './liftmap';
import { headwindOn } from './reach';

const STEP = 4;          // s: resample step, the kernel's own scale for track analysis
const HW = 10;           // s: heading baseline half-window
const G = 2;             // samples: the ± baseline the rates are taken over
const STRAIGHT_MAX = 2.5;  // deg/s: below this the glider is going somewhere, not circling
const SINK_MIN = 0.2;      // m/s: a glide is a descent, not a level ridge beat

// ---- ANA-001: the barograph ----

export interface Barograph {
  /** [seconds of day, altitude m] — the flight as the pilot flew it, nothing derived. */
  samples: [number, number][];
  maxAltM: number;
  minAltM: number;
  /** Total height gained (m), summed over the climbs only — the day's real work. */
  gainM: number;
  startSod: number;
  endSod: number;
}

/** The barograph, straight off the track. Null for a track too short to be a flight. */
export function barograph(track: readonly TrackPoint[]): Barograph | null {
  if (track.length < 2) return null;
  const samples: [number, number][] = track.map(p => [p[3], p[2]]);
  let maxAltM = -Infinity, minAltM = Infinity, gainM = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i][1];
    if (a > maxAltM) maxAltM = a;
    if (a < minAltM) minAltM = a;
    if (i > 0 && a > samples[i - 1][1]) gainM += a - samples[i - 1][1];
  }
  return {
    samples, maxAltM, minAltM, gainM,
    startSod: samples[0][0],
    endSod: samples[samples.length - 1][0],
  };
}

// ---- ANA-001: where the lift was ----

/** The climbs, as the kernel detects them (C4: the detector is soaring-core's, not ours).
 *  Empty when the track holds no circling worth the name — an honest empty list, not a
 *  desperate reinterpretation of straight flight as weak lift. */
export function climbs(track: readonly TrackPoint[]): Thermal[] {
  const probe = probeFromTrack([...track]);
  return probe ? detectClimbs(probe) : [];
}

// ---- ANA-003: the effective polar ----

export interface EffectiveGlide {
  /** How many straight gliding segments went into this — the evidence behind the number. */
  segments: number;
  distanceM: number;
  heightLostM: number;
  /** What the glider ACHIEVED: ground distance over height lost. A measurement. Null when
   *  the flight held no glide long enough to measure — never a 0, never the book value. */
  achievedLD: number | null;
  /** What the POLAR claims, at its own best glide speed. A model. */
  theoreticalLD: number;
  /** achieved / theoretical. Below 1 means the glider (or the air, or the pilot) did worse
   *  than the book — which is the normal state of affairs, and the point of the exercise. */
  ratio: number | null;
  /** True when a wind was supplied and the segments were corrected for it. When false, read
   *  the number as indicative: an IGC has no airspeed, and ground distance flatters a
   *  downwind glide. */
  windCorrected: boolean;
}

/** The best glide ratio the polar itself promises — the model half of ANA-003's comparison. */
export function theoreticalBestLD(pl: Polar): number {
  let best = 0;
  for (let v = pl.vMin; v <= pl.vMax; v += 0.25) {
    const ld = v / -sinkAt(pl, v);
    if (ld > best) best = ld;
  }
  return best;
}

/** The glide ratio this flight actually achieved, against the one the polar promises.
 *
 *  Only STRAIGHT, DESCENDING stretches count: a thermal turn descends too, and counting it
 *  would price the glider's cruise at its circling sink — a number so wrong it would look
 *  like a broken glider rather than a broken measurement.
 *
 *  When `wind` is given, each segment's ground distance is corrected to an air distance
 *  (the headwind component over the segment's own course, times its duration), which is what
 *  makes the ratio a claim about the GLIDER rather than about the day. */
export function effectiveGlide(
  track: readonly TrackPoint[], pl: Polar,
  wind?: { speed: number; direction: number } | null,
): EffectiveGlide {
  const theoreticalLD = theoreticalBestLD(pl);
  const empty: EffectiveGlide = {
    segments: 0, distanceM: 0, heightLostM: 0,
    achievedLD: null, theoreticalLD, ratio: null, windCorrected: wind != null,
  };
  const probe = probeFromTrack([...track]);
  if (!probe) return empty;
  const s = sampleProbe(probe, STEP, HW);
  if (s.length < 3) return empty;

  let distanceM = 0, heightLostM = 0, segments = 0, inGlide = false;
  for (let i = 1; i < s.length; i++) {
    const { turn, climb } = rates(s, i, G, STEP);
    const gliding = turn < STRAIGHT_MAX && climb < -SINK_MIN;
    if (!gliding) { inGlide = false; continue; }
    if (!inGlide) { inGlide = true; segments++; }
    const a = s[i - 1], b = s[i];
    let d = distM(a.lon, a.lat, b.lon, b.lat);
    if (wind) {
      // Ground distance minus what the wind carried us: the distance the glider flew through
      // the AIR, which is the only distance a polar has an opinion about.
      const course = Math.atan2(b.lon - a.lon, b.lat - a.lat) * 180 / Math.PI;
      d += headwindOn((course + 360) % 360, wind) * STEP;
    }
    const lost = a.alt - b.alt;
    if (d > 0 && lost > 0) { distanceM += d; heightLostM += lost; }
  }
  if (!(heightLostM > 0) || !(distanceM > 0)) return { ...empty, segments };
  const achievedLD = distanceM / heightLostM;
  return {
    segments, distanceM, heightLostM, achievedLD, theoreticalLD,
    ratio: achievedLD / theoreticalLD,
    windCorrected: wind != null,
  };
}
