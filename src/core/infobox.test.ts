// ============ what these tests pin ============
// The registry CLAIMS (IHM-001, IHM-002). A box is a value, and the value is complete: every box
// has a label in EVERY language we ship (a box that renders its own id in a cockpit is a bug the
// pilot discovers at 1 500 m), exactly one spelling of its unit, and a getter that PROJECTS —
// which is why an all-null source yields nothing but nulls, and never a fabricated zero (POT-007).
// And the pages the pilot boots on always have numbers on them: a stale id costs its box, never
// the page, and never the whole dashboard.
import { test, expect } from 'bun:test';
import { CATALOGUES, LANGS } from './i18n';
import { BOXES, BOX_BY_ID, DEFAULT_PAGES, sanitizePages, type BoxSource, type Page, editPages, type BoxId } from './infobox';

/** Every field unknown — the state the app is genuinely in for the first seconds after launch,
 *  before the first fix, and the state it returns to whenever the receiver drops out. */
const ALL_NULL: BoxSource = {
  latDeg: null, lonDeg: null, altM: null, qnhAltM: null, groundElevM: null, aglM: null,
  varioMs: null, avg30Ms: null, lastThermalMs: null, lastCircleMs: null,
  nettoMs: null, superNettoMs: null,
  tasMs: null, groundSpeedMs: null, stfMs: null,
  windDirDeg: null, windSpeedMs: null, instWindDirDeg: null, instWindSpeedMs: null,
  arrivalM: null, mcMs: null,
};

test('every box has a label in every catalogue we ship', () => {
  expect(BOXES.length).toBeGreaterThan(0);
  const missing: string[] = [];
  for (const b of BOXES)
    for (const lang of LANGS)
      if (!(b.labelId in CATALOGUES[lang])) missing.push(`${lang}: ${b.labelId} (${b.id})`);
  expect(missing).toEqual([]);
});

test('a badge, when a box wears one, is spelled in every catalogue too', () => {
  // VEN-001: the estimated wind must never wear the measured wind's face. A badge whose text is
  // missing is a badge that does not appear — which is exactly the confusion it exists to prevent.
  const badged = BOXES.filter(b => b.badgeId != null);
  expect(badged.map(b => b.id)).toEqual(['windDir', 'windSpeed']);
  for (const b of badged)
    for (const lang of LANGS) {
      expect(b.badgeId! in CATALOGUES[lang]).toBe(true);
      expect(b.badgeTitleId! in CATALOGUES[lang]).toBe(true);
    }
});

test('the default pages are usable on the first flight', () => {
  expect(DEFAULT_PAGES.length).toBe(3);
  expect(new Set(DEFAULT_PAGES.map(p => p.id)).size).toBe(3);
  for (const p of DEFAULT_PAGES) {
    expect(p.boxIds.length).toBeGreaterThan(0);
    for (const id of p.boxIds) expect(BOX_BY_ID.has(id)).toBe(true);
    for (const lang of LANGS) expect(p.titleId in CATALOGUES[lang]).toBe(true);
  }
});

test('BOX_BY_ID holds exactly the registry, once each', () => {
  expect(BOX_BY_ID.size).toBe(BOXES.length);
  for (const b of BOXES) expect(BOX_BY_ID.get(b.id)).toBe(b);
});

test('a box names a Quantity or a fixed unit — never both, never neither', () => {
  // One spelling of a unit per box. A box with both would let the renderer pick, and two renderers
  // would pick differently.
  for (const b of BOXES) {
    if (b.quantity === null) expect(typeof b.fixedUnit).toBe('string');
    else expect(b.fixedUnit).toBeUndefined();
  }
  // The four that are degrees on every panel on earth, and nothing else.
  expect(BOXES.filter(b => b.quantity === null).map(b => b.id))
    .toEqual(['lat', 'lon', 'windDir', 'instWindDir']);
});

test('no box invents a zero out of an absent fix (POT-007)', () => {
  for (const b of BOXES) expect(`${b.id}: ${b.get(ALL_NULL)}`).toBe(`${b.id}: null`);
});

test('a getter projects: it reads its own field and does no arithmetic', () => {
  // The pin that keeps a getter from becoming a second flight computer: what goes in comes out.
  const s: BoxSource = { ...ALL_NULL, altM: 1234.5, aglM: 800, varioMs: -1.4, windDirDeg: 270 };
  expect(BOX_BY_ID.get('alt')!.get(s)).toBe(1234.5);
  expect(BOX_BY_ID.get('agl')!.get(s)).toBe(800);
  expect(BOX_BY_ID.get('vario')!.get(s)).toBe(-1.4);
  expect(BOX_BY_ID.get('windDir')!.get(s)).toBe(270);
  // An unknown neighbour stays unknown: no box borrows from another.
  expect(BOX_BY_ID.get('groundSpeed')!.get(s)).toBeNull();
});

// ---- sanitizePages: untrusted disk bytes, and a dashboard that always has numbers on it ----

test('an id the app no longer ships costs its box, not the page', () => {
  const pages = sanitizePages([
    { id: 'p1', titleId: 'page.cruise', boxIds: ['alt', 'flux-capacitor', 'vario'] },
  ]);
  expect(pages).toEqual([{ id: 'p1', titleId: 'page.cruise', boxIds: ['alt', 'vario'] }]);
});

test('a duplicate id is the same box twice, so it is dropped', () => {
  const pages = sanitizePages([{ id: 'p1', titleId: 'page.cruise', boxIds: ['alt', 'alt', 'agl'] }]);
  expect(pages[0]!.boxIds).toEqual(['alt', 'agl']);
});

test('a page that empties out is dropped, and the pages beside it survive', () => {
  const pages = sanitizePages([
    { id: 'rotten', titleId: 'page.cruise', boxIds: ['nope', 'gone'] },
    { id: 'good', titleId: 'page.climb', boxIds: ['vario'] },
  ]);
  expect(pages.map(p => p.id)).toEqual(['good']);
});

test('garbage yields the default pages — never a screen with no numbers on it', () => {
  const garbage: unknown[] = [
    null, undefined, 'cruise', 42, {}, [1, 2, 3], [null], [{}],
    [{ id: 'p', titleId: 'page.cruise', boxIds: 'alt' }],
    [{ id: '', titleId: 'page.cruise', boxIds: ['alt'] }],
    [{ id: 'p', titleId: 'page.cruise', boxIds: ['nope'] }],
  ];
  for (const raw of garbage) expect(sanitizePages(raw)).toEqual(DEFAULT_PAGES as unknown as never);
});

test('the pages handed back are fresh, so no caller can poison the default', () => {
  const a = sanitizePages(null);
  expect(a).not.toBe(DEFAULT_PAGES);
  expect(a[0]).not.toBe(DEFAULT_PAGES[0]);
  a[0]!.boxIds.length = 0;
  a.length = 1;
  expect(DEFAULT_PAGES.length).toBe(3);
  expect(DEFAULT_PAGES[0]!.boxIds.length).toBeGreaterThan(0);
  expect(sanitizePages(null)).toEqual(DEFAULT_PAGES as unknown as never);
});

test('a page the pilot really built round-trips through JSON untouched', () => {
  const mine: Page[] = [{ id: 'mine', titleId: 'page.cruise', boxIds: ['mc', 'arrival'] }];
  expect(sanitizePages(JSON.parse(JSON.stringify(mine)))).toEqual(mine);
});

// ---- the pilot's edits (IHM-001/002), and the page that used to disappear ----

const page = (boxIds: BoxId[]): Page[] => [
  { id: 'mine', titleId: 'page.cruise', boxIds },
  { id: 'other', titleId: 'page.climb', boxIds: ['vario'] },
];

test('a page NEVER loses its last box — removing it would have destroyed the page', () => {
  // The failure this pins, end to end: the shell spliced the id out, handed the result to
  // normalizeSettings, and normalizeSettings is the DISK reader — sanitizePages drops an empty
  // page, rightly, because a titled rectangle with no numbers in it is corruption when it comes
  // off disk. So the ninth 'remove' tap on a nine-box page deleted the page, wrote the deletion
  // to disk, and left no control anywhere on the settings screen to make another one. A pilot
  // rebuilding a page lost the page.
  const one = page(['alt']);
  expect(editPages(one, 'mine', 'box-remove', 'alt')).toEqual(one);

  // And the page survives the round trip that used to eat it.
  expect(sanitizePages(editPages(one, 'mine', 'box-remove', 'alt')).map(p => p.id))
    .toEqual(['mine', 'other']);

  // Removing is still removing, right down to the last-but-one.
  expect(editPages(page(['alt', 'agl']), 'mine', 'box-remove', 'agl')[0]!.boxIds).toEqual(['alt']);
});

test('the edits are edits: add, move, and never a duplicate', () => {
  expect(editPages(page(['alt']), 'mine', 'box-add', 'vario')[0]!.boxIds).toEqual(['alt', 'vario']);
  // The same box twice would read the same number in two rectangles and steal the room from a box
  // that has something else to say.
  expect(editPages(page(['alt', 'vario']), 'mine', 'box-add', 'alt')[0]!.boxIds)
    .toEqual(['alt', 'vario']);
  // A box id the registry does not know is not a box.
  expect(editPages(page(['alt']), 'mine', 'box-add', 'nonsense')[0]!.boxIds).toEqual(['alt']);

  expect(editPages(page(['alt', 'vario']), 'mine', 'box-up', 'vario')[0]!.boxIds)
    .toEqual(['vario', 'alt']);
  expect(editPages(page(['alt', 'vario']), 'mine', 'box-down', 'alt')[0]!.boxIds)
    .toEqual(['vario', 'alt']);
  // The ends hold: nothing falls off the top or the bottom.
  expect(editPages(page(['alt', 'vario']), 'mine', 'box-up', 'alt')[0]!.boxIds)
    .toEqual(['alt', 'vario']);
  expect(editPages(page(['alt', 'vario']), 'mine', 'box-down', 'vario')[0]!.boxIds)
    .toEqual(['alt', 'vario']);
});

test('an edit touches ONE page, and never the value it was handed', () => {
  const before = page(['alt', 'vario']);
  const snapshot = JSON.parse(JSON.stringify(before));
  const after = editPages(before, 'mine', 'box-remove', 'alt');
  expect(before).toEqual(snapshot);                    // the normalizer's value is not mutated
  expect(after[1]).toEqual(before[1]!);                // the other page is untouched…
  expect(after[1]).not.toBe(before[1]);                // …and it is still a fresh object
  // A page id nobody has, or a tap racing a repaint: nothing to do, and nothing done.
  expect(editPages(before, 'ghost', 'box-remove', 'alt')).toEqual(before);
  expect(editPages(before, 'mine', 'box-remove', 'mc')).toEqual(before);
});
