// ============ what the divert panel promises the pilot ============
// The renderer is the last centimetre before the eye, and it is where an honest computation
// can still turn into a lie: a null printed as 0, a grey verdict painted green, a list that
// looks empty when the truth is "nowhere to land". So these tests pin the CLAIMS — the words
// and the classes a pilot's decision hangs on — and never the markup around them.
//
// Half of them are about SILENCE, and that is not a curiosity of the panel — it is its hardest
// problem. A blank panel is what every other flight has taught the pilot to read as "nothing to
// report", and this panel has five different reasons to be blank. Each of them now has a
// sentence, and the loudest sentence in the app — NONE_REACHABLE — is allowed to mean only the
// one thing it was written to mean.
import { expect, test } from 'bun:test';
import { NONE_REACHABLE, type Alternate } from '../core/landables';
import {
  LANDABLE_STATE_CLASS, alternatesHtml as alternatesHtmlT,
  styleFilterHtml as styleFilterHtmlT, type DivertPanel,
} from './landables-ui';
import { LANDABLE_CATS } from '../core/cup';
import type { Poi } from '../core/cup';
import { translator } from '../core/i18n';
import { PRESETS } from '../core/units';

// IHM-006: the panel's sentences used to be exported English constants and these tests pinned
// the constants. They are catalogue entries now, and the tests pin the CATALOGUE — the same
// claims, in the place a French pilot can also read them. NONE_REACHABLE stays imported from
// core/landables: i18n.test.ts asserts the English entry IS that constant, so the loudest
// sentence in the app still has exactly one source.
const en = translator('en');
const fr = translator('fr');
// Metric unless a test says otherwise. CFG-003 — the row reads in the unit the pilot chose, the
// same one his InfoBoxes read in — is pinned on its own, at the bottom of this file.
const METRIC = PRESETS.metric;
const alternatesHtml = (p: DivertPanel, limit?: number): string =>
  limit == null ? alternatesHtmlT(p, METRIC, en) : alternatesHtmlT(p, METRIC, en, limit);
const styleFilterHtml = (sel: Parameters<typeof styleFilterHtmlT>[0]): string =>
  styleFilterHtmlT(sel, en);

const REACH_UNKNOWN = en('lnd.reachUnknown');
const NO_ALTITUDE = en('lnd.noAltitude');
const NO_LANDABLE_IN_FILE = en('lnd.noLandableInFile');
const NO_STYLE_SELECTED = en('lnd.noStyleSelected');
const STALE_VERDICTS = en('lnd.stale');
// The radius reaches the catalogue PREFORMATTED — '80 km', not '80' beside a hard-coded 'km' in
// the sentence. That is what lets a pilot who chose nautical miles read the same sentence in NM.
const noFieldInRadius = (dist: string): string => en('lnd.noFieldInRadius', { dist });
const someNotJudged = (judged: number, inRadius: number, dist: string): string =>
  en('lnd.someNotJudged', { judged, inRadius, dist });
const noneOfJudgedReachable = (judged: number): string =>
  en('lnd.noneOfJudgedReachable', { judged });

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
  limit: state === 'indeterminate' ? 'unknown' : 'glide',
  ...over,
});

/** The ordinary panel: a .cup is loaded, the fix has a height, every candidate was judged, the
 *  link is alive, nothing is filtered. Each test then breaks exactly one of those. */
const panel = (judged: readonly Alternate[], over: Partial<DivertPanel> = {}): DivertPanel => ({
  loaded: true,
  landableCount: Math.max(1, judged.length),
  haveAlt: true,
  inRadius: judged.length,
  radiusM: 80_000,
  judged,
  rows: judged,
  stale: false,
  ...over,
});

const html = (judged: readonly Alternate[], over: Partial<DivertPanel> = {}, limit?: number): string =>
  alternatesHtml(panel(judged, over), limit);

/** The content of one `<span class="lnd-x">…</span>` cell, so a claim about a VALUE is not
 *  pinned to the shape of the row around it. */
const cell = (h: string, cls: string): string[] =>
  [...h.matchAll(new RegExp(`class="${cls}">([^<]*)<`, 'g'))].map(m => m[1]);

// ---- LND-006: nothing reachable is the loudest thing the panel ever says ----

test('a list with no reachable field shouts NONE_REACHABLE, above the rows, and still shows them', () => {
  const h = html([alt('Serres', 'unreachable', -80), alt('Aspres', 'unreachable', -1_400)]);

  expect(h).toContain(NONE_REACHABLE);
  expect(h).toContain('NO landable field within reach');   // the exact words, not a paraphrase

  // Above the rows: the pilot must meet the bad news before he starts reading names.
  expect(h.indexOf(NONE_REACHABLE)).toBeLessThan(h.indexOf('Serres'));

  // And the rows survive: short by 80 m and short by 1400 m are different situations, and the
  // pilot is about to have to choose between them.
  expect(h).toContain('Serres');
  expect(h).toContain('Aspres');
  expect(cell(h, 'lnd-margin')).toEqual(['−80 m', '−1400 m']);
});

test('a list with one reachable field does NOT shout — the panel only cries wolf when it must', () => {
  expect(html([alt('Serres', 'reachable', 240), alt('Aspres', 'unreachable', -80)]))
    .not.toContain(NONE_REACHABLE);
});

test('LND-006 does NOT fire over an all-indeterminate list: unmeasured is not refused', () => {
  // The fresh install, the cold cache, the pilot who flew off the edge of his DEM. Every field
  // comes back 'indeterminate' because the terrain march hit unloaded ground — and the panel used
  // to print "NO landable field within reach" directly above grey rows that each read "terrain not
  // loaded". An unconditional claim of absence, with a confession one line below it that nobody
  // took a measurement. That trains the eye to discount the one banner that must never be
  // discounted.
  const h = html([alt('Serres', 'indeterminate', null), alt('Aspres', 'indeterminate', null)]);

  expect(h).not.toContain(NONE_REACHABLE);
  expect(h).toContain(REACH_UNKNOWN);
  expect(h).toContain('UNKNOWN');                 // an unasked question, said as one
  expect(h).toContain('terrain not loaded');      // and the rows still say why, each for itself
});

test('LND-006 fires when a field was actually judged and refused, even beside an unmeasured one', () => {
  // The distinction is "did anyone measure anything", not "is every row red": one measured
  // refusal is a measured negative, and the banner is earned.
  const h = html([alt('Serres', 'unreachable', -80), alt('Vercors', 'indeterminate', null)]);
  expect(h).toContain(NONE_REACHABLE);
});

// ---- the cost cap: a compute budget is not a claim about the world ----

test('a capped list says how many fields it never asked about — and softens the banner', () => {
  // Core marches the 30 NEAREST fields, and reachability is not monotonic in distance (the whole
  // point of the terrain march). So the 31st can be the only one that was makeable. The banner may
  // not speak for fields nobody marched, and the pilot must be able to see that it did not.
  const judged = [alt('Serres', 'unreachable', -80), alt('Aspres', 'unreachable', -900)];
  const h = html(judged, { inRadius: 12 });

  expect(h).toContain(someNotJudged(2, 12, '80 km'));
  expect(h).toContain(noneOfJudgedReachable(2));
  expect(h).not.toContain(NONE_REACHABLE);        // the unconditional claim is NOT made
});

test('when every field in the radius was judged, the banner is the unconditional one', () => {
  const judged = [alt('Serres', 'unreachable', -80)];
  const h = html(judged, { inRadius: 1 });
  expect(h).toContain(NONE_REACHABLE);
  expect(h).not.toContain('judged —');            // no scope footnote: nothing was left unasked
});

// ---- SYS-002: the panel ages with the link ----

test('a dead link ages the divert rows too — they are a claim about a fix that has stopped arriving', () => {
  // The boxes above already grey out and say "the LAST RECEIVED, not current". The divert rows are
  // DERIVED from that same fix — "reachable, +240 m" is a claim about one position and one height —
  // and they used to keep glowing green at full brightness while the pilot descended for two
  // minutes on a margin that had since evaporated.
  const h = html([alt('Serres', 'reachable', 240)], { stale: true });

  expect(h).toContain(STALE_VERDICTS);
  expect(h).toContain('class="landables stale"');
  // Said BEFORE the rows: the pilot must know the list has stopped being current before he reads
  // a margin off it.
  expect(h.indexOf(STALE_VERDICTS)).toBeLessThan(h.indexOf('Serres'));
});

test('a live link says nothing about staleness — the caption is news, not furniture', () => {
  const h = html([alt('Serres', 'reachable', 240)]);
  expect(h).not.toContain(STALE_VERDICTS);
  expect(h).not.toContain('stale');
});

// ---- LND-003/007: an unmeasured field is grey and says so, never a zero ----

test('an indeterminate field carries the indeterminate class, a dash for its margin, and the words', () => {
  const h = html([alt('Vercors', 'indeterminate', null)]);

  expect(h).toContain(LANDABLE_STATE_CLASS.indeterminate);
  // Never dressed as an option: the class that means "you can have this" appears nowhere.
  expect(h).not.toContain(LANDABLE_STATE_CLASS.reachable);

  // The margin is unknown, so it is a dash. A 0 here would be a promise of a zero-margin
  // arrival — which is a MEASUREMENT, and we have none (POT-007).
  expect(cell(h, 'lnd-margin')).toEqual(['—']);
  expect(cell(h, 'lnd-margin')[0]).not.toMatch(/\d/);   // no number at all, of any sign

  // Grey is not an explanation. The word is.
  expect(h).toContain('terrain not loaded');
});

test('a ridge-blocked field shows the dash and the reason, never a free-air margin', () => {
  // Core hands this row a null margin because there is no arrival to have height in hand over
  // (core/landables.ts). The renderer's job is to not invent one back.
  const h = html([alt('Behind', 'unreachable', null, { limit: 'terrain' })]);
  expect(cell(h, 'lnd-margin')).toEqual(['—']);
  expect(h).toContain('ridge in the way');
});

// ---- LND-004: core ranked the list; the renderer does not get a second opinion ----

test('the rows come out in the order given, best margin at the top, without re-sorting', () => {
  // Deliberately handed to the renderer already ranked (as core hands it): if this file sorted
  // anything of its own, a second — untested — ranking would exist in the codebase.
  const h = html([
    alt('Saint-Auban', 'reachable', 640),
    alt('Serres', 'reachable', 240),
    alt('Aspres', 'reachable', 55),
  ]);

  expect(cell(h, 'lnd-name')).toEqual(['Saint-Auban', 'Serres', 'Aspres']);
  expect(cell(h, 'lnd-margin')).toEqual(['+640 m', '+240 m', '+55 m']);
});

test('the renderer prints the order it is GIVEN, even when that order is not by margin', () => {
  // The proof that no sort happens here: a mis-ranked list comes out mis-ranked. Core owns the
  // ranking and core's tests pin it; this file's job is to not have an opinion.
  const h = html([alt('Aspres', 'reachable', 55), alt('Serres', 'reachable', 240)]);
  expect(cell(h, 'lnd-name')).toEqual(['Aspres', 'Serres']);
});

test('the list is cut at the limit, eight rows by default', () => {
  const many = Array.from({ length: 12 }, (_, i) => alt(`F${i}`, 'reachable', 500 - i * 10));
  expect(cell(html(many), 'lnd-name')).toHaveLength(8);
  expect(cell(html(many, {}, 3), 'lnd-name')).toEqual(['F0', 'F1', 'F2']);
});

// ---- LND-007: everything the base gives, and a dash for everything it does not ----

test('a field whose file gave no runway and no frequency prints dashes, never zeros', () => {
  const bare = field('Aspres', { rwdirDeg: null, rwlenM: null, freq: null, elevM: null });
  const h = html([{ ...alt('Aspres', 'reachable', 240), point: bare }]);

  expect(cell(h, 'lnd-rwy')).toEqual(['— · —']);      // both halves absent, independently
  expect(cell(h, 'lnd-freq')).toEqual(['—']);
  expect(cell(h, 'lnd-elev')).toEqual(['—']);         // an unreadable elevation is not sea level
});

test('a field whose file gave runway, frequency and elevation prints them', () => {
  const h = html([alt('Saint-Auban', 'reachable', 240)]);

  expect(cell(h, 'lnd-rwy')).toEqual(['094° · 800 m']);
  expect(cell(h, 'lnd-freq')).toEqual(['123.500']);
  expect(cell(h, 'lnd-elev')).toEqual(['1256 m']);
  expect(cell(h, 'lnd-bearing')).toEqual(['094°']);   // three digits, always
  expect(cell(h, 'lnd-dist')).toEqual(['12.4 km']);
  expect(h).toContain('gliding airfield');           // the cat, in the pilot's words
});

test('the frequency is escaped like the name — it is file text, not a number', () => {
  // .cup files are traded between pilots and downloaded from club sites, and the freq column is
  // whatever string the author typed: "123.500", but also "<see AIP>". Unescaped, that '<' opens
  // an unknown element that swallows the closing tag — the frequency cell renders EMPTY and the
  // 'ridge in the way' caption is re-parented into it. A present value displaying as absent, on
  // the divert panel. (And a freq of `<img src=x onerror=…>` would simply run.)
  const nasty = field('Aspres', { freq: '<see AIP>' });
  const h = html([{ ...alt('Aspres', 'unreachable', -80), point: nasty }]);

  expect(h).toContain('&lt;see AIP&gt;');
  expect(h).not.toContain('<see AIP>');
  expect(cell(h, 'lnd-freq')).toEqual(['&lt;see AIP&gt;']);   // present, and visible as present
  expect(h).toContain('short on glide');                      // the caption still belongs to the row
});

// ---- the five silences, and the fact that they are five ----

test('no .cup loaded draws nothing at all — an empty box teaches the eye to skip it', () => {
  expect(alternatesHtml(panel([], { loaded: false, landableCount: 0 }))).toBe('');
});

test('a .cup with no landable in it says THAT — it does not claim nothing is reachable', () => {
  // A turnpoint-only file, which this app accepts and labels "212 points, 0 landable". Printing
  // "NO landable field within reach" over it would be a lie about a database that never held a
  // field; printing nothing at all would look exactly like a working panel with good news.
  const h = alternatesHtml(panel([], { landableCount: 0, inRadius: 0 }));
  expect(h).toContain(NO_LANDABLE_IN_FILE);
  expect(h).not.toContain(NONE_REACHABLE);
});

test('a fix with no altitude says nothing was judged — not that nothing is reachable', () => {
  const h = alternatesHtml(panel([], { haveAlt: false, landableCount: 40, inRadius: 0 }));
  expect(h).toContain(NO_ALTITUDE);
  expect(h).not.toContain(NONE_REACHABLE);
});

test('a pilot beyond his database\'s coverage is told so, not shown a blank corner', () => {
  // The Frenchman crossing into Spain with a French .cup: the nearest landable is 118 km away, the
  // radius is 80, so core returns nothing — and the panel used to render as literally nothing, the
  // same pixels it uses for "you never loaded a file".
  const h = alternatesHtml(panel([], { landableCount: 400, inRadius: 0 }));
  expect(h).toContain(noFieldInRadius('80 km'));
  expect(h).not.toContain(NONE_REACHABLE);
});

test('unticking every type empties the ROWS and says so — the verdicts are untouched', () => {
  // The banner is computed over `judged`, which the filter never touches. Here a field IS
  // reachable, and the panel must not shout — it must say the list is filtered.
  const judged = [alt('Serres', 'reachable', 240)];
  const h = alternatesHtml(panel(judged, { rows: [] }));

  expect(h).toContain(NO_STYLE_SELECTED);
  expect(h).not.toContain(NONE_REACHABLE);
});

test('a filter that hides the only reachable field still does not fabricate the alarm', () => {
  // LND-008's literal example: the pilot on a training flight unticks "outlanding field", and the
  // only field he can have is a vachable strip six kilometres away. Hiding the ROW is sanctioned.
  // Shouting "NO landable field within reach" at him is not — and that is what a banner computed
  // over the filtered list did.
  const vachable = alt('Cow pasture', 'reachable', 200, { point: field('Cow pasture', { cat: 'outlanding' }) });
  const far = alt('Airfield', 'unreachable', -400);
  const h = alternatesHtml(panel([vachable, far], { rows: [far] }));

  expect(h).not.toContain(NONE_REACHABLE);
  expect(h).not.toContain(noneOfJudgedReachable(2));
  expect(cell(h, 'lnd-name')).toEqual(['Airfield']);      // the row is hidden, as asked
});

// ---- LND-008: the type filter ----

test('the filter offers the four landable categories, all ticked when nothing is filtered', () => {
  const h = styleFilterHtml(null);
  for (const c of LANDABLE_CATS) expect(h).toContain(`id="lnd-style-${c}"`);
  expect([...h.matchAll(/checked/g)]).toHaveLength(4);
  expect(h).toContain('outlanding field');
});

test('a narrowed selection unticks the categories it excludes', () => {
  // The training flight that wants no fields in a cow pasture: the outlanding box goes.
  const h = styleFilterHtml(['airfield-grass', 'airfield-gliding', 'airfield-solid']);
  expect(/id="lnd-style-outlanding"(?! checked)/.test(h)).toBe(true);
  expect(h).toContain('id="lnd-style-airfield-gliding" checked');
});


// ---- IHM-006: the same panel, in French ----

test('the divert panel speaks French — and the English sentence is GONE, not merely joined', () => {
  const judged = [alt('Serres', 'unreachable', -80, { limit: 'glide' })];
  const p: DivertPanel = {
    loaded: true, landableCount: 4, haveAlt: true, inRadius: 1,
    radiusM: 80_000, judged, rows: judged, stale: false,
  };
  const french = alternatesHtmlT(p, METRIC, fr);
  // The loudest sentence in the app, in the pilot's language — and the English one absent, which
  // is the whole point: a warning a pilot cannot read is a warning he does not heed.
  expect(french).toContain(fr('lnd.noneReachable'));
  expect(french).not.toContain(NONE_REACHABLE);
  expect(french).toContain(fr('lnd.limit.glide'));       // and the row still says WHY
  expect(french).not.toContain('short on glide');
  // The .cup category too: it is data in English in the kernel, and a word in French here.
  expect(french).toContain(fr('cup.cat.airfield-gliding'));
  expect(alternatesHtmlT(p, METRIC, en)).toContain(NONE_REACHABLE);
});


// ---- CFG-003: the rows read in the unit the pilot chose ----

test('the divert rows honour the pilot\'s units — his margin is not in two units at once', () => {
  // The failure this pins: the arrival box overhead read '+850 ft' while the row he actually
  // diverts on read '+259 m', because the panel had never heard of the unit setting.
  const judged = [alt('Serres', 'reachable', 259, { distanceM: 12_400 })];
  const p: DivertPanel = {
    loaded: true, landableCount: 4, haveAlt: true, inRadius: 1,
    radiusM: 80_000, judged, rows: judged, stale: false,
  };
  const aviation = alternatesHtmlT(p, PRESETS.aviation, en);
  expect(aviation).toContain('+850 ft');                 // the margin, in his altitude unit
  expect(aviation).toContain('6.7 NM');                  // the distance, in his distance unit
  expect(aviation).toContain('4121 ft');                 // the field's elevation, likewise
  expect(aviation).toContain('2625 ft');                 // and the runway length
  expect(aviation).not.toContain('+259 m');
  expect(aviation).not.toContain('12.4 km');
  // …and the radius in the banner sentence follows, because the sentence takes a formatted string.
  expect(alternatesHtmlT({ ...p, inRadius: 0 }, PRESETS.aviation, en)).toContain('43 NM');

  // Metric is still metric — the default did not move, it merely stopped being the only option.
  expect(alternatesHtmlT(p, PRESETS.metric, en)).toContain('+259 m');
});
