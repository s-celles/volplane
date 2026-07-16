import { test, expect } from 'bun:test';
import { translator } from '../core/i18n';
import { DEFAULT_UNITS } from '../core/units';
import { gotoResultsHtml, gotoRowHtml } from './goto-ui';
import type { GotoResult } from '../core/goto';
import type { Poi } from 'soaring-core/poi';

const t = translator('en');
const poi = (o: Partial<Poi>): Poi => ({
  name: 'Saint-Auban', code: 'LFNS', country: 'FR', lon: 5.9, lat: 44.05, elevM: 480,
  cat: 'airfield-gliding', rwdirDeg: null, rwlenM: null, freq: null, desc: null, raw: null, ...o,
});
const res = (o: Partial<GotoResult>): GotoResult =>
  ({ point: poi({}), match: 'namePrefix', distanceM: 32_000, bearingDeg: 47, ...o });

test('a row shows enough to be sure of the place — name, code, kind, distance, bearing', () => {
  const html = gotoRowHtml(res({}), 0, DEFAULT_UNITS, t);
  expect(html).toContain('Saint-Auban');
  expect(html).toContain('LFNS');
  expect(html).toContain('gliding airfield');
  expect(html).toContain('data-goto="0"');           // the index, not a coordinate
});

test('THE COORDINATE NEVER ROUND-TRIPS THROUGH THE DOM — only the index does', () => {
  // A lat/lon that went out as text and came back parsed is one truncation away from a different
  // valley. The shell reads data-goto and looks the point up in the results array.
  const html = gotoRowHtml(res({}), 3, DEFAULT_UNITS, t);
  expect(html).not.toContain('5.9');
  expect(html).not.toContain('44.05');
  expect(html).toContain('data-goto="3"');
});

test('no distance on the ground is not shown as `— km` — a made-up measurement is worse than none', () => {
  const html = gotoRowHtml(res({ distanceM: null, bearingDeg: null }), 0, DEFAULT_UNITS, t);
  expect(html).not.toContain('goto-dist');
  expect(html).not.toContain('—');
});

test('AN EMPTY RESULT IS AN HONEST REFUSAL, not a broken box', () => {
  // core/goto returns nothing when a query matches nothing, deliberately: a pilot handed the nearest
  // field for a name he typed would fly to it. The two empties say different things, and both must
  // read as answers, not faults.
  expect(gotoResultsHtml([], '', DEFAULT_UNITS, t)).toContain(t('goto.empty'));
  expect(gotoResultsHtml([], 'LFNX', DEFAULT_UNITS, t)).toContain(t('goto.none'));
  expect(gotoResultsHtml([], 'LFNX', DEFAULT_UNITS, t)).not.toContain(t('goto.empty'));
});

test('the rows carry their index in order, so the shell reads the right point back', () => {
  const html = gotoResultsHtml([res({}), res({ point: poi({ name: 'Vinon' }) })], 'v', DEFAULT_UNITS, t);
  expect(html.indexOf('data-goto="0"')).toBeLessThan(html.indexOf('data-goto="1"'));
});

test('a name with markup in it cannot break out of the row', () => {
  const html = gotoRowHtml(res({ point: poi({ name: '<script>x', code: null }) }), 0, DEFAULT_UNITS, t);
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});
