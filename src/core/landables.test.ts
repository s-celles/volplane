// The phase's acceptance claim lives in the first test in this file. Everything else defends it.
//
// The claim is not "the computer answers"; a range circle answers too, instantly and wrongly. The
// claim is that this computer REFUSES a field it would be flattering to offer — the nearer, lower
// one — because there is rock in the way, and offers instead the farther, higher one it can
// actually reach. If that test ever goes green for the wrong reason, the layer is decoration.
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_POLAR as PL } from 'soaring-core/polar';
import { distM, mPerLng } from 'soaring-core/geo';
import type { ElevSampler } from 'soaring-core/ports';
import type { Poi, PoiCat } from './cup';
import { alternates, reachableOnly, NONE_REACHABLE } from './landables';

const LON = 8, LAT = 47;
const eastM = (m: number): number => LON + m / mPerLng(LAT);

/** A .cup point with only the fields that matter here filled in; the rest is what the format
 *  allows to be absent, and absent is null (POT-007), never a zero. */
const pt = (name: string, cat: PoiCat, mEast: number, elevM: number | null): Poi => ({
  name, code: name, country: 'FR',
  lon: eastM(mEast), lat: LAT,
  elevM, cat,
  rwdirDeg: null, rwlenM: null, freq: null, desc: '', raw: null,
});

/** Flat valley floor at 500 m, with a north–south wall of 2200 m rock from 8.0 to 8.6 km east.
 *  600 m thick, and higher than any glider in these tests: what is behind it is behind it. */
const valley: ElevSampler = (lon) => {
  const m = (lon - LON) * mPerLng(LAT);
  return m > 8_000 && m < 8_600 ? 2200 : 500;
};

/** Flat ground at 0 m — the case a range circle gets right, useful when the terrain is not the
 *  thing under test. */
const flat: ElevSampler = () => 0;

/** Ground nobody has loaded. */
const nowhere: ElevSampler = () => null;

test('the field behind the ridge is refused, lower and nearer though it be (LND-002/003, §9)', () => {
  const behind = pt('BEHIND', 'airfield-gliding', 12_000, 400);      // 12 km east, past the wall, elevation 400 m
  const open = pt('OPEN', 'airfield-grass', -25_000, 500);         // 25 km WEST, open valley, elevation 500 m
  const list = alternates(valley, LON, LAT, 1700, [behind, open], PL, { stepM: 100 });

  const b = list.find(a => a.point.name === 'BEHIND')!;
  const o = list.find(a => a.point.name === 'OPEN')!;

  // The refusal, and the REASON for it. 'terrain' and 'glide' are different facts: this glider
  // has the height for 12 km ten times over, and it still cannot have that field.
  expect(b.state).toBe('unreachable');
  expect(b.limit).toBe('terrain');

  expect(o.state).toBe('reachable');
  expect(o.marginM!).toBeGreaterThan(0);
  expect(reachableOnly(list)[0].point.name).toBe('OPEN');

  // And here is what makes this a claim about a LIE rather than merely an answer: the field we
  // refused is the NEARER one and the LOWER one. Every instinct, and every range circle ever
  // drawn, says take it. The measured ground says no.
  expect(distM(LON, LAT, behind.lon, behind.lat)).toBeLessThan(distM(LON, LAT, open.lon, open.lat));
  expect(behind.elevM!).toBeLessThan(open.elevM!);
});

test('LND-003: over unloaded ground every field is indeterminate, and NONE is reachable', () => {
  const pts = [pt('A', 'airfield-gliding', 5_000, 300), pt('B', 'airfield-grass', 12_000, 400), pt('C', 'outlanding', -9_000, 350)];
  const list = alternates(nowhere, LON, LAT, 1500, pts, PL, { stepM: 100 });

  expect(list.length).toBe(3);
  for (const a of list) {
    expect(a.state).toBe('indeterminate');
    expect(a.marginM).toBeNull();               // not 0 — we measured nothing, so we claim nothing
  }
  expect(reachableOnly(list).length).toBe(0);
  // The negative, said directly, because it is the one that kills: unmeasured is never green.
  expect(list.every(a => a.state !== 'reachable')).toBe(true);
});

test('LND-003: unmeasured is not unreachable — a field past the loaded DEM says so', () => {
  // Ground under the glider is loaded out to 5 km. Beyond that, the tiles have not arrived.
  const partial: ElevSampler = (lon) => ((lon - LON) * mPerLng(LAT) < 5_000 ? 0 : null);
  const far = pt('FAR', 'airfield-gliding', 15_000, 200);
  const [a] = alternates(partial, LON, LAT, 1500, [far], PL, { stepM: 100 });

  expect(a.state).toBe('indeterminate');
  expect(a.limit).toBe('unknown');
  expect(a.marginM).toBeNull();
  // The whole point of the third state: the glide arithmetic alone would have said "yes, easily"
  // and the terrain check has not been made. Neither answer is available, so neither is given.
  expect(a.state).not.toBe('unreachable');
});

test('LND-001: a mountain pass and a plain waypoint are not fields, however close they sit', () => {
  const pts = [
    pt('PASS', 'waypoint', 1_000, 1800),        // a col, right under the nose
    pt('TURN', 'waypoint', 2_000, 900),         // a turnpoint
    pt('FIELD', 'airfield-gliding', 10_000, 0),
  ];
  const list = alternates(flat, LON, LAT, 2000, pts, PL, { stepM: 100 });
  expect(list.map(a => a.point.name)).toEqual(['FIELD']);
});

test('LND-004: the reachable fields come back sorted by descending margin', () => {
  const pts = [pt('FAR', 'airfield-gliding', 20_000, 0), pt('NEAR', 'airfield-gliding', 5_000, 0), pt('MID', 'airfield-grass', 12_000, 0)];
  const list = alternates(flat, LON, LAT, 2000, pts, PL, { stepM: 100 });

  expect(list.map(a => a.state)).toEqual(['reachable', 'reachable', 'reachable']);
  expect(list.map(a => a.point.name)).toEqual(['NEAR', 'MID', 'FAR']);
  const m = list.map(a => a.marginM!);
  expect(m[0]).toBeGreaterThan(m[1]);
  expect(m[1]).toBeGreaterThan(m[2]);
});

test('LND-006: with nothing in reach the list still speaks — it does not shrug', () => {
  // 300 m over flat ground, fields at 40 and 50 km: no glider has that.
  const pts = [pt('A', 'airfield-gliding', 40_000, 0), pt('B', 'airfield-grass', 50_000, 0)];
  const list = alternates(flat, LON, LAT, 300, pts, PL, { stepM: 200 });

  expect(list.length).toBe(2);
  expect(list.every(a => a.state === 'unreachable')).toBe(true);
  expect(reachableOnly(list).length).toBe(0);
  // The caller has an explicit thing to SAY, not an empty array to render as white space.
  expect(NONE_REACHABLE).toBe('NO landable field within reach');

  // Least-bad first: "short by 200 m" is a plan, "short by 500 m" is not.
  expect(list[0].marginM!).toBeGreaterThan(list[1].marginM!);
});

test('LND-008 is NOT core\'s business: core judges EVERY landable, always', () => {
  // A review finding put this rule here, and it is the kind that only shows up in the field: a
  // field excluded from the JUDGING is a field the "NO landable field within reach" banner then
  // speaks for without ever having asked about it. Untick "outlanding fields" and the banner
  // would announce nothing is reachable — with a vachable strip three kilometres away. So the
  // type filter is a VIEW, applied in the shell, over verdicts core reached for all of them.
  const pts = [pt('GLIDING', 'airfield-gliding', 6_000, 0), pt('OUTLANDING', 'outlanding', 3_000, 0)];
  const all = alternates(flat, LON, LAT, 2000, pts, PL, { stepM: 200 });
  expect(all.map(a => a.point.name).sort()).toEqual(['GLIDING', 'OUTLANDING']);
});

test('LND-005 / C3: no modelled field can widen a landing option, and the imports prove it', () => {
  // Enforced the way purity.test.ts enforces C5: by reading the source. A comment promising this
  // erodes on the first hurried commit; a test fails the build.
  const src = readFileSync(join(import.meta.dir, 'landables.ts'), 'utf8');
  const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  expect(specs.length).toBeGreaterThan(0);
  for (const s of specs) {
    expect(s).not.toMatch(/liftmap/);
    expect(s).not.toMatch(/soaring-core\/lift/);
    expect(s).not.toMatch(/potential/);
  }
});

test('the wind in use is priced into the verdict, not decorated onto it', () => {
  const field = [pt('EAST', 'airfield-gliding', 20_000, 0)];
  const still = alternates(flat, LON, LAT, 1000, field, PL, { stepM: 100 })[0];
  const head = alternates(flat, LON, LAT, 1000, field, PL, {
    stepM: 100, wind: { speed: 15, direction: 90 },      // FROM the east: dead on the nose
  })[0];

  expect(still.state).toBe('reachable');
  // Either the margin shrank or the field fell out of reach entirely. Both are the wind arriving
  // at reachableTo; a wind that changed nothing would mean the option was never wired through.
  expect(head.marginM!).toBeLessThan(still.marginM!);
});
