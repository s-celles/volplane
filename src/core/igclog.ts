// ============ the IGC logger (LOG-001 …) ============
// The flight, written down in the format every scorer and every replay reads — including
// ours: the round-trip test hands this file's output to soaring-core's parseIGC and demands
// the same fixes back. An encoder judged by its own ecosystem's parser cannot quietly drift.
//
// Same discipline as everywhere: a fix with no altitude logs the altitude fields as ZERO
// because the IGC grammar has no empty cell — but the A/V validity flag says which fixes
// carried a real 3D fix, so nothing is passed off as measured that was not.

import type { NavState } from './nav';

const two = (n: number): string => String(Math.floor(n)).padStart(2, '0');

/** Decimal degrees → IGC DDMM mmm (lat) / DDDMM mmm (lon), hemisphere letter appended. */
function igcCoord(v: number, isLat: boolean): string {
  const a = Math.abs(v);
  const deg = Math.floor(a);
  const minTh = Math.round((a - deg) * 60000);          // minutes × 1000, the IGC unit
  const hemi = isLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E');
  return String(deg).padStart(isLat ? 2 : 3, '0') + String(minTh).padStart(5, '0') + hemi;
}

const alt5 = (m: number | undefined | null): string =>
  String(Math.max(-9999, Math.min(99999, Math.round(m ?? 0)))).padStart(5, '0');

/** One NavState with a fix → one B record. Null without a fix: no place, no line. */
export function bRecord(s: NavState): string | null {
  if (!s.fix) return null;
  const { sod, lat, lon, alt } = s.fix;
  const t = two(sod / 3600) + two((sod / 60) % 60) + two(sod % 60);
  // 'A' = 3D fix (we have a GPS altitude), 'V' = the altitude is not to be believed.
  const valid = alt != null ? 'A' : 'V';
  return `B${t}${igcCoord(lat, true)}${igcCoord(lon, false)}${valid}${alt5(s.pressureAlt)}${alt5(alt)}`;
}

export interface LogMeta {
  /** UTC day the log is of, YYYY-MM-DD. */
  day: string;
  pilot?: string;
  gliderType?: string;
}

/** The header block. 'XXX' is the unassigned manufacturer code — honest for an uncertified
 *  logger (NFR-008): this file records the flight, it does not claim an FAI seal. */
export function igcHeader(meta: LogMeta): string {
  const [y, m, d] = meta.day.split('-');
  return [
    'AXXXVOLPLANE',
    `HFDTEDATE:${d}${m}${y.slice(2)}`,
    `HFPLTPILOTINCHARGE:${meta.pilot ?? ''}`,
    `HFGTYGLIDERTYPE:${meta.gliderType ?? ''}`,
    'HFFTYFRTYPE:VOLPLANE',
  ].join('\r\n') + '\r\n';
}

export interface IgcLogger {
  /** Feed every navigation state; only fixes become records, at most one per second — the
   *  IGC second is the format's own resolution, and Condor's 1 Hz maps one-to-one. */
  add(s: NavState): void;
  /** The complete file so far. Cheap to call: the records accumulate as strings. */
  file(): string;
  count(): number;
}

export function igcLogger(meta: LogMeta): IgcLogger {
  const records: string[] = [];
  let lastSod = -1;
  return {
    add(s: NavState): void {
      if (!s.fix || Math.floor(s.fix.sod) === lastSod) return;
      const rec = bRecord(s);
      if (!rec) return;
      lastSod = Math.floor(s.fix.sod);
      records.push(rec);
    },
    file: () => igcHeader(meta) + records.join('\r\n') + (records.length ? '\r\n' : ''),
    count: () => records.length,
  };
}
