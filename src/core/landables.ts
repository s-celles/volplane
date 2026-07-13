// ============ where you can actually land (LND-002…008) ============
// A landables layer that only draws dots is a decoration. The question a pilot asks at 1700 m
// over a valley is not "where are the fields", it is "which of them can I still HAVE" — and the
// honest answer depends on the rock in between, the wind actually blowing, and the height he
// insists on arriving with.
//
// So this module asks reach.ts that question once per field. It does not re-derive the march:
// reach.ts already walks the ground metre by metre and already knows the difference between a
// glide that ran out and a ridge that said no. Here we only choose WHICH fields to ask about,
// and then turn its three answers into the three the screen shows.
//
// The precedence in `verdict` is the safety argument of the whole file, and it is a PRECEDENCE,
// not a switch: an unmeasured answer outranks a reachable one. Everything else follows from it.
//
// C3 holds, and LND-005 is the name of the holding: the only inputs here are the measured DEM,
// the measured polar, and the wind in use. No modelled lift field — no thermal potential, no
// convergence guess — may widen a landing option, ever. A model that can only ADD options is a
// model that can only kill; landables.test.ts reads this file's own imports to prove it hasn't.

import { reachableTo, type ReachLimit, type ReachOptions } from './reach';
import { isLandable, type Poi, type PoiCat } from './cup';
import { distM, bearingDeg } from 'soaring-core/geo';
import type { ElevSampler } from 'soaring-core/ports';
import type { Polar } from 'soaring-core/polar';

/** LND-003's three answers. They are three different FACTS and must never share a colour or a
 *  sort bucket. */
export type LandState = 'reachable' | 'unreachable' | 'indeterminate';

export interface Alternate {
  point: Poi;
  state: LandState;
  /** Height in hand over the field's ground on arrival, reserve already deducted. NULL when
   *  indeterminate — never 0. A zero here would be a promise of a zero-margin arrival, which is
   *  a measurement; we have none. */
  marginM: number | null;
  distanceM: number;
  bearingDeg: number;
  /** WHY, carried through from the march. The pilot who sees 'terrain' knows a different thing
   *  from the one who sees 'glide', and both know more than the one shown only a colour. */
  limit: ReachLimit;
}

export interface AlternateOptions {
  /** How far out it is worth asking. Default 80 km — beyond a glider's best glide from any
   *  sane height, so the ceiling costs nothing a pilot would have used. */
  radiusM?: number;
  /** Arrival margin (m) — the same reserve the final glide keeps; passed straight to
   *  reachableTo as safetyM. */
  safetyM?: number;
  /** The wind IN USE (measured or estimated). FROM direction, as everywhere in this app. */
  wind?: { speed: number; direction: number } | null;
  stepM?: number;
  /** Cost ceiling: at most this many nearest fields are marched, per fix. Default 30. */
  maxFields?: number;
}

/** LND-006, as one string the UI cannot paraphrase into something softer. */
export const NONE_REACHABLE = 'NO landable field within reach';

/** Exported because the shell has to be able to SAY them. A radius and a cap the pilot cannot
 *  see are a radius and a cap that let the panel's banner speak for fields nobody marched. */
export const DEFAULT_RADIUS_M = 80_000;
export const DEFAULT_MAX_FIELDS = 30;

/** The verdict, in the order that keeps it honest.
 *
 *  Unloaded ground under a field is not flat ground. If the DEM has not answered — on the path
 *  or beneath the field itself — then we do not know how high the field's ground is, and a
 *  cheerful green over unmeasured terrain is exactly the invented promise POT-007 forbids. Here
 *  that promise is paid for at the ground, by the pilot, in the last 200 metres of a glide he
 *  should never have started. So indeterminate outranks reachable, always, and an indeterminate
 *  field is NEVER shown as reachable. */
function verdict(
  alt: number | null,
  r: { reachable: boolean; limit: ReachLimit; marginM: number | null },
): { state: LandState; marginM: number | null } {
  if (alt == null) return { state: 'indeterminate', marginM: null };
  if (r.limit === 'unknown') return { state: 'indeterminate', marginM: null };
  // A ridge in the way is a KNOWN no with no number attached to it. The field is unreachable —
  // that much was measured, and it is not a question — but "height in hand on arrival" is
  // meaningless when there is no arrival, so the margin is null and the row shows the dash. It
  // must not fall into the indeterminate case either: 'terrain' is an answer, and demoting it
  // to an unasked question would hide the mountain (LND-003, TER-005).
  if (r.limit === 'terrain') return { state: 'unreachable', marginM: null };
  // A NaN margin is an unmeasured margin wearing a number's clothes: it compares false against
  // every threshold, so it would fail OPEN. It joins the null case rather than getting its own.
  if (r.marginM == null || !Number.isFinite(r.marginM))
    return { state: 'indeterminate', marginM: null };
  if (r.reachable) return { state: 'reachable', marginM: r.marginM };
  return { state: 'unreachable', marginM: r.marginM };
}

const BUCKET: Record<LandState, number> = { reachable: 0, unreachable: 1, indeterminate: 2 };

/** reach.ts fills its own blanks with `{ ...DEFAULTS, ...o }`, and an explicit `safetyM:
 *  undefined` in that spread does not fall back to the default — it OVERWRITES it, and the
 *  arithmetic downstream comes out NaN. A NaN margin compares false against every threshold,
 *  which is to say it fails open: a field short by 400 m would sort and print as though it had
 *  been measured. So we hand reach.ts only the keys the caller actually set, and let it own its
 *  own defaults. */
function reachOpts(o: AlternateOptions, distanceM: number): ReachOptions {
  const r: ReachOptions = { wind: o.wind ?? null, maxM: Math.max(distanceM, 1) };
  if (o.safetyM != null) r.safetyM = o.safetyM;
  if (o.stepM != null) r.stepM = o.stepM;
  return r;
}

/** The candidates: every landable field inside the radius, nearest first, BEFORE the cost cap
 *  takes its slice.
 *
 *  Exported because the shell must be able to count them. `alternates` marches only the nearest
 *  `maxFields` of these, and reachability is NOT monotonic in distance — the file's own headline
 *  test is a nearer field refused for rock and a farther one reachable — so the cap can drop the
 *  only field that was makeable. That is tolerable ONLY if the number of fields nobody asked
 *  about is visible; the alternative is a "NO landable field within reach" banner speaking for
 *  fields that were never marched. Hence this function: the denominator in "30 of 52 judged".
 *
 *  LND-008 is deliberately NOT here. The pilot's style filter is a VIEW filter and it belongs in
 *  the shell: a field excluded from the judging is a field the banner would then speak for
 *  without ever having asked, which is how "I unticked outlanding fields" becomes "NO landable
 *  field within reach" with a vachable strip six kilometres away. Core judges every landable
 *  style, always; the shell hides rows and rings. */
export function landablesWithin(
  points: readonly Poi[], lon: number, lat: number, radiusM: number = DEFAULT_RADIUS_M,
): Poi[] {
  // LND-001's verdict is not ours to second-guess: landability is the ORIGIN FILE's style code,
  // read in exactly one place (soaring-core/poi). We only narrow it by radius.
  return points
    .filter(p => isLandable(p.cat))
    .map(p => ({ p, d: distM(lon, lat, p.lon, p.lat) }))
    .filter(c => c.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map(c => c.p);
}

/** Every landable worth asking about, judged and ranked (LND-002/003/004).
 *
 *  The list is deterministic on purpose: same fix, same list, same order. A list that reshuffles
 *  frame to frame under a steady glider is a list the pilot stops reading, and an alternates list
 *  nobody reads is worse than none — it occupies the screen space an honest one would have had. */
export function alternates(
  elev: ElevSampler, lon: number, lat: number, alt: number | null,
  points: readonly Poi[], polar: Polar, o: AlternateOptions = {},
): Alternate[] {
  const radiusM = o.radiusM ?? DEFAULT_RADIUS_M;
  const maxFields = o.maxFields ?? DEFAULT_MAX_FIELDS;

  // The cap is a COST bound, not a claim about the world — and because it IS a cost bound, what
  // it dropped is counted out loud by the shell (landablesWithin, above), never merely dropped.
  const near = landablesWithin(points, lon, lat, radiusM).slice(0, maxFields);

  const out: Alternate[] = [];
  for (const p of near) {
    const d = distM(lon, lat, p.lon, p.lat);
    const r = alt == null
      ? { reachable: false, limit: 'unknown' as ReachLimit, marginM: null }
      : reachableTo(elev, lon, lat, alt, { lon: p.lon, lat: p.lat }, polar, reachOpts(o, d));

    // The margin is reachableTo's, and it is measured against the DEM's ground AT the field.
    // p.elevM is a DISPLAY value (LND-007) — a number typed into a waypoint file years ago, by
    // someone we cannot ask. We print it; we never let it decide a safety verdict.
    const { state, marginM } = verdict(alt, r);
    out.push({
      point: p,
      state,
      marginM,
      distanceM: d,
      bearingDeg: bearingDeg(lon, lat, p.lon, p.lat),
      limit: r.limit,
    });
  }

  // LND-004. Reachable first, best margin at the top — the field with the most height in hand is
  // the field you want when the day falls apart. Then the unreachable, least-bad first, because
  // "short by 40 m" and "short by 1400 m" are different plans. Indeterminate last and nearest
  // first: they are not options yet, they are questions, and the nearest question is the one the
  // DEM is most likely to answer next.
  //
  // Inside the unreachable bucket the ridge-blocked fields sink to the bottom, ranked by distance
  // and by nothing else. "Least-bad" is a statement about a SHORTFALL — a height the pilot might
  // yet find in one more climb — and a mountain is not a shortfall: no thermal makes the ground
  // behind that wall reachable on this glide. Ranking a wall among the near-misses (which the old
  // free-air margin did, and it sorted FIRST) offers the one field on the list that cannot be had
  // as the closest thing to a plan.
  return out.sort((a, b) => {
    const bucket = BUCKET[a.state] - BUCKET[b.state];
    if (bucket !== 0) return bucket;
    if (a.state === 'reachable' || a.state === 'unreachable') {
      const wa = a.limit === 'terrain' ? 1 : 0, wb = b.limit === 'terrain' ? 1 : 0;
      if (wa !== wb) return wa - wb;
      if (wa === 0) {
        const ma = a.marginM ?? -Infinity, mb = b.marginM ?? -Infinity;
        if (ma !== mb) return mb - ma;
      }
    }
    if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
    return a.point.name.localeCompare(b.point.name);
  });
}

/** The fields the glider can actually have. Empty is a RESULT, not a gap: when this comes back
 *  empty the caller says NONE_REACHABLE out loud (LND-006) rather than showing a blank panel and
 *  letting the pilot read it as "nothing to worry about". */
export function reachableOnly(list: readonly Alternate[]): Alternate[] {
  return list.filter(a => a.state === 'reachable');
}
