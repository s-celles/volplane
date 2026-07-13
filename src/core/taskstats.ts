// ============ what the task still OWES (TSK-007, and TSK-006's clock) ============
// task.ts answers the question the scorer asks: what has been achieved, what happened, what is
// signed for. This file answers the question the PILOT asks, which is the opposite one — what
// is LEFT. How far to the finish from here, how long that will take at the speed I have
// actually been making, and (on an AAT) whether I am going to come home early or late against
// the minimum time.
//
// Everything here is derived. Nothing here validates, nothing here scores: the fold in task.ts
// remains the only place a turnpoint can be signed off, and `scoredDistanceM` remains the only
// place distance is credited. If this file re-scored, there would be two scorers in the
// codebase and only one of them would be the judge of record.
//
// The discipline is POT-007's, and it costs something. A speed on task before the start is not
// zero — it does not EXIST, and a 0.0 in that box would read as "you are going nowhere" when
// the truth is "the question has not started being asked". An ETA priced at a speed of zero is
// not an infinite time, it is no time at all. Five of the six fields below are null until the
// start validates, and they are null again whenever the arithmetic would have to invent a
// denominator.
//
// The exception, deliberately: `remainingM`. It is pure geometry — the distance from where the
// glider IS, through every point it has not yet rounded, to the finish — and that is a live
// fact from the very first fix, before the start gate is crossed and while the pilot is still
// deciding whether to go. A dash there would hide a number we genuinely have. So: remaining
// distance is measured from the first fix; the five TIME-derived figures wait for the start.

import { distM } from 'soaring-core/geo';
// The scorer is BORROWED, never re-implemented: `scoredDistanceM` is the one place distance is
// credited, and the achieved speed below divides exactly its number by exactly its clock.
import { scoredDistanceM, type Task, type TaskProgress, type AatProgress } from './task';

export interface TaskStats {
  /** m from the CURRENT position to the finish, through every point not yet validated.
   *  Null without a fix, or with no task. Zero once the finish validates — that is a fact, not
   *  a dash: there is nothing left to fly. */
  remainingM: number | null;
  /** m/s achieved on task: the distance the scorer credits, over the time it took. Null before
   *  the start validates, and null while the elapsed time is not positive — never 0.0 as a
   *  stand-in for a speed nobody can compute yet. */
  achievedMs: number | null;
  /** s still to fly, priced at the ACHIEVED speed — TSK-007's "temps estimé". Not a prediction
   *  of the weather: a statement that if the rest of the task goes like the part already flown,
   *  it takes this long. Null when there is no achieved speed yet, or it is not positive: a
   *  glider that has gone nowhere has no ETA, and 1/0 is not an answer. */
  etaS: number | null;
  /** s of task flown so far. Null before the start — the clock starts at the gate. */
  elapsedS: number | null;
  /** AAT only (TSK-006). (elapsedS + etaS) − minTaskTimeS: POSITIVE means the task, flown on at
   *  the current speed, will run LONG — the pilot is not short of time and can extend into the
   *  areas. Negative means he will come home EARLY, and on an AAT that is distance thrown away.
   *  Null on a task with no aatArea sector, with no minimum time given, before the start, or
   *  whenever there is no ETA to add. */
  overUnderS: number | null;
  /** TSK-007's other half, on EVERY task: the speed that lands exactly on the task time —
   *  remaining distance over the time still available. "Vitesse sur tâche réalisée ET REQUISE" is
   *  a Must and it is not qualified by task type; a racing pilot asks "am I fast enough to get
   *  home in the time I have" as often as an AAT pilot does, and used to be shown nothing at all.
   *  It needs a time target, which only the organisers know: null when none was given (the ribbon
   *  then dashes, which is the app admitting it was not told), and null with the time already run
   *  out — the speed needed to cover ground in zero seconds is not a number to put in front of a
   *  pilot, and Infinity rendered as "Inf km/h" is worse than a dash. */
  requiredMs: number | null;
}

/** An AAT is a task with at least one assigned AREA. It is what makes the over/under figure mean
 *  something: only on an AAT is coming home early a way of throwing distance away, because only
 *  there can the pilot spend the spare time by flying deeper into the areas. */
export function isAat(t: Task): boolean {
  return t.points.some(tp => tp.sector.kind === 'aatArea');
}

/** Where a point NOT yet reached sits, for the purpose of measuring what is left.
 *
 *  For a cylinder, a line or an FAI quadrant this is exact enough to argue about: the pilot
 *  will pass within a sector radius of the centre and the centre is what the scorer uses.
 *
 *  For an aatArea it is an APPROXIMATION and must be read as one — the true remaining distance
 *  through an area depends on the target chosen INSIDE it, which is TSK-006's optimiser and is
 *  out of scope here. Taking the area centre understates a task flown deep into the areas and
 *  overstates one cut short. It is honest about direction and about magnitude, and it is not a
 *  scoring claim: `scoredDistanceM` in task.ts, which IS one, never looks at this function. */
function targetOf(t: Task, i: number): { lon: number; lat: number } {
  return t.points[i].wp;
}

export function taskStats(
  t: Task,
  p: TaskProgress,
  a: AatProgress,
  at: { lon: number; lat: number; sod: number } | null,
  o?: { minTaskTimeS?: number | null },
): TaskStats {
  const none: TaskStats = {
    remainingM: null, achievedMs: null, etaS: null, elapsedS: null,
    overUnderS: null, requiredMs: null,
  };
  if (!at || t.points.length === 0) return none;

  const done = p.next >= t.points.length;

  // What is left, geometrically: the run-in to the next point, then every leg beyond it. Once
  // the finish is signed there is no run-in and no legs — the sum is a real, earned zero.
  let remainingM = 0;
  if (!done) {
    const first = targetOf(t, p.next);
    remainingM = distM(at.lon, at.lat, first.lon, first.lat);
    for (let i = p.next + 1; i < t.points.length; i++) {
      const from = targetOf(t, i - 1);
      const to = targetOf(t, i);
      remainingM += distM(from.lon, from.lat, to.lon, to.lat);
    }
  }

  const startedAt = p.validatedAt[0];
  if (startedAt == null) return { ...none, remainingM };   // the clock has not started

  const elapsedS = at.sod - startedAt;
  const scored = scoredDistanceM(t, p, a);
  const achievedMs = scored != null && elapsedS > 0 ? scored / elapsedS : null;

  // A finished task has nothing left to fly, and that is 0 seconds — not "unknown", and not a
  // number priced at a speed. Otherwise the ETA exists only if a positive speed exists to price
  // it at.
  const etaS = done ? 0
    : achievedMs != null && achievedMs > 0 ? remainingM / achievedMs
    : null;

  // The task time is the ORGANISERS' number and it belongs to whatever task they set — a racing
  // task carries one as readily as an AAT. It used to be discarded for anything but an AAT, which
  // silently threw away the figure the pilot had typed into the settings box and left TSK-007's
  // "required" half unanswerable on the commonest task there is.
  const minT = o?.minTaskTimeS ?? null;
  const timeLeftS = minT == null ? null : minT - elapsedS;
  const requiredMs = timeLeftS != null && timeLeftS > 0 ? remainingM / timeLeftS : null;
  // The over/under, though, stays an AAT figure: it is only on an AAT that finishing early is a
  // mistake to be corrected — by flying deeper into the areas — rather than simply a good day.
  const overUnderS = isAat(t) && minT != null && etaS != null ? elapsedS + etaS - minT : null;

  return { remainingM, achievedMs, etaS, elapsedS, overUnderS, requiredMs };
}
