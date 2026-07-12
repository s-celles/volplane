// The parser is the first thing a wrong number passes through. ACQ-005 says a malformed
// sentence must be rejected WITHOUT altering the navigation state — so these tests care less
// about what parses than about what must NOT.
import { test, expect } from 'bun:test';
import { parse, isValid, type Reading } from './nmea';

/** Append the correct NMEA checksum, so the tests can write sentences by hand. */
const cs = (body: string): string => {
  let c = 0;
  for (let i = 1; i < body.length; i++) c ^= body.charCodeAt(i);
  return `${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`;
};

const GGA = cs('$GPGGA,120000.00,4712.0000,N,00847.5000,E,1,08,1.0,540.0,M,47.0,M,,');
const RMC = cs('$GPRMC,120000.00,A,4712.0000,N,00847.5000,E,54.0,090.0,110726,,,A');

// ---- the frame ----

test('a sentence with a bad checksum is rejected — a flipped bit is a plausible lie', () => {
  // One bad bit in a latitude puts the glider 100 km away, and the number still looks fine.
  // The checksum is the only thing between that and the pilot.
  expect(isValid(GGA)).toBe(true);
  expect(isValid(GGA.slice(0, -2) + '00')).toBe(false);
  expect(parse(GGA.slice(0, -2) + '00')).toBeNull();
});

test('a sentence with no checksum at all is not trusted', () => {
  expect(isValid('$GPGGA,120000.00,4712.0000,N,00847.5000,E,1,08,1.0,540.0,M,47.0,M,,')).toBe(false);
});

test('garbage never throws — it returns null', () => {
  // A parser that throws on a half-received packet takes the flight computer down with it.
  for (const junk of ['', '\0', 'hello', '$', '$*', '$GPGGA', '$GPGGA*ZZ', '****']) {
    expect(() => parse(junk)).not.toThrow();
    expect(parse(junk)).toBeNull();
  }
});

// ---- position ----

test('GGA gives a position and an altitude', () => {
  const r = parse(GGA)!;
  expect(r.fix!.sod).toBe(12 * 3600);
  expect(r.fix!.lat).toBeCloseTo(47 + 12 / 60, 6);      // ddmm.mmmm, NOT decimal degrees
  expect(r.fix!.lon).toBeCloseTo(8 + 47.5 / 60, 6);
  expect(r.fix!.alt).toBeCloseTo(540, 6);
});

test('a southern / western hemisphere is negative', () => {
  const s = cs('$GPGGA,120000.00,3350.0000,S,15112.0000,W,1,08,1.0,10.0,M,0,M,,');
  const r = parse(s)!;
  expect(r.fix!.lat).toBeCloseTo(-(33 + 50 / 60), 6);
  expect(r.fix!.lon).toBeCloseTo(-(151 + 12 / 60), 6);
});

test('ddmm.mmmm is minutes, not decimals — and 60 minutes does not exist', () => {
  // 4760.0 would be "47 degrees and 60 minutes". A parser that reads it as 47.60 degrees
  // accepts it happily and is wrong by 24 km. It must refuse.
  expect(parse(cs('$GPGGA,120000.00,4760.0000,N,00847.5000,E,1,08,1.0,540.0,M,47.0,M,,'))).toBeNull();
});

test('a receiver that says it has no fix is believed', () => {
  const noFix = cs('$GPGGA,120000.00,4712.0000,N,00847.5000,E,0,00,,,M,,M,,');
  expect(parse(noFix)).toBeNull();                       // quality 0 → no position, not a bad one
  const void_ = cs('$GPRMC,120000.00,V,4712.0000,N,00847.5000,E,54.0,090.0,110726,,,N');
  expect(parse(void_)).toBeNull();                       // 'V' = void
});

test('RMC gives ground speed in m/s, not knots', () => {
  const r = parse(RMC)!;
  expect(r.groundSpeed).toBeCloseTo(54 * 0.514444, 4);   // ~100 km/h
  expect(r.track).toBeCloseTo(90, 6);
});

// ---- the Condor trap (ACQ-003, ACQ-013) ----

/** A real $LXWP0. The layout matters and is easy to get wrong — there are FIVE more vario
 *  fields after the first, and a heading, before the wind:
 *
 *    $LXWP0, logger, IAS(km/h), baroAlt(m), vario1..vario6, heading, windDir, windSpeed(km/h)
 *       0       1       2           3          4 .. 9          10       11        12
 *
 *  Wind here: 20 km/h, 270° — from the west, or towards it, depending on who is speaking. */
const LXWP0 = cs('$LXWP0,Y,120.4,1250.0,1.5,,,,,,239,270,20.0');

test('Condor 2 and Condor 3 disagree about which way the wind blows', () => {
  // Condor 3 reports the direction the wind blows TOWARDS; Condor 2 (and LX) report where it
  // comes FROM — the convention every pilot reads. One driver for both REVERSES the wind,
  // silently and plausibly. XCSoar had to ship two separate drivers for exactly this, and it
  // is the whole reason ACQ-003 demands that drivers be versioned.
  const c2 = parse(LXWP0, 'condor2')!;
  const c3 = parse(LXWP0, 'condor3')!;
  expect(c2.wind!.direction).toBeCloseTo(270, 6);        // from the west
  expect(c3.wind!.direction).toBeCloseTo(90, 6);         // the SAME sentence: from the east
  expect(Math.abs(c2.wind!.direction - c3.wind!.direction)).toBe(180);
});

test('the wind is in m/s, whatever the instrument sends', () => {
  const r = parse(LXWP0, 'condor2')!;
  expect(r.wind!.speed).toBeCloseTo(20 / 3.6, 6);        // LX sends km/h
});

test('LXWP0 also carries the vario and the pressure altitude', () => {
  const r = parse(LXWP0, 'condor2')!;
  expect(r.vario).toBeCloseTo(1.5, 6);
  expect(r.pressureAlt).toBeCloseTo(1250, 6);
});

test('the instrument wind is kept apart from the wind we estimate', () => {
  // VEN-001 estimates the wind from circle drift. An instrument may also REPORT one. They are
  // different claims and must not be conflated — one of them is measurable, the other is ours.
  const r: Reading = parse(LXWP0, 'condor2')!;
  expect(r.wind).toBeDefined();                          // this is the instrument's claim
  expect((r as { estimatedWind?: unknown }).estimatedWind).toBeUndefined();
});

// ---- sentences we do not use ----

test('an unknown sentence is not an error, it is just quiet', () => {
  expect(parse(cs('$GPGSV,3,1,11,01,05,040,20'))).toBeNull();
});
