// The claims of the briefing panel, pinned at the render boundary. These tests read the output
// as a pilot would — is the unknown a dash, is the modelled number badged, does the sandbox say
// so — and never as a DOM. Markup details (tag choice, class order) are deliberately NOT pinned:
// what must survive refactoring is what the strings SAY.
import { describe, expect, test } from 'bun:test';
import { briefingHtml, completenessHtml, emagramSvg, offlineBadgeHtml } from './briefing-ui';
import { briefingAt, type Briefing, type EmagramGeom } from '../core/briefing';
import { completeness, tilesForArea, tileKey, type Held, type PackSpec } from '../core/pack';

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

// A fully-populated briefing, by hand — the render contract is against the Briefing shape,
// not against any particular atmosphere.
const FULL: Briefing = {
  source: 'forecast',
  hour: 12,
  cloudbase: 1500,
  ceiling: 2200,
  stability: 0.012,
  wind: [
    { alt: 500, speed: 5, dirFrom: 270 },
    { alt: 1500, speed: 8, dirFrom: 300 },
  ],
  sounding: null,
  summary: { depth: 1800, isCu: true, openTop: false },
};

describe('briefingHtml', () => {
  test('an all-null briefing renders dashes, never a fake zero (POT-007)', () => {
    const out = briefingHtml(briefingAt(null, 12, 'forecast'));
    expect(out).toContain('Cloudbase');
    expect(out).toContain('—');
    expect(out).toContain('unknown');
    // The one output that must be impossible: a zero the pilot would believe.
    expect(out).not.toContain('0 m');
    expect(out).not.toMatch(/>0</);
  });

  test('every numeric value carries the modelled badge (POT-007)', () => {
    const out = briefingHtml(FULL);
    // cloudbase + ceiling + stability + convection depth, then three numbers per wind rung.
    const numericValues = 4 + FULL.wind.length * 3;
    expect(count(out, '>modelled<')).toBeGreaterThanOrEqual(numericValues);
    expect(out).toContain('indicative, not validated');
  });

  test('a sandbox briefing says SANDBOX; a forecast one does not (WX-005)', () => {
    const sandbox = briefingHtml({ ...FULL, source: 'sandbox' });
    expect(sandbox).toContain('SANDBOX — synthetic atmosphere');
    expect(sandbox).toContain('sandbox');
    expect(briefingHtml(FULL)).not.toContain('SANDBOX');
  });

  test('wind rows show km/h and the FROM direction', () => {
    const out = briefingHtml(FULL);
    expect(out).toContain('km/h');
    expect(out).toContain('from');
    expect(out).toContain('18'); // 5 m/s → 18 km/h
    expect(out).toContain('270');
  });
});

describe('completenessHtml', () => {
  const spec: PackSpec = {
    id: 'p1', name: 'Alps test', day: '2026-07-12',
    area: { west: 6, south: 45, east: 6.5, north: 45.4 },
  };
  const now = 1_000_000_000;

  test('a not-ready pack warns in words and names the missing kind (OFF-010/011)', () => {
    const held: Held = { tiles: new Set(), weather: null };
    const out = completenessHtml(completeness(spec, held, 10, now));
    expect(out).toContain('NOT flight-ready');
    expect(out).toContain('terrain');
    expect(out).toContain('missing');
  });

  test('a complete pack reads flight-ready, with flight and enrichment separated (OFF-008)', () => {
    const held: Held = {
      tiles: new Set(tilesForArea(spec.area, 10).map(tileKey)),
      weather: { fetchedAt: now, day: spec.day },
    };
    const out = completenessHtml(completeness(spec, held, 10, now));
    expect(out).not.toContain('NOT flight-ready');
    expect(out).toContain('flight');
    expect(out).toContain('enrichment');
  });

  test('a stale forecast warns as stale but never grounds the pack (OFF-008/011)', () => {
    const held: Held = {
      tiles: new Set(tilesForArea(spec.area, 10).map(tileKey)),
      weather: { fetchedAt: now - 72 * 3_600_000, day: spec.day },
    };
    const out = completenessHtml(completeness(spec, held, 10, now));
    expect(out).toContain('stale');
    expect(out).not.toContain('NOT flight-ready');
  });
});

describe('offlineBadgeHtml', () => {
  const now = 10 * 3_600_000;

  test('offline is a state, not a failure (OFF-005)', () => {
    const out = offlineBadgeHtml(false, true, now - 3 * 3_600_000, now);
    expect(out).toContain('offline');
    expect(out).not.toMatch(/error|fail/i);
  });

  test('the snapshot age is shown, and an absent snapshot is a dash', () => {
    expect(offlineBadgeHtml(false, true, now - 3 * 3_600_000, now)).toContain('weather: 3 h old');
    const none = offlineBadgeHtml(false, true, null, now);
    expect(none).toContain('weather: —');
    expect(none).not.toContain('0 h');
  });

  test('a non-persistent store says the cache will not survive a restart', () => {
    expect(offlineBadgeHtml(true, false, null, now)).toContain('restart');
    expect(offlineBadgeHtml(true, true, null, now)).not.toContain('restart');
  });

  test('online shows online, not offline', () => {
    expect(offlineBadgeHtml(true, true, null, now)).not.toContain('offline');
  });
});

describe('emagramSvg', () => {
  const g: EmagramGeom = {
    env: [{ T: 20, alt: 400 }, { T: 6, alt: 2600 }],
    parcel: [{ T: 20, alt: 400 }, { T: -2, alt: 2600 }],
    cloudbase: 1500,
    ceiling: null,
  };

  test('a null geometry is an empty state, not a crash and not a curve (ANA-004)', () => {
    const out = emagramSvg(null, 300, 200);
    expect(out).toContain('<svg');
    expect(out).toContain('—');
    expect(out).not.toContain('<polyline');
  });

  test('a two-point sounding draws both curves, sized by viewBox', () => {
    const out = emagramSvg(g, 300, 200);
    expect(count(out, '<polyline')).toBe(2);
    expect(out).toContain('viewBox="0 0 300 200"');
    expect(out).toContain('stroke-dasharray'); // the parcel is the dashed one
  });

  test('the cloudbase line exists only when cloudbase is known (POT-007)', () => {
    const out = emagramSvg(g, 300, 200);
    expect(out).toContain('cloudbase');
    expect(out).toContain('1500 m');
    expect(out).not.toContain('ceiling');
    expect(emagramSvg({ ...g, cloudbase: null }, 300, 200)).not.toContain('cloudbase');
  });
});
