// ============ the circling assistant (THE-001, THE-002): where in the turn the lift lives ====
// A thermal is almost never centred on the circle the pilot happens to be flying. He feels it —
// the vario surges once a turn — but a surge felt through the seat is a memory by the time he
// could act on it, and half a turn later he no longer knows WHERE it was. This file remembers
// for him: it lays the vario onto the circle it was measured on, and names the sector to shift
// towards.
//
// THE BIN KEY IS NOT THE HEADING. It is the bearing from the CIRCLE'S CENTRE TO THE GLIDER at
// the instant the lift was measured. That is the only thing the pilot can act on: he displaces
// his circle towards a PLACE, and the place is a direction from the centre of the turn he is
// flying. A rose binned by heading answers a question nobody asked — on a circle the heading
// leads the position by 90°, so such a rose would send him to the wrong quarter with complete
// confidence, which is worse than sending him nowhere.
//
// The centre is inferred, not known: it is the centroid of the positions over the last complete
// 360° (circling's `circleState` gives the span). No closed circle ⇒ no centre ⇒ no rose.
//
// THE-001's gate is "TANT QUE le planeur est en spirale", and the emphasis is on TANT QUE. A
// closed circle sitting somewhere in the window is NOT that gate: it stays in the window for
// three minutes after the pilot has rolled out, and a rose drawn off it would point a live arrow
// at air the glider left six kilometres back — advice about a thermal that is now behind him,
// worn with the authority of a measurement. So the gate is `circleState().circling`: the glider
// must be in a sustained turn NOW. Roll out and the rose goes to null, which draws its own
// refusal ("not circling — no rose"). We do not paint a rose over a straight glide, we do not
// extrapolate one from an arc, and we do not keep one warm after the climb.
//
// So the whole object is an ESTIMATE built out of measurements: every sample in it is a real
// vario reading at a real position (C3 does not bite — no modelled field is read here, and none
// ever may be), but the binning, the decay and above all the inferred centre are inference.
// It therefore wears `est`, exactly as the wind does (VEN-001), and exactly as liftmap wears
// `modelled` — as a LITERAL type, so the compiler itself refuses an untagged rose and no caller
// can quietly hand it on with the vario's plain authority. The rose says "this is where the lift
// WAS, as best we can reconstruct it", never "this is where the thermal IS".
//
// Evidence DECAYS. A thermal drifts with the wind and leans with the shear, so a sample three
// minutes old is a claim about air that has physically gone somewhere else; weighting it equally
// with the last turn would anchor the assistant to a core the glider has already left behind.
//
// The vz is the VARIO, and only the vario. A climb rate could be differenced out of the track's
// altitude with the kernel's `rates`, and it is tempting because it is always available — but it
// is a different quantity (GPS-noisy, energy-blind, lagging by its own baseline), and silently
// pouring it into the same bins as the instrument's readings would forge measurements the pilot
// thinks came from his vario. Without a vario there is no rose. Null, and the dash.
//
// And the assistant is allowed to have NO opinion. Below MIN_BINS sampled sectors the circle is
// not mapped; below MIN_CONTRAST_MS of relief the rose is flat, and the strongest bin is then
// just the luckiest one. An assistant that always points somewhere teaches the pilot to chase
// noise out of a thermal he had already centred — the silence is the feature, not a gap in it.

import type { TrackPoint } from 'soaring-core/types';
import { bearingDeg, distM } from 'soaring-core/geo';
import { circleState } from './circling';

export const BINS = 12;              // 30° sectors: fine enough to name a quarter of the circle,
                                     // coarse enough that one lucky beacon cannot own a sector
export const HALF_LIFE_S = 60;       // evidence DECAYS: the thermal drifts and leans, and a
                                     // three-minute-old sample is a claim about air that has gone
export const WINDOW_S = 180;
export const MIN_BINS = 8;           // below this much of the circle sampled, there is no advice
export const MIN_CONTRAST_MS = 0.3;  // a FLAT rose gives NO advice — a coin-toss "go left" is worse
                                     // than silence, because the pilot will fly it

/** Samples nearer than this to the inferred centre have no meaningful bearing FROM it: on a
 *  drifting circle the centroid can land close to the track, and a metre of GPS noise would then
 *  fling the sample across four sectors. A vote that unstable is not evidence. */
const MIN_RADIUS_M = 5;

/** …and samples FARTHER than this from it were not on this circle at all. The ring holds three
 *  minutes, which on a working day includes the glide in: those cruise fixes carry the vario's
 *  sink, they all lie in one direction from the centre we inferred, and binned by bearing they
 *  would pile a wall of −2 m/s into a single sector — depressing the circle's own mean and
 *  inflating the contrast that is supposed to keep a flat rose quiet. A thermalling turn is a
 *  couple of hundred metres across at the very most; a sample half a kilometre from the centre is
 *  a sample of somewhere else. */
const MAX_RADIUS_M = 500;

export interface RoseBin {
  /** Centre bearing of the sector, degrees true, FROM THE CIRCLE'S CENTRE. */
  bearing: number;
  /** Decay-weighted mean vertical speed measured in that part of the circle. NULL for a bin
   *  with no evidence — never 0, which would paint an unsampled sector as dead air. */
  vzMs: number | null;
  /** Summed decay weight: how much this bin's number is actually worth. */
  weight: number;
}

export interface Rose {
  /** The compiler-enforced badge, exactly as liftmap's `modelled: true`. This is an ESTIMATE
   *  from measurements — binned, decayed, and centred on a circle we inferred. It wears `est`. */
  est: true;
  bins: RoseBin[];
  /** THE-002: where to shift the circle. Null when the rose is too empty or too flat to say. */
  best: { bearing: number; vzMs: number } | null;
  /** WHY there is no advice, and it is carried out of core because the two silences are two
   *  different facts and the screen must not say the same sentence about both (POT-007).
   *  'flat' is a measurement: the circle was mapped and the lift really is even, so "even lift —
   *  no shift" is TRUE and the pilot may stay where he is. 'under-sampled' is the absence of one:
   *  most of the circle carries no vario evidence at all, and telling a pilot the lift is even
   *  over sectors nobody has flown is inventing the very measurement the hatched wedges are there
   *  to deny. Null exactly when `best` is not. */
  noAdvice: 'under-sampled' | 'flat' | null;
  /** Circle centre used (lon, lat) — the reference the bearings are measured from. */
  centre: { lon: number; lat: number };
  samples: number;
}

/** A fix as the assistant keeps it: the track point plus the vario reading that went with it.
 *  `vz` is null when the instrument gave none, and a null vz is kept only so the position still
 *  feeds the circle geometry — it never becomes a zero in a bin. */
interface Fix { sod: number; lon: number; lat: number; alt: number; vz: number | null }

export interface CircleRose {
  /** One fix. `vz` is the live vario (m/s) — null when the instrument gives none, and a null
   *  vz contributes NOTHING (it does not contribute a zero). */
  add(sod: number, lon: number, lat: number, alt: number, vz: number | null): void;
  /** The rose at `now`, or NULL when the glider is not circling / has not closed a circle /
   *  has too little evidence. Null renders as the dash and as no advice. */
  rose(now: number): Rose | null;
}

export function circleRose(): CircleRose {
  const ring: Fix[] = [];

  return {
    add(sod, lon, lat, alt, vz) {
      const last = ring.length ? ring[ring.length - 1].sod : null;
      // A fix that does not advance the clock cannot advance the picture, and it would break the
      // binary search the probe does on the track we hand it.
      if (last != null && sod === last) return;
      // A clock that goes backwards is a NEW FLIGHT (a replay, a day rollover), not a fix to be
      // dropped: ignoring it would leave the assistant staring at the previous session's circle
      // for the whole of this one. Same law as circling.ts's ring.
      if (last != null && sod < last) ring.length = 0;
      ring.push({ sod, lon, lat, alt, vz });
      while (ring.length && sod - ring[0].sod > WINDOW_S) ring.shift();
    },

    rose(now) {
      const pts: TrackPoint[] = ring.map(f => [f.lon, f.lat, f.alt, f.sod]);
      // THE-001's gate, both halves: the glider must be circling NOW (or the arrow is advice
      // about air it has left), and it must have closed a circle (or there is no centre to
      // measure bearings from).
      const { circling, span } = circleState(pts);
      if (!circling || !span) return null;

      // The centre. The centroid of ONE complete circle and not of the whole window: over three
      // minutes the thermal drifts downwind, and a centroid of five drifting circles sits in the
      // middle of a sausage, not in the middle of the turn the pilot is flying now.
      let sLon = 0, sLat = 0, n = 0;
      for (const f of ring) {
        if (f.sod < span.fromSod || f.sod > span.toSod) continue;
        sLon += f.lon; sLat += f.lat; n++;
      }
      if (n === 0) return null;
      const centre = { lon: sLon / n, lat: sLat / n };

      const sum = new Float64Array(BINS), wgt = new Float64Array(BINS);
      let samples = 0;
      for (const f of ring) {
        // A null vario is not a zero climb. It is the absence of a reading, and the whole point
        // of this file is that the two never blur.
        if (f.vz === null) continue;
        const age = now - f.sod;
        if (age < 0 || age > WINDOW_S) continue;
        const r = distM(centre.lon, centre.lat, f.lon, f.lat);
        if (r < MIN_RADIUS_M || r > MAX_RADIUS_M) continue;
        const w = 2 ** (-age / HALF_LIFE_S);
        const b = Math.round(bearingDeg(centre.lon, centre.lat, f.lon, f.lat) / (360 / BINS)) % BINS;
        sum[b] += w * f.vz; wgt[b] += w; samples++;
      }
      if (samples === 0) return null;

      const bins: RoseBin[] = [];
      for (let b = 0; b < BINS; b++)
        bins.push({
          bearing: b * (360 / BINS),
          vzMs: wgt[b] > 0 ? sum[b] / wgt[b] : null,
          weight: wgt[b],
        });

      // THE-002. The advice is the strongest sector, but only against a rose that has earned the
      // right to name one: enough of the circle actually flown with a working vario, and enough
      // relief between the best sector and the circle's own average that the difference is lift
      // and not the shape of the noise. Anything less and we say nothing.
      const seen = bins.filter((x): x is RoseBin & { vzMs: number } => x.vzMs !== null);
      let best: Rose['best'] = null;
      // The two silences are named, not merged. Under-sampled means we have not mapped the circle
      // and have nothing to say about it; flat means we HAVE mapped it and it really is even. The
      // screen prints two different sentences, and it can only do that if core tells it which.
      let noAdvice: Rose['noAdvice'] = 'under-sampled';
      if (seen.length >= MIN_BINS) {
        const top = seen.reduce((a, x) => (x.vzMs > a.vzMs ? x : a));
        const mean = seen.reduce((a, x) => a + x.vzMs, 0) / seen.length;
        if (top.vzMs - mean >= MIN_CONTRAST_MS) {
          best = { bearing: top.bearing, vzMs: top.vzMs };
          noAdvice = null;
        } else {
          noAdvice = 'flat';
        }
      }

      return { est: true, bins, best, noAdvice, centre, samples };
    },
  };
}
