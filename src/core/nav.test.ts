// Phase 0's verifiable claim, as a test: sentences in, a right height above ground out —
// through the DeviceSource port (C5) and through soaring-core, with nothing else in between.
//
// If any of the three is a lie — the port, the kernel, the parser — it fails here, and it
// fails now rather than in six months.
import { test, expect } from 'bun:test';
import { apply, navigate, reground, EMPTY, type NavState } from './nav';
import { lines, withHealth, type LinkState } from './device';
import type { ElevSampler } from 'soaring-core/ports';
import { distM } from 'soaring-core/geo';

const cs = (body: string): string => {
  let c = 0;
  for (let i = 1; i < body.length; i++) c ^= body.charCodeAt(i);
  return `${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`;
};
/** A GGA at 47°N 8°E + the given offsets, at `alt` metres. */
const gga = (dLat: number, dLon: number, alt: number, t = '120000.00'): string => {
  const lat = 47 + dLat, lon = 8 + dLon;
  const dm = (d: number) => {
    const deg = Math.floor(Math.abs(d));
    return `${String(deg).padStart(2, '0')}${(( Math.abs(d) - deg) * 60).toFixed(4).padStart(7, '0')}`;
  };
  return cs(`$GPGGA,${t},${dm(lat)},N,0${dm(lon)},E,1,08,1.0,${alt.toFixed(1)},M,47.0,M,,`);
};

/** A slope: the ground rises 100 m per 0.01° of longitude eastward, from 500 m. */
const slope: ElevSampler = (lon) => 500 + (lon - 8) * 10000;
/** A DEM that has not loaded. Null means UNKNOWN — never a fake zero. */
const nothing: ElevSampler = () => null;

// ---- the claim ----

test('a fix over known ground gives a height above ground', () => {
  const s = apply(EMPTY, gga(0, 0, 1500), slope);
  expect(s.fix!.lat).toBeCloseTo(47, 4);
  expect(s.groundElev).toBeCloseTo(500, 3);
  expect(s.agl).toBeCloseTo(1000, 2);      // 1500 AMSL over 500 m of ground
});

test('the height above ground follows the terrain, not the altitude alone', () => {
  // Same altitude, flown east over rising ground: the AGL must fall. This is the whole point
  // of TER-003, and it is the number that keeps a glider out of a hillside.
  const level = 1500;
  const west = apply(EMPTY, gga(0, 0.00, level), slope);
  const east = apply(EMPTY, gga(0, 0.05, level), slope);
  expect(east.groundElev!).toBeGreaterThan(west.groundElev!);
  expect(east.agl!).toBeLessThan(west.agl!);
  expect(west.agl! - east.agl!).toBeCloseTo(500, 1);   // 0.05° × 10000 m/°
});

test('unknown ground gives NO height above ground — not a wrong one', () => {
  // A DEM tile that has not loaded is not sea level. A flight computer that quietly reports
  // 1500 m AGL over an unloaded mountain is worse than one that reports nothing: the pilot
  // believes it.
  const s = apply(EMPTY, gga(0, 0, 1500), nothing);
  expect(s.fix).not.toBeNull();            // we DO know where we are
  expect(s.groundElev).toBeNull();         // we do NOT know what is under us
  expect(s.agl).toBeNull();                // so we say nothing, rather than something
});

test('a position with no altitude gives no height above ground either', () => {
  const rmc = cs('$GPRMC,120000.00,A,4700.0000,N,00800.0000,E,54.0,090.0,110726,,,A');
  const s = apply(EMPTY, rmc, slope);
  expect(s.fix).not.toBeNull();
  expect(s.groundElev).toBeCloseTo(500, 3);
  expect(s.agl).toBeNull();                // ground known, altitude not → no honest AGL
});

// ---- ACQ-005: a bad sentence changes nothing ----

test('a malformed sentence leaves the state EXACTLY as it was', () => {
  const good = apply(EMPTY, gga(0, 0, 1500), slope);
  for (const junk of ['', 'hello', '$GPGGA,garbage*00', gga(0, 0, 9999).slice(0, -2) + 'FF']) {
    const after = apply(good, junk, slope);
    expect(after).toBe(good);              // same OBJECT: nothing was touched, not even copied
  }
});

test('a receiver that reports no fix does not erase the last known position', () => {
  const good = apply(EMPTY, gga(0, 0, 1500), slope);
  const noFix = cs('$GPGGA,120001.00,4700.0000,N,00800.0000,E,0,00,,,M,,M,,');
  expect(apply(good, noFix, slope)).toBe(good);
});

// ---- the stream, end to end (C5) ----

test('a Condor-shaped stream drives the whole state through the port', async () => {
  // What Phase 0 has to prove: bytes arrive in packets that do not respect sentence
  // boundaries, get split into lines, get parsed, and come out as a right AGL.
  const first = gga(0, 0, 1500);
  const packets = [
    first.slice(0, 5),                                             // half a sentence: "$GPGG"
    first.slice(5) + '\r\n' + gga(0, 0.01, 1500),                  // its other half + a whole one
    '\r\n' + cs('$LXWP0,Y,120.4,1250.0,1.7,,,,,,239,270,20.0') + '\r\n',
  ];
  const states: NavState[] = [];
  for await (const s of navigate(lines((async function* () { yield* packets; })()), slope, 'condor2')) {
    states.push(s);
  }
  const last = states[states.length - 1];
  expect(states.length).toBe(3);
  expect(last.groundElev).toBeCloseTo(600, 2);        // moved 0.01° east → ground 100 m higher
  expect(last.agl).toBeCloseTo(900, 2);
  expect(last.vario).toBeCloseTo(1.7, 6);
  expect(last.reportedWind!.direction).toBeCloseTo(270, 6);
});

test('the same stream read as Condor 3 reverses the wind — and nothing else', async () => {
  // The trap, at the level of the whole chain rather than one sentence.
  const line = cs('$LXWP0,Y,120.4,1250.0,1.7,,,,,,239,270,20.0');
  const c2 = apply(EMPTY, line, slope, 'condor2');
  const c3 = apply(EMPTY, line, slope, 'condor3');
  expect(c2.vario).toBe(c3.vario!);
  expect(Math.abs(c2.reportedWind!.direction - c3.reportedWind!.direction)).toBe(180);
});

// ---- ACQ-006: silence is reported, not endured ----

test('a source that goes silent is reported, not quietly trusted', async () => {
  const seen: LinkState[] = [];
  const src = (async function* () {
    yield gga(0, 0, 1500);
    await new Promise(r => setTimeout(r, 30));   // ...and then nothing
  })();
  for await (const _ of withHealth(src, s => seen.push(s), 10)) { /* drain */ }
  expect(seen.some(s => s.state === 'live')).toBe(true);
  expect(seen.some(s => s.state === 'silent')).toBe(true);   // the link went quiet, and we said so
  expect(seen[seen.length - 1].state).toBe('closed');
});

// ---- GGA and RMC are a pair, not rivals ----

test('an RMC of the same second does not erase the altitude GGA just gave', () => {
  // Receivers emit GGA (with altitude) and RMC (without) for the SAME instant. Taking each
  // fix at face value blinks the altitude — and the AGL with it — twice a second. Same
  // second, same altitude: that is a merge, not an invention.
  const withAlt = apply(EMPTY, gga(0, 0, 1500), slope);
  const rmc = cs('$GPRMC,120000.00,A,4700.0000,N,00800.0000,E,54.0,090.0,110726,,,A');
  const after = apply(withAlt, rmc, slope);
  expect(after.fix!.alt).toBe(1500);
  expect(after.agl).toBeCloseTo(1000, 2);
  expect(after.groundSpeed).toBeCloseTo(54 * 0.514444, 4);   // and RMC still contributed
});

test('an RMC of a DIFFERENT second carries no stale altitude', () => {
  // One second later the glider may be 5 m higher or lower. An altitude is a measurement of
  // an instant; gluing an old one onto a new fix would be inventing data.
  const withAlt = apply(EMPTY, gga(0, 0, 1500), slope);
  const later = cs('$GPRMC,120007.00,A,4700.0000,N,00800.0000,E,54.0,090.0,110726,,,A');
  expect(apply(withAlt, later, slope).fix!.alt).toBeUndefined();
});

// ---- a tile arriving is an event too ----

test('ground that BECOMES known fills the AGL in, without waiting for a fix', () => {
  // The glider circles in one spot while the DEM loads. When the tile lands, the ground
  // under the unmoved fix just became known — showing UNKNOWN until the next fix would be
  // wrong for a second, and a full silence-timeout wrong if the source stalls.
  const before = apply(EMPTY, gga(0, 0, 1500), nothing);
  expect(before.agl).toBeNull();
  const after = reground(before, slope);
  expect(after.groundElev).toBeCloseTo(500, 3);
  expect(after.agl).toBeCloseTo(1000, 2);
});

test('reground with nothing new preserves the object identity', () => {
  const s = apply(EMPTY, gga(0, 0, 1500), slope);
  expect(reground(s, slope)).toBe(s);       // same OBJECT — a UI can skip the render
  expect(reground(EMPTY, slope)).toBe(EMPTY);   // no fix: nothing to reground
});

// ---- soaring-core really is the one doing the geodesy ----

test('the kernel is what measures the ground, not us', () => {
  // distM comes from soaring-core. If this import were decorative, the test would still pass
  // — so make it earn its place: the two fixes are one degree of latitude apart.
  const a = apply(EMPTY, gga(0, 0, 1500), slope).fix!;
  const b = apply(EMPTY, gga(1, 0, 1500), slope).fix!;
  expect(distM(a.lon, a.lat, b.lon, b.lat)).toBeCloseTo(111320, -2);
});
