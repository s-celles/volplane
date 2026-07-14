// ============ TSK-002/008/009: composing a task, and refusing to build a broken one ============
//
// Until now a task arrived by import or not at all. A pilot with a waypoint file and no CSV had no
// way to declare where he was going — which is the first thing anybody does with a flight computer.
//
// ---- what this file does NOT do, and that is the point ----
//
// It does not know what a sector is. It does not know that a start is a gate, that a turnpoint is a
// cylinder, or that the FAI quadrant opens away from the task. All of that lives in `task.ts`, in
// `simpleTask` and `inSector` and `sectorOutline`, and it is judged, drawn and validated from there.
//
// This file edits an ORDERED LIST OF WAYPOINTS. The task is DERIVED from it. That is the whole
// design: a task builder that grew its own idea of what a sector is would be a second rule book, and
// two rule books about one crossing is one too many — the map would draw one and the scorer would
// judge by the other, and the pilot would find out at the desk.

import { simpleTask, RULES, type Task, type Waypoint, type RulesVersion } from './task';
import { distM } from 'soaring-core/geo';

export type Edit = 'add' | 'remove' | 'up' | 'down';

/** The waypoints a task is made of, in order. The inverse of `withWaypoints`. */
export function taskWaypoints(t: Task | null): Waypoint[] {
  return t === null ? [] : t.points.map(p => p.wp);
}

/** The task these waypoints make — or NULL, because two points are the fewest a task can have and
 *  one point is not a shorter task, it is not a task.
 *
 *  The sectors come from `simpleTask`, which is where they are defined and where they are judged. */
export function withWaypoints(wps: readonly Waypoint[], rules: RulesVersion): Task | null {
  return wps.length >= 2 ? simpleTask([...wps], rules) : null;
}

/** One edit, applied to the ordered list. Out-of-range indices are a no-op rather than a throw: this
 *  is driven by a screen that repaints, and between the paint and the tap the list may have moved. */
export function editWaypoints(
  wps: readonly Waypoint[], act: Edit, index: number, wp?: Waypoint,
): Waypoint[] {
  const out = [...wps];
  switch (act) {
    case 'add':
      // Appended, never inserted at a guess. A pilot builds a task in the order he will fly it, and
      // a builder that silently put the point somewhere else would be deciding his route for him.
      if (wp !== undefined) out.push(wp);
      return out;
    case 'remove':
      if (index >= 0 && index < out.length) out.splice(index, 1);
      return out;
    case 'up':
      if (index > 0 && index < out.length) [out[index - 1], out[index]] = [out[index], out[index - 1]];
      return out;
    case 'down':
      if (index >= 0 && index < out.length - 1) [out[index], out[index + 1]] = [out[index + 1], out[index]];
      return out;
  }
}

/** TSK-009. What is wrong with this task, said in catalogue ids so it can be said in French.
 *
 *  Not "is it valid" — WHAT is wrong. A boolean tells a pilot his task is broken and leaves him to
 *  find out how; these say which leg, and why.
 *
 *  The zero-length leg is the one that matters. Two consecutive points at the same place is a leg
 *  with no course, and a start LINE has no course to stand across — `inSector` refuses it, correctly,
 *  and the pilot would see a gate that never opens and never know why. It is caught here, where he
 *  can still fix it, and not in the air. */
export interface Problem { id: string; index: number | null; params?: Record<string, string | number> }

/** A leg shorter than this has no meaningful course. 100 m is a hangar, not a leg. */
const MIN_LEG_M = 100;

export function taskProblems(wps: readonly Waypoint[]): Problem[] {
  const out: Problem[] = [];
  if (wps.length === 0) return out;                       // an empty list is not a broken task
  if (wps.length === 1) {
    out.push({ id: 'task.problem.tooShort', index: null });
    return out;
  }

  for (let i = 1; i < wps.length; i++) {
    const d = distM(wps[i - 1].lon, wps[i - 1].lat, wps[i].lon, wps[i].lat);
    if (d < MIN_LEG_M) {
      out.push({
        id: 'task.problem.zeroLeg', index: i,
        params: { from: wps[i - 1].name, to: wps[i].name },
      });
    }
  }
  return out;
}

/** The total distance the task asks for, in metres — the sum of its legs. Null when there is no task
 *  to measure. It is not the SCORED distance (that is `scoredDistanceM`, and for an AAT they are not
 *  the same number): it is the length of the line the pilot drew, which is what he wants to see while
 *  he is drawing it. */
export function taskLengthM(wps: readonly Waypoint[]): number | null {
  if (wps.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < wps.length; i++) {
    sum += distM(wps[i - 1].lon, wps[i - 1].lat, wps[i].lon, wps[i].lat);
  }
  return sum;
}

/** The rule sets a pilot may declare under. Taken from RULES, never spelled again here: the day the
 *  kernel learns fai-2026, the picker offers it. */
export const RULE_VERSIONS = Object.keys(RULES) as RulesVersion[];
