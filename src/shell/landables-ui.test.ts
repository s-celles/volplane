// ============ what the divert panel promises the pilot ============
// The renderer is the last centimetre before the eye, and it is where an honest computation
// can still turn into a lie: a null printed as 0, a grey verdict painted green, a list that
// looks empty when the truth is "nowhere to land". So these tests pin the CLAIMS — the words
// and the classes a pilot's decision hangs on — and never the markup around them.
import { expect, test } from 'bun:test';
import { NONE_REACHABLE, type Alternate } from '../core/landables';
import { LANDABLE_STATE_CLASS, alternatesHtml, styleFilterHtml } from './landables-ui';
import { LANDABLE_CATS } from '../core/cup';
import type { Poi } from '../core/cup';

/** A field with everything the .cup could say, so each test can null out exactly the thing it
 *  is asking about and nothing else. */
const field = (name: string, over: Partial<Poi> = {}): Poi => ({
  name, code: name.slice(0, 3), country: 'FR',
  lon: 5.9, lat: 44.3, elevM: 1_256, cat: 'airfield-gliding',
  rwdirDeg: 94, rwlenM: 800, freq: '123.500', desc: '', raw: null,
  ...over,
});

const alt = (
  name: string, state: Alternate['state'], marginM: number | null, over: Partial<Alternate> = {},
): Alternate => ({
  point: field(name),
  state, marginM,
  distanceM: 12_400,
  bearingDeg: 94,
  limit: state === 'indeterminate' ? 'unknown' : state === 'unreachable' ? 'glide' : 'glide',
  ...over,
});

/** The content of one `<span class="lnd-x">…</span>` cell, so a claim about a VALUE is not
 *  pinned to the shape of the row around it. */
const cell = (html: string, cls: string): string[] =>
  [...html.matchAll(new RegExp(`class="${cls}">([^<]*)<`, 'g'))].map(m => m[1]);

// ---- LND-006: nothing reachable is the loudest thing the panel ever says ----

test('a list with no reachable field shouts NONE_REACHABLE, above the rows, and still shows them', () => {
  const html = alternatesHtml([
    alt('Serres', 'unreachable', -80),
    alt('Aspres', 'unreachable', -1_400),
  ]);

  expect(html).toContain(NONE_REACHABLE);
  expect(html).toContain('NO landable field within reach');   // the exact words, not a paraphrase

  // Above the rows: the pilot must meet the bad news before he starts reading names.
  expect(html.indexOf(NONE_REACHABLE)).toBeLessThan(html.indexOf('Serres'));

  // And the rows survive: short by 80 m and short by 1400 m are different situations, and the
  // pilot is about to have to choose between them.
  expect(html).toContain('Serres');
  expect(html).toContain('Aspres');
  expect(cell(html, 'lnd-margin')).toEqual(['−80 m', '−1400 m']);
});

test('a list with one reachable field does NOT shout — the panel only cries wolf when it must', () => {
  const html = alternatesHtml([alt('Serres', 'reachable', 240), alt('Aspres', 'unreachable', -80)]);
  expect(html).not.toContain(NONE_REACHABLE);
});

// ---- LND-003/007: an unmeasured field is grey and says so, never a zero ----

test('an indeterminate field carries the indeterminate class, a dash for its margin, and the words', () => {
  const html = alternatesHtml([alt('Vercors', 'indeterminate', null)]);

  expect(html).toContain(LANDABLE_STATE_CLASS.indeterminate);
  // Never dressed as an option: the class that means "you can have this" appears nowhere.
  expect(html).not.toContain(LANDABLE_STATE_CLASS.reachable);

  // The margin is unknown, so it is a dash. A 0 here would be a promise of a zero-margin
  // arrival — which is a MEASUREMENT, and we have none (POT-007).
  expect(cell(html, 'lnd-margin')).toEqual(['—']);
  expect(cell(html, 'lnd-margin')[0]).not.toMatch(/\d/);   // no number at all, of any sign

  // Grey is not an explanation. The word is.
  expect(html).toContain('terrain not loaded');
});

// ---- LND-004: core ranked the list; the renderer does not get a second opinion ----

test('the rows come out in the order given, best margin at the top, without re-sorting', () => {
  // Deliberately handed to the renderer already ranked (as core hands it): if this file sorted
  // anything of its own, a second — untested — ranking would exist in the codebase.
  const html = alternatesHtml([
    alt('Saint-Auban', 'reachable', 640),
    alt('Serres', 'reachable', 240),
    alt('Aspres', 'reachable', 55),
  ]);

  expect(cell(html, 'lnd-name')).toEqual(['Saint-Auban', 'Serres', 'Aspres']);
  expect(cell(html, 'lnd-margin')).toEqual(['+640 m', '+240 m', '+55 m']);
});

test('the renderer prints the order it is GIVEN, even when that order is not by margin', () => {
  // The proof that no sort happens here: a mis-ranked list comes out mis-ranked. Core owns the
  // ranking and core's tests pin it; this file's job is to not have an opinion.
  const html = alternatesHtml([alt('Aspres', 'reachable', 55), alt('Serres', 'reachable', 240)]);
  expect(cell(html, 'lnd-name')).toEqual(['Aspres', 'Serres']);
});

test('the list is cut at the limit, eight rows by default', () => {
  const many = Array.from({ length: 12 }, (_, i) => alt(`F${i}`, 'reachable', 500 - i * 10));
  expect(cell(alternatesHtml(many), 'lnd-name')).toHaveLength(8);
  expect(cell(alternatesHtml(many, 3), 'lnd-name')).toEqual(['F0', 'F1', 'F2']);
});

// ---- LND-007: everything the base gives, and a dash for everything it does not ----

test('a field whose file gave no runway and no frequency prints dashes, never zeros', () => {
  const bare = field('Aspres', { rwdirDeg: null, rwlenM: null, freq: null, elevM: null });
  const html = alternatesHtml([{ ...alt('Aspres', 'reachable', 240), point: bare }]);

  expect(cell(html, 'lnd-rwy')).toEqual(['— · —']);      // both halves absent, independently
  expect(cell(html, 'lnd-freq')).toEqual(['—']);
  expect(cell(html, 'lnd-elev')).toEqual(['—']);         // an unreadable elevation is not sea level
});

test('a field whose file gave runway, frequency and elevation prints them', () => {
  const html = alternatesHtml([alt('Saint-Auban', 'reachable', 240)]);

  expect(cell(html, 'lnd-rwy')).toEqual(['094° · 800 m']);
  expect(cell(html, 'lnd-freq')).toEqual(['123.500']);
  expect(cell(html, 'lnd-elev')).toEqual(['1256 m']);
  expect(cell(html, 'lnd-bearing')).toEqual(['094°']);   // three digits, always
  expect(cell(html, 'lnd-dist')).toEqual(['12.4 km']);
  expect(html).toContain('gliding airfield');           // the cat, in the pilot's words
});

// ---- the empty panel ----

test('no .cup loaded draws nothing at all — an empty box teaches the eye to skip it', () => {
  expect(alternatesHtml([])).toBe('');
});

// ---- LND-008: the type filter ----

test('the filter offers the four landable categories, all ticked when nothing is filtered', () => {
  const html = styleFilterHtml(null);
  for (const c of LANDABLE_CATS) expect(html).toContain(`id="lnd-style-${c}"`);
  expect([...html.matchAll(/checked/g)]).toHaveLength(4);
  expect(html).toContain('outlanding field');
});

test('a narrowed selection unticks the categories it excludes', () => {
  // The training flight that wants no fields in a cow pasture: the outlanding box goes.
  const html = styleFilterHtml(['airfield-grass', 'airfield-gliding', 'airfield-solid']);
  expect(/id="lnd-style-outlanding"(?! checked)/.test(html)).toBe(true);
  expect(html).toContain('id="lnd-style-airfield-gliding" checked');
});
