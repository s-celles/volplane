// ============ TSK-011: the goto search, as the pilot sees it ============
//
// core/goto.ts decided WHICH places answer a query and IN WHAT ORDER. This file is only the drawing
// of that answer, and it is pure — it takes the ranked results and returns HTML, so the ranking can
// be tested without a browser and the drawing without a ranking.
//
// One rule carries over from the core and must not be softened here: a row is a place the pilot can
// fly to, and it must show him enough to know he picked the right one WITHOUT a second glance —
// because in the air he does not get a second glance. The name, the code he may have typed, what kind
// of place it is, and how far and which way. No more: a row that wraps to two lines is a row he
// scrolls past.

import { formatText, type UnitPrefs } from '../core/units';
import type { GotoResult } from '../core/goto';

export type T = (id: string, params?: Record<string, string | number>) => string;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Three digits, always. 94° and 094° are the same bearing and not the same glance, and a column that
 *  changes width is a column that gets misread — the landables panel learned this first. */
const bearing3 = (deg: number): string => `${String((Math.round(deg) % 360 + 360) % 360).padStart(3, '0')}°`;

/** One row: the place, and just enough to be sure of it.
 *
 *  The DISTANCE is null on the ground, and there it simply is not shown — an empty `— km` would claim
 *  a measurement nobody made. The pilot briefing in the clubhouse does not need it; he knows where
 *  Saint-Auban is, he needs its name spelled the way the file spells it.
 *
 *  `data-i` carries the index into the results array. The shell reads it back and looks the point up
 *  there, so no coordinate is ever round-tripped through the DOM as a string — a lat/lon that went out
 *  as text and came back parsed is a lat/lon one truncation away from a different valley. */
export function gotoRowHtml(r: GotoResult, i: number, units: UnitPrefs, t: T): string {
  const p = r.point;
  const code = p.code !== null && p.code !== '' ? `<span class="goto-code">${esc(p.code)}</span>` : '';
  const far = r.distanceM !== null && r.bearingDeg !== null
    ? `<span class="goto-dist">${esc(formatText(r.distanceM, 'distance', units.distance))}</span>`
      + `<span class="goto-brg">${bearing3(r.bearingDeg)}</span>`
    : '';
  return `<button type="button" class="goto-row" data-goto="${i}">
    <span class="goto-name">${esc(p.name)}</span>
    ${code}
    <span class="goto-cat">${esc(t(`cup.cat.${p.cat}`))}</span>
    ${far}
  </button>`;
}

/** The whole panel: the input the pilot types into, and the rows his letters found.
 *
 *  It is emitted ONCE and never rebuilt while he types — see the shell. Rebuilding it on every
 *  keystroke would take the caret out from under his thumb mid-word, which on a bumpy day means he
 *  types "aubn", gets nothing, and concludes the search is broken. The INPUT is static; only the
 *  ROWS below it are repainted. So this function draws the rows; the input lives in the markup the
 *  shell emits around it. */
export function gotoResultsHtml(results: readonly GotoResult[], query: string, units: UnitPrefs, t: T): string {
  if (results.length === 0) {
    // Nothing matched, and this is NOT a fault. `core/goto` refuses to fall back to the nearest
    // fields when a query matches nothing — a pilot who typed `LFNS` and was handed the strip 4 km
    // away would fly to the strip. So an empty result is an honest "I do not have that", and it must
    // read as that and not as a broken box.
    const key = query.trim() === '' ? 'goto.empty' : 'goto.none';
    return `<p class="goto-note">${t(key)}</p>`;
  }
  return `<div class="goto-list">${results.map((r, i) => gotoRowHtml(r, i, units, t)).join('')}</div>`;
}
