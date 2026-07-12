// ============ the glide solver (PLA-001 … PLA-005, PLA-009) ============
// The one piece of the foundation soaring-core does not hold: MacCready. The kernel owns the
// polar — w(V) = A·V³ + B/V, fitted from three points (C4) — and this file owns what a
// flight computer asks of it: how fast to fly, and whether the glider gets there.
//
// The maths is eighty years old and fails SILENTLY when wrong (the roadmap's own warning):
// a plausible-looking speed a few km/h off, an arrival height quietly optimistic. So every
// formula here is pinned by a test against the underlying variational property, not against
// a hand-computed constant that would just encode the same mistake twice.
//
// Sign conventions, once: kernel sink w(V) is NEGATIVE; here s(V) = −w(V) > 0 is the sink
// MAGNITUDE. MacCready mc ≥ 0 (m/s). netto is the air's vertical motion, + up. Headwind is
// POSITIVE when it opposes the glider. An arrival the maths cannot promise is null — a
// glider that cannot reach the goal must hear "no", not "0 m".

import { sinkAt, type Polar } from 'soaring-core/polar';

/** Sink magnitude (m/s, > 0) at true airspeed v — the kernel's w, sign flipped. */
const s = (pl: Polar, v: number): number => -sinkAt(pl, v);

/** Speed to fly (m/s) for a MacCready setting and the air currently traversed (PLA-002).
 *  The classic tangency condition, derived by minimising the height lost per metre gained
 *  over ground in the climb-glide cycle:  minimise (s(V) + mc − netto) / V, whose stationary
 *  point satisfies  s′(V)·V = s(V) + mc − netto. With the kernel's two-term polar that is
 *      f(V) = 2a·V³ − 2b/V − (mc − netto) = 0,   a = −A, b = −B,
 *  (at mc = netto = 0 the closed form V = (b/a)^¼ falls out — best glide, the classic
 *  origin-tangent) and f is strictly increasing on V > 0 — one root, found by bisection,
 *  clamped to the polar's envelope. Rising air slows the ring down; sink speeds it up. */
export function speedToFly(pl: Polar, mc: number, netto = 0): number {
  const a = -pl.A, b = -pl.B;
  const f = (v: number): number => 2 * a * v * v * v - 2 * b / v - (mc - netto);
  if (f(pl.vMin) >= 0) return pl.vMin;         // even min speed over-flies the tangency
  if (f(pl.vMax) <= 0) return pl.vMax;         // the envelope caps what the ring asks
  let lo = pl.vMin, hi = pl.vMax;
  for (let i = 0; i < 60; i++) {               // 60 halvings: interval < 1e-15 of the span
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Ground glide ratio at speed v against a headwind (PLA-001): metres forward per metre
 *  down. Null when the wind eats the whole airspeed — a glider standing still over ground
 *  has no glide ratio, and −3 would look plausible. */
export function glideRatio(pl: Polar, v: number, headwind = 0): number | null {
  const vg = v - headwind;
  if (vg <= 0) return null;
  return vg / s(pl, v);
}

export interface Arrival {
  /** Height (m) above the goal's elevation on arrival, reserve already spent. Negative =
   *  below the goal: the glider does NOT arrive. */
  height: number;
  /** The still-air speed to fly the glide is priced at (m/s). */
  v: number;
  /** Height (m) the whole glide consumes, reserve included — what PLA-004 subtracts. */
  required: number;
}

/** Final glide (PLA-004, PLA-005, PLA-009): from `alt` (m AMSL), `dist` metres to a goal at
 *  `goalElev`, against `headwind`, at the MacCready ring's speed, keeping `reserve` metres in
 *  hand. Null when the maths cannot promise an arrival AT ALL (headwind ≥ speed to fly): an
 *  unreachable goal is unknown-shaped, not a large negative number.
 *
 *  The glide is priced in STILL air (netto 0): en-route lift is the flight's luck, not the
 *  plan's collateral. C3's line holds here too — nothing modelled (no POT field) may feed
 *  this number, ever. */
export function arrival(
  pl: Polar, mc: number, alt: number, dist: number, goalElev: number,
  headwind = 0, reserve = 0,
): Arrival | null {
  const v = speedToFly(pl, mc, 0);
  const vg = v - headwind;
  if (vg <= 0) return null;
  const required = dist * s(pl, v) / vg + reserve;
  return { height: alt - goalElev - required, v, required };
}
