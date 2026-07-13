// The cross-section's one hard rule: unloaded ground is a HOLE, and it says so. A profile
// that draws unmeasured terrain as flat is the plan view's own lie, told in the one dimension
// that was supposed to fix it.
import { test, expect } from 'bun:test';
import { xsectionSvg } from './xsection-ui';
import type { ElevSampler } from 'soaring-core/ports';
import type { Airspace } from '../core/airspace';

const flat: ElevSampler = () => 500;
const nothing: ElevSampler = () => null;
/** Known for the first half of the slice, unloaded beyond. */
const half: ElevSampler = (lon) => (lon - 8) * 76_800 < 5_000 ? 500 : null;

const base = { lon: 8, lat: 47, bearing: 90, altM: 2000, rangeM: 10_000, glideRatio: 30, spaces: [] };

test('known ground draws one filled profile and no unknown warning', () => {
  const svg = xsectionSvg({ ...base, elev: flat });
  expect(svg).toContain('class="ground"');
  expect(svg).not.toContain('NOT loaded');
  expect(svg).toContain('class="slope"');       // the glide slope is drawn over it
  expect(svg).toContain('class="glider"');
});

test('unloaded ground is a HOLE, and the percentage is said out loud', () => {
  const svg = xsectionSvg({ ...base, elev: nothing });
  expect(svg).not.toContain('class="ground"');  // nothing measured: nothing drawn
  expect(svg).toContain('100% of the ground ahead is NOT loaded');
});

test('a half-loaded slice draws what it knows and confesses the rest', () => {
  const svg = xsectionSvg({ ...base, elev: half });
  expect(svg).toContain('class="ground"');      // the known half IS drawn…
  expect(svg).toMatch(/[0-9]+% of the ground ahead is NOT loaded/);   // …and the rest confessed
});

test('no glide ratio means no slope line — never a flat line standing in for one', () => {
  const svg = xsectionSvg({ ...base, elev: flat, glideRatio: null });
  expect(svg).not.toContain('class="slope"');
  expect(svg).toContain('class="ground"');
});

test('an airspace floor crossing the slice is a bar with its class and name', () => {
  const tma: Airspace = { name: 'GENEVA TMA', class: 'D', floor: 1500, ceiling: 5000 };
  const svg = xsectionSvg({ ...base, elev: flat, spaces: [tma] });
  expect(svg).toContain('class="asp-floor"');
  expect(svg).toContain('D GENEVA TMA');
  // A floor OUTSIDE the drawn window is not drawn — a bar pinned to the frame edge would
  // claim an airspace is right there when it is 3000 m away.
  const high: Airspace = { ...tma, floor: 9000 };
  expect(xsectionSvg({ ...base, elev: flat, spaces: [high] })).not.toContain('asp-floor');
});
