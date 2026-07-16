// ============ the MacCready the day is actually giving (PLA-008) ============
//
// MacCready is not a taste, it is a PREDICTION: the setting that flies the day optimally is the
// climb rate of the NEXT thermal. Nobody can measure the next thermal, so every pilot does the
// same thing — he remembers the last few, and he guesses. And he guesses badly, in a way that is
// well documented and always in the same direction: he remembers the good ones. The 4 m/s core he
// centred perfectly at 13:40 is a memory; the two 1.2 m/s scratches that got him there are not.
// So the MC knob drifts up, he flies too fast between climbs, and he arrives lower than he
// planned — the expensive half of being wrong, because the cheap half is only losing a few
// minutes.
//
// This module does the remembering for him, out of climbs he has ALREADY FLOWN. It is the same
// arithmetic the pilot does in his head, done honestly.
//
// ---- IT PROPOSES. IT DOES NOT SET. ----
//
// There is no setter here and there must never be one. A MacCready that moves by itself is an
// instrument whose speed-to-fly needle, final-glide arrow and arrival height all changed while the
// pilot was looking out of the canopy, for a reason he never saw. The number he flies is the number
// he chose. What this file may do is put a second number next to it and let him look at it.
// `mcWorthShowing` is the whole of the module's authority: it says "this is far enough from what
// you have set to be worth your glance", and even that only nudges the SHELL, never the setting.
//
// ---- what a value means here ----
//
// m/s, positive up, exactly like the vario and like `glide.speedToFly(pl, mc)`. Null means we do
// not have an opinion — never 0, which is a real MacCready setting (fly best glide, the day is
// finished) and would be read as one.

import { GAP, MIN_STRENGTH } from 'soaring-core/airmass';

/** A climb the glider has finished and left. Structurally what `circling.lastThermal()` hands
 *  back (`ClimbAvg`), deliberately narrowed to the two fields the estimate needs: we do not want a
 *  second module claiming to know what a gain in metres is worth. */
export interface Climb {
  /** The climb's mean rate, m/s. The kernel's `strength`: net gain ÷ duration. */
  avgMs: number;
  /** Seconds since midnight at which the climb ENDED. Ordering and forgetting both key on this. */
  endSod: number;
}

/** What we are prepared to say, and what it rests on. The `fromClimbs` and `spanS` are not
 *  decoration: a pilot shown "MC 2.4" with no idea whether it came from three climbs in the last
 *  twenty minutes or from three climbs he flew before lunch cannot judge whether to believe it,
 *  and an unbelievable suggestion is worse than none — he learns to ignore the field. */
export interface McProposal {
  /** m/s, on the pilot's own 0.1 knob. Always > 0: a proposal of exactly zero would be this file
   *  saying "the day is dead" on the strength of climbs it just measured as alive. */
  mcMs: number;
  /** How many climbs went into the median. Between MIN_CLIMBS and MAX_CLIMBS. */
  fromClimbs: number;
  /** Seconds from the end of the OLDEST climb used to `nowSod`: how stale the evidence is. */
  spanS: number;
}

/** HOW MANY CLIMBS — the working memory.
 *
 *  Five. A climb-glide cycle on a cross-country day runs ten to fifteen minutes, so five climbs is
 *  roughly the last hour of flying, which is roughly the timescale on which a soaring day changes
 *  its mind: the convection deepens through the middle of the day and collapses in the evening,
 *  and neither happens climb-to-climb.
 *
 *  Fewer (three) and the number lurches every time he leaves a thermal — an instrument that jumps
 *  is an instrument nobody trusts. More (ten) and the morning is still voting at four in the
 *  afternoon, which is precisely the error we exist to remove. */
export const MAX_CLIMBS = 5;

/** AND THE OLD ONES ARE FORGOTTEN OUTRIGHT, count or no count.
 *
 *  The count cap alone is not enough, because it has no clock: a pilot who found four good climbs
 *  in the morning and has then scratched along a ridge for an hour without a single one would
 *  still be offered the morning's MC — confidently, in measured styling — at the exact moment the
 *  day has stopped working under him. That is the failure mode that hurts, so it gets its own
 *  rule: a climb older than an hour has no vote, and when they have ALL aged out we say null and
 *  the box goes to "—". Not knowing is a state a pilot can act on. */
export const HORIZON_S = 3600;

/** BELOW THIS WE DO NOT HAVE AN OPINION.
 *
 *  Three, because a median of two IS a mean and one lucky core moves it by half of its own excess
 *  — the exact bias this file was written to defeat. And because one climb is not a day: the first
 *  thermal after a launch is very often the worst one you will find, and a computer that turned it
 *  into an MC would be teaching the pilot to fly the day he has already left. */
export const MIN_CLIMBS = 3;

/** The pilot's knob has one decimal. Proposing 2.4713 m/s claims a precision that four thermals
 *  cannot possibly support, and false precision is how a suggestion earns undeserved authority. */
export const ROUND_MS = 0.1;

/** How far the proposal must sit from the setting before it is worth the pilot's glance.
 *
 *  Half a metre per second. Below that the difference is not worth a look — flying 0.2 m/s off the
 *  optimal MC costs a fraction of a percent on task speed, while a field that lights up every time
 *  a thermal ends is a field the pilot's eye learns to skip, and then it is not there on the day
 *  the number really has moved. */
export const NUDGE_MS = 0.5;

/** Is this climb evidence at all? Not a taste test — a guard on the arithmetic.
 *
 *  MIN_STRENGTH is the kernel's own floor for calling something a climb, imported rather than
 *  re-typed so that the day airmass retunes it, this file moves with it instead of quietly
 *  disagreeing with the lift map. A "climb" below it is a bit of buoyant air the glider fell
 *  through slightly slower than usual, and it says nothing about what the next thermal will give.
 *  Non-finite gets the same treatment, because one NaN in the list poisons the sort and every
 *  number downstream of it. */
function usable(c: Climb): boolean {
  return Number.isFinite(c.avgMs) && Number.isFinite(c.endSod) && c.avgMs >= MIN_STRENGTH;
}

/** THE MEDIAN, NOT THE MEAN, AND THIS IS THE DECISION THE FILE TURNS ON.
 *
 *  One 6 m/s climb under a decaying cu-nim among four honest 1.5s makes a mean of 2.4 — an MC the
 *  day cannot support, held for the next hour, flown at a speed that costs height on every glide.
 *  The median says 1.5 and shrugs at the outlier, which is what the pilot's own judgement does
 *  when he says "yes, but that one doesn't count".
 *
 *  The classical MacCready result does want the EXPECTED climb, and for a symmetric distribution
 *  the mean is that. Climb rates are not symmetric — they are a short tail of duds and a long tail
 *  of monsters — and the cost of being wrong is not symmetric either: too high an MC has you
 *  arriving low, low on options and eventually in a field, while too low an MC costs minutes. Given
 *  a skewed variable and an asymmetric loss, the robust centre is the right answer and the mean is
 *  the seductive one.
 *
 *  Unweighted, on purpose: weighting by duration would let one long strong climb dominate the
 *  sample, which is the outlier problem let back in through the window we just shut. */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The proposal, from a list of finished climbs and the present time (PLA-008).
 *
 *  Pure, and the clock is an ARGUMENT: an estimator that reads Date.now cannot be shown a morning
 *  that goes quiet, which is the one behaviour we most need to be sure of.
 *
 *  Null — never 0, never a plausible-looking number — whenever the evidence is not there: no
 *  climbs, too few, or all of them older than the horizon. */
export function proposeMc(climbs: readonly Climb[], nowSod: number): McProposal | null {
  if (!Number.isFinite(nowSod)) return null;
  const fresh = climbs
    .filter(usable)
    // Climbs from the FUTURE are not evidence, they are a broken clock — a replayed log left in
    // the list while the instrument runs live, say. Nothing good comes of averaging across two
    // different flights, so the ones we cannot place in time simply do not vote.
    .filter(c => c.endSod <= nowSod && nowSod - c.endSod <= HORIZON_S)
    .sort((a, b) => b.endSod - a.endSod)
    .slice(0, MAX_CLIMBS);

  if (fresh.length < MIN_CLIMBS) return null;

  const mcMs = Math.round(median(fresh.map(c => c.avgMs)) / ROUND_MS) * ROUND_MS;
  return {
    // Rounding cannot reach zero (every voter is ≥ MIN_STRENGTH = 0.3), but the floating-point
    // multiplication above can leave 1.7000000000000002 behind, and a box reading "1.7000000000000002"
    // is a box the pilot stops believing. One decimal in, one decimal out.
    mcMs: Math.round(mcMs * 10) / 10,
    fromClimbs: fresh.length,
    spanS: nowSod - fresh[fresh.length - 1].endSod,
  };
}

/** Is the proposal far enough from what the pilot has SET to be worth telling him about?
 *
 *  This is the module's entire authority over the cockpit, and it is advisory: it says "worth a
 *  glance", the shell decides what a glance looks like, and the pilot decides whether to turn the
 *  knob. A `current` of null (no MC chosen yet) is worth showing by definition — there is nothing
 *  for the suggestion to be redundant with. */
export function mcWorthShowing(currentMs: number | null, p: McProposal | null): boolean {
  if (p === null) return false;
  if (currentMs === null || !Number.isFinite(currentMs)) return true;
  return Math.abs(p.mcMs - currentMs) >= NUDGE_MS;
}

export interface AutoMc {
  /** Offer a finished climb. Idempotent on purpose — see below. */
  add(c: Climb): void;
  /** The proposal as of `nowSod`, or null. */
  propose(nowSod: number): McProposal | null;
  /** What the estimate currently rests on, newest last. For tests and for a debug panel. */
  climbs(): readonly Climb[];
}

/** As many climbs as we retain before trimming. MAX_CLIMBS would be too tight: `propose` drops
 *  climbs from the future and beyond the horizon, so the raw list must be able to hold a few that
 *  are not currently voting without evicting ones that are. */
const KEEP = 16;

/** The accumulator the flight loop feeds.
 *
 *  It exists because of how `circling.lastThermal()` behaves: it returns THE SAME climb on every
 *  fix, for as long as that climb is the last one — for twenty minutes of glide, at 1 Hz, that is
 *  twelve hundred offers of one thermal. A shell pushing them naively into a list would build a
 *  history in which the last climb has voted a thousand times and the median is simply the last
 *  climb. So `add` is idempotent by identity of the CLIMB, not of the call.
 *
 *  Identity is `endSod` within GAP, which is the same tolerance circling itself uses to tell a NEW
 *  climb from a climb it is RE-detecting after its ring scrolled. The re-detection carries a
 *  slightly different average (its start has been trimmed away, so it looks shorter and weaker);
 *  taking the freshest record for a climb we already hold means we track whatever circling now
 *  believes, and never count one thermal twice. */
export function autoMcTracker(): AutoMc {
  const climbs: Climb[] = [];

  return {
    add(c) {
      if (!usable(c)) return;
      const last = climbs.length ? climbs[climbs.length - 1] : null;
      if (last) {
        // The clock ran BACKWARDS: this is not a late fix, it is a DIFFERENT FLIGHT. Replay an
        // afternoon log (sod ≈ 50000), then plug into the instrument next morning (sod ≈ 32000),
        // and without this the pilot is offered yesterday's MacCready — in confident, measured
        // styling — for his first climb of the day. The same reset circling.ts makes, for the same
        // reason, and it must be made here too: this list outlives circling's ring by design.
        if (c.endSod < last.endSod - GAP) climbs.length = 0;
        else if (c.endSod <= last.endSod + GAP) { climbs[climbs.length - 1] = c; return; }
      }
      climbs.push(c);
      while (climbs.length > KEEP) climbs.shift();
    },
    propose: now => proposeMc(climbs, now),
    climbs: () => climbs,
  };
}
