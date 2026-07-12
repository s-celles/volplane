// ============ derived flight values (VAR-001…003, POS-003…006) ============
// The numbers between the instrument and the screen: what the polar makes of the vario, what
// the atmosphere makes of the airspeed, what a half-minute makes of the noise. Everything
// here DERIVES — from NavState, from the kernel's polar maths, from a QNH the pilot set. A
// missing input propagates as null, never as a plausible stand-in: no IAS means no TAS and
// no netto, not a netto priced at a guessed speed.

import { nettoAt, superNettoAt, type Polar } from 'soaring-core/polar';
import type { NavState } from './nav';

/** ISA pressure-altitude scale height for the density correction (m). TAS = IAS·√(ρ₀/ρ),
 *  and up in the convective band √(ρ₀/ρ) ≈ e^(h/2H) within a fraction of a percent — an
 *  error far below what a mechanical ASI reads to. */
const H_SCALE = 8435;

/** True airspeed (m/s) from indicated, at a pressure altitude (POS-005). */
export function tasAt(ias: number, pressureAlt: number): number {
  return ias * Math.exp(Math.max(0, pressureAlt) / (2 * H_SCALE));
}

/** QNH altitude (m, POS-003/004): the pressure altitude re-based from the 1013.25 hPa the
 *  instrument assumes onto the QNH the pilot set. ~8.3 m per hPa near the surface — the
 *  aviation rule of thumb, exact enough for a setting that itself moves hour to hour. */
export const M_PER_HPA = 8.3;
export function qnhAlt(pressureAlt: number, qnh: number): number {
  return pressureAlt + (qnh - 1013.25) * M_PER_HPA;
}

export interface Derived {
  /** True airspeed (m/s), or null without an IAS — never ground speed in disguise. */
  tas: number | null;
  /** The air's own motion (VAR-002) and what circling in it would yield (VAR-003). Null
   *  without both a vario and an airspeed: a netto priced at a guessed speed is a lie. */
  netto: number | null;
  superNetto: number | null;
  /** QNH altitude (m), when the instrument gives a pressure altitude. */
  qnhAlt: number | null;
}

/** Everything the polar and the atmosphere derive from one NavState (a pure function — the
 *  rolling average below is the only stateful thing in this file, and it is its own box). */
export function derive(s: NavState, pl: Polar, qnh = 1013.25): Derived {
  const tas = s.ias != null ? tasAt(s.ias, s.pressureAlt ?? s.fix?.alt ?? 0) : null;
  return {
    tas,
    netto: s.vario != null && tas != null ? nettoAt(pl, s.vario, tas) : null,
    superNetto: s.vario != null && tas != null ? superNettoAt(pl, s.vario, tas) : null,
    qnhAlt: s.pressureAlt != null ? qnhAlt(s.pressureAlt, qnh) : null,
  };
}

/** The rolling vertical average (POS-006): the vario integrated over a window, seconds-of-day
 *  driven so a replay averages identically to a live flight. Null until the window has SOME
 *  history — an average of nothing is not 0.0 m/s. */
export function rollingVario(windowS = 30) {
  const samples: { t: number; v: number }[] = [];
  return {
    add(t: number, v: number): void {
      samples.push({ t, v });
      while (samples.length && t - samples[0].t > windowS) samples.shift();
    },
    average(): number | null {
      if (!samples.length) return null;
      return samples.reduce((a, s) => a + s.v, 0) / samples.length;
    },
  };
}
