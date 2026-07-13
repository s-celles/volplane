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

/** 0 none · 1 low (13–18 s) · 2 important (9–12 s) · 3 urgent (0–8 s). FLARM's own scale, and
 *  every level from 1 up is a COLLISION ALARM in the Dataport spec — there is no "info" tier. */
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
  /** Seconds-of-day this judgement was heard (the caller supplies the clock, exactly as Traffic
   *  does). It exists so the status can be AGED: without it, the last PFLAU stands forever, and a
   *  FLARM that falls silent mid-alarm — cable out, a source that sends position but no FLARM,
   *  a replay followed by a Condor stream — leaves the banner lit and the warble sounding about
   *  traffic that passed minutes ago, with no fix left that could ever retract it. */
  at: number;
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

/** $PFLAU: the instrument's summary. Null on a malformed line, per ACQ-005. `at` is the caller's
 *  clock (seconds of day), as for PFLAA — the sentence carries no time of its own, and a
 *  judgement that cannot be timed cannot be withdrawn. */
export function parsePflau(line: string, at: number): FlarmStatus | null {
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
    at,
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

/** The instrument's own JUDGEMENT ages on exactly the same law as the picture it judges, and for
 *  a harder reason: an alarm is a claim about the next few seconds, so the moment the FLARM stops
 *  speaking there is no evidence for it. Read the status through here — never straight off the
 *  last-seen object — and a FLARM that goes quiet mid-alarm falls silent with its own banner
 *  instead of warbling, unretractably, for the rest of the flight over an empty traffic list.
 *
 *  A clock that has gone BACKWARDS (a new replay, a day rollover) is a different flight, and last
 *  flight's threat is not this flight's: it ages out too. */
export function freshStatus(f: FlarmStatus | null, now: number): FlarmStatus | null {
  if (!f) return null;
  const dt = now - f.at;
  return dt < 0 || dt > TRAFFIC_TTL_S ? null : f;
}

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
