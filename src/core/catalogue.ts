// ============ the catalogue: where the files live, and how old yours is ============
// `soaring-data` ships pointers, not payloads — an airspace file goes wrong faster than a
// repository can be updated, and a wrong airspace file is worse than none: it is a TMA the pilot
// believes he is clear of. So the maintainers serve it, we link to it, and THIS app's job is the
// one nobody else can do for it: tell the pilot how old the copy in his hands is.
//
// That is the whole reason this module exists rather than a `fetch` in the shell. Three things
// have to be kept apart, and a screen that blurs them is worse than no screen:
//
//   - the file has NOT been downloaded          → nothing to be stale about
//   - it was downloaded, and it is FRESH        → a measurement
//   - it was downloaded, and its age is UNKNOWN → because upstream published no date, or the
//                                                 file carries none. NOT the same as fresh.
//
// The third is the one that kills. A blank date rendered as an empty cell reads as "fine".

/** One row of `catalogue.csv`, which is a Frictionless tabular resource — the schema lives in the
 *  package's own datapackage.json, not in a comment here. */
export interface CatalogueEntry {
  id: string;
  kind: 'airspace' | 'waypoints' | 'flarmnet' | 'weather' | 'other';
  format: string;
  /** ISO 3166-1 alpha-2, or WORLD. */
  area: string;
  name: string;
  uri: string;
  source: string | null;
  sourceUrl: string | null;
  /** NULL when we have not established it. Null is a statement, not a blank. */
  licence: string | null;
  licenceUrl: string | null;
  /** May a cache that holds this file also SHARE it? False when the licence is unknown. */
  redistributable: boolean;
  /** Upstream's own last-update date, or NULL when it publishes none. */
  updated: string | null;
  /** What the file holds AND WHAT IT DOES NOT. */
  coverage: string | null;
}

const cells = (line: string): string[] => {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};

const str = (s: string | undefined): string | null => {
  const t = (s ?? '').replace(/^"|"$/g, '').trim();
  return t === '' ? null : t;
};

/** Parse the catalogue. A row we cannot read is DROPPED — an entry with no uri is not an entry,
 *  it is a button that does nothing. Same discipline as every other reader here. */
export function parseCatalogue(csv: string): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  const lines = csv.split(/\r?\n/);
  const head = cells(lines[0] ?? '').map(h => h.trim());
  const col = (n: string): number => head.indexOf(n);
  const iId = col('id'), iUri = col('uri'), iName = col('name');
  if (iId < 0 || iUri < 0 || iName < 0) return [];       // not a catalogue we understand

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = cells(lines[i]);
    const at = (n: string): string | undefined => { const c = col(n); return c < 0 ? undefined : f[c]; };
    const id = str(f[iId]), uri = str(f[iUri]), name = str(f[iName]);
    if (!id || !uri || !name) continue;
    out.push({
      id, uri, name,
      kind: (str(at('kind')) ?? 'other') as CatalogueEntry['kind'],
      format: str(at('format')) ?? 'unknown',
      area: (str(at('area')) ?? 'WORLD').toUpperCase(),
      source: str(at('source')),
      sourceUrl: str(at('source_url')),
      licence: str(at('licence')),
      licenceUrl: str(at('licence_url')),
      // Unknown is NOT permission: anything but an explicit 'true' means no.
      redistributable: str(at('redistributable')) === 'true',
      updated: str(at('updated')),
      coverage: str(at('coverage')),
    });
  }
  return out;
}

// ---- how old is the file in my hands? ----

/** Some files state their own version and date on their first line — the French airspace file
 *  opens with `*version= ef4c9df 2026-07-04T16:32:12Z`. That date is better than any the
 *  catalogue could carry, because it describes THIS copy rather than what upstream published at
 *  some point. Read it when it is there; say nothing when it is not. */
export function versionOf(text: string): string | null {
  const m = /^\s*\*\s*version\s*=\s*(\S+)\s+(\d{4}-\d{2}-\d{2})/im.exec(text.slice(0, 500));
  return m ? m[2] : null;
}

/** What the pilot holds, and when he got it. */
export interface Held {
  entryId: string;
  /** When THIS app downloaded it (epoch ms). A measurement — our own clock, our own act. */
  fetchedAt: number;
  /** The date the FILE claims for itself (YYYY-MM-DD), when it states one. */
  fileDate: string | null;
  bytes: number;
}

export type Freshness =
  /** Never downloaded. There is nothing to be stale about, and no alarm to raise. */
  | { state: 'absent' }
  /** Downloaded, and the file dates itself: we can say how old the DATA is. */
  | { state: 'dated'; ageDays: number; fileDate: string }
  /** Downloaded, but neither the file nor the catalogue says when the DATA was made. We know only
   *  when WE fetched it — which is not the same thing, and must not be shown as if it were. */
  | { state: 'undated'; fetchedDaysAgo: number };

/** How old is it, and how sure are we? The distinction between `dated` and `undated` is the
 *  entire point: "fetched 2 days ago" says nothing about whether the airspace inside was already
 *  six months out of date when we fetched it. A screen that prints one and means the other has
 *  told the pilot his file is fresh. */
export function freshness(held: Held | null, now: number): Freshness {
  if (!held) return { state: 'absent' };
  const day = 86_400_000;
  if (held.fileDate) {
    const t = Date.parse(`${held.fileDate}T00:00:00Z`);
    if (Number.isFinite(t)) {
      return { state: 'dated', fileDate: held.fileDate, ageDays: Math.max(0, Math.floor((now - t) / day)) };
    }
  }
  return { state: 'undated', fetchedDaysAgo: Math.max(0, Math.floor((now - held.fetchedAt) / day)) };
}

/** Beyond this, an airspace file should be looked at again. Not an expiry — we cannot know that —
 *  but the age at which "I downloaded it once" stops being an answer. */
export const AIRSPACE_STALE_DAYS = 30;
