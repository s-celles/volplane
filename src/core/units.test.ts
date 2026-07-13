// CFG-003 pinned at the two places it can go wrong: the choice must really be per QUANTITY (a
// per-system toggle would pass a naive test and fail a real panel), and an unknown must survive
// the trip through the formatter as an unknown (POT-007) — not as a zero wearing a unit.
import { test, expect } from 'bun:test';
import { QUANTITIES, PRESETS, DEFAULT_UNITS, unitFor, convert, format, type Quantity, type UnitSystem, type UnitPrefs, toSI, formatText } from './units';

const SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial', 'aviation'];

test('an unknown is a dash, in every quantity and every system — never 0, never NaN', () => {
  // The whole of POT-007 in one table: null, undefined and a non-finite number are all the same
  // statement — nobody measured this — and none of them may come out looking like a measurement.
  for (const q of QUANTITIES)
    for (const sys of SYSTEMS)
      for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
        const r = format(bad, q, sys);
        expect(`${q}/${sys}: ${r.text}|${r.unit}`).toBe(`${q}/${sys}: —|`);
      }
});

test('a zero is NOT an unknown — the pilot is entitled to tell them apart', () => {
  expect(format(0, 'vario', 'metric')).toEqual({ text: '0.0', unit: 'm/s' });
  expect(format(0, 'altitude', 'aviation')).toEqual({ text: '0', unit: 'ft' });
});

test('every quantity carries a unit in every system — a new quantity cannot ship unitless', () => {
  // This is the exhaustiveness guard: add a Quantity to the union without a row in the table and
  // TypeScript stops the build; add a row with an empty unit and this stops it.
  for (const q of QUANTITIES)
    for (const sys of SYSTEMS) {
      expect(unitFor(q, sys)).toBeTruthy();
      const r = format(1, q, sys);
      expect(`${q}/${sys}`).toBe(`${q}/${sys}`);
      expect(r.unit).toBe(unitFor(q, sys));
      expect(r.unit.length).toBeGreaterThan(0);
      expect(r.text).not.toBe('—');
      expect(r.text).not.toContain('NaN');
    }
  expect(QUANTITIES.length).toBe(8);   // the list is exhaustive, not a sample
});

test('aviation is the mixed system the requirement is for: ft, kt — and m/s for the vario', () => {
  expect(format(1000, 'altitude', 'aviation')).toEqual({ text: '3281', unit: 'ft' });
  expect(format(30, 'speed', 'aviation')).toEqual({ text: '58', unit: 'kt' });
  // The point of the mixed system: the vario stays metric even when the speed is in knots.
  expect(format(2.5, 'vario', 'aviation')).toEqual({ text: '2.5', unit: 'm/s' });
  expect(format(100000, 'distance', 'aviation')).toEqual({ text: '54.0', unit: 'NM' });
});

test('metric is what the screen shows today — the default moves nothing', () => {
  expect(DEFAULT_UNITS).toEqual(PRESETS.metric);
  expect(format(1000, 'altitude', 'metric')).toEqual({ text: '1000', unit: 'm' });
  expect(format(30, 'speed', 'metric')).toEqual({ text: '108', unit: 'km/h' });
  expect(format(2.5, 'vario', 'metric')).toEqual({ text: '2.5', unit: 'm/s' });
});

test('imperial reads the vario in ft/min', () => {
  expect(format(2.5, 'vario', 'imperial')).toEqual({ text: '492', unit: 'ft/min' });
  expect(format(1000, 'altitude', 'imperial')).toEqual({ text: '3281', unit: 'ft' });
});

test('the offset conversion is the one a factor would silently botch: 0 °C is 32 °F', () => {
  // A naive scale-only conversion gives 0 °F on a freezing day and looks entirely plausible.
  expect(format(0, 'temperature', 'imperial')).toEqual({ text: '32', unit: '°F' });
  expect(format(100, 'temperature', 'imperial')).toEqual({ text: '212', unit: '°F' });
  expect(format(-40, 'temperature', 'imperial')).toEqual({ text: '-40', unit: '°F' });
  expect(format(15, 'temperature', 'metric')).toEqual({ text: '15', unit: '°C' });
});

test('convert is monotone everywhere — no conversion may reorder two measurements', () => {
  // Order is the one property every display depends on: a higher altitude must read higher,
  // whatever the unit. A sign slip or an inverted factor breaks this and nothing else catches it.
  for (const q of QUANTITIES)
    for (const sys of SYSTEMS)
      for (const [a, b] of [[1, 2], [10, 11], [-5, -4], [0, 0.5], [100, 1000]] as const)
        expect(`${q}/${sys}: ${convert(a, q, sys) < convert(b, q, sys)}`).toBe(`${q}/${sys}: true`);
});

test('the choice is per QUANTITY, not per system — that IS the requirement', () => {
  // The panel a European pilot actually flies: altitude in feet, everything else metric.
  const prefs: UnitPrefs = { ...PRESETS.metric, altitude: 'aviation' };
  expect(format(1000, 'altitude', prefs.altitude)).toEqual({ text: '3281', unit: 'ft' });
  expect(format(30, 'speed', prefs.speed)).toEqual({ text: '108', unit: 'km/h' });
  expect(format(2.5, 'vario', prefs.vario)).toEqual({ text: '2.5', unit: 'm/s' });
  // and the preset it was built from is untouched — presets fill a row, they do not own it
  expect(PRESETS.metric.altitude).toBe('metric');
});

test('digits override the per-unit default, and only the display', () => {
  const q: Quantity = 'altitude';
  expect(format(1234.56, q, 'metric')).toEqual({ text: '1235', unit: 'm' });
  expect(format(1234.56, q, 'metric', 2)).toEqual({ text: '1234.56', unit: 'm' });
  // an unknown ignores the digits too: no '0.00' hiding behind a precision
  expect(format(null, q, 'metric', 2)).toEqual({ text: '—', unit: '' });
  // QNH is read to the centihectopascal — 1013.25, not 1013
  expect(format(1013.25, 'pressure', 'metric')).toEqual({ text: '1013.25', unit: 'hPa' });
});

test('a rounded-to-zero sink does not print a minus sign', () => {
  expect(format(-0.04, 'vario', 'metric').text).toBe('0.0');
});

// ---- the way IN: a number the pilot typed ----

test('toSI is the exact inverse of convert — a mass typed in pounds is stored in kilograms', () => {
  // The bug this closes: the settings panel offered the pilot a MASS row that says lb, and the
  // glider-mass box read what he typed as kilograms whatever that row said. 1058 lb went into the
  // store as 1058 kg, and the polar it scaled was not his glider's.
  expect(toSI(1058, 'mass', 'imperial')).toBeCloseTo(479.9, 1);
  expect(toSI(350, 'mass', 'metric')).toBe(350);

  // Round-trip, in both directions, for every quantity and every system — one table, and its
  // inverse is really its inverse. Temperature is the one that catches a naive multiply: 0 °C is
  // 32 °F, so an offset dropped anywhere would show up here and nowhere else.
  for (const q of QUANTITIES) {
    for (const sys of ['metric', 'imperial', 'aviation'] as const) {
      const si = 123.456;
      expect(toSI(convert(si, q, sys), q, sys)).toBeCloseTo(si, 6);
    }
  }
  expect(toSI(32, 'temperature', 'imperial')).toBeCloseTo(0, 9);
});

test('formatText joins the number to its unit — and an unknown keeps neither', () => {
  // The one formatter for the panels that print a number inside a SENTENCE (the divert rows, the
  // terrain note, the task ribbon). They used to spell `${(m/1000).toFixed(1)} km` each for
  // themselves, which is how one screen came to show two units for the same quantity.
  expect(formatText(12_400, 'distance', 'metric')).toBe('12.4 km');
  expect(formatText(12_400, 'distance', 'aviation')).toBe('6.7 NM');
  expect(formatText(259, 'altitude', 'aviation')).toBe('850 ft');
  // POT-007: '— km' would still be claiming a kilometre was measured.
  expect(formatText(null, 'distance', 'metric')).toBe('—');
  expect(formatText(NaN, 'altitude', 'aviation')).toBe('—');
});
