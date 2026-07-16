// ============ TSK-011: finding the place you are going to ============
//
// Until now the goal of this flight computer was, literally, HERE. `fly.goalHere` takes the current
// position and the ground under it and calls that the final glide's destination — which computes an
// arrival height of roughly zero, at the point you are already standing on. It is the one control in
// the app that is honest about nothing: there was no way to say "Saint-Auban", so the app said "you".
//
// The point base has been here the whole time — `cup.ts` reads the .cup and the WinPilot files,
// `landables.ts` judges the fields, `landmarks.ts` holds the summits. What was missing was the
// question: WHICH ONE.
//
// ---- what a good answer is, for the pilot who is actually asking ----
//
// He is asking in one of two situations, and they are not the same question:
//
//   ON THE GROUND, briefing, no GPS lock yet. He types a name he already knows. He wants that place,
//   and he wants the list to work with no fix at all — a search that goes blank until the receiver
//   has locked is a search he will never use, because he sets his goal before he starts the engine.
//
//   IN THE AIR, being thrown about, one hand on the stick. He types three or four letters and looks
//   OUT again. He gets ONE glance at the result. So:
//
//     · the letters he types are the ones on his fingers, not the ones in the file. "leocadie" must
//       find "Sainte-Léocadie" — an accent he cannot type on a bumpy day is a place he cannot reach.
//     · what he types is usually the START of something: "LFN…", "saint…", "aub…". So a PREFIX match
//       stands above a match buried in the middle of a word — "Saint-Auban" before "Le Saintois",
//       always. He is completing a word, not grepping a database.
//     · among matches that are equally good, the NEAR one is the one he means. There are four
//       Saint-Somethings in France and he is going to the one he can see.
//     · and the list is SHORT. Forty rows is not an answer; it is a second search, run in a cockpit.
//       MAX_RESULTS is the whole reason the ranking above has to be right — the ranking is what
//       decides which eight survive.
//
// ---- what it refuses ----
//
// A query that matches nothing returns NOTHING. It does not quietly fall back to the nearest fields:
// a pilot who typed "LFNS" and was handed the strip 4 km away, in a list he glanced at, would fly to
// the strip. An empty list says "I do not have that" and costs him a retype; a helpful list says
// "here is somewhere else" in a voice that sounds exactly like the answer he asked for.
//
// And there is no fabricated distance anywhere. With no fix, `distanceM` is null — never 0, which
// would sort every place in the world to the top of a "nearest" list as though it were under the
// wing.
//
// Pure: no clock, no DOM, no files. The position is an argument.

import { distM, bearingDeg } from 'soaring-core/geo';
import type { Poi } from './cup';

/** Where the glider is. Null when there is no fix yet — which is the NORMAL case for this module:
 *  most goals are chosen in the clubhouse. */
export interface Origin { lon: number; lat: number }

/** WHY this row is on the screen. Exported because the shell may show it (a code hit and a
 *  buried-substring hit are different levels of confidence, and the pilot deserves to see which he
 *  has), but above all because it is the RANK, and the rank is what this file is for. */
export type MatchKind =
  /** He typed the whole code: "LFNS". There is no ambiguity left to resolve — not by distance, not
   *  by anything. This is the answer even if it is 600 km away. */
  | 'code'
  /** "LFN…" — completing a code. */
  | 'codePrefix'
  /** "saint-au…" — completing the name from its first letter. */
  | 'namePrefix'
  /** "auban" in "Saint-Auban": the start of a WORD inside the name. Pilots say the distinctive half
   *  of a name, not the saintly half — this tier is the one that makes those names findable. */
  | 'wordPrefix'
  /** Buried in the middle of a word. Last of the name matches, and deliberately so. */
  | 'contains'
  /** No query: offered because it is CLOSE. */
  | 'nearby'
  /** No query and no fix: offered because it exists, in name order. Not a claim about proximity —
   *  it is a browse, and it wears a different name so nothing downstream can read it as "nearest". */
  | 'listed';

const RANK: Readonly<Record<MatchKind, number>> = {
  code: 0, codePrefix: 1, namePrefix: 2, wordPrefix: 3, contains: 4, nearby: 5, listed: 6,
};

/** The most rows this module will ever hand back.
 *
 *  Eight, because the list is read at a glance, one-handed, by someone whose eyes belong outside the
 *  cockpit. Flight-deck work puts a glance at well under two seconds; eight short rows fit in it and
 *  twenty do not. A longer list does not give the pilot more choice — it gives him a second search to
 *  run while nobody is flying the aeroplane. The cost of the cap is that the ranking above must be
 *  right, and that is a cost worth paying in this file rather than in the cockpit. */
export const MAX_RESULTS = 8;

export interface GotoOptions {
  /** Fewer rows than the cap, if the caller has less room. More is refused: see MAX_RESULTS. */
  limit?: number;
}

export interface GotoResult {
  point: Poi;
  match: MatchKind;
  /** Metres from the glider — NULL when there is no fix, or when the point carries no usable
   *  position. Never 0: a zero here reads as "under the wing" and sorts like it. */
  distanceM: number | null;
  /** Degrees true — null under exactly the same conditions, and for the same reason. */
  bearingDeg: number | null;
}

// ---- the letters, as a thumb types them ----

/** Strip the accents and the case. A pilot in turbulence types `e`, and the file says `é`; refusing
 *  him the field on that difference is refusing him the field. (Same fold as `polarlib.slug`, and
 *  for the same reason — it just does not go on to mangle the string into an id.) */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Split on everything that is not a letter or a digit: "Saint-Auban", "Saint Auban" and
 *  "SAINT_AUBAN" are the same three keystrokes to a pilot, and the file's punctuation is an accident
 *  of whoever typed it in 1998. */
const words = (folded: string): string[] => folded.split(/[^a-z0-9]+/).filter(w => w.length > 0);

/** A query with nothing but punctuation in it is an EMPTY query, not a query that matches nothing.
 *  The difference is what the pilot sees when his finger lands on the wrong key: the nearest places,
 *  rather than a blank panel he reads as "the database is broken". */
const queryTokens = (q: string): string[] => words(fold(q));

/** The best tier this one token reaches against this one point, or null if it does not reach it at
 *  all.
 *
 *  The description field is NOT searched, on purpose. It is free prose — "grass, hangar, avgas, PPR"
 *  — and folding it into the haystack means "gas" returns half the country. A search whose hits the
 *  pilot cannot explain is a search he stops trusting, and he is right to. */
function tokenMatch(tok: string, name: string, nameWords: readonly string[], code: string): MatchKind | null {
  if (code !== '') {
    if (code === tok) return 'code';
    if (code.startsWith(tok)) return 'codePrefix';
  }
  if (name.startsWith(tok)) return 'namePrefix';
  if (nameWords.some(w => w.startsWith(tok))) return 'wordPrefix';
  if (name.includes(tok) || code.includes(tok)) return 'contains';
  return null;
}

/** How well a whole query matches one point, or null if it does not.
 *
 *  Every token must match — "saint auban" is a narrowing, not a wish list, and a point that answers
 *  only half of what he typed is a point he did not ask for. The tier of the whole is the tier of its
 *  WEAKEST token: a match is only as good as its worst part, and letting one strong token carry a
 *  weak one would float a buried substring to the top of the list. */
export function matchPoint(p: Poi, query: string): MatchKind | null {
  const toks = queryTokens(query);
  if (toks.length === 0) return null;          // an empty query is not a name match — see gotoSearch
  const name = fold(p.name);
  const nameWords = words(name);
  const code = fold(p.code ?? '');

  let worst: MatchKind | null = null;
  for (const tok of toks) {
    const m = tokenMatch(tok, name, nameWords, code);
    if (m === null) return null;
    if (worst === null || RANK[m] > RANK[worst]) worst = m;
  }
  return worst;
}

// ---- the distance, or the absence of one ----

function measure(p: Poi, from: Origin | null): { distanceM: number | null; bearingDeg: number | null } {
  const none = { distanceM: null, bearingDeg: null };
  // A NaN latitude is not a fix. It arrives from a half-parsed sentence or an uninitialised state,
  // and every comparison it touches answers false — which is to say it would sort as though it had
  // been measured. It is an ABSENCE, and it is named as one here rather than propagated.
  if (from === null || !Number.isFinite(from.lon) || !Number.isFinite(from.lat)) return none;
  if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) return none;
  const d = distM(from.lon, from.lat, p.lon, p.lat);
  if (!Number.isFinite(d)) return none;
  return { distanceM: d, bearingDeg: bearingDeg(from.lon, from.lat, p.lon, p.lat) };
}

/** The ranking, in one place.
 *
 *  Tier first — the pilot is completing a word, and the word he is completing outranks geography.
 *  Then distance, because among names that are equally plausible the near one is the one he means.
 *  Then the name, so that the SAME query always produces the SAME eight rows in the SAME order: a
 *  list that reshuffles under a steady glider between two glances is a list he has to re-read, and
 *  re-reading is the thing this whole file exists to spare him. */
function compare(a: GotoResult, b: GotoResult): number {
  const tier = RANK[a.match] - RANK[b.match];
  if (tier !== 0) return tier;
  const da = a.distanceM, db = b.distanceM;
  // An unmeasurable distance does not get to sit at the top of the list by being smaller than every
  // number. It sinks, and it prints as a dash.
  if (da === null && db !== null) return 1;
  if (da !== null && db === null) return -1;
  if (da !== null && db !== null && da !== db) return da - db;
  const byName = a.point.name.localeCompare(b.point.name);
  if (byName !== 0) return byName;
  return (a.point.code ?? '').localeCompare(b.point.code ?? '');
}

/** The cap, applied to whatever the caller asked for. A shell asking for forty rows gets eight — the
 *  ceiling is a property of the pilot's eyes, not of the caller's layout, so it is not negotiable
 *  from outside. */
function cap(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return MAX_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(limit)));
}

// ---- the three questions ----

/** Points whose NAME or CODE answers the query, best first (TSK-011).
 *
 *  Distance ranks the ties when there is a fix, and simply is not claimed when there is not. An empty
 *  query returns an empty list HERE — "which places are called nothing?" has no answer — and it is
 *  `gotoSearch` that turns the empty query into the other question. */
export function searchByName(
  points: readonly Poi[], query: string, from: Origin | null = null, o: GotoOptions = {},
): GotoResult[] {
  const out: GotoResult[] = [];
  for (const p of points) {
    const match = matchPoint(p, query);
    if (match === null) continue;
    out.push({ point: p, match, ...measure(p, from) });
  }
  return out.sort(compare).slice(0, cap(o.limit));
}

/** The nearest points to a position, nearest first.
 *
 *  With no fix this returns NOTHING, and that refusal is the module's spine: "nearest" is a claim
 *  about a distance, we have no distance, and the alternative — handing back the first eight points
 *  of the file under the heading the pilot reads as "closest to you" — is precisely the confident
 *  empty box this project exists to not print. If the caller wants something to show with no fix, it
 *  is `gotoSearch`, and what comes back is labelled `listed`, not `nearby`. */
export function nearest(points: readonly Poi[], from: Origin | null, o: GotoOptions = {}): GotoResult[] {
  if (from === null) return [];
  const out: GotoResult[] = [];
  for (const p of points) {
    const m = measure(p, from);
    if (m.distanceM === null) continue;        // no distance, no place in a list ranked by distance
    out.push({ point: p, match: 'nearby', ...m });
  }
  return out.sort(compare).slice(0, cap(o.limit));
}

/** What the goto box shows, whatever the pilot has typed so far (TSK-011).
 *
 *  Nothing typed → the nearest places, because with an empty box the only thing the app knows about
 *  his intention is where he is. Nothing typed and no fix → the file, in name order, so the goal can
 *  still be set in the clubhouse.
 *
 *  Something typed → ONLY what matches it. Never a mixture: a list that puts the two fields he asked
 *  for above six he did not, all in the same typeface, is a list he will scroll past in one bump. */
export function gotoSearch(
  points: readonly Poi[], query: string, from: Origin | null = null, o: GotoOptions = {},
): GotoResult[] {
  if (queryTokens(query).length === 0) {
    if (from !== null && Number.isFinite(from.lon) && Number.isFinite(from.lat))
      return nearest(points, from, o);
    return points
      .map((p): GotoResult => ({ point: p, match: 'listed', distanceM: null, bearingDeg: null }))
      .sort(compare)
      .slice(0, cap(o.limit));
  }
  return searchByName(points, query, from, o);
}
