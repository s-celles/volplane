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

import { NONE_REACHABLE, type Alternate } from '../core/landables';
import { catLabel, LANDABLE_CATS, type PoiCat } from '../core/cup';

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
const LIMIT_WORD: Record<Alternate['limit'], string> = {
  glide: 'short on glide',
  terrain: 'ridge in the way',
  unknown: 'terrain not loaded',
};

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
function marginText(m: number | null): string | null {
  if (m == null) return null;
  const r = Math.round(m);
  return `${r < 0 ? '−' : '+'}${Math.abs(r)} m`;
}

/** Three digits, always: 94° and 094° are the same bearing but not the same glance, and a
 *  column that changes width is a column that gets misread. */
function bearingText(deg: number): string {
  const d = Math.round(deg) % 360;
  return `${String((d + 360) % 360).padStart(3, '0')}°`;
}

function distanceText(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}

function elevText(m: number | null): string | null {
  return m == null ? null : `${Math.round(m)} m`;
}

/** LND-007's optional half. The .cup gives runway and frequency only when the file's author
 *  bothered, and half of them did not — so both halves of the runway are printed
 *  independently and either may be a dash. A field with a known direction and an unknown
 *  length says exactly that. */
function rwyText(rwdir: number | null, rwlenM: number | null): string {
  const dir = rwdir == null ? null : bearingText(rwdir);
  const len = rwlenM == null ? null : `${Math.round(rwlenM)} m`;
  return `${shown(dir)} · ${shown(len)}`;
}

function rowHtml(a: Alternate): string {
  const p = a.point;
  // The margin is core's verdict rendered, and the WORD comes along with it whenever the row
  // is not a plain yes: the pilot who reads 'ridge in the way' knows something a red dot never
  // told him, and the pilot who reads 'terrain not loaded' knows this is a question, not a no.
  const why = a.state === 'reachable' ? '' : `<span class="lnd-why">${LIMIT_WORD[a.limit]}</span>`;
  return `<div class="lnd-row ${LANDABLE_STATE_CLASS[a.state]}">`
    + `<span class="lnd-name">${esc(p.name)}</span>`
    + `<span class="lnd-style">${catLabel(p.cat)}</span>`
    + `<span class="lnd-margin">${shown(marginText(a.marginM))}</span>`
    + `<span class="lnd-bearing">${bearingText(a.bearingDeg)}</span>`
    + `<span class="lnd-dist">${distanceText(a.distanceM)}</span>`
    + `<span class="lnd-elev">${shown(elevText(p.elevM))}</span>`
    + `<span class="lnd-rwy">${rwyText(p.rwdirDeg, p.rwlenM)}</span>`
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
export const REACH_UNKNOWN = 'terrain not loaded — reachability UNKNOWN, not refused';
export const NO_ALTITUDE = 'no altitude — no glide slope, so nothing was judged';
export const NO_LANDABLE_IN_FILE = 'the loaded file holds no landable field';
export const noFieldInRadius = (km: number): string =>
  `no landable field within ${km} km — this file does not cover the ground you are over`;
export const NO_STYLE_SELECTED = 'every landable type is unticked — the list is FILTERED, not empty';
/** A compute budget is not a claim about the world, and the pilot is entitled to know when it
 *  bit. Reachability is not monotonic in distance — that is the whole point of the terrain
 *  march — so "the 30 nearest" is not "the 30 best", and the 31st may be the only one. */
export const someNotJudged = (judged: number, inRadius: number, km: number): string =>
  `${judged} of ${inRadius} fields within ${km} km judged — the rest were not asked about`;
/** The softened banner for exactly that case: still loud, but it no longer speaks for fields
 *  nobody marched. */
export const noneOfJudgedReachable = (judged: number): string =>
  `NONE of the ${judged} fields judged is within reach`;
export const STALE_VERDICTS = 'these verdicts are from the LAST fix received, not from now';

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
export function alternatesHtml(p: DivertPanel, limit: number = DEFAULT_LIMIT): string {
  if (!p.loaded) return '';                       // nothing was ever asked: draw nothing

  const km = Math.round(p.radiusM / 1000);
  // SYS-002, first, above everything: the boxes overhead already grey out and say the values are
  // the last received. The divert rows are DERIVED from that same aging fix — a "reachable,
  // +240 m" whose margin may have evaporated two minutes ago — and they were the one panel on the
  // screen that did not admit it had stopped being current.
  const head = p.stale ? note('lnd-stale', STALE_VERDICTS) : '';
  const wrap = (inner: string): string =>
    `<div class="landables${p.stale ? ' stale' : ''}">${head}${inner}</div>`;

  if (p.landableCount === 0) return wrap(note('lnd-note', NO_LANDABLE_IN_FILE));
  if (!p.haveAlt) return wrap(note('lnd-note', NO_ALTITUDE));
  if (p.inRadius === 0) return wrap(note('lnd-note', noFieldInRadius(km)));

  const unjudged = Math.max(0, p.inRadius - p.judged.length);
  const anyReachable = p.judged.some(a => a.state === 'reachable');
  // Somebody was actually MEASURED and refused. Without this, "nothing is reachable" is a claim
  // about ground the DEM never answered for.
  const anyRefused = p.judged.some(a => a.state === 'unreachable');

  const banner = anyReachable ? ''
    : !anyRefused ? note('lnd-unknown', REACH_UNKNOWN)
    : unjudged > 0 ? note('lnd-none', noneOfJudgedReachable(p.judged.length))
    : note('lnd-none', NONE_REACHABLE);

  const scope = unjudged > 0
    ? note('lnd-scope', someNotJudged(p.judged.length, p.inRadius, km))
    : '';

  // A filter that empties the list says so. The rows are gone because the pilot hid them, and a
  // panel that went blank without a word would read as "no fields" — the very confusion the
  // banner above is built to prevent.
  const rows = p.rows.length === 0
    ? note('lnd-note', NO_STYLE_SELECTED)
    : p.rows.slice(0, Math.max(0, limit)).map(rowHtml).join('');

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
export function styleFilterHtml(selected: readonly PoiCat[] | null): string {
  const on = (cat: PoiCat): boolean => selected == null || selected.includes(cat);
  const boxes = LANDABLE_CATS.map(cat =>
    `<label class="lnd-filter-box"><input type="checkbox" id="lnd-style-${cat}"`
    + `${on(cat) ? ' checked' : ''}> ${catLabel(cat)}</label>`,
  ).join('');
  return `<div class="lnd-filter">${boxes}</div>`;
}
