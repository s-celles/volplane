// ============ required glide ratio versus achieved glide ratio (PLA-006) ============
//
// The arrival height (PLA-005) answers "do I get there?" with a number the pilot cannot argue
// with — and cannot check either. It is the output of a polar, a MacCready ring and a wind
// estimate, and every one of those three can be wrong in the same direction on the same day:
// a tired glider, bugs on the wings, water in the wings, a headwind stronger than the vector we
// fitted. When they are, the arrival height stays confidently positive all the way down to the
// field short of the field.
//
// PLA-006 is the check on it, and it is the reading every mature computer puts next to the
// arrival height:
//
//     REQUIRED   the ground glide ratio the geometry demands: distance, over the height we may
//                actually spend. A fact about the map. No polar in it, no wind, no MacCready.
//
//     ACHIEVED   the ground glide ratio the glider is getting RIGHT NOW: ground covered over
//                height lost, measured. A fact about the last minute of flight. No model in it.
//
// Neither number knows anything about the other, and that is the entire point: when the model
// says you arrive 200 m high and the two numbers say you need 38 and you are getting 24, the
// numbers are right and the model is wrong. The pilot turns towards the field while he still
// has a field to turn towards. That comparison, and nothing else, is what this file is for.
//
// ---- both numbers are GROUND ratios, and they must stay that way ----
//
// Required is ground distance over height. Achieved is ground distance over height. Wind is in
// BOTH of them, identically, and cancels in the comparison — which is exactly why it is safe to
// compare them without a wind estimate, and why the comparison catches a wind estimate that is
// wrong. Convert either one to an air ratio and you have thrown that away and rebuilt the very
// model you were trying to check.
//
// The corollary is a rule for whoever wires this up: the comparison is only meaningful while the
// glider is actually TRACKING THE GOAL. A ground finesse of 45 measured on a downwind leg says
// nothing about a glide that will finish upwind. This module cannot see the goal's bearing, so
// it cannot enforce that — the shell must (see the wiring note).
//
// ---- and it says NULL a great deal ----
//
// Achieved glide ratio is a quotient of two small, noisy quantities. It is unmeasurable in a
// thermal, unmeasurable in a pull-up, unmeasurable across a GPS dropout, and unmeasurable in the
// first seconds after switch-on. Every one of those returns null and the box reads "—". A pilot
// who sees "—" looks out of the window; a pilot who sees "L/D 137" because we divided 1800 m by
// 13 m of altitude noise has been told a story.

import { distM } from 'soaring-core/geo';

/** One fix, as this module needs it. Time is an ARGUMENT (seconds since midnight UTC, the same
 *  `sod` the rest of the computer speaks): nothing here reads a clock, so a window whose state a
 *  test cannot see is a window a test cannot break. */
export interface GlideSample {
  sod: number;
  lon: number;
  lat: number;
  /** Altitude (m AMSL). The same source throughout the window — mixing GPS and pressure altitude
   *  inside one window would put the two instruments' offset straight into the numerator. */
  altM: number;
}

// ---- THE WINDOW. This is the number the file exists to get right. ----
//
// Achieved L/D = distance / height lost, and the height lost is what kills it. Two errors fight:
//
//   TOO SHORT — it is noise. GPS altitude carries a few metres of RMS error (vertical dilution
//     runs 1.5–2× the horizontal), and the quotient inherits it as roughly 1.4·σ / (height lost).
//     A glider at 1 m/s sink loses 5 m in five seconds; three metres of noise on five metres of
//     signal is not a measurement, it is a random number generator with an aviation font. At
//     twenty seconds it is still ±20 %. Worse, five seconds is shorter than the aircraft itself:
//     a stick-forward and a stick-back trade height for speed and back again, and a window that
//     fits inside one pull-up reports the ENERGY EXCHANGE, not the glide.
//
//   TOO LONG — it is history. At 120 km/h a five-minute window spans ten kilometres of ground
//     and, on a normal cross-country, at least one thermal turn: it reports the air the glider
//     was in over the last ridge. On a 20 km final glide, five minutes is a QUARTER OF THE WHOLE
//     GLIDE — by the time the number moves, the decision it was meant to inform is behind you.
//     And the point of PLA-006 is precisely to catch a glide going wrong while it is going wrong.
//
// SIXTY SECONDS. At a typical cruise sink of ~1 m/s that is ~60 m of height lost against a few
// metres of altitude noise — an error near 5–7 %, small enough that a 20 % shortfall against the
// required ratio stands clearly out of it. It is longer than any pull-up or gust response (a few
// seconds) and shorter than a thermal cycle (minutes). It is about 2 km of ground: one parcel of
// air, not a tour of the county. It responds inside a quarter-minute to a glide that has started
// going wrong, which is soon enough to turn back.
export const WINDOW_S = 60;

/** A window may be short of samples and still answer — but not THIS short. Below half the window
 *  the noise argument above bites, and there is a specific moment when it would bite hardest: the
 *  first seconds after the computer is switched on, when the pilot is most inclined to believe a
 *  fresh number. Until there is a real span of flight behind it, the answer is null. */
export const MIN_SPAN_S = 30;

/** And the span is not enough on its own: what matters is the HEIGHT LOST in it, because that is
 *  the denominator. Twenty metres, against a few metres of GPS altitude noise, is the floor below
 *  which the quotient is mostly noise — and it is also, conveniently, the floor below which the
 *  glider is not really gliding: a minute at 0.3 m/s of net sink means it is in rising air, and
 *  "L/D 300" is a true statement about a state that is about to end and a lie about the glide the
 *  pilot is asking after. */
export const MIN_LOSS_M = 20;

/** The window must have been flown roughly STRAIGHT, or the ratio is a fiction.
 *
 *  This is the trap that makes a naive achieved-L/D useless in the aircraft. A glider circling in
 *  a thermal covers 700 m of track per turn while descending relative to the air — feed the path
 *  length to the quotient and it will happily report a glide ratio of 15 to a pilot who is going
 *  precisely nowhere. So: net displacement over path length. A straight glide scores 1.0; a 60°
 *  change of course across the whole window still scores ~0.95; a complete circle scores ~0. Below
 *  0.8 the glider spent a serious part of that minute turning, the height it lost belongs to the
 *  turn and not to the glide, and there is no honest number to report.
 *
 *  Cheap, pure, and it needs no turn detector — which also means it cannot fall out of step with
 *  one. */
export const STRAIGHT_MIN = 0.8;

/** A hole in the fixes longer than this breaks the window. The straight line we would otherwise
 *  draw across the gap is an ASSERTION that the glider flew straight through it — and a dropout
 *  under a wing in a steep turn is exactly when it did not. We keep only the contiguous tail after
 *  the hole, and if that tail is too short, we say nothing. */
export const MAX_GAP_S = 10;

/** How far the achieved ratio must beat (or miss) the required one before we call it. A dead band,
 *  not a decoration: the achieved number carries some 5–7 % of noise of its own, so a glide that
 *  is "making it" by 2 % is not making it by anything we can measure, and a verdict that flips
 *  between HOLDING and LOSING at 1 Hz teaches the pilot to ignore the box. Ten per cent — inside
 *  that band the honest word is MARGINAL, which is also the word a pilot would use. */
export const MARGIN_FRAC = 0.10;

/** The glide ratio the geometry REQUIRES, over the ground: distance, divided by the height we are
 *  allowed to spend getting there.
 *
 *  The reserve comes out of the height BEFORE the division, and this is the whole reason the
 *  reserve exists: 10 km with 1000 m in hand needs a ground finesse of 10, but 10 km with 1000 m
 *  of which 300 m is a reserve you have promised yourself needs 14.3. The second number is the one
 *  that has to be flown. A reserve subtracted after the division would be no reserve at all.
 *
 *  There is no polar in this function and no wind and no MacCready — that omission is the feature.
 *  It is a statement about the map, and it is the only number on the final-glide screen that
 *  cannot be wrong because a model was wrong. */
export function requiredGlide(
  distanceM: number, altM: number, goalElevM: number, reserveM = 0,
): number | null {
  if (!Number.isFinite(distanceM) || !Number.isFinite(altM)
    || !Number.isFinite(goalElevM) || !Number.isFinite(reserveM)) return null;
  // Standing on the goal: the required finesse is 0/0. Not "zero", which would read as "you need
  // no glide ratio at all" and is the one message this box must never show to a pilot who is in
  // fact still 40 km out with a broken distance calculation behind him.
  if (distanceM <= 0) return null;
  const spendableM = altM - goalElevM - reserveM;
  // The goal is at or above us once the reserve is honoured. NO finite glide ratio reaches it —
  // and the honest way to say "no glide ratio suffices" is not to print a very large one, nor a
  // negative one (a negative finesse is not a finesse), but to print nothing. The pilot is
  // climbing or landing somewhere else, and the box must not pretend to be part of that decision.
  if (spendableM <= 0) return null;
  return distanceM / spendableM;
}

/** The glide ratio the glider ACHIEVED over the window, with the evidence that produced it — the
 *  numbers are carried out so the shell can show WHY, and so a suspicious pilot can check us. */
export interface Achieved {
  /** Ground distance flown, per metre of height lost. Always > 0: the window climbed, or it did
   *  not answer at all. */
  ld: number;
  distanceM: number;
  heightLostM: number;
  /** Seconds of flight actually behind the number. Less than WINDOW_S after a dropout or a
   *  restart, never less than MIN_SPAN_S. */
  spanS: number;
}

/** The achieved ground glide ratio over the last WINDOW_S seconds of `samples` (oldest first, the
 *  last one being NOW). Null whenever the window cannot honestly answer — see the constants above
 *  for each refusal, and the tests for what each one is protecting the pilot from.
 *
 *  Pure over an array the caller owns. `glideWindow()` below is the same thing with the ring
 *  buffer attached, for a shell that just wants to push fixes at it. */
export function achievedGlide(samples: readonly GlideSample[], windowS = WINDOW_S): Achieved | null {
  if (samples.length < 2) return null;
  const now = samples[samples.length - 1];
  if (!finite(now)) return null;

  // Walk BACKWARDS from now. Backwards, because the window is anchored at the present and every
  // reason to stop — too old, a hole in the fixes, a sample out of order — is a reason to keep
  // the tail and throw the past away, never the other way round.
  const tail: GlideSample[] = [now];
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i];
    const next = tail[tail.length - 1];
    if (!finite(s)) break;
    // Time not strictly increasing: a duplicate fix, or a replay that seeked, or midnight. We
    // cannot glue two pieces of time together and call the join a glide.
    if (s.sod >= next.sod) break;
    if (next.sod - s.sod > MAX_GAP_S) break;         // a hole: keep only what is after it
    if (now.sod - s.sod > windowS) break;            // older than the window: it is history
    tail.push(s);
  }
  if (tail.length < 2) return null;
  const first = tail[tail.length - 1];

  const spanS = now.sod - first.sod;
  if (spanS < MIN_SPAN_S) return null;

  // Height lost. This is where the climbing glider is refused: a NEGATIVE glide ratio is not a
  // glide ratio, it is a category error, and −38 next to a required 38 is the kind of thing a
  // pilot reads as "38" in half a second under load.
  const heightLostM = first.altM - now.altM;
  if (heightLostM < MIN_LOSS_M) return null;

  let pathM = 0;
  for (let i = tail.length - 1; i > 0; i--) {
    const a = tail[i], b = tail[i - 1];
    pathM += distM(a.lon, a.lat, b.lon, b.lat);
  }
  // No ground covered at all while losing height. Physically that is a glider descending on the
  // spot; in practice it is a frozen GPS still emitting the last position, and a confident 0.0
  // beside a required 38 would be an alarm about the wrong thing entirely.
  if (pathM <= 0) return null;

  // THE CIRCLING GUARD (STRAIGHT_MIN). Without it this function reports a fine glide ratio to a
  // glider turning in a thermal, which is the single most common way a live L/D box lies.
  const netM = distM(first.lon, first.lat, now.lon, now.lat);
  if (netM / pathM < STRAIGHT_MIN) return null;

  return { ld: pathM / heightLostM, distanceM: pathM, heightLostM, spanS };
}

const finite = (s: GlideSample): boolean =>
  Number.isFinite(s.sod) && Number.isFinite(s.lon) && Number.isFinite(s.lat) && Number.isFinite(s.altM);

/** HOLDING — achieved beats required by more than the dead band: the glide is being flown.
 *  MARGINAL — inside the dead band: it is neither, and saying so is the honest answer.
 *  LOSING  — achieved falls short by more than the dead band: this glide does not arrive. */
export type GlideVerdict = 'holding' | 'marginal' | 'losing';

export interface GlideCompare {
  requiredLD: number | null;
  achievedLD: number | null;
  /** (achieved − required) / required. Negative = short. Null unless BOTH halves are known. */
  marginFrac: number | null;
  /** Null whenever either half is unknown — and null is the point. The most dangerous thing this
   *  module could do is answer HOLDING because it had nothing to compare against. */
  verdict: GlideVerdict | null;
}

/** The comparison, made honestly.
 *
 *  Honestly means: it refuses to have an opinion unless it has both numbers. There is no fallback
 *  to the polar, no assumption that the last known achieved ratio still holds, no "probably fine".
 *  A glider circling under a cloud has no achieved ratio (see the circling guard) and therefore no
 *  verdict, and the box says "—" until it rolls out and flies straight for half a minute. That is
 *  correct: he has no glide to judge yet. */
export function compareGlide(
  requiredLD: number | null, achievedLD: number | null, marginFrac = MARGIN_FRAC,
): GlideCompare {
  if (requiredLD === null || achievedLD === null || !(requiredLD > 0))
    return { requiredLD, achievedLD, marginFrac: null, verdict: null };
  const margin = (achievedLD - requiredLD) / requiredLD;
  const verdict: GlideVerdict =
    margin > marginFrac ? 'holding' : margin < -marginFrac ? 'losing' : 'marginal';
  return { requiredLD, achievedLD, marginFrac: margin, verdict };
}

/** The window with its buffer, for a shell that has fixes and no wish to keep an array.
 *
 *  Stateful, but with no clock in it: `sod` arrives with the sample. Same discipline as the
 *  gesture recogniser — a hysteresis (or a window) whose state you cannot see from a test is a
 *  hysteresis you cannot test. */
export interface GlideWindow {
  add(s: GlideSample): void;
  achieved(): Achieved | null;
  /** Throw the flight away: a new flight, a replay seek, a source change. */
  reset(): void;
}

export function glideWindow(windowS = WINDOW_S): GlideWindow {
  let buf: GlideSample[] = [];
  return {
    add(s) {
      if (!finite(s)) return;                        // a bad fix changes nothing (ACQ-005's spirit)
      const last = buf[buf.length - 1];
      // Time went backwards: the replay seeked, or the source restarted, or it is one second past
      // midnight and `sod` wrapped 86400 → 0. Any of those, joined to the buffer, produces a span
      // of minus a day and a glide ratio out of a nightmare. Forget the flight and start again —
      // thirty seconds of "—" is the correct price for not knowing what time it is.
      if (last !== undefined && s.sod <= last.sod) { buf = [s]; return; }
      buf.push(s);
      // Keep a little more than the window: `achievedGlide` does the real cutting, and a buffer
      // trimmed exactly to the window would drop the sample that defines its far edge.
      const cut = s.sod - windowS - MAX_GAP_S;
      let drop = 0;
      while (drop < buf.length && buf[drop].sod < cut) drop++;
      if (drop > 0) buf = buf.slice(drop);
    },
    achieved: () => achievedGlide(buf, windowS),
    reset() { buf = []; },
  };
}
