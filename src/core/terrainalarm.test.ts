// The claim TER-008 exists for, as tests. The headline is not "a wall raises an alarm" — any
// arithmetic does that. It is that a HOLE in the DEM raises NOTHING: an alarm over unmeasured
// ground is the alarm the pilot learns to discount, and this is the one alarm that must never
// be discounted.
import { test, expect } from 'bun:test';
import { DEFAULT_POLAR as PL } from 'soaring-core/polar';
import { mPerLng } from 'soaring-core/geo';
import type { ElevSampler } from 'soaring-core/ports';
import type { NavState } from './nav';
import {
  terrainAhead, terrainAlarm, CLEAR_HOLD_S, MIN_AGL_M, TERRAIN_CLEARANCE_M, DEFAULT_HORIZON_S,
  type TerrainVerdict,
} from './terrainalarm';

const LON = 8, LAT = 47;
const eastM = (m: number): number => LON + m / mPerLng(LAT);

/** A glider flying due east, high enough that no gate hides the verdict under test. */
const flying = (alt: number, groundElev: number | null, o: Partial<NavState> = {}): NavState => ({
  fix: { sod: 0, lat: LAT, lon: LON, alt },
  groundSpeed: 30,
  track: 90,
  groundElev,
  agl: groundElev == null ? null : alt - groundElev,
  ...o,
});

/** A wall of rock `d` metres east, 2000 m high; valley floor at 300 m everywhere else. */
const wallAt = (d: number): ElevSampler => (lon) => (lon > eastM(d) ? 2000 : 300);

/** Ground nobody has loaded — the hole. */
const nothing: ElevSampler = () => null;

/** The DEM covers 2 km east of us and then stops dead. */
const endsAt2km: ElevSampler = (lon) => (lon > eastM(2000) ? null : 300);

// ---- 1. THE ONE THAT MATTERS ----

test('unloaded terrain NEVER raises the alarm — it says UNMEASURED (TER-008, POT-007)', () => {
  // Everything is set up to alarm — 1500 m, 30 m/s, straight at the horizon — except that
  // there is no terrain there. Not flat terrain: NO terrain. The AGL is handed to us from a
  // ground sample we no longer have; even so, the verdict must not be an alarm.
  const v = terrainAhead(nothing, flying(1500, 300), PL);
  expect(v.kind).toBe('unmeasured');
  expect(v.kind).not.toBe('alarm');       // said twice, on purpose: this is the whole file
});

test('a DEM that runs out mid-horizon is still UNMEASURED, never an alarm', () => {
  // 40 m/s over 60 s = 2.4 km of horizon; the ground is known for 2 km of it and then gone.
  const v = terrainAhead(endsAt2km, flying(1500, 300, { groundSpeed: 40 }), PL);
  expect(v.kind).toBe('unmeasured');
  expect(v.kind).not.toBe('alarm');
  if (v.kind !== 'unmeasured') throw new Error('unreachable');
  expect(v.distanceM).toBeGreaterThan(1500);   // it tells the pilot HOW FAR the measurement goes
  expect(v.distanceM).toBeLessThanOrEqual(2000);
});

// ---- 2. clear air ----

test('flat ground far below is clear — the slope does not reach it inside the horizon', () => {
  // 1500 m over ground at 200 m, 30 m/s: the horizon is 1.8 km, and 1.8 km of best glide costs
  // ~60 m of height. The ground is 1300 m away, vertically.
  const v = terrainAhead(() => 200, flying(1500, 200), PL);
  expect(v.kind).toBe('clear');
});

// ---- 2bis. THE ALARM THAT WOULD HAVE BEEN MUTED ----
// The whole circuit, every approach, every winch launch and every low ridge beat happen a couple
// of hundred metres over the ground, on purpose. An alarm that fires there fires on every flight,
// and the pilot mutes it — after which it cannot warn him about the rock either. The old code fed
// the march the pilot's 200 m FINAL-GLIDE RESERVE as its collision clearance, and so cried
// "TERRAIN — ALARM 3 · ridge in the way · 0.0 km · 0 s to impact" over dead-flat ground from
// ~245 m AGL all the way down.

test('flat ground at CIRCUIT HEIGHT is clear — the reserve is not a collision clearance', () => {
  const flat300 = (): number => 300;
  // Every height a glider actually flies a circuit, a low save or a ridge beat at.
  for (const agl of [MIN_AGL_M, 160, 180, 200, 205, 250, 300, 400]) {
    const v = terrainAhead(flat300, flying(300 + agl, 300), PL, { horizonS: 60 });
    expect(v.kind).toBe('clear');
  }
  // …and there is nowhere to put the reserve even if a caller wanted to: the clearance is this
  // file's own number, and it is small.
  expect(TERRAIN_CLEARANCE_M).toBeLessThan(100);
  expect(MIN_AGL_M).toBeGreaterThan(TERRAIN_CLEARANCE_M);   // the two can never cross
});

// ---- 2ter. THE THERMAL ----
// A circling glider is not flying the straight ray this file marches: once a turn the track
// sweeps onto the ridge it is climbing beside. The alarm would fire once per circle, the 8 s hold
// would smear it across the rest, and chooseVoice would take the vario away for the whole climb —
// in the one place the pilot needs it most.

test('a glider CIRCLING beside a ridge is not flying at it: no alarm', () => {
  const s = flying(1200, 300, { groundSpeed: 26 });
  // Straight at it, this is a level-3 alarm — the geometry is not in doubt.
  expect(terrainAhead(wallAt(600), s, PL, { horizonS: 60 }).kind).toBe('alarm');
  // In a turn, the same instantaneous track is not a path: it is one radius of a circle.
  expect(terrainAhead(wallAt(600), s, PL, { horizonS: 60, circling: true }).kind).toBe('clear');
});

// ---- 3. the wall ----

test('a wall inside the horizon alarms, names the ridge, and times the impact', () => {
  const v = terrainAhead(wallAt(1000), flying(1200, 300), PL, { horizonS: 60 });
  expect(v.kind).toBe('alarm');
  if (v.kind !== 'alarm') throw new Error('unreachable');
  expect(v.cause).toBe('terrain');              // a ridge in the way, not a glide running out
  expect(v.bearing).toBe(90);                   // the banner can point at it
  expect(Math.abs(v.distanceM - 1000)).toBeLessThanOrEqual(200);   // within one march step
  expect(v.timeToImpactS!).toBeCloseTo(v.distanceM / 30, 6);
  expect(Math.abs(v.timeToImpactS! - 1000 / 30)).toBeLessThanOrEqual(200 / 30);
});

// ---- 4. the same wall, out of reach of the horizon ----

test('the same wall twice as far is outside the horizon: clear', () => {
  // 30 m/s × 60 s = 1.8 km of horizon; the rock is at 2 km. It is not a lie to stay quiet about
  // ground the pilot did not ask to be warned about — he asked for one minute.
  const v = terrainAhead(wallAt(2000), flying(1200, 300), PL, { horizonS: 60 });
  expect(v.kind).toBe('clear');
});

// ---- 5. levels ----

test('level 3 inside half the horizon, level 2 beyond it', () => {
  const s = (o: Partial<NavState>) => flying(1200, 300, { groundSpeed: 24, ...o });
  const near = terrainAhead(wallAt(600), s({}), PL, { horizonS: 60 });    // 600 m at 24 m/s = 25 s
  const far = terrainAhead(wallAt(1200), s({}), PL, { horizonS: 60 });    // 1200 m at 24 m/s = 50 s
  if (near.kind !== 'alarm' || far.kind !== 'alarm') throw new Error('both must alarm');
  expect(near.timeToImpactS!).toBeCloseTo(25, 3);
  expect(near.level).toBe(3);
  expect(far.timeToImpactS!).toBeCloseTo(50, 3);
  expect(far.level).toBe(2);
});

// ---- 6. the gates: no input, no alarm ----

test('no track, no ground speed, no height above ground: no alarm', () => {
  const wall = wallAt(1000);
  // No track: we do not know where the glider is pointed, so we do not know what it is pointed AT.
  expect(terrainAhead(wall, flying(1200, 300, { track: undefined }), PL).kind).toBe('clear');
  // 3 m/s over the ground: a glider on a trailer, or a fix gone stale. Not a collision.
  expect(terrainAhead(wall, flying(1200, 300, { groundSpeed: 3 }), PL).kind).toBe('clear');
  // 10 m AGL: this glider is landing. A terrain alarm in the flare teaches the pilot to hate
  // the terrain alarm.
  expect(terrainAhead(wall, flying(310, 300), PL).kind).toBe('clear');
  // No fix, no altitude: nothing to march from.
  expect(terrainAhead(wall, { fix: null, groundElev: null, agl: null }, PL).kind).toBe('clear');
  expect(terrainAhead(wall, flying(1200, 300, { fix: { sod: 0, lat: LAT, lon: LON } }), PL).kind)
    .toBe('clear');
});

test('an emptied horizon field does NOT switch the alarm off — it falls back to the default', () => {
  // `Number('')` is 0, and 0 is finite: the settings box reads as zero the instant the pilot
  // selects it and hits backspace to retype. A horizon of 0 s used to return CLEAR for the rest
  // of the flight — no banner, no tone, and nothing on the screen admitting the alarm was off,
  // because 'clear' and 'disabled' render identically. A safety alarm may not be disabled by a
  // keystroke that says nothing.
  const armed = terrainAhead(wallAt(1000), flying(1200, 300), PL, { horizonS: DEFAULT_HORIZON_S });
  expect(armed.kind).toBe('alarm');
  for (const horizonS of [Number(''), 0, -30, Number.NaN, undefined]) {
    expect(terrainAhead(wallAt(1000), flying(1200, 300), PL, { horizonS })).toEqual(armed);
  }
});

test('a headwind stronger than the glider itself is a broken wind estimate, not a collision', () => {
  // The march would stop dead at zero metres and shout about rock the glider is nowhere near.
  const v = terrainAhead(wallAt(1000), flying(1200, 300), PL, { wind: { speed: 70, direction: 90 } });
  expect(v.kind).toBe('clear');
});

// ---- 7. hysteresis ----

test('an alarm outlives the fix that raised it by CLEAR_HOLD_S, so it cannot flicker', () => {
  const box = terrainAlarm();
  const alarm: TerrainVerdict = {
    kind: 'alarm', level: 2, distanceM: 1000, timeToImpactS: 33, cause: 'terrain', bearing: 90,
  };
  const clear: TerrainVerdict = { kind: 'clear' };

  expect(box.add(0, alarm).kind).toBe('alarm');
  expect(box.add(1, alarm).kind).toBe('alarm');
  // The ridge slips out of the horizon. The alarm does NOT slip out with it.
  expect(box.add(2, clear).kind).toBe('alarm');
  expect(box.add(3, clear).kind).toBe('alarm');
  expect(box.add(1 + CLEAR_HOLD_S - 1, clear).kind).toBe('alarm');
  // …and once the hold is spent, it clears honestly.
  expect(box.add(1 + CLEAR_HOLD_S, clear).kind).toBe('clear');
  expect(box.add(1 + CLEAR_HOLD_S + 1, clear).kind).toBe('clear');
});

test('losing the DEM does not cancel a rock we measured a second ago', () => {
  const box = terrainAlarm();
  const alarm: TerrainVerdict = {
    kind: 'alarm', level: 3, distanceM: 400, timeToImpactS: 13, cause: 'terrain', bearing: 90,
  };
  expect(box.add(10, alarm).kind).toBe('alarm');
  expect(box.add(11, { kind: 'unmeasured', distanceM: 0 }).kind).toBe('alarm');
});
