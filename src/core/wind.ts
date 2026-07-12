// ============ the estimated wind (VEN-001, VEN-003, VEN-004) ============
// A circling glider is a balloon: whatever its airspeed does, its CIRCLES go where the air
// goes. The kernel already knows how to find the circles (detectClimbs) and read their drift
// (thermalDrift) — C4 leaves this file only the live plumbing: keep a window of recent fixes,
// ask the kernel, remember what it said per altitude band.
//
// This wind is an ESTIMATE, and VEN-001 draws the line the UI must not blur: the instrument's
// reported wind and ours are two different claims and are never merged. The estimate carries
// its own evidence (how many thermals, how old) so the display can say how much to trust it —
// the same honesty POT-007 demands of the lift fields.

import type { Probe } from 'soaring-core/ports';
import { detectClimbs, type Thermal } from 'soaring-core/airmass';
import { probeFromTrack } from './liftmap';
import type { TrackPoint } from 'soaring-core/types';

export interface WindEstimate {
  /** m/s, meteorological: the direction the wind blows FROM, like every pilot expects. */
  speed: number;
  direction: number;
  /** The evidence: how many detected climbs drifted into this number, and the seconds-of-day
   *  of the last one — the display's staleness clock, not ours to hide. */
  climbs: number;
  at: number;
  /** The altitude band the contributing circles spanned (m) — VEN-003's ladder rung. */
  band: [number, number];
}

/** How much track the estimator keeps (s). Two thermals apart rarely exceed this; a longer
 *  memory would average yesterday's wind into today's. */
export const WINDOW_S = 1200;

/** VEN-004's rungs: the profile is reported per altitude band this thick (m). */
export const BAND_M = 500;

const drift = (ths: readonly Thermal[]): [number, number] | null => {
  // The kernel's thermalDrift averages ALL thermals; the live ladder wants them per band,
  // so the same mean is taken here over a band's subset — same maths, kernel's detection.
  let u = 0, v = 0, n = 0;
  for (const t of ths) {
    if (t.dt <= 0) continue;
    const lat = (t.c0[1] + t.c1[1]) / 2;
    u += (t.c1[0] - t.c0[0]) * 111320 * Math.cos(lat * Math.PI / 180) / t.dt;
    v += (t.c1[1] - t.c0[1]) * 111320 / t.dt;
    n++;
  }
  return n ? [u / n, v / n] : null;
};

const toMet = ([u, v]: [number, number]): { speed: number; direction: number } => ({
  speed: Math.hypot(u, v),
  // The drift vector points WHERE the air goes; the wind is named for where it comes FROM.
  direction: ((Math.atan2(-u, -v) * 180 / Math.PI) + 360) % 360,
});

export interface WindEstimator {
  /** Feed every fix. Cheap: an array push and a trim. */
  add(lon: number, lat: number, alt: number, sod: number): void;
  /** The freshest estimate, or null before the first circled climb — an unknown wind is
   *  null, never a calm one. */
  estimate(): WindEstimate | null;
  /** VEN-004: the ladder — the freshest estimate per altitude band, bottom-up. */
  profile(): WindEstimate[];
}

export function windEstimator(): WindEstimator {
  const pts: TrackPoint[] = [];
  const byBand = new Map<number, WindEstimate>();
  let freshest: WindEstimate | null = null;
  let lastRun = -Infinity;

  function rerun(now: number): void {
    // Detection over 20 minutes of track costs real work; once per 15 s is far finer than
    // the wind changes and invisible next to a 1 Hz fix loop.
    if (now - lastRun < 15) return;
    lastRun = now;
    const probe: Probe | null = probeFromTrack(pts);
    if (!probe) return;
    for (const th of detectClimbs(probe)) {
      const mid = (th.base + th.top) / 2;
      const band = Math.floor(mid / BAND_M);
      const d = drift([th]);
      if (!d) continue;
      const met = toMet(d);
      const est: WindEstimate = {
        ...met, climbs: 1, at: th.t1,
        band: [band * BAND_M, (band + 1) * BAND_M],
      };
      const held = byBand.get(band);
      if (!held || th.t1 >= held.at) byBand.set(band, est);
      if (!freshest || th.t1 >= freshest.at) freshest = est;
    }
  }

  return {
    add(lon, lat, alt, sod): void {
      pts.push([lon, lat, alt, sod]);
      while (pts.length && sod - pts[0][3] > WINDOW_S) pts.shift();
      rerun(sod);
    },
    estimate: () => freshest,
    profile: () => [...byBand.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e),
  };
}
