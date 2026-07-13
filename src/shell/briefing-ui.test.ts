// The claims of the briefing panel, pinned at the render boundary. These tests read the output
// as a pilot would — is the unknown a dash, is the modelled number badged, does the sandbox say
// so — and never as a DOM. Markup details (tag choice, class order) are deliberately NOT pinned:
// what must survive refactoring is what the strings SAY.
import { describe, expect, test } from 'bun:test';
import {
  completenessHtml as completenessHtmlT, offlineBadgeHtml as offlineBadgeHtmlT,
  briefingHtml as briefingHtmlT, emagramSvg as emagramSvgT,
} from './briefing-ui';
import { translator } from '../core/i18n';
import { PRESETS } from '../core/units';

// IHM-006: a translator in, the same claims out. The literals moved into the catalogue; the
// tests read them back through it, so 'Cloudbase' is still pinned — as the catalogue's word.
const en = translator('en');
const fr = translator('fr');
const completenessHtml = (c: Parameters<typeof completenessHtmlT>[0]): string => completenessHtmlT(c, en);
const offlineBadgeHtml = (a: boolean, b: boolean, c: number | null, d: number): string =>
  offlineBadgeHtmlT(a, b, c, d, en);
const METRIC = PRESETS.metric;
const briefingHtml = (b: Parameters<typeof briefingHtmlT>[0]): string => briefingHtmlT(b, METRIC, en);
const emagramSvg = emagramSvgT;
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


// ---- IHM-006: the briefing, in French ----

test('the briefing panel translates — badge, warning and label alike (IHM-006)', () => {
  const b: Briefing = {
    hour: 13, source: 'forecast', cloudbase: 1800, ceiling: 2400, stability: 0.011,
    summary: { depth: 1500, isCu: true, openTop: false }, wind: [], sounding: null,
  };
  const french = briefingHtmlT(b, METRIC, fr);
  expect(french).toContain(fr('bf.cloudbase'));
  expect(french).not.toContain('Cloudbase');
  // POT-007's badge is the one word on this screen a pilot must not skim past: it says the
  // number is a MODEL. A badge he cannot read is a badge that does not badge anything.
  expect(french).toContain(fr('badge.modelled'));
  expect(french).toContain(fr('badge.modelled.title'));
  expect(french).not.toContain('indicative, not validated');
  expect(briefingHtmlT(b, METRIC, en)).toContain('Cloudbase');
  expect(briefingHtmlT(b, METRIC, en)).toContain('indicative, not validated');
});

test('a sandbox says SANDBOX in French too — a synthetic sky cannot pass for a real one', () => {
  const b: Briefing = {
    hour: 13, source: 'sandbox', cloudbase: 1800, ceiling: 2400, stability: 0.011,
    summary: null, wind: [], sounding: null,
  };
  const french = briefingHtmlT(b, METRIC, fr);
  expect(french).toContain('sandbox');                 // the CLASS survives translation…
  expect(french).toContain(fr('bf.sandboxBanner'));    // …and the banner is in his language
});

// ---- CFG-003: the briefing reads in the units the pilot chose ----

test('the briefing honours the pilot\'s units — a cloudbase he compares with his altimeter', () => {
  const b: Briefing = {
    hour: 13, source: 'forecast', cloudbase: 1800, ceiling: 2400, stability: 0.011,
    summary: { depth: 1500, isCu: true, openTop: false },
    wind: [{ alt: 1000, speed: 10, dirFrom: 270 }], sounding: null,
  };
  const aviation = briefingHtmlT(b, PRESETS.aviation, en);
  expect(aviation).toContain('5906');                 // 1800 m of cloudbase, in feet
  expect(aviation).toContain('ft');
  expect(aviation).toContain('19');                   // 10 m/s of wind, in knots
  expect(aviation).toContain('speed (kt)');           // …and the column header says so
  expect(aviation).not.toContain('speed (km/h)');
  // The unit lives in units.ts, not in the catalogue: the header takes it as a parameter.
  const metric = briefingHtmlT(b, PRESETS.metric, en);
  expect(metric).toContain('speed (km/h)');
  expect(metric).toContain('alt (m)');
  expect(metric).toContain('1800');
});
