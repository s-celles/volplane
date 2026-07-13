// ============ the InfoBoxes and the page tabs (IHM-001, IHM-002, CFG-003, POT-007) ============
// The screen the pilot makes his own, rendered. core/infobox holds WHAT a box is — an id, a label
// id, a quantity, a one-line getter — and this file holds what a box LOOKS like. Nothing else:
// values in, an HTML string out, no DOM, no fetch, no state, like alerts-ui and landables-ui.
//
// It never judges and never computes. The numbers come from the registry's getters, the words from
// the catalogue (IHM-006 — a renderer that spells a label itself is a label the catalogue cannot
// reach), and the arithmetic from units.format. Three sources, none of them here, because a second
// place that knows how to turn 1000 m into feet is a second place that can be wrong about it.
//
// This is where CFG-003 finally happens: the last centimetre. Everything upstream — the store, the
// getters, the BoxSource handed to boxesHtml — is SI and stays SI. The foot exists for the width of
// one string.
//
// And a null is UNKNOWN all the way to the pixel (POT-007): a dash, the `unknown` class, and NO
// unit. "— ft" still claims a foot was involved in a measurement nobody made.

import { BOX_BY_ID, type BoxDef, type BoxSource, type Page } from '../core/infobox';
import { format, type Quantity, type UnitPrefs } from '../core/units';

/** The translator, handed in. The renderer must never CHOOSE a language — detection is the shell's
 *  business, and a renderer that reached for a locale would be a renderer no test could pin to a
 *  catalogue. Exported so the sibling renderers spell the same thing the same way. */
export type T = (id: string, params?: Record<string, string | number>) => string;

/** A page title today comes from our own catalogue and a box label likewise, so nothing here can
 *  currently carry markup. It is escaped anyway, for the same reason landables-ui escapes a .cup
 *  field name: it costs nothing, and the day a pilot names his own page the discipline is already
 *  in place rather than being remembered. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ONE box renderer in this codebase, exported on its own because the Analysis screen draws boxes
 *  too. Two renderers would be two answers to "what does an unknown look like", and only one of
 *  them would be the tested one.
 *
 *  The markup is exactly what the dashboard has always emitted, so app.css needs no new rule:
 *  a `.box`, a `.k` holding the label and its badge, a `.v` holding the number and a small `.u`.
 *
 *  `quantity: null` is the box that is not a quantity — a latitude, a wind direction: degrees on
 *  every panel on earth. It carries a fixedUnit and the pilot's unit choice never touches it. */
export function boxHtml(
  label: string,
  value: number | null,
  quantity: Quantity | null,
  units: UnitPrefs,
  opts?: { fixedUnit?: string; digits?: number; badge?: string },
): string {
  const known = value != null && Number.isFinite(value);
  // CFG-003, here and nowhere before: SI went in, the pilot's unit comes out. format() owns the
  // dash, the rounding and the disappearing unit — this file does not reimplement any of them.
  const shown = quantity != null
    ? format(value, quantity, units[quantity], opts?.digits)
    : { text: known ? value.toFixed(opts?.digits ?? 0) : '—', unit: known ? (opts?.fixedUnit ?? '') : '' };

  const badge = opts?.badge ?? '';
  return `<div class="box${known ? '' : ' unknown'}">`
    + `<div class="k">${esc(label)}${badge}</div>`
    + `<div class="v">${esc(shown.text)}<span class="u">${esc(shown.unit)}</span></div>`
    + `</div>`;
}

/** VEN-001, riding the definition rather than the renderer: a value we INFERRED must not wear the
 *  face of a value an instrument MEASURED. The badge is built here only because HTML is built here;
 *  which boxes get one is the registry's decision, and it is the only one. */
function badgeHtml(def: BoxDef, t: T): string {
  if (def.badgeId == null) return '';
  const title = def.badgeTitleId == null ? '' : esc(t(def.badgeTitleId));
  return `<span class="badge estimated" title="${title}">${esc(t(def.badgeId))}</span>`;
}

/** One page of the pilot's dashboard (IHM-001), in the ORDER he put the ids in — the order IS the
 *  configuration, and this file must not have an opinion about it.
 *
 *  An id that no longer resolves renders NOTHING. sanitizePages should have dropped it on the way
 *  off disk, so reaching here means a bug — and a bug that costs one box is survivable on a flight
 *  screen in a way that a bug shouting 'undefined' between the altitude and the vario is not.
 *
 *  `stale` (SYS-002) only reaches the container: the values age VISIBLY, they do not vanish. A
 *  screen that blanks under a pilot mid-turn has taken away the last thing he had. */
export function boxesHtml(
  page: Page,
  s: BoxSource,
  units: UnitPrefs,
  t: T,
  opts?: { stale?: boolean },
): string {
  const boxes = page.boxIds
    .map(id => BOX_BY_ID.get(id))
    .filter((def): def is BoxDef => def !== undefined)
    .map(def => boxHtml(t(def.labelId), def.get(s), def.quantity, units, {
      fixedUnit: def.fixedUnit,
      digits: def.digits,
      badge: badgeHtml(def, t),
    }))
    .join('');
  return `<div class="boxes${opts?.stale ? ' stale' : ''}">${boxes}</div>`;
}

/** IHM-002: the pages the pilot flips between as the flight changes phase.
 *
 *  `data-page` rather than a bound handler, because main.ts delegates the click on a container it
 *  builds once and this nav repaints under it — a listener attached to a button that the next
 *  render replaces is a tab that stops working after the first fix. */
export function pageTabsHtml(pages: readonly Page[], activeId: string, t: T): string {
  const tabs = pages.map(p =>
    `<button class="page-tab${p.id === activeId ? ' active' : ''}" type="button" `
    + `data-page="${esc(p.id)}">${esc(t(p.titleId))}</button>`,
  ).join('');
  return `<nav class="page-tabs">${tabs}</nav>`;
}
