// ============ FLARM traffic (FLM-001 … FLM-005) ============
// PFLAU is the instrument's own judgement — one line, the loudest threat. PFLAA is the
// picture — one line per aircraft. Both are parsed with the same refusal discipline as
// every NMEA sentence (ACQ-005): malformed means null, never a half-applied threat.
//
// FLM-005 is not a display detail, it is THE display rule: FLARM sees only other FLARMs.
// A quiet traffic screen means "no FLARM threat", never "no traffic" — the words the UI
// prints beside this data are part of the requirement, and the constant below is exported
// so the screen and the tests share the exact sentence.

import { isValid } from './nmea';

/** The reminder that must accompany every traffic display, verbatim (FLM-005). */
export const SEE_AND_AVOID =
  'FLARM sees only other FLARMs — traffic display does not replace looking out';

/** 0 none · 1 info (~19–25 s) · 2 important (~14–18 s) · 3 urgent (≤ 13 s). FLARM's own scale. */
export type AlarmLevel = 0 | 1 | 2 | 3;

export interface FlarmStatus {
  rx: number;                     // devices heard
  alarm: AlarmLevel;
  /** Degrees relative to OWN track, [-180, 180], toward the loudest threat. Null when the
   *  instrument sends none (no alarm, or no directional fix on the threat). */
  bearing: number | null;
  /** Metres above (+) / below (−) us, and metres away, of the loudest threat. */
  relVertical: number | null;
  relDistance: number | null;
}

export interface Traffic {
  id: string;
  alarm: AlarmLevel;
  /** Metres north and east of OWN position — FLARM's own relative frame, kept as sent. */
  relNorth: number;
  relEast: number;
  relVertical: number | null;
  track: number | null;
  groundSpeed: number | null;
  climbRate: number | null;
  /** Seconds-of-day this aircraft was last heard (caller supplies the clock). */
  at: number;
}

const num = (s: string | undefined): number | null => {
  if (s == null || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

const level = (v: number | null): AlarmLevel =>
  (v === 1 || v === 2 || v === 3 ? v : 0);

/** $PFLAU: the instrument's summary. Null on a malformed line, per ACQ-005. */
export function parsePflau(line: string): FlarmStatus | null {
  if (!isValid(line)) return null;
  const f = line.slice(1, line.lastIndexOf('*')).split(',');
  if (f[0] !== 'PFLAU') return null;
  const rx = num(f[1]);
  if (rx == null) return null;
  return {
    rx,
    alarm: level(num(f[5])),
    bearing: num(f[6]),
    relVertical: num(f[8]),
    relDistance: num(f[9]),
  };
}

/** $PFLAA: one aircraft of the picture. `at` is the caller's clock (seconds of day) — the
 *  sentence carries no time of its own, and ageing the picture is trafficStore's job. */
export function parsePflaa(line: string, at: number): Traffic | null {
  if (!isValid(line)) return null;
  const f = line.slice(1, line.lastIndexOf('*')).split(',');
  if (f[0] !== 'PFLAA') return null;
  const relNorth = num(f[2]), relEast = num(f[3]);
  if (relNorth == null || relEast == null) return null;   // a threat with no place is no picture
  return {
    id: f[6] || `anon:${relNorth}:${relEast}`,
    alarm: level(num(f[1])),
    relNorth, relEast,
    relVertical: num(f[4]),
    track: num(f[7]),
    groundSpeed: num(f[9]),
    climbRate: num(f[10]),
    at,
  };
}

/** How long an aircraft stays on the picture after its last sentence. FLARM repeats every
 *  second; five silent seconds means gone (out of range, landed, or shadowed) — and a stale
 *  glider painted as current is a pilot looking at the wrong sky. */
export const TRAFFIC_TTL_S = 5;

export interface TrafficStore {
  add(t: Traffic): void;
  /** The live picture at `now`, loudest first. Ageing happens HERE, on read — the store
   *  never shows an aircraft older than TRAFFIC_TTL_S. */
  picture(now: number): Traffic[];
}

export function trafficStore(): TrafficStore {
  const byId = new Map<string, Traffic>();
  return {
    add(t: Traffic): void { byId.set(t.id, t); },
    picture(now: number): Traffic[] {
      for (const [id, t] of byId) if (now - t.at > TRAFFIC_TTL_S) byId.delete(id);
      return [...byId.values()].sort((a, b) => b.alarm - a.alarm
        || Math.hypot(a.relNorth, a.relEast) - Math.hypot(b.relNorth, b.relEast));
    },
  };
}
