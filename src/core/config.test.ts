// ============ what these tests pin ============
// The settings CLAIMS (OFF-002, OFF-006, PLA-010, ESP-004): what the pilot configured comes
// back, garbage comes back as the defaults and never as a throw, and the repair is genuinely
// field by field — one mangled field costs that field alone, never its neighbours. A ceiling
// that would evict everything (zero, negative, NaN) is refused in favour of the default; a
// .plr the parser cannot fly is refused rather than persisted; a class filter that would
// silently mute every alert becomes null (all monitored), never an empty list.
import { test, expect } from 'bun:test';
import { DEFAULT_POLAR } from 'soaring-core/polar';
import { DEFAULT_SETTINGS, normalizeSettings, activePolar, fieldNumber } from './config';

// One CSV line in the .plr dialect parsePlr accepts: mass, ballast, then three
// (speed, sink) points and the wing area, with a comment line to prove those survive.
const LS4_PLR = '* comment\n350, 120, 100, -0.6, 150, -1.1, 200, -2.1, 10.5';

test('a valid ceiling survives normalization and a JSON round-trip', () => {
  expect(normalizeSettings({ cacheBudgetMB: 50 }).cacheBudgetMB).toBe(50);
  const persisted = JSON.parse(JSON.stringify({ cacheBudgetMB: 50 }));
  expect(normalizeSettings(persisted).cacheBudgetMB).toBe(50);
});

test('garbage in, defaults out — never a throw', () => {
  const garbage: unknown[] = [
    null, undefined, 42, 'many', [], {},
    { cacheBudgetMB: 'many' }, { cacheBudgetMB: NaN }, { cacheBudgetMB: Infinity },
  ];
  for (const raw of garbage) expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
});

test('a ceiling that would evict everything is refused, not obeyed', () => {
  expect(normalizeSettings({ cacheBudgetMB: 0 })).toEqual(DEFAULT_SETTINGS);
  expect(normalizeSettings({ cacheBudgetMB: -5 })).toEqual(DEFAULT_SETTINGS);
});

test('the normalizer answers a fresh object, so no caller can edit the defaults', () => {
  const a = normalizeSettings(null);
  expect(a).toEqual(DEFAULT_SETTINGS);
  expect(a).not.toBe(DEFAULT_SETTINGS);
  a.cacheBudgetMB = 1;
  expect(DEFAULT_SETTINGS.cacheBudgetMB).toBe(200);
});

// ---- polar (PLA-010): raw text in, the pilot's glider back out ----

test('a real .plr round-trips and activePolar flies it under its own name', () => {
  const s = normalizeSettings({ polar: { name: 'LS4', plr: LS4_PLR }, cacheBudgetMB: 500 });
  expect(s.polar).toEqual({ name: 'LS4', plr: LS4_PLR });
  expect(s.cacheBudgetMB).toBe(500);
  expect(activePolar(s).name).toBe('LS4');
});

test('a .plr the parser refuses is not a polar the computer may fly', () => {
  const s = normalizeSettings({ polar: { name: 'LS4', plr: 'not a polar' }, cacheBudgetMB: 500 });
  expect(s.polar).toBeNull();
  expect(activePolar(s)).toBe(DEFAULT_POLAR);
  // The field-by-field pin: the mangled polar cost the polar alone, not the budget.
  expect(s.cacheBudgetMB).toBe(500);
});

test('a polar missing its name or its text is refused whole', () => {
  expect(normalizeSettings({ polar: { name: '', plr: LS4_PLR } }).polar).toBeNull();
  expect(normalizeSettings({ polar: { name: '  ', plr: LS4_PLR } }).polar).toBeNull();
  expect(normalizeSettings({ polar: { name: 'LS4' } }).polar).toBeNull();
  expect(normalizeSettings({ polar: 'LS4' }).polar).toBeNull();
});

test('with no stored polar, the built-in default flies — never null', () => {
  expect(activePolar(DEFAULT_SETTINGS)).toBe(DEFAULT_POLAR);
  expect(activePolar(normalizeSettings(null))).toBe(DEFAULT_POLAR);
});

// ---- monitored classes (ESP-004): one spelling, and the safe failure is "watch everything" ----

test('classes are stored trimmed, UPPERCASE, and deduplicated — one spelling', () => {
  expect(normalizeSettings({ monitoredClasses: [' d ', 'D', 'e', ''] }).monitoredClasses)
    .toEqual(['D', 'E']);
});

test('a filter that would mute every alert becomes null (all monitored), never an empty list', () => {
  expect(normalizeSettings({ monitoredClasses: [] }).monitoredClasses).toBeNull();
  expect(normalizeSettings({ monitoredClasses: ['', '  '] }).monitoredClasses).toBeNull();
});

test('a class list that is not an array of strings watches everything, not a fragment', () => {
  expect(normalizeSettings({ monitoredClasses: 'D' }).monitoredClasses).toBeNull();
  expect(normalizeSettings({ monitoredClasses: { 0: 'D' } }).monitoredClasses).toBeNull();
  expect(normalizeSettings({ monitoredClasses: ['D', 42] }).monitoredClasses).toBeNull();
});

// ---- migration: yesterday's one-field disk record costs the pilot nothing ----

test('the old one-field record gains the new fields as null', () => {
  expect(normalizeSettings({ cacheBudgetMB: 300 }))
    .toEqual({ cacheBudgetMB: 300, polar: null, monitoredClasses: null });
});

// ---- the fields the pilot TYPES into (POT-007, TER-008) ----
// The trap this function exists for: `Number('') === 0`, and 0 is finite. The obvious guard —
// "finite? take it: else the default" — therefore lets an EMPTY box through as ZERO, which is the
// one value it was written to keep out. An empty box is the state every field passes through the
// instant the pilot selects it and hits backspace to retype.

test('an EMPTY field is the default, not a zero — this is the whole point of the function', () => {
  expect(fieldNumber('', 60)).toBe(60);
  expect(fieldNumber('   ', 200)).toBe(200);
  // A horizon of 0 s disabled the terrain alarm outright, silently, for the rest of the flight.
  expect(fieldNumber('', 60, 1)).toBe(60);
});

test('garbage is the default too, and a real number is obeyed', () => {
  expect(fieldNumber('abc', 60)).toBe(60);
  expect(fieldNumber('1013.25', 900)).toBe(1013.25);
  expect(fieldNumber('  45 ', 60)).toBe(45);
  expect(fieldNumber('0', 1)).toBe(0);          // no minimum given: a typed 0 is a choice (MC 0)
});

test('below `min` is a value the pilot cannot have meant, so it is the default', () => {
  // A horizon of 0 s is not a short horizon, it is no alarm; a QNH of 0 hPa is no altimeter
  // setting. Where zero is not a value, it does not become one by being typed.
  expect(fieldNumber('0', 60, 1)).toBe(60);
  expect(fieldNumber('-30', 60, 1)).toBe(60);
  expect(fieldNumber('0', 1013.25, 1)).toBe(1013.25);
  expect(fieldNumber('30', 60, 1)).toBe(30);    // above the minimum: obeyed
});
