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

/** A whole IGC file -> the sentences of its flight, in order. */
export function igcToSentences(txt: string): string[] {
  return parseIGC(txt).map(([lon, lat, alt, sod]) => gga(lon, lat, alt, sod));
}
