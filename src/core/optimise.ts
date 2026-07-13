// ============ scoring the flight (CNC-001, CNC-002, CNC-003) ============
// What was that flight worth? Two questions, really: the furthest free distance through a
// handful of turnpoints (OLC classic), and the biggest FAI triangle whose shape the rules
// actually allow.
//
// The same lesson task.ts learned applies here, and harder: a scoring formula is REGULATION,
// not arithmetic. OLC and the FAI have changed their rules before and will again, and two
// programs that "both score OLC" already disagree. So the barèmes are a VERSIONED VALUE:
// a result names the rule set it was computed under, and next season's rules arrive as a new
// entry beside this one — never as an edit that silently re-scores last year's flights.
//
// And the honest ceiling, stated once: this is the COCKPIT's estimate, computed on a decimated
// track so it can run while flying. The IGC file, scored by the league's own software, is the
// judge of record. Saying so is not modesty — it is the difference between a useful in-flight
// number and a claim that will be contradicted by the only scorer that counts.

import { distM } from 'soaring-core/geo';
import type { TrackPoint } from 'soaring-core/types';

// ---- the versioned barèmes ----

export interface ScoringRules {
  /** How many points the free-distance flight may use (OLC classic: 6, so 5 legs). */
  freePoints: number;
  /** No FAI triangle leg may be shorter than this fraction of the perimeter. 28% is the
   *  rule for triangles under 500 km; the big-triangle relaxation is a different era's
   *  entry, not a branch here. */
  faiMinLegFraction: number;
  /** Points per kilometre, per discipline — CNC-002 wants a SCORE, not only a distance. */
  freeKmPoints: number;
  faiKmPoints: number;
}

/** The library. One FROZEN entry per barème era; adding next season's is an ADDITION. */
export const SCORING: Record<string, ScoringRules> = {
  'olc-2024': {
    freePoints: 6,
    faiMinLegFraction: 0.28,
    freeKmPoints: 1.0,
    faiKmPoints: 1.4,        // the FAI triangle's classic premium over free distance
  },
};
export type ScoringVersion = keyof typeof SCORING;

// ---- the shared preparation ----

/** Thin the track to at most `n` points, keeping the first and the last. A cockpit estimate
 *  runs on a decimated track by necessity — the DP below is quadratic and the triangle search
 *  cubic — and saying which track was optimised is part of saying what the number means. */
export function decimate(pts: readonly TrackPoint[], n: number): TrackPoint[] {
  if (pts.length <= n) return [...pts];
  const out: TrackPoint[] = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round(i * (pts.length - 1) / (n - 1))]);
  return out;
}

/** The pairwise distance matrix. Computed once: the triangle search reads it O(n³) times, and
 *  recomputing the geodesy inside that loop is the difference between milliseconds and
 *  seconds. */
function distances(pts: readonly TrackPoint[]): Float64Array {
  const n = pts.length;
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = distM(pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
      d[i * n + j] = v;
      d[j * n + i] = v;
    }
  return d;
}

// ---- CNC-001/002: free distance ----

export interface FreeResult {
  rules: ScoringVersion;
  distanceM: number;
  points: number;
  /** The optimal geometry (CNC-002): the turnpoints, in order, as [lon, lat]. */
  legs: [number, number][];
}

/** The furthest distance through `freePoints` fixes taken IN ORDER — the OLC classic shape.
 *  A dynamic program: best[k][j] is the longest chain of k legs ending at fix j, so each
 *  answer is built from the one before it and the whole thing is O(legs · n²) instead of the
 *  combinatorial disaster the brute force would be. */
export function freeDistance(
  track: readonly TrackPoint[], rules: ScoringVersion = 'olc-2024', maxPts = 200,
): FreeResult | null {
  const r = SCORING[rules];
  const pts = decimate(track, maxPts);
  const n = pts.length;
  if (n < 2) return null;                       // one fix is a place, not a flight
  const d = distances(pts);
  const legs = r.freePoints - 1;

  // best[k][j] and the back-pointer that lets us rebuild the geometry CNC-002 asks for.
  let best = new Float64Array(n);               // k = 0: no legs flown, zero distance
  const from: Int32Array[] = [];
  for (let k = 1; k <= legs; k++) {
    const next = new Float64Array(n).fill(-Infinity);
    const back = new Int32Array(n).fill(-1);
    for (let j = 1; j < n; j++) {
      for (let i = 0; i < j; i++) {
        if (best[i] === -Infinity) continue;
        const cand = best[i] + d[i * n + j];
        if (cand > next[j]) { next[j] = cand; back[j] = i; }
      }
    }
    from.push(back);
    best = next;
  }

  // The best chain may use FEWER legs than the maximum — a straight out-and-back beats a
  // wandering five-legger — but the DP above forces exactly `legs`, and a repeated point
  // costs nothing (distance 0), so the maximum over j is already the honest answer.
  let endJ = 0, endD = 0;
  for (let j = 0; j < n; j++) if (best[j] > endD) { endD = best[j]; endJ = j; }
  if (!(endD > 0)) return null;

  const chain: number[] = [endJ];
  for (let k = legs - 1; k >= 0; k--) {
    const prev = from[k][chain[0]];
    if (prev < 0) break;
    chain.unshift(prev);
  }
  return {
    rules,
    distanceM: endD,
    points: (endD / 1000) * r.freeKmPoints,
    legs: chain.map(i => [pts[i][0], pts[i][1]] as [number, number]),
  };
}

// ---- CNC-001/002/003: the FAI triangle ----

export interface TriangleResult {
  rules: ScoringVersion;
  distanceM: number;
  points: number;
  /** The three turnpoints (CNC-002). */
  legs: [number, number][];
  /** CNC-003: does the shape satisfy the rules? The search only ever returns valid triangles,
   *  so this is `true` — but it is stated in the RESULT, not assumed by the reader, because a
   *  future rules era may want to offer an invalid best with its reason. */
  faiValid: boolean;
  /** The shortest leg as a fraction of the perimeter — the number the rule is about, shown
   *  so a pilot can see how close to the limit his triangle sits. */
  minLegFraction: number;
}

/** The biggest FAI-shaped triangle through three fixes taken in order. Brute force over the
 *  decimated track (O(n³), and n is small by construction), rejecting every shape the rules
 *  refuse — CNC-003's check is not a post-hoc verdict on one candidate, it is the constraint
 *  the search runs under, so the answer is the biggest LEGAL triangle rather than the biggest
 *  triangle with a disappointing footnote.
 *
 *  The triangle is closed through the three turnpoints themselves: a cockpit estimate, not the
 *  league's start/finish closing arithmetic. The IGC file is the judge of record. */
export function faiTriangle(
  track: readonly TrackPoint[], rules: ScoringVersion = 'olc-2024', maxPts = 120,
): TriangleResult | null {
  const r = SCORING[rules];
  const pts = decimate(track, maxPts);
  const n = pts.length;
  if (n < 3) return null;
  const d = distances(pts);

  let bestP = 0, bi = -1, bj = -1, bk = -1, bestFrac = 0;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      const a = d[i * n + j];
      for (let k = j + 1; k < n; k++) {
        const b = d[j * n + k], c = d[k * n + i];
        const per = a + b + c;
        if (per <= bestP) continue;                       // cannot win: skip the shape test
        const frac = Math.min(a, b, c) / per;
        if (frac < r.faiMinLegFraction) continue;         // CNC-003, enforced IN the search
        bestP = per; bi = i; bj = j; bk = k; bestFrac = frac;
      }
    }
  }
  if (bi < 0) return null;                                // no legal triangle in this flight
  return {
    rules,
    distanceM: bestP,
    points: (bestP / 1000) * r.faiKmPoints,
    legs: [bi, bj, bk].map(i => [pts[i][0], pts[i][1]] as [number, number]),
    faiValid: true,
    minLegFraction: bestFrac,
  };
}
