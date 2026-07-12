// ============ NMEA 0183 + vendor sentences ============
// The instrument speaks in lines. This turns a line into a fact, or into nothing.
//
// ACQ-005 is the rule that shapes this file: a malformed sentence MUST be rejected WITHOUT
// altering the navigation state. So nothing here mutates anything — a sentence parses to a
// value or to null, and the caller decides what to do with it. A parser that throws, or that
// half-applies a bad fix, is a parser that can put a wrong position in front of a pilot.

export interface Fix {
  /** Seconds since midnight UTC. NMEA gives no date in most sentences; the day comes from
   *  elsewhere (RMC, or the system clock at startup). */
  sod: number;
  lat: number;
  lon: number;
  /** Altitude (m). GGA gives it above the geoid; a vendor sentence may give pressure altitude. */
  alt?: number;
}

export interface Motion {
  /** Ground speed (m/s) and track (deg true), when the sentence carries them. */
  groundSpeed?: number;
  track?: number;
}

/** What one sentence told us. Every field is optional because every sentence says only part
 *  of it — and a sentence that says nothing useful is not an error, it is just quiet. */
export interface Reading extends Motion {
  fix?: Fix;
  /** Vertical speed (m/s) from a vario sentence. */
  vario?: number;
  /** Wind as the INSTRUMENT reports it — not as we estimate it (VEN-001). Keep them apart. */
  wind?: { speed: number; direction: number };
  /** Pressure altitude (m), when the instrument sends it separately from GPS altitude. */
  pressureAlt?: number;
}

// ---- the frame ----

/** True when the line is a well-formed NMEA sentence AND its checksum is right.
 *  The checksum is not decoration: a flipped bit in a latitude is a position 100 km away,
 *  and it looks perfectly plausible. */
export function isValid(line: string): boolean {
  if (!line.startsWith('$') && !line.startsWith('!')) return false;
  const star = line.lastIndexOf('*');
  if (star < 1) return false;                       // no checksum → we do not trust it
  const sum = line.slice(star + 1).trim();
  if (!/^[0-9A-Fa-f]{2}$/.test(sum)) return false;
  let c = 0;
  for (let i = 1; i < star; i++) c ^= line.charCodeAt(i);
  return c === parseInt(sum, 16);
}

const num = (s: string | undefined): number | undefined => {
  if (s == null || s === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

/** NMEA latitude/longitude: ddmm.mmmm — degrees and MINUTES, glued together. Reading it as a
 *  decimal degree is the classic way to put a glider in the sea. */
function coord(v: string | undefined, hemi: string | undefined): number | undefined {
  const raw = num(v);
  if (raw == null || !hemi) return undefined;
  const deg = Math.floor(raw / 100);
  const min = raw - deg * 100;
  if (min >= 60) return undefined;                  // not minutes → the sentence is lying
  const d = deg + min / 60;
  return hemi === 'S' || hemi === 'W' ? -d : d;
}

/** hhmmss.sss → seconds since midnight UTC. */
function sod(v: string | undefined): number | undefined {
  const t = num(v);
  if (t == null) return undefined;
  const h = Math.floor(t / 10000), m = Math.floor(t / 100) % 100, s = t % 100;
  if (h > 23 || m > 59 || s >= 61) return undefined;
  return h * 3600 + m * 60 + s;
}

const KNOTS_TO_MS = 0.514444;

// ---- drivers ----

/** Which instrument is on the other end. A driver is NOT cosmetic: the same sentence can mean
 *  different things on different instruments — and even on different VERSIONS of the same one.
 *
 *  Condor 2 and Condor 3 are the case in point, and the reason ACQ-003 demands versioned
 *  drivers: Condor 3 changed the wind-direction convention in $LXWP0. Read a Condor 3 stream
 *  with the Condor 2 driver and the wind comes out REVERSED — silently, plausibly, and with
 *  the pilot trusting it. XCSoar had to ship two separate drivers for exactly this. */
export type Driver = 'generic' | 'condor2' | 'condor3';

/** Parse one sentence. Returns null when the line is malformed, has a bad checksum, or simply
 *  carries nothing we use. Never throws, never partially applies (ACQ-005). */
export function parse(line: string, driver: Driver = 'generic'): Reading | null {
  if (!isValid(line)) return null;
  const body = line.slice(1, line.lastIndexOf('*'));
  const f = body.split(',');
  const type = f[0];

  // --- GGA: position + altitude ---
  if (type.endsWith('GGA')) {
    const quality = num(f[6]);
    if (quality === 0) return null;                 // no fix — not an error, just no position
    const t = sod(f[1]), lat = coord(f[2], f[3]), lon = coord(f[4], f[5]);
    if (t == null || lat == null || lon == null) return null;
    return { fix: { sod: t, lat, lon, alt: num(f[9]) } };
  }

  // --- RMC: position + ground speed + track ---
  if (type.endsWith('RMC')) {
    if (f[2] !== 'A') return null;                  // 'V' = void: the receiver says do not use this
    const t = sod(f[1]), lat = coord(f[3], f[4]), lon = coord(f[5], f[6]);
    if (t == null || lat == null || lon == null) return null;
    const kn = num(f[7]);
    return {
      fix: { sod: t, lat, lon },
      groundSpeed: kn == null ? undefined : kn * KNOTS_TO_MS,
      track: num(f[8]),
    };
  }

  // --- $LXWP0: LX Navigation vario/wind. Condor emulates it. ---
  if (type === 'LXWP0') {
    //   $LXWP0, logger, IAS(km/h), baroAlt(m), vario1..vario6, heading, windDir, windSpeed
    //      0        1        2           3          4 .. 9          10       11        12
    // Six vario fields, not one, and a heading before the wind. Miscount them and the wind
    // direction becomes the heading — a number that looks entirely plausible.
    const r: Reading = {};
    const baro = num(f[3]);
    if (baro != null) r.pressureAlt = baro;
    const vario = num(f[4]);
    if (vario != null) r.vario = vario;

    const wDir = num(f[11]), wSpd = num(f[12]);
    if (wDir != null && wSpd != null) {
      // THE trap. Condor 3 reports the direction the wind blows TOWARDS; Condor 2 (and LX)
      // report where it blows FROM — the meteorological convention every pilot expects. Get
      // this wrong and the wind arrow points backwards while looking entirely reasonable.
      const from = driver === 'condor3' ? (wDir + 180) % 360 : wDir;
      r.wind = { speed: wSpd / 3.6, direction: from };   // LX sends km/h
    }
    return Object.keys(r).length ? r : null;
  }

  return null;   // a sentence we do not use is not a failure
}
