// The distinction this whole module exists to protect: "I fetched it two days ago" is NOT "the
// airspace inside is two days old". A file can be downloaded this morning and have been six
// months stale when it was published. A screen that prints the first and means the second has
// told the pilot his airspace is current. These tests fail if the two ever collapse into one.
import { test, expect } from 'bun:test';
import { parseCatalogue, versionOf, freshness, AIRSPACE_STALE_DAYS } from './catalogue';
import catalogueCsv from 'soaring-data/catalogue/catalogue.csv' with { type: 'text' };

const DAY = 86_400_000;
const NOW = Date.parse('2026-07-13T12:00:00Z');

test('the real catalogue parses, and its unknown licence is not permission', () => {
  const entries = parseCatalogue(catalogueCsv);
  expect(entries.length).toBeGreaterThan(0);
  const fr = entries.find(e => e.area === 'FR' && e.kind === 'airspace')!;
  expect(fr).toBeDefined();
  expect(fr.uri).toStartWith('https://');
  expect(fr.source).toBe('planeur-net');
  // The licence was never established, so the entry says so — and 'unknown' is not 'yes'.
  expect(fr.licence).toBeNull();
  expect(fr.redistributable).toBe(false);
  // And the coverage says what the file does NOT contain, which is the half that stops a pilot
  // inferring a coverage nobody promised.
  expect(fr.coverage).toContain('NO aerodromes');
});

test('a row with no uri is not an entry — it is a button that does nothing', () => {
  const csv = [
    'id,kind,format,area,name,uri,redistributable',
    'good,airspace,openair,FR,France,https://example.org/f.txt,false',
    'nouri,airspace,openair,FR,Nowhere,,false',
    ',airspace,openair,FR,No id,https://example.org/x.txt,false',
  ].join('\n');
  expect(parseCatalogue(csv).map(e => e.id)).toEqual(['good']);
});

test('redistributable is false unless the catalogue says true, in so many letters', () => {
  const row = (v: string): string =>
    ['id,kind,format,area,name,uri,redistributable', `x,airspace,openair,FR,F,https://e.org/f,${v}`].join('\n');
  expect(parseCatalogue(row('true'))[0].redistributable).toBe(true);
  expect(parseCatalogue(row('false'))[0].redistributable).toBe(false);
  expect(parseCatalogue(row(''))[0].redistributable).toBe(false);      // unknown is NOT permission
  expect(parseCatalogue(row('yes'))[0].redistributable).toBe(false);
});

test('a file that dates itself is read — the French airspace does', () => {
  const head = '*version= ef4c9df 2026-07-04T16:32:12Z\n**********\nAC D\n';
  expect(versionOf(head)).toBe('2026-07-04');
  expect(versionOf('AC D\nAN SOMETHING\n')).toBeNull();       // no claim, so we make none
});

test('freshness keeps THREE states apart, and the third is the one that kills', () => {
  // Never downloaded: nothing to be stale about.
  expect(freshness(null, NOW)).toEqual({ state: 'absent' });

  // The file dates ITSELF: we can speak about the age of the DATA.
  const dated = freshness(
    { entryId: 'fr', fetchedAt: NOW - 2 * DAY, fileDate: '2026-06-13', bytes: 10 }, NOW);
  expect(dated.state).toBe('dated');
  expect(dated).toMatchObject({ ageDays: 30, fileDate: '2026-06-13' });

  // Fetched TWO DAYS AGO, and the data inside is THIRTY days old. If these two numbers were ever
  // allowed to be the same field, this is the flight where it would matter.
  expect(dated.state === 'dated' && dated.ageDays).toBe(30);
  expect(dated.state === 'dated' && dated.ageDays >= AIRSPACE_STALE_DAYS).toBe(true);

  // No date anywhere: we know only when WE fetched it, and we say ONLY that.
  const undated = freshness(
    { entryId: 'x', fetchedAt: NOW - 5 * DAY, fileDate: null, bytes: 10 }, NOW);
  expect(undated).toEqual({ state: 'undated', fetchedDaysAgo: 5 });
});

test('an unparsable file date falls back to "undated" — never to a confident wrong age', () => {
  const f = freshness({ entryId: 'x', fetchedAt: NOW - DAY, fileDate: 'soon', bytes: 1 }, NOW);
  expect(f.state).toBe('undated');
});
