// ============ TSK-011: what the goto box must never do ============
// The tests that matter here are the REFUSALS. A search that hands back a plausible field to a pilot
// who asked for a different one is worse than a search that hands back nothing: he glanced once, and
// he is now flying to it.

import { test, expect } from 'bun:test';
import { gotoSearch, searchByName, nearest, matchPoint, fold, MAX_RESULTS } from './goto';
import type { Poi } from './cup';

const poi = (name: string, code: string | null, lon: number, lat: number, o: Partial<Poi> = {}): Poi => ({
  name, code, country: 'FR', lon, lat, elevM: null, cat: 'airfield-gliding',
  rwdirDeg: null, rwlenM: null, freq: null, desc: null, raw: null, ...o,
});

// Real places, real positions — the ranking arguments below are only worth anything if the distances
// between them are the ones a pilot would actually be flying.
const STAUBAN = poi('Saint-Auban', 'LFNS', 5.9906, 44.0603, { desc: 'PPR, alternate LFNF, avgas' });
const VINON = poi('Vinon-sur-Verdon', 'LFNF', 5.7833, 43.7417);
const FAYENCE = poi('Fayence', 'LFMF', 6.7017, 43.6106);
const LEOCADIE = poi('Sainte-Léocadie', null, 2.0058, 42.4400);
const MONTAGNE = poi('Montagne Noire', 'LFMG', 2.0067, 43.4056);
const CLERMONT = poi('Clermont-Ferrand', 'LFLC', 3.1692, 45.7867);
const VENTOUX = poi('Mont Ventoux', null, 5.2786, 44.1739, { cat: 'summit', elevM: 1909 });

const BASE: Poi[] = [STAUBAN, VINON, FAYENCE, LEOCADIE, MONTAGNE, CLERMONT, VENTOUX];

/** Over the Durance, some 16 km north of Saint-Auban. */
const HERE = { lon: 5.94, lat: 44.20 };

const names = (rs: { point: Poi }[]) => rs.map(r => r.point.name);

test('A QUERY THAT MATCHES NOTHING RETURNS NOTHING — it does NOT fall back to what is near', () => {
  // The whole file lives or dies on this. A pilot types four letters, glances, and taps the first
  // row. If a failed search quietly degrades into "here are the nearest fields", the row he taps is
  // a place he never asked for, and it looks exactly like the place he did.
  expect(gotoSearch(BASE, 'tokyo', HERE)).toEqual([]);
  expect(gotoSearch(BASE, 'saint tokyo', HERE)).toEqual([]);   // every token must land, or none does
});

test('the DESCRIPTION is not searched — "avgas" is not a place, and neither is a code in someone else\'s remarks', () => {
  // Saint-Auban's desc says "alternate LFNF". Folding free prose into the haystack means the pilot
  // who types LFNF is offered Saint-Auban — 50 km from the field he named, and above it in the list,
  // because it is nearer to him. Hits a pilot cannot explain are hits he stops trusting.
  expect(gotoSearch(BASE, 'avgas', HERE)).toEqual([]);
  expect(names(gotoSearch(BASE, 'lfnf', HERE))).toEqual(['Vinon-sur-Verdon']);
});

test('A PREFIX BEATS A SUBSTRING, even when the substring match is NEARER', () => {
  // "mont": Clermont-Ferrand is 290 km away and Montagne Noire is 330 — and Clermont still comes
  // LAST, because the pilot is COMPLETING A WORD, not grepping a database. He typed the start of the
  // name he has in his head. Distance only sorts the two that begin with it.
  expect(names(gotoSearch(BASE, 'mont', HERE))).toEqual(['Mont Ventoux', 'Montagne Noire', 'Clermont-Ferrand']);
  expect(matchPoint(MONTAGNE, 'mont')).toBe('namePrefix');
  expect(matchPoint(CLERMONT, 'mont')).toBe('contains');
});

test('the distinctive half of a name is findable: "auban" finds Saint-Auban', () => {
  // Nobody says "Saint-". Pilots say Auban, Léo, Verdon. A search that only matched from the first
  // letter would make every Saint-Something reachable only by typing the part that carries no
  // information at all.
  expect(matchPoint(STAUBAN, 'auban')).toBe('wordPrefix');
  expect(names(gotoSearch(BASE, 'auban', HERE))).toEqual(['Saint-Auban']);
  expect(names(gotoSearch(BASE, 'verdon', HERE))).toEqual(['Vinon-sur-Verdon']);
});

test('ACCENTS DO NOT EXIST FOR A THUMB — "leocadie" finds Sainte-Léocadie', () => {
  // An accent he cannot type on a bumpy day is a place he cannot reach.
  expect(names(gotoSearch(BASE, 'leocadie', HERE))).toEqual(['Sainte-Léocadie']);
  expect(names(gotoSearch(BASE, 'LÉOCADIE', HERE))).toEqual(['Sainte-Léocadie']);
  expect(fold('Sainte-Léocadie')).toBe('sainte-leocadie');
});

test('equal matches are ranked by DISTANCE — of the four Saints, he means the one he can see', () => {
  // Both are name prefixes. Saint-Auban is 16 km away; Sainte-Léocadie is in the Pyrenees.
  expect(names(gotoSearch(BASE, 'saint', HERE))).toEqual(['Saint-Auban', 'Sainte-Léocadie']);
});

test('a code is a code: "LFN" completes to the near LFN fields, "LFNS" is an answer', () => {
  expect(matchPoint(STAUBAN, 'lfns')).toBe('code');
  expect(matchPoint(STAUBAN, 'lfn')).toBe('codePrefix');
  expect(names(gotoSearch(BASE, 'lfn', HERE))).toEqual(['Saint-Auban', 'Vinon-sur-Verdon']);
});

test('"saint auban" and "auban saint" are the same place — and the weakest token sets the rank', () => {
  expect(names(gotoSearch(BASE, 'saint auban', HERE))).toEqual(['Saint-Auban']);
  expect(names(gotoSearch(BASE, 'auban saint', HERE))).toEqual(['Saint-Auban']);
  // 'saint' is a name prefix, 'erdon' is buried in Verdon. A match is only as good as its worst part:
  // letting the strong token carry the weak one would float buried substrings to the top.
  expect(matchPoint(VINON, 'vinon erdon')).toBe('contains');
});

test('NO FIX, NO NEAREST — `nearest` refuses rather than naming a closest it did not measure', () => {
  // "Nearest" is a claim about a distance. With no fix there is no distance, and the first eight rows
  // of the file under that heading is the confident empty box this project exists to not print.
  expect(nearest(BASE, null)).toEqual([]);
  expect(nearest(BASE, { lon: NaN, lat: 44.2 })).toEqual([]);
});

test('but the goal can still be set IN THE CLUBHOUSE, before the receiver has locked', () => {
  // Most goals are chosen on the ground with no fix. A search that goes blank until GPS lock is a
  // search nobody ever uses. So the box browses — by NAME, labelled `listed`, and with NO distance.
  const r = gotoSearch(BASE, '', null);
  expect(r.every(x => x.match === 'listed')).toBe(true);
  expect(names(r)[0]).toBe('Clermont-Ferrand');            // name order, not a guessed proximity
  expect(r.every(x => x.distanceM === null && x.bearingDeg === null)).toBe(true);
});

test('AN UNKNOWN DISTANCE IS NULL, NEVER 0 — a zero would sort as though it were under the wing', () => {
  const noFix = gotoSearch(BASE, 'saint', null);
  expect(noFix.map(x => x.distanceM)).toEqual([null, null]);
  // A NaN fix is an ABSENCE wearing a number's clothes: every comparison it touches answers false, so
  // a distance derived from it would sort as though it had been measured.
  const nan = gotoSearch(BASE, 'saint', { lon: 5.94, lat: NaN });
  expect(nan.every(x => x.distanceM === null)).toBe(true);
  // and with no distance to rank by, the order falls back to the name — never to whatever the file
  // happened to list first.
  expect(names(nan)).toEqual(['Saint-Auban', 'Sainte-Léocadie']);
});

test('an EMPTY box with a fix means "what is near me" — nearest first, and it says so', () => {
  const r = gotoSearch(BASE, '', HERE);
  expect(names(r)[0]).toBe('Saint-Auban');                 // 16 km
  expect(r[0].match).toBe('nearby');
  expect(r[0].distanceM).toBeGreaterThan(10_000);
  expect(r[0].distanceM).toBeLessThan(25_000);
  expect(r[0].bearingDeg).not.toBeNull();
  // and it is genuinely sorted, not merely filtered
  const ds = r.map(x => x.distanceM as number);
  expect([...ds].sort((a, b) => a - b)).toEqual(ds);
});

test('a query of pure punctuation is an EMPTY query, not a query that matches nothing', () => {
  // His finger lands on the wrong key in a bump. He should see the places near him, not a blank panel
  // he reads as "the database failed to load".
  expect(names(gotoSearch(BASE, '  -  ', HERE))).toEqual(names(gotoSearch(BASE, '', HERE)));
});

test('THE LIST IS SHORT — forty rows is not an answer, it is a second search run in a cockpit', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    poi(`Champ ${String(i).padStart(2, '0')}`, null, 6 + i / 100, 44 + i / 100));
  expect(gotoSearch(many, 'champ', HERE)).toHaveLength(MAX_RESULTS);
  expect(gotoSearch(many, '', HERE)).toHaveLength(MAX_RESULTS);
  expect(nearest(many, HERE)).toHaveLength(MAX_RESULTS);
  // and the cap is not negotiable from outside: it is a property of the pilot's eyes, not of the
  // caller's layout.
  expect(gotoSearch(many, 'champ', HERE, { limit: 40 })).toHaveLength(MAX_RESULTS);
  // a caller with less room may ask for less
  expect(gotoSearch(many, 'champ', HERE, { limit: 3 })).toHaveLength(3);
  expect(gotoSearch(many, 'champ', HERE, { limit: 0 })).toHaveLength(1);   // never zero rows by rounding
});

test('the same query on a steady glider gives the SAME eight rows in the SAME order', () => {
  // A list that reshuffles between two glances is a list he has to re-read, and re-reading is what
  // this file exists to spare him. Ties break on the name — never on the file's row order.
  const a = poi('Serres-la-Bâtie', null, 5.7278, 44.4222);
  const b = poi('Serres-la-Bâtie', null, 5.7278, 44.4222);     // same place, twice in the file
  const first = searchByName([a, b, ...BASE], 'serres', HERE);
  const again = searchByName([b, a, ...BASE], 'serres', HERE);
  expect(names(first)).toEqual(names(again));
  expect(first).toHaveLength(2);
});

test('searchByName does not answer an empty query — the empty box is a different question', () => {
  // Keeping them apart is what stops "which places are called nothing?" from being answered with the
  // whole file.
  expect(searchByName(BASE, '', HERE)).toEqual([]);
  expect(matchPoint(STAUBAN, '   ')).toBeNull();
});
