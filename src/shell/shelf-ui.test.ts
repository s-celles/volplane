// The claims of the shelf and cache panels, pinned at the render boundary — same discipline
// as briefing-ui.test.ts: read the output as a pilot would (is the pin stated, is the offer a
// proposal, is the unmeasured cache a dash), never as a DOM. Tag choice and class order are
// deliberately NOT pinned; what must survive refactoring is what the strings SAY and the
// data-act/data-id contract main.ts delegates on.
import { describe, expect, test } from 'bun:test';
import { shelfHtml as shelfHtmlT, cacheHtml as cacheHtmlT, BYTES_PER_MB } from './shelf-ui';
import { translator } from '../core/i18n';

// IHM-006: a translator in, the same claims out.
const en = translator('en');
const shelfHtml = (
  a: Parameters<typeof shelfHtmlT>[0], b: Parameters<typeof shelfHtmlT>[1],
  c: Parameters<typeof shelfHtmlT>[2],
): string => shelfHtmlT(a, b, c, en);
const cacheHtml = (
  a: Parameters<typeof cacheHtmlT>[0], b: number, c: Parameters<typeof cacheHtmlT>[2],
): string => cacheHtmlT(a, b, c, en);
import type { Completeness } from '../core/pack';
import type { ShelfEntry, UpdateOffer } from '../core/shelf';
import type { EvictionPlan } from '../core/cachebudget';

const entry = (id: string, name: string, pinned = false): ShelfEntry => ({
  spec: { id, name, day: '2026-07-14', area: { west: 6, south: 45, east: 6.5, north: 45.4 } },
  pinned,
  addedAt: 1_000,
  lastUsedAt: 2_000,
});

// The chip contract is against Completeness's `ready` flag, not against any particular pack —
// hand-built values keep the claim independent of how completeness() measures.
const READY: Completeness = { items: [], ready: true };
const NOT_READY: Completeness = { items: [], ready: false };

describe('shelfHtml', () => {
  test('a pinned row says pinned and offers no remove button (OFF-007)', () => {
    const out = shelfHtml([entry('a', 'Alps', true)], new Map([['a', READY]]), []);
    expect(out).toContain('pinned');
    expect(out).toContain('protected from eviction');
    expect(out).not.toContain('data-act="remove"');
  });

  test('an unpinned row offers pin, open and remove, each carrying the id', () => {
    const out = shelfHtml([entry('a', 'Alps')], new Map([['a', READY]]), []);
    expect(out).toContain('pin for flight');
    expect(out).toContain('data-act="pin" data-id="a"');
    expect(out).toContain('data-act="open" data-id="a"');
    expect(out).toContain('data-act="remove" data-id="a"');
  });

  test('a pack absent from the completeness map is unknown, not ready (POT-007)', () => {
    const out = shelfHtml([entry('a', 'Alps')], new Map(), []);
    expect(out).toContain('—');
    expect(out).toContain('unknown');
    expect(out).not.toContain('flight-ready');
  });

  test('the chip states ready or NOT ready from the measurement (OFF-010)', () => {
    const ready = shelfHtml([entry('a', 'Alps')], new Map([['a', READY]]), []);
    expect(ready).toContain('flight-ready');
    expect(ready).not.toContain('NOT flight-ready');
    const notReady = shelfHtml([entry('a', 'Alps')], new Map([['a', NOT_READY]]), []);
    expect(notReady).toContain('NOT flight-ready');
  });

  test('an offer names its reason in words and its button carries the right id (OFF-009/011)', () => {
    const offers: UpdateOffer[] = [{ id: 'b', reason: 'weather-stale' }];
    const out = shelfHtml([entry('a', 'Alps'), entry('b', 'Jura')], new Map(), offers);
    expect(out).toContain('snapshot fetched more than 48 h ago');
    expect(out).toContain('data-act="update" data-id="b"');
    expect(out).toContain('update now');
    // Only the offered pack gets the button — the other row proposes nothing.
    expect(out).not.toContain('data-act="update" data-id="a"');
  });

  test('every offer reason has its own words, none of them an error (OFF-009)', () => {
    const reasons: [UpdateOffer['reason'], string][] = [
      ['weather-missing', 'no snapshot held'],
      ['weather-stale', 'snapshot fetched more than 48 h ago'],
      ['weather-wrong-day', 'snapshot is for another day'],
    ];
    for (const [reason, words] of reasons) {
      const out = shelfHtml([entry('a', 'Alps')], new Map(), [{ id: 'a', reason }]);
      expect(out).toContain(words);
      expect(out).not.toMatch(/error|fail/i);
    }
  });

  test('a pack with no offer shows no update button', () => {
    const out = shelfHtml([entry('a', 'Alps')], new Map(), []);
    expect(out).not.toContain('data-act="update"');
    expect(out).not.toContain('update now');
  });

  test('rows keep the given order — the caller sorted, this function must not reshuffle (OFF-010)', () => {
    const out = shelfHtml([entry('b', 'Jura'), entry('a', 'Alps')], new Map(), []);
    expect(out.indexOf('Jura')).toBeLessThan(out.indexOf('Alps'));
  });

  test('a pilot-typed name cannot break the markup', () => {
    const out = shelfHtml([entry('a', '<script>alert(1)</script>')], new Map(), []);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  test('an empty shelf explains itself instead of rendering nothing', () => {
    const out = shelfHtml([], new Map(), []);
    expect(out).toContain('No packs yet');
    expect(out.length).toBeGreaterThan(0);
  });

  test('no null-heavy input ever leaks undefined or NaN', () => {
    const sweeps = [
      shelfHtml([], new Map(), []),
      shelfHtml([entry('a', 'Alps'), entry('b', 'Jura', true)], new Map(), []),
      shelfHtml([entry('a', 'Alps')], new Map(), [{ id: 'a', reason: 'weather-missing' }]),
    ];
    for (const out of sweeps) {
      expect(out).not.toContain('undefined');
      expect(out).not.toContain('NaN');
    }
  });
});

describe('cacheHtml', () => {
  // DECIMAL MB throughout (BYTES_PER_MB = 1e6) — the SAME unit enforcement multiplies the
  // setting by. These tests used to pin MiB, which had the gauge and the eviction policy
  // disagreeing by 4.9% about one number: a confirmed finding, and the claim is now one unit.
  const plan = (over: boolean): EvictionPlan => ({
    evict: ['tile/10/1/1', 'tile/10/1/2'],
    usedBytes: 300 * 1e6,
    keptBytes: 279 * 1e6,
    pinnedBytes: 260 * 1e6,
    overBudget: over,
  });

  test('an unmeasured cache is a dash, never a fake zero (POT-007)', () => {
    const out = cacheHtml(null, 256, null);
    expect(out).toContain('—');
    expect(out).toContain('256 MB');
    expect(out).not.toContain('0');
  });

  test('usage reads X MB of Y MB, one decimal', () => {
    const out = cacheHtml(12_897_484, 256, null); // 12.897 decimal MB
    expect(out).toContain('12.9 MB');
    expect(out).toContain('of 256 MB');
  });

  test('the last enforcement says what it evicted, in tiles and MB (OFF-006)', () => {
    const out = cacheHtml(300 * 1e6, 256, plan(false));
    expect(out).toContain('evicted 2 tiles');
    expect(out).toContain('21.0 MB');
  });

  test('a plan that evicted nothing says so, not a blank', () => {
    const out = cacheHtml(100 * 1e6, 256, { ...plan(false), evict: [] });
    expect(out).toContain('evicted nothing');
  });

  test('an over-budget plan says the pin wins and the ceiling cannot be met (OFF-006/007)', () => {
    const out = cacheHtml(300 * 1e6, 256, plan(true));
    expect(out).toContain('pinned packs alone exceed the ceiling');
    expect(out).toContain('cannot be met');
    expect(out).toContain('never evicted');
    expect(cacheHtml(300 * 1e6, 256, plan(false))).not.toContain('cannot be met');
  });

  test('no null-heavy input ever leaks undefined or NaN', () => {
    const sweeps = [
      cacheHtml(null, 256, null),
      cacheHtml(null, 256, plan(true)),
      cacheHtml(NaN, 256, null),
    ];
    for (const out of sweeps) {
      expect(out).not.toContain('undefined');
      expect(out).not.toContain('NaN');
    }
  });
});
