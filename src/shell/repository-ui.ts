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

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The age, in the words the pilot must read. Three states, three different sentences — and the
 *  middle one is the only one that may ever look reassuring. */
export function freshnessHtml(f: Freshness): string {
  switch (f.state) {
    case 'absent':
      return '<span class="repo-age absent">not downloaded</span>';
    case 'dated': {
      const stale = f.ageDays >= AIRSPACE_STALE_DAYS;
      return `<span class="repo-age ${stale ? 'stale' : 'fresh'}">`
        + `${f.ageDays} day${f.ageDays === 1 ? '' : 's'} old (file dated ${esc(f.fileDate)})`
        + (stale ? ' — check for an update' : '')
        + '</span>';
    }
    case 'undated':
      // The dangerous one. We know when WE fetched it and NOTHING about when the data was made,
      // and saying only the first would let a pilot read "5 days ago" as "5 days old".
      return '<span class="repo-age unknown">'
        + `fetched ${f.fetchedDaysAgo} day${f.fetchedDaysAgo === 1 ? '' : 's'} ago — `
        + 'the file states no date, so the AGE OF THE DATA is unknown</span>';
  }
}

/** The licence, said out loud — including when we do not know it, because a blank licence column
 *  reads as "unencumbered" and that is not a thing we may imply. */
function licenceHtml(e: CatalogueEntry): string {
  if (e.licence == null) {
    return '<span class="repo-lic unknown" title="Not established. Unknown is not permission — this app will not share the file.">licence unknown</span>';
  }
  const name = e.licenceUrl
    ? `<a href="${esc(e.licenceUrl)}" target="_blank" rel="noreferrer">${esc(e.licence)}</a>`
    : esc(e.licence);
  return `<span class="repo-lic">${name}${e.redistributable ? '' : ' — not redistributable'}</span>`;
}

function rowHtml(e: CatalogueEntry, held: Held | null, f: Freshness): string {
  const id = esc(e.id);
  return `<div class="repo-row">
    <div class="repo-head">
      <span class="repo-area">${esc(e.area)}</span>
      <span class="repo-name">${esc(e.name)}</span>
      <span class="repo-kind">${esc(e.kind)}</span>
      ${freshnessHtml(f)}
    </div>
    ${e.coverage ? `<div class="repo-coverage">${esc(e.coverage)}</div>` : ''}
    <div class="repo-meta">
      ${e.source ? `<span class="repo-src">maintained by ${
        e.sourceUrl ? `<a href="${esc(e.sourceUrl)}" target="_blank" rel="noreferrer">${esc(e.source)}</a>` : esc(e.source)
      }</span>` : ''}
      ${licenceHtml(e)}
      <button data-act="get" data-id="${id}">${held ? 'update' : 'download'}</button>
      ${held ? `<button data-act="use" data-id="${id}">use</button>` : ''}
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
): string {
  if (entries.length === 0) {
    return '<div class="repo"><div class="repo-empty">The catalogue holds nothing yet.</div></div>';
  }
  const note = online ? '' :
    '<div class="repo-offline">offline — what is already downloaded still works; nothing new can be fetched</div>';
  return `<div class="repo">
    <div class="repo-note">These files are served by the people who maintain them. VOLPLANE does not
      host them and does not correct them — it downloads them and tells you how old yours is.</div>
    ${note}
    ${entries.map(e => rowHtml(e, heldById.get(e.id) ?? null, freshnessOf(e))).join('')}
  </div>`;
}
