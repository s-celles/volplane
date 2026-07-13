// The one rendering rule this file exists to enforce: an UNKNOWN age must never look like a fresh
// one. A blank cell reads as "fine", and "fetched 5 days ago" reads as "5 days old" — and the
// airspace inside may have been six months stale the day it was published.
import { test, expect } from 'bun:test';
import { repositoryHtml as repositoryHtmlT, freshnessHtml as freshnessHtmlT } from './repository-ui';
import { translator } from '../core/i18n';

const en = translator('en');
const repositoryHtml = (
  a: Parameters<typeof repositoryHtmlT>[0], b: Parameters<typeof repositoryHtmlT>[1],
  c: Parameters<typeof repositoryHtmlT>[2], d: boolean,
): string => repositoryHtmlT(a, b, c, d, en);
const freshnessHtml = (f: Parameters<typeof freshnessHtmlT>[0]): string => freshnessHtmlT(f, en);
import type { CatalogueEntry, Held } from '../core/catalogue';
import { AIRSPACE_STALE_DAYS } from '../core/catalogue';

const entry = (over: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id: 'fr', kind: 'airspace', format: 'openair', area: 'FR',
  name: 'France — airspace', uri: 'https://example.org/france.txt',
  source: 'planeur-net', sourceUrl: 'https://github.com/planeur-net/airspace',
  licence: null, licenceUrl: null, redistributable: false,
  updated: null, coverage: 'Controlled airspace. Contains NO aerodromes.',
  ...over,
});

const held: Held = { entryId: 'fr', fetchedAt: 0, fileDate: null, bytes: 100 };

test('an undated file SAYS its age is unknown — it never merely shows the fetch date', () => {
  const html = freshnessHtml({ state: 'undated', fetchedDaysAgo: 5 });
  expect(html).toContain('fetched 5 days ago');
  expect(html).toContain('AGE OF THE DATA is unknown');   // the half that stops the misread
  expect(html).toContain('unknown');                       // and it wears the warning class
  expect(html).not.toContain('fresh');
});

test('a dated file says how old the DATA is, and shouts past the threshold', () => {
  const fresh = freshnessHtml({ state: 'dated', ageDays: 3, fileDate: '2026-07-10' });
  expect(fresh).toContain('3 days old');
  expect(fresh).toContain('file dated 2026-07-10');
  expect(fresh).not.toContain('check for an update');

  const old = freshnessHtml({ state: 'dated', ageDays: AIRSPACE_STALE_DAYS, fileDate: '2026-06-13' });
  expect(old).toContain('check for an update');
  expect(old).toContain('stale');
});

test('never downloaded is its own state — there is nothing to be stale about', () => {
  const html = freshnessHtml({ state: 'absent' });
  expect(html).toContain('not downloaded');
  expect(html).not.toContain('old');
  expect(html).not.toContain('unknown');       // absent is not "unknown age": it is ABSENT
});

test('an unknown licence is SAID — a blank column would read as unencumbered', () => {
  const html = repositoryHtml([entry()], new Map(), () => ({ state: 'absent' }), true);
  expect(html).toContain('licence unknown');
  expect(html).not.toContain('not redistributable');   // we say the licence is unknown, not that
});

test('a known, non-redistributable licence says BOTH things', () => {
  const html = repositoryHtml(
    [entry({ licence: 'ODbL', licenceUrl: 'https://x/l', redistributable: false })],
    new Map(), () => ({ state: 'absent' }), true);
  expect(html).toContain('ODbL');
  expect(html).toContain('not redistributable');
});

test('the coverage — including what the file does NOT hold — reaches the screen', () => {
  const html = repositoryHtml([entry()], new Map(), () => ({ state: 'absent' }), true);
  expect(html).toContain('Contains NO aerodromes');
  // And the panel never claims to be the source of the data. Whitespace-normalised: the sentence
  // wraps in the template, and a test that pinned the line breaks would be pinning the layout.
  expect(html.replace(/\s+/g, ' ')).toContain('does not host them and does not correct them');
});

test('a held entry offers update and use; an absent one only download', () => {
  const absent = repositoryHtml([entry()], new Map(), () => ({ state: 'absent' }), true);
  expect(absent).toContain('>download<');
  expect(absent).not.toContain('data-act="use"');

  const there = repositoryHtml([entry()], new Map([['fr', held]]),
    () => ({ state: 'undated', fetchedDaysAgo: 1 }), true);
  expect(there).toContain('>update<');
  expect(there).toContain('data-act="use" data-id="fr"');
});

test('offline says what still works, rather than looking broken', () => {
  const html = repositoryHtml([entry()], new Map(), () => ({ state: 'absent' }), false);
  expect(html).toContain('offline');
  expect(html).toContain('already downloaded still works');
});

test('a pilot-typed name cannot break the markup', () => {
  const html = repositoryHtml([entry({ name: '<script>alert(1)</script>' })], new Map(),
    () => ({ state: 'absent' }), true);
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});
