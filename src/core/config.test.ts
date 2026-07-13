// ============ what these tests pin ============
// The settings CLAIMS (OFF-002, OFF-006, PLA-010, ESP-004): what the pilot configured comes
// back, garbage comes back as the defaults and never as a throw, and the repair is genuinely
// field by field — one mangled field costs that field alone, never its neighbours. A ceiling
// that would evict everything (zero, negative, NaN) is refused in favour of the default; a
// .plr the parser cannot fly is refused rather than persisted; a class filter that would
// silently mute every alert becomes null (all monitored), never an empty list.
import { test, expect } from 'bun:test';
import { DEFAULT_POLAR, sinkAt, minSink } from 'soaring-core/polar';
import {
  DEFAULT_SETTINGS, normalizeSettings, activePolar, fieldNumber, massKgFromField, massBandKg,
} from './config';
import { DEFAULT_UNITS } from './units';
import { DEFAULT_PAGES } from './infobox';
import { GLIDER_LIBRARY, gliderById, polarOf } from './polarlib';

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

test('the old one-field record gains the new fields at their defaults', () => {
  expect(normalizeSettings({ cacheBudgetMB: 300 }))
    .toEqual({ ...DEFAULT_SETTINGS, cacheBudgetMB: 300 });
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

// ---- the screen the pilot made his own (IHM-001, IHM-002, CFG-002, CFG-003, CFG-005) ----
// CFG-005: the configuration survives the restart. The record is persisted VERBATIM by packstore's
// putJson, so the shape it comes back in has to be the shape it went out in — nothing clever, no
// class, no Map, nothing JSON quietly flattens.

test('a fresh install boots usable, and the whole record survives a JSON round-trip', () => {
  const s = normalizeSettings({});
  expect(s.lang).toBe('en');
  expect(s.units).toEqual(DEFAULT_UNITS);
  expect(s.pages).toEqual(DEFAULT_PAGES as unknown as never);
  expect(s.pages.some(p => p.id === s.activePageId)).toBe(true);
  expect(s.glider).toBeNull();
  // Verbatim: what putJson writes is what the next launch reads back, unchanged.
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  expect(normalizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
});

test('the units repair is row by row: a mangled speed costs the speed unit alone', () => {
  const s = normalizeSettings({
    units: { ...DEFAULT_UNITS, altitude: 'aviation', speed: 'furlongs per fortnight' },
  });
  expect(s.units.speed).toBe(DEFAULT_UNITS.speed);      // the bad row fell back...
  expect(s.units.altitude).toBe('aviation');            // ...and the good row stood, in feet
  expect(s.units.vario).toBe(DEFAULT_UNITS.vario);
});

test('a mangled language costs the language alone, never the pages', () => {
  const mine = [{ id: 'mine', titleId: 'page.cruise', boxIds: ['mc', 'arrival'] }];
  const s = normalizeSettings({ lang: 'klingon', pages: mine });
  expect(s.lang).toBe('en');
  expect(s.pages).toEqual(mine as unknown as never);
  expect(normalizeSettings({ lang: 'fr' }).lang).toBe('fr');
});

test('an activePageId naming a page the pilot deleted falls back to the first — never to nothing', () => {
  const s = normalizeSettings({
    pages: [{ id: 'mine', titleId: 'page.cruise', boxIds: ['alt'] }],
    activePageId: 'finalGlide',
  });
  expect(s.activePageId).toBe('mine');
  expect(s.pages.some(p => p.id === s.activePageId)).toBe(true);
  // And an id that does name a surviving page is obeyed.
  expect(normalizeSettings({ activePageId: 'climb' }).activePageId).toBe('climb');
});

// ---- which polar flies (CFG-002 vs PLA-010) ----

test('an imported .plr outranks a library glider — the pilot handed us HIS file', () => {
  const s = normalizeSettings({
    polar: { name: 'LS4', plr: LS4_PLR },
    glider: { libId: 'ash25', massKg: 700 },
  });
  expect(activePolar(s).name).toBe('LS4');
});

test('with only a library glider, the library glider flies — and the mass adjustment is real', () => {
  const s = normalizeSettings({ glider: { libId: 'ls-4a', massKg: 480 } });
  expect(s.glider).toEqual({ libId: 'ls-4a', massKg: 480 });
  const flown = activePolar(s);
  expect(flown.name).toBe('LS-4a');
  // 480 kg on an entry published at 361 kg, and the adjustment is REAL, not decorative: if massKg
  // were being dropped on the floor these numbers would be equal. The DIRECTION is the physics,
  // and it is worth stating because it is the opposite of what "heavier sinks more" suggests:
  // ballast buys SPEED. At 30 m/s (108 km/h) the ballasted glider sinks LESS than the reference
  // one — that is the whole point of carrying water — and its BEST it can ever do, the minimum
  // sink, is worse. That pair is the physics, and it holds for every polar in the library; the
  // speed at which the two curves cross is a property of the individual glider and is deliberately
  // not pinned here. A settings screen that got this backwards would hand the pilot a final glide
  // that is optimistic exactly where he is fastest and lowest.
  const reference = polarOf(gliderById('ls-4a')!, null);
  expect(Math.abs(sinkAt(flown, 30))).toBeLessThan(Math.abs(sinkAt(reference, 30)));
  expect(Math.abs(minSink(flown))).toBeGreaterThan(Math.abs(minSink(reference)));
});

test('a mass nobody can have meant is not an adjustment: it is the entry reference mass', () => {
  for (const massKg of [0, -50, 'heavy', NaN, null]) {
    const s = normalizeSettings({ glider: { libId: 'ls-4a', massKg } });
    expect(s.glider).toEqual({ libId: 'ls-4a', massKg: null });
    expect(sinkAt(activePolar(s), 30)).toBe(sinkAt(polarOf(gliderById('ls-4a')!, null), 30));
  }
});

test('a library id that no longer exists is not a glider — the default flies, and nothing throws', () => {
  const s = normalizeSettings({ glider: { libId: 'flying-saucer', massKg: 480 } });
  expect(s.glider).toBeNull();
  expect(activePolar(s)).toBe(DEFAULT_POLAR);
  expect(activePolar(normalizeSettings({ glider: 'ls-4a' }))).toBe(DEFAULT_POLAR);
});

test('with neither an import nor a library pick, the built-in default flies', () => {
  expect(activePolar(normalizeSettings({}))).toBe(DEFAULT_POLAR);
});

// ---- CFG-002's "ajustables": the mass, in the pilot's unit, inside a band he could have meant ----

test('the mass box is read in the unit the pilot chose, not in kilograms regardless', () => {
  // The failure this pins: the settings screen offers a MASS row that can say lb, and the glider
  // mass box beside it was read as kilograms whatever that row said. A pilot on the imperial
  // preset typing 1058 (lb) had 1058 KG stored: k = √(1058/361) = 1.71, and every speed and sink
  // on his polar scaled by that — a glider three times his weight flying his final glide.
  expect(massKgFromField('480', 361, 'metric')).toBe(480);
  expect(massKgFromField('1058', 361, 'imperial')).toBeCloseTo(479.9, 1);
  // 'aviation' is kilograms for mass — the mixed panel is feet and knots, not pounds.
  expect(massKgFromField('480', 361, 'aviation')).toBe(480);
});

test('a mass outside the plausible band is a typo, and it is REFUSED, not flown', () => {
  // '45' for '450' — one dropped zero. It used to be accepted (the floor was 1 kg and there was
  // no ceiling), persisted, and handed to atMass: k = √0.1 scales the ASK 21's polar to a curve
  // ten times too steep whose maximum usable airspeed is 19 m/s, so every sink the computer priced
  // for the rest of the flight was clamped at a speed the glider was not flying.
  expect(massKgFromField('45', 450, 'metric')).toBeNull();
  expect(massKgFromField('4500', 450, 'metric')).toBeNull();
  // Refused, not clamped: a clamp would invent a ballast state he never typed. Null means the
  // polar as PUBLISHED — a glider we can defend, at a mass the panel names (POT-007).
  expect(massKgFromField('', 450, 'metric')).toBeNull();
  expect(massKgFromField('  ', 450, 'metric')).toBeNull();
  expect(massKgFromField('heavy', 450, 'metric')).toBeNull();

  // The band itself: an empty two-seater flown solo at the bottom, full water at the top.
  const { minKg, maxKg } = massBandKg(350);
  expect(minKg).toBeCloseTo(245, 6);              // 0.7 × 350
  expect(maxKg).toBeCloseTo(560, 6);              // 1.6 × 350 — a Discus 2 takes 200 litres
  expect(massKgFromField(String(maxKg), 350, 'metric')).toBe(maxKg);
  expect(massKgFromField(String(maxKg + 1), 350, 'metric')).toBeNull();
  expect(massKgFromField(String(minKg), 350, 'metric')).toBe(minKg);
  expect(massKgFromField(String(minKg - 1), 350, 'metric')).toBeNull();
});

test('a mass off DISK is repaired against the entry, not merely against zero', () => {
  // The same 45 kg, arriving from a settings file written before the band existed. It is
  // arithmetically fine and aeronautically impossible, and normalizeSettings is the last door.
  const entry = GLIDER_LIBRARY[0]!;
  const typo = normalizeSettings({ glider: { libId: entry.id, massKg: 45 } });
  expect(typo.glider).toEqual({ libId: entry.id, massKg: null });
  expect(sinkAt(activePolar(typo), 30)).toBe(sinkAt(polarOf(entry, null), 30));

  const real = normalizeSettings({ glider: { libId: entry.id, massKg: entry.refMassKg * 1.2 } });
  expect(real.glider).toEqual({ libId: entry.id, massKg: entry.refMassKg * 1.2 });
});
