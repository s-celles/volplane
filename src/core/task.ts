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
  aatAreaM: number;
}

/** The library. One FROZEN entry per rules era; adding next year's is an ADDITION. */
export const RULES: Record<string, Rules> = {
  // FAI Sporting Code Section 3, as flown in 2024–2026 club practice: 500 m turnpoint
  // cylinders ("beer cans"), 1 km start/finish gates, 3 km FAI quadrants where used.
  //
  // aatAreaM arrived later than the four radii above, but a NEW field with a documented
  // default is an ADDITION to this entry, not an edit of what it already promised: no task
  // built before the field existed changes meaning. 20 km is the common club default for
  // an AAT area. This entry also fixes HOW areas score: 'fai-2024' scores an AAT area by
  // the greedy farthest-point rule in `advanceAat` below — a future rules era that scores
  // differently is a new entry (and a branch on `t.rules` there), never a re-score of old
  // tasks under edited maths.
  'fai-2024': {
    startLineM: 1000, tpCylinderM: 500, faiQuadrantM: 3000, finishLineM: 1000,
    aatAreaM: 20000,
  },
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

/** THE SECTOR, AS A SHAPE — the same geometry `inSector` judges by, and the map must draw.
 *
 *  Returned in METRES relative to the point: (east, north) offsets, which the painter projects. Null
 *  where the shape needs a leg it has not got — a start line with nothing to stand across is a
 *  misbuilt task, and drawing it as a giant cylinder would be the map inventing a rule.
 *
 *  ---- why this lives here, next to inSector, and not in the painter ----
 *
 *  A turnpoint is not a circle. It is a cylinder, or a GATE crossed perpendicular to the course, or a
 *  ninety-degree FAI QUADRANT that opens AWAY from the task. A pilot shown a circle where the rules
 *  put a quadrant will fly to a place that looks valid on his screen and validates nothing — and he
 *  will find out at the scoring desk.
 *
 *  So the picture and the rule must not be two descriptions of the same thing, kept in step by
 *  goodwill. They are one description, in one file, and the test below flies a point across the drawn
 *  outline and asserts that `inSector` agrees with it at every step. If the shape ever drifts from
 *  the rule, the build says so — which is the only way a pilot can trust what he is looking at. */
export function sectorOutline(
  tp: TaskPoint, prev: Waypoint | null, next: Waypoint | null,
): [number, number][] | null {
  const s = tp.sector;
  // A bearing (degrees from north, clockwise) to an (east, north) unit vector.
  const at = (brgDeg: number, r: number): [number, number] => {
    const a = brgDeg * Math.PI / 180;
    return [r * Math.sin(a), r * Math.cos(a)];
  };

  switch (s.kind) {
    case 'cylinder':
    case 'aatArea': {
      const out: [number, number][] = [];
      for (let i = 0; i < 64; i++) out.push(at(i * 360 / 64, s.radiusM));
      return out;
    }

    case 'line': {
      // inSector's gate: |across| ≤ L/2 and |along| ≤ L/4 of the course. That is a RECTANGLE, L wide
      // and L/2 deep, standing across the leg — not a line, and not a circle. It is drawn as what it
      // is, because a pilot judges his crossing by what he sees.
      const ref = next ?? prev;
      if (ref === null) return null;
      const course = bearingDeg(tp.wp.lon, tp.wp.lat, ref.lon, ref.lat);
      const half = s.lengthM / 2, deep = s.lengthM / 4;
      const across = at(course + 90, 1), along = at(course, 1);
      const corner = (a: number, l: number): [number, number] =>
        [across[0] * a + along[0] * l, across[1] * a + along[1] * l];
      return [corner(-half, -deep), corner(half, -deep), corner(half, deep), corner(-half, deep)];
    }

    case 'faiQuadrant': {
      // The axis inSector uses, verbatim: the bisector of the two legs, turned 180° so the quadrant
      // opens AWAY from the task. Copying the arithmetic would be two rules; this IS the arithmetic.
      if (prev === null || next === null) return null;
      const inB = bearingDeg(tp.wp.lon, tp.wp.lat, prev.lon, prev.lat);
      const outB = bearingDeg(tp.wp.lon, tp.wp.lat, next.lon, next.lat);
      let bisector = (inB + outB) / 2;
      if (Math.abs(inB - outB) > 180) bisector += 180;
      const axis = bisector + 180;

      const out: [number, number][] = [[0, 0]];
      for (let i = 0; i <= 24; i++) out.push(at(axis - 45 + i * 90 / 24, s.radiusM));
      return out;
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

// ---- AAT scoring (TSK-003 / TSK-006) ----
// In an Assigned Area Task the turnpoint is not a point but a region, and the pilot's score
// is the distance actually achieved through it. The IGC file is the judge of record; this is
// the cockpit's live estimate of the same rule, and it obeys the same discipline as
// validation: a fold over fixes, best-so-far only ever improves — what happened, happened.

/** Per task-point index: the best scoring fix found inside that aatArea so far. null for
 *  non-AAT points and for areas not yet entered — an entered area always holds a real fix,
 *  because the fix that validated it is itself the first candidate. */
export type AatProgress = ({ lon: number; lat: number } | null)[];

export const freshAat = (t: Task): AatProgress => t.points.map(() => null);

/** Where task point `i` scores from: an AAT area at its best fix (its centre only while it
 *  holds none), everything else at its waypoint. */
function scoringPoint(t: Task, a: AatProgress, i: number): { lon: number; lat: number } {
  const tp = t.points[i];
  return tp.sector.kind === 'aatArea' ? a[i] ?? tp.wp : tp.wp;
}

/** On a dead-straight leg the flat-earth sums below tie to within float noise for every
 *  depth into the area, so a strict comparison would freeze the score at the entry fix.
 *  Sums within a metre — far below GPS truth — are treated as tied, and the tie goes to
 *  the fix with more distance BEHIND the pilot: flown distance is fact, remaining is plan. */
const AAT_TIE_M = 1;

/** Fold one fix into the AAT bests. Pure: identity (the same array) when nothing improves.
 *  Run AFTER `advance` on the same fix — a fix only scores an area the task order has
 *  reached, so entry itself plants the first best.
 *
 *  The rule, per 'fai-2024': a candidate replaces the current best when it increases
 *  distM(prevScoring, fix) + distM(fix, nextCentre) — greedy per area, holding the
 *  neighbours still. That is an APPROXIMATION of the optimal dynamic program over all
 *  areas jointly: indicative for the cockpit, and the IGC file remains the judge of
 *  record. */
export function advanceAat(
  t: Task, p: TaskProgress, a: AatProgress, lon: number, lat: number,
): AatProgress {
  let out = a;
  for (let i = 0; i < t.points.length; i++) {
    const tp = t.points[i];
    if (tp.sector.kind !== 'aatArea') continue;
    if (p.validatedAt[i] == null) continue;              // task order has not reached it
    // An area needs a previous scoring point and a next centre to score against. An AAT
    // area first or last in the task is a misbuilt task, not a scorable one.
    if (i === 0 || i + 1 >= t.points.length) continue;
    const prevWp = t.points[i - 1].wp;
    const nextC = t.points[i + 1].wp;
    if (!inSector(tp, lon, lat, prevWp, nextC)) continue;
    const prevS = scoringPoint(t, out, i - 1);
    const flown = distM(prevS.lon, prevS.lat, lon, lat);
    const sum = flown + distM(lon, lat, nextC.lon, nextC.lat);
    const best = out[i];
    if (best) {
      const bFlown = distM(prevS.lon, prevS.lat, best.lon, best.lat);
      const bSum = bFlown + distM(best.lon, best.lat, nextC.lon, nextC.lat);
      const gain = sum - bSum;
      if (!(gain > AAT_TIE_M || (gain > -AAT_TIE_M && flown > bFlown))) continue;
    }
    if (out === a) out = a.slice();                      // copy-on-write, once
    out[i] = { lon, lat };
  }
  return out;
}

/** The distance scored so far (m): the legs between consecutive scoring points of the
 *  points validated so far. null before the start validates — an unstarted task has NO
 *  scored distance, and null renders as a dash, never a fake zero. A freshly started task
 *  scores a real 0. For a task with no aatArea sectors this is exactly the wp-to-wp
 *  distance of the validated legs. */
export function scoredDistanceM(t: Task, p: TaskProgress, a: AatProgress): number | null {
  if (p.validatedAt[0] == null) return null;
  let sum = 0;
  for (let i = 1; i < p.next; i++) {
    const from = scoringPoint(t, a, i - 1);
    const to = scoringPoint(t, a, i);
    sum += distM(from.lon, from.lat, to.lon, to.lat);
  }
  return sum;
}

// ---- the builders ----

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

/** The AAT sibling of `simpleTask`: line-start, assigned areas between, line-finish. */
export function aatTask(wps: Waypoint[], rules: RulesVersion = 'fai-2024'): Task {
  const r = RULES[rules];
  return {
    rules,
    points: wps.map((wp, i) => ({
      wp,
      sector: i === 0 ? { kind: 'line', lengthM: r.startLineM }
        : i === wps.length - 1 ? { kind: 'line', lengthM: r.finishLineM }
        : { kind: 'aatArea', radiusM: r.aatAreaM },
    })),
  };
}
