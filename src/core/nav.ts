// ============ the navigation state (POS-001, POS-002, TER-002, TER-003) ============
// Where we are, how high above the ground, how fast, going where. Everything a first screen
// needs, and nothing more.
//
// This is where soaring-core earns its keep: the height above ground is an ElevSampler away,
// and the sampler does not care whether the terrain came off a CDN or out of an offline pack
// (OFF-004). The flight computer asks "how high is the ground here?" and gets an answer, or
// gets NULL — which is a different thing from zero, and the difference is a mountain.

import type { ElevSampler } from 'soaring-core/ports';
import { parse, type Driver, type Reading } from './nmea';

export interface NavState {
  /** Null until the first valid fix. A flight computer with no position must SAY so, not
   *  show a plausible one. */
  fix: { sod: number; lat: number; lon: number; alt?: number } | null;
  groundSpeed?: number;
  track?: number;
  vario?: number;
  /** Indicated airspeed (m/s) and pressure altitude (m), when a vario sentence supplies
   *  them. Carried raw: TAS, QNH altitude and the polar's speeds derive in compute.ts. */
  ias?: number;
  pressureAlt?: number;
  /** The wind the INSTRUMENT reported. Not the one we estimate (VEN-001) — that is a separate
   *  claim, and conflating them would let a model quietly pass for a measurement (POT-007's
   *  principle, applied to the wind). */
  reportedWind?: { speed: number; direction: number };
  /** Terrain elevation under the glider (m). Null = the ground is UNKNOWN here — not loaded,
   *  not sea level. */
  groundElev: number | null;
  /** Height above ground (m). Null when either the position or the ground is unknown. There is
   *  no honest AGL without both. */
  agl: number | null;
}

export const EMPTY: NavState = { fix: null, groundElev: null, agl: null };

/** Re-ask the terrain under the CURRENT fix. Needed twice: by `apply` when a fix moves, and
 *  by the shell when a tile arrives — the ground under an unmoved glider just became known,
 *  and waiting a whole fix for the AGL to appear would show UNKNOWN over terrain we hold.
 *  Pure, and identity-preserving: if nothing changed, the same state comes back. */
export function reground(state: NavState, elev: ElevSampler): NavState {
  if (!state.fix) return state;
  const g = elev(state.fix.lon, state.fix.lat);
  const agl = g != null && state.fix.alt != null ? state.fix.alt - g : null;
  if (g === state.groundElev && agl === state.agl) return state;
  return { ...state, groundElev: g, agl };
}

/** Apply one sentence to the state. Pure: state in, state out. A sentence that parses to
 *  nothing leaves the state EXACTLY as it was (ACQ-005) — including the object identity, so a
 *  UI can cheaply tell that nothing happened. */
export function apply(state: NavState, line: string, elev: ElevSampler, driver: Driver = 'generic'): NavState {
  const r: Reading | null = parse(line, driver);
  if (!r) return state;

  const next: NavState = { ...state };
  // GGA carries the altitude; RMC, of the SAME instant, does not. Merging the altitude across
  // the pair is reading the receiver correctly; carrying it to a LATER fix would be inventing
  // a measurement — one second is 1.5 m of climb, or much more of sink.
  if (r.fix) next.fix = r.fix.alt == null && state.fix?.sod === r.fix.sod
    ? { ...r.fix, alt: state.fix.alt }
    : r.fix;
  if (r.groundSpeed !== undefined) next.groundSpeed = r.groundSpeed;
  if (r.track !== undefined) next.track = r.track;
  if (r.vario !== undefined) next.vario = r.vario;
  if (r.ias !== undefined) next.ias = r.ias;
  if (r.pressureAlt !== undefined) next.pressureAlt = r.pressureAlt;
  if (r.wind) next.reportedWind = r.wind;

  // The ground, and the height above it. Recomputed only when the position moved — the
  // elevation sampler may hit a tile cache, and a flight computer runs at 1 Hz for hours.
  return r.fix ? reground(next, elev) : next;
}

/** Drive the state from a source of sentences. This is the whole flight computer's intake:
 *  a stream in, a state out, and no idea where the stream came from (C5). */
export async function* navigate(
  src: AsyncIterable<string>,
  elev: ElevSampler,
  driver: Driver = 'generic',
  initial: NavState = EMPTY,
): AsyncIterable<NavState> {
  let state = initial;
  for await (const line of src) {
    const next = apply(state, line, elev, driver);
    if (next !== state) {
      state = next;
      yield state;
    }
  }
}
