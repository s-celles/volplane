// ============ the task (TSK-001 …): waypoints, sectors, validation ============
// The roadmap's costliest warning lives here: sector geometry is not business logic, it is
// REGULATION — FAI rules that change, and that XCSoar and LK8000 already disagree about
// (§7bis). So the rules are a VERSIONED VALUE, not code paths: a task names the rule set it
// was built under, the validator applies exactly that one, and next year's rules arrive as
// a new entry beside this year's instead of an edit that silently re-scores old flights.
//
// Validation is a fold over fixes: a turnpoint is validated by the FIRST fix inside its
// sector, in order, and never un-validated — what happened, happened (the IGC file is the
// judge of record; this is the cockpit's live view of the same rule).

import { distM, bearingDeg } from 'soaring-core/geo';

export interface Waypoint { name: string; lon: number; lat: number }

export type Sector =
  | { kind: 'cylinder'; radiusM: number }
  | { kind: 'line'; lengthM: number }                    // start/finish: a gate crossed
  | { kind: 'faiQuadrant'; radiusM: number }             // 90°, bisected by the leg bisector
  | { kind: 'aatArea'; radiusM: number };                // AAT: a cylinder scored elsewhere

export interface TaskPoint { wp: Waypoint; sector: Sector }

export interface Task {
  /** The rule set this task is valid UNDER. Scoring the same fixes under another version is
   *  a different question with a possibly different answer — by design. */
  rules: RulesVersion;
  points: TaskPoint[];                                   // start first, finish last
}

// ---- the versioned rules ----

export interface Rules {
  /** Default sector radii (m) — what a task builder offers before the pilot edits. */
  startLineM: number;
  tpCylinderM: number;
  faiQuadrantM: number;
  finishLineM: number;
}

/** The library. One FROZEN entry per rules era; adding next year's is an ADDITION. */
export const RULES: Record<string, Rules> = {
  // FAI Sporting Code Section 3, as flown in 2024–2026 club practice: 500 m turnpoint
  // cylinders ("beer cans"), 1 km start/finish gates, 3 km FAI quadrants where used.
  'fai-2024': { startLineM: 1000, tpCylinderM: 500, faiQuadrantM: 3000, finishLineM: 1000 },
};
export type RulesVersion = keyof typeof RULES;

// ---- the geometry, per sector kind ----

/** Is this fix inside the sector at `tp`, on the leg from `prev` to `next`? The leg matters:
 *  a line stands perpendicular to the inbound course, a quadrant bisects the turn. */
export function inSector(
  tp: TaskPoint, lon: number, lat: number,
  prev: Waypoint | null, next: Waypoint | null,
): boolean {
  const d = distM(lon, lat, tp.wp.lon, tp.wp.lat);
  const s = tp.sector;
  switch (s.kind) {
    case 'cylinder':
    case 'aatArea':
      return d <= s.radiusM;
    case 'line': {
      // A gate: within half its length of the point, and on the perpendicular band — judged
      // as |along-course component| small. Without a course to stand across, refuse: a line
      // with no leg is a misbuilt task, not a giant cylinder.
      const ref = next ?? prev;
      if (!ref) return false;
      const course = bearingDeg(tp.wp.lon, tp.wp.lat, ref.lon, ref.lat);
      const brg = bearingDeg(tp.wp.lon, tp.wp.lat, lon, lat);
      const along = d * Math.cos((brg - course) * Math.PI / 180);
      const across = d * Math.sin((brg - course) * Math.PI / 180);
      return Math.abs(across) <= s.lengthM / 2 && Math.abs(along) <= s.lengthM / 4;
    }
    case 'faiQuadrant': {
      if (d > s.radiusM) return false;
      // The quadrant opens AWAY from the task: its axis is the reverse of the bisector of
      // the two legs. XCSoar and LK8000 diverge on edge cases of exactly this — which is
      // why the version tag exists.
      if (!prev || !next) return false;
      const inB = bearingDeg(tp.wp.lon, tp.wp.lat, prev.lon, prev.lat);
      const outB = bearingDeg(tp.wp.lon, tp.wp.lat, next.lon, next.lat);
      let bisector = (inB + outB) / 2;
      if (Math.abs(inB - outB) > 180) bisector += 180;  // the bisector on the short side
      const axis = bisector + 180;                      // the quadrant faces AWAY from the task
      const brg = bearingDeg(tp.wp.lon, tp.wp.lat, lon, lat);
      const off = Math.abs(((brg - axis + 540) % 360) - 180);
      return off <= 45;
    }
  }
}

// ---- the validation fold ----

export interface TaskProgress {
  /** Index of the NEXT point to validate; points.length = task complete. */
  next: number;
  /** Seconds-of-day each point validated at, by index. Never shrinks (TSK's "what
   *  happened, happened"). */
  validatedAt: (number | null)[];
}

export const freshProgress = (t: Task): TaskProgress =>
  ({ next: 0, validatedAt: t.points.map(() => null) });

/** Fold one fix in. Pure: progress in, progress out; identity when nothing validates. */
export function advance(
  t: Task, p: TaskProgress, lon: number, lat: number, sod: number,
): TaskProgress {
  if (p.next >= t.points.length) return p;
  const tp = t.points[p.next];
  const prev = p.next > 0 ? t.points[p.next - 1].wp : null;
  const next = p.next + 1 < t.points.length ? t.points[p.next + 1].wp : null;
  if (!inSector(tp, lon, lat, prev, next)) return p;
  const validatedAt = p.validatedAt.slice();
  validatedAt[p.next] = sod;
  return { next: p.next + 1, validatedAt };
}

/** Build a task from waypoints under a named rules version: line-start, cylinders between,
 *  line-finish — the club default. The builder is a convenience; the RULES entry is the law. */
export function simpleTask(wps: Waypoint[], rules: RulesVersion = 'fai-2024'): Task {
  const r = RULES[rules];
  return {
    rules,
    points: wps.map((wp, i) => ({
      wp,
      sector: i === 0 ? { kind: 'line', lengthM: r.startLineM }
        : i === wps.length - 1 ? { kind: 'line', lengthM: r.finishLineM }
        : { kind: 'cylinder', radiusM: r.tpCylinderM },
    })),
  };
}
