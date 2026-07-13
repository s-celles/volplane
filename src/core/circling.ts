// ============ what the last climb gave (VAR-006) ============
// Two numbers the pilot asks for out loud, minutes apart: "what did that thermal average?"
// and "what is this circle doing?". They are different questions. The first is a verdict on a
// climb the glider has LEFT — it must survive the glide that follows, because the pilot asks it
// twenty minutes later, over the next ridge, when he is deciding whether the day is still
// working. The second is a measurement of the turn just closed, and it is allowed to be
// negative: a circle that sank is a fact, and hiding it would be the lie.
//
// Neither is ever 0.0 m/s for want of an answer. A zero here reads as "the thermal you just
// left was dead", which is a claim the pilot cannot see through and would act on. Until there
// IS a last thermal, until a full 360° HAS been swept, the answer is null and the screen says
// "—" (POT-007).
//
// The detection maths is not ours (C4). A circling climb is exactly what soaring-core's airmass
// detector already finds, on exactly the rule the rest of the ecosystem uses — and its
// `strength` is, by construction, `net gain / duration`: "le gain moyen de l'ascendance",
// literally. So `avgMs = th.strength`, and `gainM = th.strength × duration` recovers the net
// gain the kernel divided. We import its constants rather than re-typing the numbers, so that
// the day the kernel retunes MIN_GAIN or TURN_MIN, this file moves with it instead of drifting
// quietly out of agreement with the lift map.

import type { TrackPoint } from 'soaring-core/types';
import { sampleProbe, turnDelta, rates, type Samp } from 'soaring-core/probe';
import { detectClimbs, STEP, W, TURN_MIN, GAP } from 'soaring-core/airmass';
import { probeFromTrack } from './liftmap';

/** The ring the detectors see. Fifteen minutes is several thermals and several glides: long
 *  enough that a climb is still whole when it finishes (a climb needs to age past GAP before we
 *  will call it over), short enough that the detector's work stays a few hundred samples. The
 *  MEMORY of the last thermal is not bounded by this — it outlives the ring on purpose. */
export const BUFFER_S = 900;

/** The verdict on a climb the glider has left. `avgMs` is the kernel's own `strength`. */
export interface ClimbAvg { avgMs: number; gainM: number; durationS: number; endSod: number }

/** The mean climb over the last complete 360° of heading. Negative when the circle sank. */
export interface CircleAvg { avgMs: number; durationS: number; endSod: number }

export interface Circling {
  add(sod: number, lon: number, lat: number, alt: number): void;
  /** VAR-006, half one: the climb the glider has LEFT. Detected by the kernel's own rule
   *  (detectClimbs), remembered once found, and never overwritten by an older one. Null until
   *  there is one — never 0. */
  lastThermal(): ClimbAvg | null;
  /** VAR-006, half two: the mean climb over the last complete 360° of heading. Null when the
   *  glider has not swept a full circle inside the buffer — never 0. */
  lastCircle(): CircleAvg | null;
  /** Is the glider circling RIGHT NOW (sustained turn rate ≥ airmass.TURN_MIN)? THE-001's gate,
   *  and the terrain alarm's too — a circling glider is not flying the straight ray the alarm
   *  marches. The same judgement circleassist reads through `circleState`. */
  circling(): boolean;
}

/** Samples per side of the kernel's rate baseline — airmass's own `g`, kept in step with it. */
const G = Math.max(1, Math.round(W / STEP));

/** The newest sample that was actually TURNING. A circle ends where the glider rolls out, and
 *  `rates` is the wrong instrument for finding that instant: its ±W baseline lags by W, and on a
 *  tight circle it ALIASES outright — a 25 s circle sweeps 259° across an 18 s window, which
 *  turnDelta reads, quite correctly and quite uselessly, as −101°. The step-to-step sweep does
 *  neither, so we ask it instead: a step that swept less than TURN_MIN × STEP degrees was not
 *  part of a circle. Without this cut, the circle reported during the glide AFTER a climb would
 *  run from inside the thermal to the present moment — a 25 s turn billed as two minutes, its
 *  average quietly diluted by the cruise. */
function lastTurningIdx(s: readonly Samp[]): number {
  for (let i = s.length - 1; i > 0; i--)
    if (Math.abs(turnDelta(s[i - 1].hdg, s[i].hdg)) >= TURN_MIN * STEP) return i;
  return -1;
}

/** The last full 360° of heading in a sampled track, walked BACKWARDS from the last turning
 *  sample. Backwards is the whole point: the pilot wants the circle he has just closed, not the
 *  first one of the climb, and a forward scan would have to know where the climb began. */
function spanOf(s: readonly Samp[]): { fromSod: number; toSod: number } | null {
  const end = lastTurningIdx(s);
  if (end < 1) return null;
  let net = 0;
  for (let i = end; i > 0; i--) {
    net += turnDelta(s[i - 1].hdg, s[i].hdg);
    // Signed, so a reversal UNWINDS the count instead of counting twice: an S-turn back and
    // forth has swept no circle, however much heading it burned through.
    if (Math.abs(net) >= 360) return { fromSod: s[i - 1].t, toSod: s[end].t };
  }
  return null;
}

/** Is the glider circling at the END of this sampling? `rates` clamps its ±G-sample window at
 *  the edges but still divides by the full baseline, so the newest few samples read HALF the
 *  turn rate they are really flying — a steady circle would fall under TURN_MIN just as the
 *  pilot rolled in. We therefore ask the newest sample whose window is COMPLETE. It costs W
 *  seconds of lag, which is the price of the claim being about a SUSTAINED turn rather than one
 *  noisy bearing. */
function turningAt(s: Samp[]): boolean {
  return s.length > 2 * G && rates(s, s.length - 1 - G, G, STEP).turn >= TURN_MIN;
}

/** THE-001's two questions, answered from ONE sampling of the track: is the glider circling NOW,
 *  and where is the last full 360° it closed?
 *
 *  They are asked together because THE-001 needs BOTH and neither substitutes for the other. A
 *  closed circle sitting in the window says only that the glider circled at some point inside it
 *  — three minutes later, six kilometres downwind, it is still in there. "TANT QUE le planeur est
 *  en spirale" is the gate, and the gate is `circling`; the span is only where to look once the
 *  gate is open. Exported as one call because circleassist wants both and the sampling is the
 *  expensive half.
 *
 *  Headings come from `sampleProbe`, which smooths them over a ±W baseline — a raw
 *  beacon-to-beacon bearing is noise, and summing noise around a circle would find a full turn in
 *  a straight glide. */
export function circleState(
  pts: readonly TrackPoint[],
): { circling: boolean; span: { fromSod: number; toSod: number } | null } {
  const probe = probeFromTrack(pts.slice());
  if (!probe) return { circling: false, span: null };
  const s = sampleProbe(probe, STEP, W);
  return { circling: turningAt(s), span: spanOf(s) };
}

/** The span alone, for callers that only want the circle. */
export function lastCircleSpan(pts: readonly TrackPoint[]): { fromSod: number; toSod: number } | null {
  return circleState(pts).span;
}

export function circlingTracker(): Circling {
  const ring: TrackPoint[] = [];
  // The one thing that outlives the ring. The pilot glides for twenty minutes and still wants
  // to know what the last one gave, so this is never cleared and never trimmed — only replaced,
  // and only by a climb that ended LATER than it.
  let thermal: ClimbAvg | null = null;
  let circle: CircleAvg | null = null;
  let turning = false;

  const recompute = (now: number): void => {
    circle = null;
    turning = false;
    const probe = probeFromTrack(ring);
    if (!probe) return;
    const s = sampleProbe(probe, STEP, W);

    turning = turningAt(s);

    const span = spanOf(s);
    if (span && span.toSod > span.fromSod) {
      const dur = span.toSod - span.fromSod;
      const gain = probe.at(span.toSod)[2] - probe.at(span.fromSod)[2];
      circle = { avgMs: gain / dur, durationS: dur, endSod: span.toSod };
    }

    for (const th of detectClimbs(probe)) {
      // The kernel bridges interruptions of up to GAP seconds, so a climb whose last sample is
      // fresher than that may simply be pausing — the glider has flicked out of the core and is
      // coming back. Calling that "the LAST thermal" makes a claim about a climb that has not
      // ended yet, and the number would change under the pilot's eyes.
      if (th.t1 > now - GAP) continue;
      // strength := gain / duration in the kernel, so this multiplication returns exactly the
      // net height the kernel measured — not a second, differently-rounded estimate of it.
      const dur = th.t1 - th.t0;
      const cand: ClimbAvg = {
        avgMs: th.strength, gainM: th.strength * dur, durationS: dur, endSod: th.t1,
      };
      if (!thermal || cand.endSod > thermal.endSod + GAP) { thermal = cand; continue; }
      // The same climb, re-detected after the ring has scrolled: its start has been trimmed
      // away, so it now looks shorter and weaker than it was. The fuller record is the true one,
      // and the resampling grid can shift its end by a step or two, which is why "later" is not
      // enough to tell a NEW climb from a TRUNCATED one.
      if (cand.endSod >= thermal.endSod - GAP && cand.durationS > thermal.durationS) thermal = cand;
    }
  };

  return {
    add(sod, lon, lat, alt) {
      const last = ring.length ? ring[ring.length - 1][3] : null;
      // A fix that does not advance the clock cannot advance the picture, and it would break the
      // binary search every probe does on this array.
      if (last != null && sod === last) return;
      // A clock that goes BACKWARDS is not a fix to be ignored — it is a different flight. Replay
      // an afternoon log (sod ≈ 50000) and then connect to the instrument the next morning
      // (sod ≈ 32000): every live fix would fail the guard above, and the boxes would keep showing
      // the replayed flight's last thermal, in plain measured styling, as if it were this one.
      // The memory that "outlives the ring on purpose" outlives the RING, never the FLIGHT.
      if (last != null && sod < last) {
        ring.length = 0;
        thermal = null;
        circle = null;
        turning = false;
      }
      ring.push([lon, lat, alt, sod]);
      while (ring.length && sod - ring[0][3] > BUFFER_S) ring.shift();
      recompute(sod);
    },
    lastThermal: () => thermal,
    lastCircle: () => circle,
    circling: () => turning,
  };
}
