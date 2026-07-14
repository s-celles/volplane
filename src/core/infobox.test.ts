// ============ what these tests pin ============
// The registry CLAIMS (IHM-001, IHM-002). A box is a value, and the value is complete: every box
// has a label in EVERY language we ship (a box that renders its own id in a cockpit is a bug the
// pilot discovers at 1 500 m), exactly one spelling of its unit, and a getter that PROJECTS —
// which is why an all-null source yields nothing but nulls, and never a fabricated zero (POT-007).
// And the pages the pilot boots on always have numbers on them: a stale id costs its box, never
// the page, and never the whole dashboard.
import { test, expect } from 'bun:test';
import { CATALOGUES, LANGS } from './i18n';
import { BOXES, BOX_BY_ID, type BoxSource } from './infobox';

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
