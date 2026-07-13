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
import { alternates, landablesWithin, reachableOnly, NONE_REACHABLE } from './landables';

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

  // And the refusal comes with NO NUMBER, which this test used to let slide — the defect a
  // review found. The straight-line arithmetic, which knows nothing of the wall, makes this
  // field out to be +761 m in hand, and the panel printed that in the margin column: bold,
  // tabular, the most prominent number in a red row. "Height in hand on arrival" over ground
  // there is no arriving at. A margin is only a margin when the glide was flyable (POT-007).
  expect(b.marginM).toBeNull();

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

test('LND-004: a ridge is not a near miss — the blocked field sinks below the one short by 40 m', () => {
  // The ordering inside the unreachable bucket exists because "short by 40 m" and "short by
  // 1400 m" are different plans. A mountain is neither: no climb makes the ground behind that
  // wall reachable on this glide. It used to sort FIRST — its fabricated free-air margin (+761 m)
  // beat the honest negative of a field that was genuinely nearly makeable, so the top of the
  // divert list's second bucket was ranked by a number that measured nothing.
  const blocked = pt('BLOCKED', 'airfield-gliding', 12_000, 400);   // behind the 2200 m wall
  const short = pt('SHORT', 'airfield-grass', -45_000, 500);        // west, open, just out of glide
  const list = alternates(valley, LON, LAT, 1700, [blocked, short], PL, { stepM: 100 });

  expect(list.map(a => a.state)).toEqual(['unreachable', 'unreachable']);
  const [first, second] = list;

  expect(first.point.name).toBe('SHORT');
  expect(first.limit).toBe('glide');
  expect(first.marginM!).toBeLessThan(0);          // a measured shortfall: a plan, if he finds a climb

  expect(second.point.name).toBe('BLOCKED');
  expect(second.limit).toBe('terrain');
  expect(second.marginM).toBeNull();               // and above all: never a positive number
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

test('the cost cap is COUNTABLE: what it dropped can be seen, not merely dropped', () => {
  // The cap marches the 30 NEAREST fields, and reachability is not monotonic in distance — the
  // headline test at the top of this file is precisely a nearer field refused for rock. So in an
  // Alpine valley the 30 nearest can all be behind ridges while the 31st, straight down the valley
  // axis, is reachable with 400 m in hand. It is absent from the list, absent from the map, and the
  // panel used to shout "NO landable field within reach" without a word about the 30-of-31 it had
  // actually asked about. The cap stays (it is a real cost bound), but it is now VISIBLE: the shell
  // renders "N of M judged" and softens the banner. landablesWithin is that M.
  const behind = Array.from({ length: 30 }, (_, i) =>
    pt(`W${i}`, 'airfield-gliding', 9_000 + i * 300, 400));      // all past the 8.0–8.6 km wall
  const open = pt('OPEN', 'airfield-grass', -25_000, 500);       // 25 km west, clear valley
  const pts = [...behind, open];

  const capped = alternates(valley, LON, LAT, 1700, pts, PL, { stepM: 100 });
  expect(capped).toHaveLength(30);                               // the cap bit…
  expect(reachableOnly(capped)).toHaveLength(0);                 // …and it took the only field there was

  // The denominator the shell needs in order not to lie about that: 31 were in range, 30 were asked.
  expect(landablesWithin(pts, LON, LAT)).toHaveLength(31);
  expect(landablesWithin(pts, LON, LAT).length).toBeGreaterThan(capped.length);

  // And with the budget raised, the field is there and reachable — proof the cap, not the terrain,
  // is what hid it.
  const all = alternates(valley, LON, LAT, 1700, pts, PL, { stepM: 100, maxFields: 100 });
  expect(reachableOnly(all).map(a => a.point.name)).toEqual(['OPEN']);
});

test('landablesWithin counts landables, and only the ones inside the radius', () => {
  const pts = [
    pt('NEAR', 'airfield-gliding', 5_000, 0),
    pt('EDGE', 'outlanding', 79_000, 0),
    pt('BEYOND', 'airfield-grass', 120_000, 0),   // outside the 80 km default
    pt('TURN', 'waypoint', 1_000, 0),             // not a field at all (LND-001)
  ];
  expect(landablesWithin(pts, LON, LAT).map(p => p.name)).toEqual(['NEAR', 'EDGE']);
  expect(landablesWithin(pts, LON, LAT, 10_000).map(p => p.name)).toEqual(['NEAR']);
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
