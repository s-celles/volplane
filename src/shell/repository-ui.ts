// ============ the repository screen (OFF-009's other half) ============
// The catalogue says where a file lives; this says how old the one in the pilot's hands is — and
// it is the ONE thing an app can do that the maintainers of the file cannot do for it.
//
// The whole design is in the three states core keeps apart (`freshness`), and the rendering rule
// is one sentence: **an unknown age must never look like a fresh one.** A blank cell reads as
// "fine". So `undated` gets words, in the warning colour, saying exactly what we do and do not
// know — "you fetched it 5 days ago; nobody says when the airspace inside was made."
//
// Pure strings, like every other renderer here: values in, HTML out, no DOM and no fetch. The
// click contract is data-act/data-id on the container, the same one the shelf uses.

import type { CatalogueEntry, Freshness, Held } from '../core/catalogue';
import { AIRSPACE_STALE_DAYS } from '../core/catalogue';
import type { T } from './infobox-ui';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The age, in the words the pilot must read. Three states, three different sentences — and the
 *  middle one is the only one that may ever look reassuring. */
export function freshnessHtml(f: Freshness, t: T): string {
  switch (f.state) {
    case 'absent':
      return `<span class="repo-age absent">${esc(t('repo.notDownloaded'))}</span>`;
    case 'dated': {
      const stale = f.ageDays >= AIRSPACE_STALE_DAYS;
      return `<span class="repo-age ${stale ? 'stale' : 'fresh'}">`
        + esc(t('repo.dated', { days: f.ageDays, date: f.fileDate }))
        + (stale ? esc(t('repo.checkUpdate')) : '')
        + '</span>';
    }
    case 'undated':
      // The dangerous one. We know when WE fetched it and NOTHING about when the data was made,
      // and saying only the first would let a pilot read "5 days ago" as "5 days old".
      return `<span class="repo-age unknown">${
        esc(t('repo.undated', { days: f.fetchedDaysAgo }))}</span>`;
  }
}

/** The licence, said out loud — including when we do not know it, because a blank licence column
 *  reads as "unencumbered" and that is not a thing we may imply. */
function licenceHtml(e: CatalogueEntry, t: T): string {
  if (e.licence == null) {
    return `<span class="repo-lic unknown" title="${esc(t('repo.licenceUnknown.title'))}">${
      esc(t('repo.licenceUnknown'))}</span>`;
  }
  const name = e.licenceUrl
    ? `<a href="${esc(e.licenceUrl)}" target="_blank" rel="noreferrer">${esc(e.licence)}</a>`
    : esc(e.licence);
  return `<span class="repo-lic">${name}${
    e.redistributable ? '' : esc(t('repo.notRedistributable'))}</span>`;
}

function rowHtml(e: CatalogueEntry, held: Held | null, f: Freshness, t: T): string {
  const id = esc(e.id);
  return `<div class="repo-row">
    <div class="repo-head">
      <span class="repo-area">${esc(e.area)}</span>
      <span class="repo-name">${esc(e.name)}</span>
      <span class="repo-kind">${esc(e.kind)}</span>
      ${freshnessHtml(f, t)}
    </div>
    ${e.coverage ? `<div class="repo-coverage">${esc(e.coverage)}</div>` : ''}
    <div class="repo-meta">
      ${e.source ? `<span class="repo-src">${esc(t('repo.maintainedBy'))} ${
        e.sourceUrl ? `<a href="${esc(e.sourceUrl)}" target="_blank" rel="noreferrer">${esc(e.source)}</a>` : esc(e.source)
      }</span>` : ''}
      ${licenceHtml(e, t)}
      <button data-act="get" data-id="${id}">${esc(held ? t('repo.update') : t('repo.download'))}</button>
      ${held ? `<button data-act="use" data-id="${id}">${esc(t('repo.use'))}</button>` : ''}
    </div>
  </div>`;
}

/** The panel. An empty catalogue explains itself rather than rendering nothing — a blank region
 *  reads as a bug, a sentence reads as a state. */
export function repositoryHtml(
  entries: readonly CatalogueEntry[],
  heldById: ReadonlyMap<string, Held>,
  freshnessOf: (e: CatalogueEntry) => Freshness,
  online: boolean,
  t: T,
): string {
  if (entries.length === 0) {
    return `<div class="repo"><div class="repo-empty">${esc(t('repo.empty'))}</div></div>`;
  }
  const note = online ? '' :
    `<div class="repo-offline">${esc(t('repo.offline'))}</div>`;
  return `<div class="repo">
    <div class="repo-note">${esc(t('repo.note'))}</div>
    ${note}
    ${entries.map(e => rowHtml(e, heldById.get(e.id) ?? null, freshnessOf(e), t)).join('')}
  </div>`;
}
