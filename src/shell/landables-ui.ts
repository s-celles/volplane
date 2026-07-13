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
    + `<span class="lnd-freq">${shown(p.freq)}</span>`
    + why
    + `</div>`;
}

/** The divert list (LND-004): the fields core ranked, best margin first, in core's order.
 *
 *  Two silences, and they are not the same silence. An EMPTY list means no .cup is loaded —
 *  nothing was ever asked, so there is nothing to answer, and the panel is not drawn at all: a
 *  permanently empty box teaches the eye to skip that corner of the screen, and the eye keeps
 *  skipping it on the day the box finally has something to say (the argument flarmHtml already
 *  makes). A NON-EMPTY list with nothing reachable is the opposite of silence — it is the
 *  worst news of the flight, and LND-006 makes us say it out loud, above the rows, in core's
 *  own words. The rows still show, because "unreachable by 40 m" and "unreachable by 1400 m"
 *  are different situations and the pilot is about to have to choose between them. */
export function alternatesHtml(list: readonly Alternate[], limit: number = DEFAULT_LIMIT): string {
  if (list.length === 0) return '';

  // Not `list.some(reachable)` on the SLICE: the banner must judge the whole list, or a ninth
  // reachable field pushed past the cut would make us shout NONE_REACHABLE while one existed.
  const none = list.every(a => a.state !== 'reachable')
    ? `<div class="lnd-none">${NONE_REACHABLE}</div>`
    : '';

  const rows = list.slice(0, Math.max(0, limit)).map(rowHtml).join('');
  return `<div class="landables">${none}${rows}</div>`;
}

/** LND-008, as four checkboxes over the four landable styles. The pilot on a training flight
 *  who does not want outlanding fields in his list unticks one box, and core's `styles` option
 *  does the rest — the filtering happens where landability is decided (cup.ts's codes), never
 *  by hiding rows here, because a row hidden by the renderer is still a field the map paints
 *  and the count claims.
 *
 *  `null` means no filter — every landable style — and that is what a fresh session shows: the
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
