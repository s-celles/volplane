import { describe, expect, test } from 'bun:test';
import { boxesHtml, boxHtml, phaseTabsHtml } from './infobox-ui';
import { BOXES, type BoxId, type BoxSource } from '../core/infobox';
import { defaultLayout, PHASES } from '../core/layout';
import { PRESETS } from '../core/units';
import { translator } from '../core/i18n';

const en = translator('en');
const fr = translator('fr');

const NOTHING: BoxSource = {
  latDeg: null, lonDeg: null, altM: null, qnhAltM: null, groundElevM: null, aglM: null,
  varioMs: null, avg30Ms: null, lastThermalMs: null, lastCircleMs: null,
  nettoMs: null, superNettoMs: null,
  tasMs: null, groundSpeedMs: null, stfMs: null,
  windDirDeg: null, windSpeedMs: null, instWindDirDeg: null, instWindSpeedMs: null,
  arrivalM: null, mcMs: null,
};

const page = (_id: string, boxIds: BoxId[]): BoxId[] => boxIds;

const ALL: BoxId[] = BOXES.map(b => b.id);

/** The count of a substring, because "appears" and "appears exactly twice" are different claims. */
const count = (h: string, needle: string): number => h.split(needle).length - 1;

describe('POT-007 — an unknown is a dash, on the flight screen too', () => {
  test('every field null renders every box as unknown, with no unit and no fabricated zero', () => {
    const html = boxesHtml(ALL, NOTHING, PRESETS.metric, en);

    expect(count(html, 'class="box unknown"')).toBe(BOXES.length);
    expect(count(html, '<div class="v">—<')).toBe(BOXES.length);
    // The unit vanishes with the value: "— ft" still claims a foot was involved.
    expect(count(html, '<span class="u"></span>')).toBe(BOXES.length);
    expect(html).not.toContain('>0<');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  test('boxHtml alone keeps the same promise, and the unit disappears with the value', () => {
    expect(boxHtml('alt', null, 'altitude', PRESETS.aviation))
      .toBe('<div class="box unknown"><div class="k">alt</div><div class="v">—<span class="u"></span></div></div>');
    // A fixed-unit box (a latitude, a wind direction) drops its degree sign for the same reason.
    expect(boxHtml('lat', null, null, PRESETS.metric, { fixedUnit: '°', digits: 5 }))
      .not.toContain('°');
  });
});

describe('CFG-003 — the conversion happens at the last centimetre and nowhere else', () => {
  const SOURCE: BoxSource = { ...NOTHING, altM: 1000, groundSpeedMs: 30, varioMs: 2.5 };
  const p = page('cfg', ['alt', 'groundSpeed', 'vario']);

  test('one SI source, two panels', () => {
    const metric = boxesHtml(p, SOURCE, PRESETS.metric, en);
    expect(metric).toContain('1000<span class="u">m</span>');
    expect(metric).toContain('108<span class="u">km/h</span>');
    expect(metric).toContain('2.5<span class="u">m/s</span>');

    const aviation = boxesHtml(p, SOURCE, PRESETS.aviation, en);
    expect(aviation).toContain('3281<span class="u">ft</span>');
    expect(aviation).toContain('58<span class="u">kt</span>');
    // The point of the mixed panel: knots outside, metres per second on the vario.
    expect(aviation).toContain('2.5<span class="u">m/s</span>');
  });

  test('nothing but SI ever exists in memory — the source is not touched', () => {
    const before = structuredClone(SOURCE);
    boxesHtml(p, SOURCE, PRESETS.aviation, en);
    boxesHtml(p, SOURCE, PRESETS.imperial, en);
    expect(SOURCE).toEqual(before);
  });
});

describe('IHM-006 — every word through the catalogue', () => {
  test('the French panel speaks French, and the English labels are not on it', () => {
    const p = page('fr', ['agl', 'ground', 'groundSpeed']);
    const html = boxesHtml(p, NOTHING, PRESETS.metric, fr);

    expect(html).toContain('hauteur/sol');
    expect(html).toContain('vitesse sol');
    expect(html).not.toContain('AGL');
    expect(html).not.toContain('ground speed');

    expect(phaseTabsHtml('cruise', fr)).toContain('TRANSITION');
  });
});

describe('IHM-002 — the three phase rows', () => {
  test('exactly one tab is active, and each carries its own phase', () => {
    // There was never a `pages` concept. The three default pages were called cruise, climb and
    // finalGlide — which ARE the three flight phases. The pilot was driving by hand the thing the app
    // already knew, and these tabs appear ONLY when he has turned the automatic switching off.
    const html = phaseTabsHtml('circling', en);
    expect(count(html, 'class="page-tab active"')).toBe(1);
    expect(html).toContain('data-phase="circling"');
    for (const p of PHASES) expect(html).toContain(`data-phase="${p}"`);
    expect(count(html, '<button')).toBe(PHASES.length);
  });

  test('the rows are the layout\'s rows, and there are three of them', () => {
    expect(Object.keys(defaultLayout().phases).sort()).toEqual([...PHASES].sort());
  });
});


describe('IHM-001 — the boxes are the pilot´s, in the pilot´s order', () => {
  test('the order of the ids is the order on screen', () => {
    const html = boxesHtml(page('o', ['agl', 'vario']), NOTHING, PRESETS.metric, en);
    expect(html.indexOf('AGL')).toBeLessThan(html.indexOf('vario'));

    const flipped = boxesHtml(page('o', ['vario', 'agl']), NOTHING, PRESETS.metric, en);
    expect(flipped.indexOf('vario')).toBeLessThan(flipped.indexOf('AGL'));
  });

  test('an id that no longer resolves costs its box, never the ROW', () => {
    const rotten = ['alt', 'ghost', 'vario'] as unknown as BoxId[];
    const html = boxesHtml(rotten, { ...NOTHING, altM: 1000, varioMs: 1 }, PRESETS.metric, en);

    expect(count(html, '<div class="box"')).toBe(2);
    expect(html).toContain('alt');
    expect(html).toContain('vario');
    expect(html).not.toContain('ghost');
    expect(html).not.toContain('undefined');
  });
});

describe('VEN-001 — our wind never wears the instrument´s face', () => {
  test('the estimated badge rides the two wind boxes and no other', () => {
    const html = boxesHtml(ALL, NOTHING, PRESETS.metric, en);
    expect(count(html, 'class="badge estimated"')).toBe(2);
    expect(html).toContain('title="from circle drift — an estimate, not the instrument"');

    // The INSTRUMENT's wind is a measurement and carries no badge; ours does.
    expect(boxesHtml(page('w', ['windSpeed']), NOTHING, PRESETS.metric, en)).toContain('badge estimated');
    expect(boxesHtml(page('w', ['instWindSpeed', 'instWindDir', 'alt', 'vario']), NOTHING, PRESETS.metric, en))
      .not.toContain('badge');
  });
});

describe('SYS-002 — the values age visibly, they do not vanish', () => {
  test('stale marks the container and changes nothing else', () => {
    const s: BoxSource = { ...NOTHING, altM: 1000, varioMs: 2.5 };
    const p = page('s', ['alt', 'vario']);
    const fresh = boxesHtml(p, s, PRESETS.metric, en);
    const stale = boxesHtml(p, s, PRESETS.metric, en, { stale: true });

    expect(stale).toContain('<div class="boxes stale">');
    expect(fresh).toContain('<div class="boxes">');
    expect(stale.replace('class="boxes stale"', 'class="boxes"')).toBe(fresh);
  });
});
