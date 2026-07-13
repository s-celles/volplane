// ============ the shelf, the cache line, the update offers — as strings (OFF-006/007/009/010/011) ============
// briefing-ui.ts's sibling, under the same contract: pure functions from values to HTML
// strings, no document, no listeners, no Tauri. main.ts owns the DOM and wires clicks by
// delegation on the container, reading data-act/data-id off whatever was clicked — those two
// attributes are the WHOLE event contract, which is why a repaint costs nothing (the mixer's
// pointer handling survives repaints for the same reason) and why bun test can assert every
// claim here without a browser.
//
// The claims are OFF's. The shelf is the pre-flight enumeration of what is held (OFF-010).
// The pin is a visible, per-pack pilot act (OFF-007) — so the toggle's label states the
// CURRENT state, and a pinned row simply has no remove button: core would refuse the removal
// anyway, and a UI must not offer what will be refused. An update is a PROPOSAL, a button the
// pilot may ignore — OFF-009's own words are "proposer — sans l'imposer" — so this file
// renders offers and never accepts one. And the cache line says what the ceiling is and what
// the last enforcement did or could not do (OFF-006), including the honest case where pinned
// packs alone exceed the budget. Throughout, main.ts's spelling of unknown: '—' with the
// 'unknown' class, never a zero somebody would believe (POT-007).

import type { Completeness } from '../core/pack';
import type { Shelf, ShelfEntry, UpdateOffer } from '../core/shelf';
import type { EvictionPlan } from '../core/cachebudget';

// Free text must not be able to break the markup around it. Pack names are pilot-typed, so
// they are the obvious case — but ids and days pass through persistence and normalizeShelf
// only checks that they are strings, so they get the same treatment: a screen is the wrong
// place to trust the disk.
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---- OFF-009: the reasons, in words ----

// OFF-011 asks for staleness NAMED, not colour-coded — so each offer reason has one sentence,
// aligned with pack.ts's own wording (the completeness screen and the offer must never
// disagree about the same snapshot).
const REASON_WORDS: Record<UpdateOffer['reason'], string> = {
  'tiles-missing': 'terrain: no tiles held — the pack cannot carry a flight',
  'tiles-partial': 'terrain: tiles missing — the pack is not flight-ready',
  'weather-missing': 'weather: no snapshot held',
  'weather-stale': 'weather: snapshot fetched more than 48 h ago',
  'weather-wrong-day': 'weather: snapshot is for another day',
};

// ---- OFF-010: the shelf, one row per promise ----

// The flight-ready chip. A pack whose completeness nobody measured is UNKNOWN, not ready —
// the dash, never a green light the measurement did not earn (POT-007 applied to readiness).
const chip = (c: Completeness | undefined): string =>
  c == null ? '<span class="badge unknown">—</span>'
    : c.ready ? '<span class="badge ready">flight-ready</span>'
    : '<span class="badge not-ready">NOT flight-ready</span>';

function rowHtml(e: ShelfEntry, c: Completeness | undefined, offer: UpdateOffer | undefined): string {
  const id = esc(e.spec.id);
  // The pin toggle names the state the pack is IN, not the action alone: 'pinned — protected
  // from eviction' is both the current fact and, implicitly, what a tap will undo. That is
  // OFF-007's visibility requirement carried by the label itself.
  const pin = e.pinned
    ? `<button data-act="pin" data-id="${id}">pinned — protected from eviction</button>`
    : `<button data-act="pin" data-id="${id}">pin for flight</button>`;
  const remove = e.pinned ? ''
    : `<button data-act="remove" data-id="${id}">remove</button>`;
  // The offer line exists only when core proposed one — and it carries a reason in words plus
  // a button. Nothing here fires the update; main.ts does, and only when the pilot taps.
  const offerLine = offer == null ? ''
    : `<div class="offer">${REASON_WORDS[offer.reason]}
        <button data-act="update" data-id="${id}">update now</button>
      </div>`;
  return `<div class="shelf-row${e.pinned ? ' pinned' : ''}">
    <span class="name">${esc(e.spec.name)}</span>
    <span class="day">${esc(e.spec.day)}</span>
    ${chip(c)}
    ${pin}
    <button data-act="open" data-id="${id}">open</button>
    ${remove}
    ${offerLine}
  </div>`;
}

/** The shelf panel (OFF-010): one row per entry, in the order GIVEN — the caller passes
 *  sortedShelf's output and this function does not re-sort, so the offers list (which follows
 *  the same order) and the screen line up one-to-one. An empty shelf explains itself instead
 *  of rendering nothing: a blank region reads as a bug, a sentence reads as a state. */
export function shelfHtml(
  shelf: Shelf,
  completenessById: ReadonlyMap<string, Completeness>,
  offers: readonly UpdateOffer[],
): string {
  if (shelf.length === 0) {
    return '<div class="shelf"><div class="shelf-empty">No packs yet — provision one above and it will be remembered</div></div>';
  }
  const offerById = new Map(offers.map(o => [o.id, o]));
  return `<div class="shelf">
    ${shelf.map(e => rowHtml(e, completenessById.get(e.spec.id), offerById.get(e.spec.id))).join('')}
  </div>`;
}

// ---- OFF-006: the ceiling, said out loud ----

// Bytes, in the unit the setting speaks: DECIMAL MB (1e6), to one decimal — the SAME unit
// enforcement multiplies the setting by. Display in MiB while enforcing in MB had the gauge
// and the eviction policy disagreeing by 4.9% about one number (a confirmed finding); one
// definition, spelled here, ends the argument. Null in, null out — and a non-finite number
// collapses to null rather than printing 'NaN' on a pre-flight screen.
export const BYTES_PER_MB = 1e6;
const mb = (bytes: number | null): string | null =>
  bytes == null || !Number.isFinite(bytes) ? null : (bytes / BYTES_PER_MB).toFixed(1);

/** The cache line: usage against the ceiling, and what the last enforcement did. A null
 *  usedBytes is a '—', NEVER '0 MB' — a zero would claim an empty cache nobody measured,
 *  which is POT-007's fake-zero rule applied to bytes. When a plan exists, its outcome is one
 *  sentence (how many tiles, how many MB); and when the plan is over budget, the display says
 *  the one honest thing there is to say: the pinned packs alone exceed the ceiling, the pin
 *  wins (OFF-007 outranks OFF-006), and the ceiling therefore cannot be met — rather than
 *  lying about either the pin or the setting. */
export function cacheHtml(
  usedBytes: number | null,
  budgetMB: number,
  lastPlan: EvictionPlan | null,
): string {
  const used = mb(usedBytes);
  const usage = `<div class="cache-usage${used == null ? ' unknown' : ''}">${
    used == null ? '—' : `${used} MB`} of ${budgetMB} MB</div>`;
  let planLines = '';
  if (lastPlan != null) {
    const n = lastPlan.evict.length;
    planLines += n === 0
      ? '<div class="evicted">last enforcement evicted nothing</div>'
      : `<div class="evicted">last enforcement evicted ${n} tile${n === 1 ? '' : 's'} (${
          mb(lastPlan.usedBytes - lastPlan.keptBytes) ?? '—'} MB)</div>`;
    if (lastPlan.overBudget) {
      planLines += `<div class="over-budget">pinned packs alone exceed the ceiling (${
        mb(lastPlan.pinnedBytes) ?? '—'} MB pinned) — pinned packs are never evicted, so the ceiling cannot be met</div>`;
    }
  }
  return `<div class="cache">${usage}${planLines}</div>`;
}
