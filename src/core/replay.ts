// ============ IGC -> NMEA (ACQ-010) ============
// A replayed flight enters through the SAME door as a live instrument: as sentences. The
// alternative — a parallel path that feeds the navigation state directly — would mean the
// replay exercises different code than a flight does, and a replay that cannot catch a
// parsing bug is a replay that proves nothing. So an IGC file becomes GGA sentences, and
// everything downstream (nmea.ts, nav.ts, the screen) cannot tell it from Condor.
//
// soaring-core does the IGC reading (C4: what is generic lives there); this file only turns
// its track points back into the NMEA dialect our own front door speaks.
import { parseIGC } from 'soaring-core/igc';
import { distM, bearingDeg } from 'soaring-core/geo';

const checksum = (body: string): string => {
  let c = 0;
  for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i);
  return c.toString(16).toUpperCase().padStart(2, '0');
};

/** Decimal degrees -> NMEA ddmm.mmmm. The carry matters: 46.9999999° is 46°60.0000′ after
 *  rounding, and coord() downstream rightly refuses 60 minutes — so carry it into the degree
 *  instead of emitting a sentence our own parser must reject. */
function dm(v: number, degDigits: number): string {
  const a = Math.abs(v);
  let deg = Math.floor(a);
  let min = (a - deg) * 60;
  if (Number(min.toFixed(4)) >= 60) { deg += 1; min = 0; }
  return `${String(deg).padStart(degDigits, '0')}${min.toFixed(4).padStart(7, '0')}`;
}

/** One track point -> one $GPGGA. Quality 1 (an IGC B-record IS a fix); the fields we do not
 *  know (satellites, HDOP, geoid separation) are left EMPTY, not invented — the parser treats
 *  an empty field as unknown, which is the truth. */
export function gga(lon: number, lat: number, alt: number, sod: number): string {
  const h = Math.floor(sod / 3600), m = Math.floor(sod / 60) % 60, s = sod % 60;
  const hms = `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}.00`;
  const body = `GPGGA,${hms},${dm(lat, 2)},${lat < 0 ? 'S' : 'N'},${dm(lon, 3)},${lon < 0 ? 'W' : 'E'},1,,,${alt.toFixed(1)},M,,M,,`;
  return `$${body}*${checksum(body)}`;
}

/** One track point -> one $GPRMC, carrying COURSE and GROUND SPEED.
 *
 *  A B-record has neither — an IGC file is positions and times. But the course and speed BETWEEN two
 *  fixes are not an invention: they are the real geometry of the flight, the same track and speed a
 *  GPS computes from the same movement. Emitting them makes a replay behave like a flight rather than
 *  like a positions-only feed — which is the whole point of ACQ-010, and it is what lets a pilot
 *  rehearse a track-up screen (CAR-002) on the ground before he trusts it in the air.
 *
 *  The FIRST fix has no previous one to measure from, so it gets no RMC: course and speed are unknown
 *  there, and unknown is emitted as nothing, never as zero. */
export function rmc(lon: number, lat: number, sod: number, speedKt: number, courseDeg: number): string {
  const h = Math.floor(sod / 3600), m = Math.floor(sod / 60) % 60, s = sod % 60;
  const hms = `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}.00`;
  const body = `GPRMC,${hms},A,${dm(lat, 2)},${lat < 0 ? 'S' : 'N'},${dm(lon, 3)},${lon < 0 ? 'W' : 'E'}`
    + `,${speedKt.toFixed(1)},${courseDeg.toFixed(1)},,,,`;
  return `$${body}*${checksum(body)}`;
}

/** A whole IGC file -> the sentences of its flight, in order.
 *
 *  Each fix is a GGA (position, altitude) and, from the second on, an RMC (course, speed derived from
 *  the leg just flown). Two sentences per fix, exactly as a real GPS emits them. */
export function igcToSentences(txt: string): string[] {
  const pts = parseIGC(txt);
  const out: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [lon, lat, alt, sod] = pts[i]!;
    out.push(gga(lon, lat, alt, sod));
    if (i === 0) continue;
    const [plon, plat, , psod] = pts[i - 1]!;
    const dtS = sod - psod;
    if (dtS <= 0) continue;                       // same second, or time ran backwards: no course from it
    const d = distM(plon, plat, lon, lat);
    const speedKt = (d / dtS) / 0.514444;         // m/s -> knots, the unit RMC speaks
    out.push(rmc(lon, lat, sod, speedKt, bearingDeg(plon, plat, lon, lat)));
  }
  return out;
}
