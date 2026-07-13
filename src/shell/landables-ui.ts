// ============ the divert list (LND-004/006/007/008) ============
// The panel a pilot reads when the day has stopped working: which fields can I still HAVE,
// best first, without leaving the flight screen. Everything hard has already happened in
// core/landables.ts — the march over the rock, the three verdicts, the ranking. What is left
// here is the part that must not lie in the last centimetre: turning those numbers into
// glyphs.
//
// Pure, like xsection-ui and liftmap-ui's legend: values in, an HTML string out, no DOM and
// no fetch. Which means this file NEVER re-sorts and NEVER re-judges. If it re-sorted, there
// would be two rankings in the codebase and only one of them tested; if it re-judged, a green
// row could appear over ground core called unmeasured. It renders what it is given, in the
// order it is given, and its only freedom is what to say when a value is missing.
//
// And what it says is "—". Every null in a row is an ABSENCE the pilot must see as an absence:
// a runway length we do not have is not a runway of length zero, an unmeasured margin is not a
// zero-margin arrival (POT-007). The one number a glider dies of is the one nobody measured
// and the screen printed anyway.

// IHM-006. Every sentence below used to be an exported English constant, and the tests pinned
// the constants. They now live in the catalogue, and the tests pin the CATALOGUE — which is the
// same claim, said in a place a French pilot can also read. core/landables.ts is NOT edited:
// NONE_REACHABLE stays the kernel's own promise, and i18n.test.ts asserts the English entry is
// character-for-character that promise, so the two cannot drift.
// CFG-003 reaches this panel too, and it had to: the InfoBoxes a centimetre above these rows print
// the pilot's chosen unit, and these rows printed metres and kilometres whatever he chose. One
// screen, two units for the same quantity — an arrival margin in feet in the box and in metres in
// the row he actually diverts on. Every number below now goes through the SAME units.format the
// boxes go through, and the panel is handed the pilot's prefs like it is handed his language.
import type { Alternate } from '../core/landables';
import { LANDABLE_CATS, type PoiCat } from '../core/cup';
import { format, formatText, type UnitPrefs } from '../core/units';
import type { T } from './infobox-ui';

/** The state → class map, exported because the CSS and the renderer must not drift apart, and
 *  because a caller (the map layer, a future divert mode) colours the same three facts.
 *
 *  The three names share no prefix by construction: 'reachable' as a substring of
 *  'unreachable' would make every `class.includes(…)` test — and every CSS rule written in a
 *  hurry — quietly match the opposite verdict. Three different facts, three different words. */
export const LANDABLE_STATE_CLASS: Record<Alternate['state'], string> = {
  reachable: 'lnd-reachable',
  unreachable: 'lnd-out-of-reach',
  indeterminate: 'lnd-indeterminate',
};

/** LND-003 in words. A colour tells the pilot THAT something is different; the word tells him
 *  WHICH thing, and only the word survives sunlight on a canopy. 'unknown' is the one that
 *  matters most: it is not a bad field, it is an unasked question. */
const LIMIT_ID: Record<Alternate['limit'], string> = {
  glide: 'lnd.limit.glide',
  terrain: 'lnd.limit.terrain',
  unknown: 'lnd.limit.unknown',
};

/** The .cup category, in the pilot's words. core/cup's catLabel is the English spelling and
 *  remains the kernel's; here the same nine facts go through the catalogue, so a French pilot
 *  reads "terrain de vol à voile" and the two lists cannot fall out of step — the id is built
 *  from the category itself. */
const catText = (cat: PoiCat, t: T): string => t(`cup.cat.${cat}`);

/** The default depth of the list. Eight rows is about what a pilot reads before he stops
 *  reading; the ninth-best alternate has never saved anyone. */
const DEFAULT_LIMIT = 8;

/** Names come from the pilot's own .cup file and we did not write it — a field called
 *  "L'Étoile <sud>" must render as itself and not as markup. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** THE rule of this file, and the reason it exists as a named function rather than a sprinkle
 *  of `?? '—'`: an unknown renders as an em dash, everywhere, once. Never a 0, never a blank
 *  cell the eye reads as "nothing to report". */
const DASH = '—';
function shown(v: string | null): string {
  return v ?? DASH;
}

/** Signed, because the sign IS the message: +240 is height in hand, −80 is a field you cannot
 *  have. A true minus sign (U+2212), not a hyphen, so the two read differently at a glance in
 *  a column of digits. Null is the indeterminate case and gets the dash — a margin we did not
 *  measure is not a margin of zero (LND-003, POT-007). */
function marginText(m: number | null, u: UnitPrefs): string | null {
  if (m == null) return null;
  // The magnitude goes through the formatter (a margin is an ALTITUDE — metres, or feet if that is
  // what he flies); the sign is put back in front, because format() has no notion of a signed
  // height and rounding a −0.4 m margin to "−0" would be a minus sign in front of nothing.
  const { text, unit } = format(Math.abs(m), 'altitude', u.altitude);
  return `${m < 0 ? '−' : '+'}${text} ${unit}`;
}

/** Three digits, always: 94° and 094° are the same bearing but not the same glance, and a
 *  column that changes width is a column that gets misread. */
function bearingText(deg: number): string {
  const d = Math.round(deg) % 360;
  return `${String((d + 360) % 360).padStart(3, '0')}°`;
}

function distanceText(m: number, u: UnitPrefs): string {
  return formatText(m, 'distance', u.distance);
}

function elevText(m: number | null, u: UnitPrefs): string | null {
  return m == null ? null : formatText(m, 'altitude', u.altitude);
}

/** LND-007's optional half. The .cup gives runway and frequency only when the file's author
 *  bothered, and half of them did not — so both halves of the runway are printed
 *  independently and either may be a dash. A field with a known direction and an unknown
 *  length says exactly that. */
function rwyText(rwdir: number | null, rwlenM: number | null, u: UnitPrefs): string {
  const dir = rwdir == null ? null : bearingText(rwdir);
  // A runway length is a length on the ground, and it is read the way a field's elevation is read —
  // metres, or feet for the pilot who flies feet. Never the cross-country distance unit: a 900 m
  // strip is not "0.5 NM of runway".
  const len = rwlenM == null ? null : formatText(rwlenM, 'altitude', u.altitude);
  return `${shown(dir)} · ${shown(len)}`;
}

function rowHtml(a: Alternate, u: UnitPrefs, t: T): string {
  const p = a.point;
  // The margin is core's verdict rendered, and the WORD comes along with it whenever the row
  // is not a plain yes: the pilot who reads 'ridge in the way' knows something a red dot never
  // told him, and the pilot who reads 'terrain not loaded' knows this is a question, not a no.
  const why = a.state === 'reachable' ? '' : `<span class="lnd-why">${esc(t(LIMIT_ID[a.limit]))}</span>`;
  return `<div class="lnd-row ${LANDABLE_STATE_CLASS[a.state]}">`
    + `<span class="lnd-name">${esc(p.name)}</span>`
    + `<span class="lnd-style">${esc(catText(p.cat, t))}</span>`
    + `<span class="lnd-margin">${shown(marginText(a.marginM, u))}</span>`
    + `<span class="lnd-bearing">${bearingText(a.bearingDeg)}</span>`
    + `<span class="lnd-dist">${distanceText(a.distanceM, u)}</span>`
    + `<span class="lnd-elev">${shown(elevText(p.elevM, u))}</span>`
    + `<span class="lnd-rwy">${rwyText(p.rwdirDeg, p.rwlenM, u)}</span>`
    // Escaped for the same reason the NAME is, and it was missed for years because a frequency
    // "looks like" a number: it is not. It is whatever string the file wrote — "123.500", but
    // also "<see AIP>" from a hand-edited .cup — and .cup files are traded between pilots and
    // downloaded from club sites. Unescaped, a '<' swallows the rest of the row as markup: the
    // frequency cell renders EMPTY and the 'ridge in the way' caption beside it is re-parented
    // into it. A present value silently displaying as absent, on the divert panel, which is the
    // one thing this file's header says must never happen.
    + `<span class="lnd-freq">${shown(p.freq == null ? null : esc(p.freq))}</span>`
    + why
    + `</div>`;
}

/** Everything the panel needs to tell the truth about its own silence.
 *
 *  The old signature was a bare list, and a bare list cannot distinguish the two things an
 *  empty panel might mean. "No .cup is loaded" (nothing was ever asked) and "a .cup IS loaded
 *  and not one field qualifies" (the answer is none) rendered as the SAME blank pixels — and a
 *  blank space is what every other flight has trained the pilot to read as "nothing to report".
 *  So the panel is handed the facts, not just the answers, and each silence gets its own word. */
export interface DivertPanel {
  /** A .cup is loaded at all. Without one the panel is not drawn — a permanently empty box
   *  teaches the eye to skip that corner of the screen, and the eye keeps skipping it on the
   *  day the box finally has something to say. */
  loaded: boolean;
  /** Landable-style points the loaded file holds, anywhere on earth. Zero means the pilot
   *  loaded a turnpoint file: "no field within reach" would be a lie about a database that
   *  never contained a field. */
  landableCount: number;
  /** The fix carries an altitude. Without one there is no glide slope to march and NOTHING was
   *  judged — which is not the same as nothing being reachable. */
  haveAlt: boolean;
  /** Landable fields inside the judging radius, INCLUDING the ones core's cost cap never
   *  marched. The denominator in "30 of 52". */
  inRadius: number;
  /** The radius core searched (m) — the boundary of the question that was asked. */
  radiusM: number;
  /** Every field core judged, in core's order, UNFILTERED by the pilot's type boxes. The banner
   *  speaks for this list and no other: a view filter must not be able to fabricate the worst
   *  alarm of the flight (LND-008 hides rows; it does not remove fields from the world). */
  judged: readonly Alternate[];
  /** The rows to draw: `judged` as the LND-008 filter leaves it. */
  rows: readonly Alternate[];
  /** SYS-002: the link is silent or closed. Every verdict below was computed from the LAST fix
   *  received, and an alternate is a claim about ONE position and ONE height. */
  stale: boolean;
}

/** LND-006's honest neighbours. Each one is a DIFFERENT fact, and the whole argument of this
 *  file is that they must not be allowed to wear each other's clothes:
 *
 *  NONE_REACHABLE (core's own words) is a measured negative — fields were marched, and not one
 *  of them can be had. It is the loudest thing the panel ever says, and the reason it may be
 *  said at all is that somebody measured something. The moment it starts firing over unmeasured
 *  ground, over an unloaded DEM, over fields nobody marched, it becomes an alarm the eye learns
 *  to discount — and it is the one alarm in this app that must never be discounted. */
// The ids, so the argument above can be read as a list: lnd.reachUnknown, lnd.noAltitude,
// lnd.noLandableInFile, lnd.noFieldInRadius, lnd.noStyleSelected, lnd.someNotJudged (a compute
// budget is not a claim about the world, and the pilot is entitled to know when it bit —
// reachability is not monotonic in distance, so "the 30 nearest" is not "the 30 best" and the
// 31st may be the only one), lnd.noneOfJudgedReachable (the softened banner for exactly that
// case: still loud, but no longer speaking for fields nobody marched) and lnd.stale.

const note = (cls: string, text: string): string => `<div class="${cls}">${text}</div>`;

/** The divert list (LND-004/006/008): the fields core ranked, best margin first, in core's
 *  order, with the panel's own silences named.
 *
 *  The banner is the safety argument of the whole file, and it is computed over `judged` — never
 *  over `rows`, never over the eight-row slice. Three ways it could lie, and all three were
 *  real:
 *    · over a FILTERED list, an unticked outlanding field six kilometres away disappears and the
 *      panel shouts that nothing is reachable;
 *    · over an ALL-INDETERMINATE list, it reports an unmeasured thing as a measured negative —
 *      "NO landable field within reach" printed directly above grey rows that each read "terrain
 *      not loaded", which is the panel asserting a fact and confessing one line down that it took
 *      no measurement;
 *    · over a CAPPED list, it speaks for the fields core's cost budget never marched.
 *  Each of those now has its own sentence, and NONE_REACHABLE is left to mean the one thing it
 *  was written to mean. */
export function alternatesHtml(
  p: DivertPanel, u: UnitPrefs, t: T, limit: number = DEFAULT_LIMIT,
): string {
  if (!p.loaded) return '';                       // nothing was ever asked: draw nothing

  // The radius reaches the catalogue ALREADY FORMATTED, as one string with its unit in it. The
  // messages used to say "within {km} km", which baked the kilometre into the sentence: no renderer
  // could ever have honoured a pilot who chose nautical miles without rewriting both catalogues. A
  // unit belongs in units.ts, never in a translation.
  const dist = formatText(p.radiusM, 'distance', u.distance, 0);
  // SYS-002, first, above everything: the boxes overhead already grey out and say the values are
  // the last received. The divert rows are DERIVED from that same aging fix — a "reachable,
  // +240 m" whose margin may have evaporated two minutes ago — and they were the one panel on the
  // screen that did not admit it had stopped being current.
  const head = p.stale ? note('lnd-stale', t('lnd.stale')) : '';
  const wrap = (inner: string): string =>
    `<div class="landables${p.stale ? ' stale' : ''}">${head}${inner}</div>`;

  if (p.landableCount === 0) return wrap(note('lnd-note', t('lnd.noLandableInFile')));
  if (!p.haveAlt) return wrap(note('lnd-note', t('lnd.noAltitude')));
  if (p.inRadius === 0) return wrap(note('lnd-note', t('lnd.noFieldInRadius', { dist })));

  const unjudged = Math.max(0, p.inRadius - p.judged.length);
  const anyReachable = p.judged.some(a => a.state === 'reachable');
  // Somebody was actually MEASURED and refused. Without this, "nothing is reachable" is a claim
  // about ground the DEM never answered for.
  const anyRefused = p.judged.some(a => a.state === 'unreachable');

  const banner = anyReachable ? ''
    : !anyRefused ? note('lnd-unknown', t('lnd.reachUnknown'))
    : unjudged > 0 ? note('lnd-none', t('lnd.noneOfJudgedReachable', { judged: p.judged.length }))
    : note('lnd-none', t('lnd.noneReachable'));

  const scope = unjudged > 0
    ? note('lnd-scope', t('lnd.someNotJudged', { judged: p.judged.length, inRadius: p.inRadius, dist }))
    : '';

  // A filter that empties the list says so. The rows are gone because the pilot hid them, and a
  // panel that went blank without a word would read as "no fields" — the very confusion the
  // banner above is built to prevent.
  const rows = p.rows.length === 0
    ? note('lnd-note', t('lnd.noStyleSelected'))
    : p.rows.slice(0, Math.max(0, limit)).map(a => rowHtml(a, u, t)).join('');

  return wrap(`${banner}${scope}${rows}`);
}

/** LND-008, as four checkboxes over the four landable categories. The pilot on a training flight
 *  who does not want outlanding fields in his list unticks one box, and the ROWS and the map's
 *  RINGS go — not the verdicts. Core judges every landable, always: a field excluded from the
 *  judging is a field the LND-006 banner then speaks for without ever having asked about it, and
 *  a view control that can fabricate the flight's worst alarm is not a view control.
 *
 *  `null` means no filter — every landable category — and that is what a fresh session shows: the
 *  default is the whole truth, and narrowing it is a deliberate act. State lives with the
 *  integrator (main.ts); this function only draws the current one. */
export function styleFilterHtml(selected: readonly PoiCat[] | null, t: T): string {
  const on = (cat: PoiCat): boolean => selected == null || selected.includes(cat);
  const boxes = LANDABLE_CATS.map(cat =>
    `<label class="lnd-filter-box"><input type="checkbox" id="lnd-style-${cat}"`
    + `${on(cat) ? ' checked' : ''}> ${esc(catText(cat, t))}</label>`,
  ).join('');
  return `<div class="lnd-filter">${boxes}</div>`;
}
