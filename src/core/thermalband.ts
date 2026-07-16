// ============ the thermal band (THE-003): at what height is the day working? ============
//
// The pilot asks this out loud, on the radio, four times an afternoon: "ça monte mieux en haut ou
// en bas ?". It is not the same question as "what did the last thermal average" (VAR-006, answered
// by circling.ts). It is a question about the DAY: the inversion sits somewhere, the climbs go soft
// under it, and the pilot wants to know at which height he should stop climbing and push on — and,
// on the next glide, how low he may let himself go before the air stops working.
//
// So the answer is not one number. It is a LADDER: one average rate of climb per slice of altitude,
// accumulated over the whole flight, every thermal of the day poured into the same slices.
//
// ---- what counts, and what would poison it ----
//
// Only what happened IN A SPIRAL, and circling.ts already says when that is (`circling()`, the same
// gate THE-001 and the terrain alarm read). The reason is not tidiness. A glide through a slice at
// −1.5 m/s is not evidence about that slice's LIFT; it is evidence about the glider's polar. Mix the
// cruise in and the band measures the sink rate of the aeroplane, which the pilot already knows, and
// buries the one thing he does not.
//
// And the step INTO the spiral is thrown away too — see the `wasCircling` guard. The pull-up that
// starts a climb converts twenty knots of speed into thirty metres of height in three seconds, and
// billed to a slice that reads as +10 m/s. One entry like that, in a slice with little else in it,
// and the band would point the pilot at an altitude where nothing ever climbed.
//
// ---- and a slice nobody stayed in says NOTHING ----
//
// Three seconds clipped off the top of a climb is not a measurement. Two GPS altitudes, each ±5 m,
// divided by 3 s, is an average rate of climb with an error bar of ±2 m/s: the noise is bigger than
// anything the day can produce. Printed as "+1.8 m/s" it is indistinguishable from a real reading,
// and the pilot would climb to that height and find nothing. So a slice under MIN_SLICE_S of
// circling has NO average — `avgMs: null`, the screen says "—", and the accumulated time is
// reported next to it so a human can see WHY it is empty rather than wonder whether it is broken.
// An empty slice is empty. It is never 0.0 m/s: a zero here reads as "nothing works at that height",
// which is a claim, and one the pilot cannot see through.

/** The height of one slice, in metres.
 *
 *  A compromise the pilot can feel. Too tall (300 m) and the whole usable band on a mediocre day is
 *  three bars — the inversion, the thing he is looking for, is inside one of them and invisible.
 *  Too short (25 m) and a 2 m/s climb crosses a slice in twelve seconds, so nearly every slice falls
 *  under MIN_SLICE_S and the ladder is a column of dashes.
 *
 *  100 m is one minute of climb at 1.7 m/s — comfortably over the noise floor on a single pass — and
 *  it puts ten to twenty rungs under a 1000–2000 m working band, which is enough to SEE the shape:
 *  weak at the bottom, best in the middle third, dying under the cap. */
export const SLICE_M = 100;

/** Below this much accumulated circling time, a slice has no average at all.
 *
 *  It is set by the altimeter's noise, not by taste. With a per-fix altitude error of ~5 m, an
 *  average taken over T seconds carries an error of roughly 7/T m/s: ±2.4 m/s at 3 s, ±0.35 m/s at
 *  20 s, ±0.23 m/s at 30 s. Thirty seconds is where the error falls below the last digit the screen
 *  shows (0.1 m/s is the display, but a quarter of a m/s is the honest resolution), and it is also,
 *  usefully, about the time a climbing glider actually spends crossing a 100 m slice. A slice the
 *  glider merely clipped on its way through cannot reach it; a slice it truly worked cannot miss it. */
export const MIN_SLICE_S = 30;

/** A hole in the fixes longer than this is not attributed to any slice.
 *
 *  Fixes arrive at 1 Hz. When they stop for a minute — the GPS lost the sky under a wing, the log
 *  was paused, the tail of a replay ran out — we know the glider was circling before the hole and
 *  circling after it, and NOTHING about what happened inside. Bridging it would credit a slice with
 *  a minute of climb that may have been a minute of centring, or of leaving and coming back, and
 *  would attribute the whole height change to whichever slice the midpoint happened to fall in. Ten
 *  seconds is generous for a stutter of the receiver and far short of anything a glider can hide in. */
export const MAX_GAP_S = 10;

/** Beyond this, the altitude is not a glider's — it is a corrupt fix or an uninitialised field, and
 *  one of them would allocate a hundred thousand empty slices for the ladder to walk through. */
const ALT_LIMIT_M = 20000;

/** One rung of the ladder. `avgMs` is null — never 0 — when the slice has not been circled in long
 *  enough to say anything (THE-003); `timeS` is still reported, because a pilot who can see that the
 *  slice holds four seconds understands the dash, and a pilot who sees a blank does not. */
export interface BandSlice {
  /** Bottom of the slice, metres, same datum as the altitudes fed in. */
  baseM: number;
  /** Top of the slice. Always `baseM + SLICE_M`. */
  topM: number;
  /** Mean rate of climb observed in a spiral inside this slice, m/s. Negative is allowed and is a
   *  fact: a height band where the circles sank is exactly what the pilot needs told. Null when the
   *  slice holds less than MIN_SLICE_S of circling — including when it holds nothing at all. */
  avgMs: number | null;
  /** Seconds of circling accumulated in this slice, over the whole flight. */
  timeS: number;
  /** Net height gained (or lost, if negative) while circling inside this slice, metres. */
  gainM: number;
}

export interface ThermalBand {
  /** One fix. `circling` is circling.ts's own verdict for this fix — the same gate the wind rose and
   *  the terrain alarm use. Time is an argument, never a clock read: an accumulator whose state
   *  cannot be driven from a test is an accumulator nobody checks. */
  add(sod: number, altM: number, circling: boolean): void;
  /** The ladder, lowest slice first, CONTIGUOUS from the lowest slice ever circled in to the highest
   *  — gaps in the middle come back as slices with `avgMs: null` and `timeS: 0`. A ladder with rungs
   *  missing would read as a shorter band, not as an unexplored one, and the pilot would draw the
   *  inversion at the wrong height. Empty (`[]`) until the glider has circled at all. */
  slices(): readonly BandSlice[];
  /** Where it climbs best today, or null while no slice has yet earned an average. Never a fallback
   *  to "the middle" or to zero. */
  best(): BandSlice | null;
}

interface Acc { timeS: number; gainM: number }

/** The slice a height falls in. Floor, not round: slice 0 is [0, 100) and slice −1 is [−100, 0), so
 *  the ladder stays a partition even below the datum (a QNH-referenced altitude over the Zuiderzee,
 *  a badly set QFE — neither is our business to reject here). */
const idxOf = (altM: number): number => Math.floor(altM / SLICE_M);

export function thermalBand(): ThermalBand {
  const acc = new Map<number, Acc>();
  let lo = 0;
  let hi = -1;   // hi < lo means: nothing accumulated yet.
  let prevSod: number | null = null;
  let prevAlt = 0;
  let prevCircling = false;

  const clear = (): void => {
    acc.clear();
    lo = 0;
    hi = -1;
    prevSod = null;
    prevCircling = false;
  };

  const sliceAt = (i: number): BandSlice => {
    const a = acc.get(i);
    const timeS = a ? a.timeS : 0;
    const gainM = a ? a.gainM : 0;
    return {
      baseM: i * SLICE_M,
      topM: (i + 1) * SLICE_M,
      // The whole discipline of the project, in one ternary: not enough time, no number.
      avgMs: timeS >= MIN_SLICE_S ? gainM / timeS : null,
      timeS,
      gainM,
    };
  };

  return {
    add(sod, altM, circling) {
      if (!Number.isFinite(sod) || !Number.isFinite(altM) || Math.abs(altM) > ALT_LIMIT_M) return;

      // A clock that goes BACKWARDS is not a bad fix, it is a DIFFERENT FLIGHT — replay an afternoon
      // log (sod ≈ 50000) and then plug in the instrument next morning (sod ≈ 32000). circling.ts
      // resets on exactly this, and a band that did not would keep showing yesterday's inversion,
      // in plain measured styling, as today's.
      if (prevSod !== null && sod < prevSod) clear();

      const dt = prevSod === null ? 0 : sod - prevSod;
      // Only the step BETWEEN two circling fixes is evidence about a slice's lift. The step that
      // enters the spiral carries the pull-up (a zoom that reads as +10 m/s and is stored energy,
      // not air), and the step that leaves it carries the roll-out and the dive away.
      const usable = prevSod !== null && prevCircling && circling && dt > 0 && dt <= MAX_GAP_S;

      if (usable) {
        // Bill the step to the slice its MIDPOINT falls in. A step straddling a boundary belongs
        // half to each and we refuse to split it (splitting assumes a constant rate inside the step,
        // which is precisely the thing being measured); the midpoint at least never charges a slice
        // for a climb that happened mostly outside it, which taking the start altitude would do on
        // every fast climb.
        const i = idxOf((prevAlt + altM) / 2);
        const a = acc.get(i) ?? { timeS: 0, gainM: 0 };
        a.timeS += dt;
        a.gainM += altM - prevAlt;
        acc.set(i, a);
        if (hi < lo) { lo = i; hi = i; }
        else { if (i < lo) lo = i; if (i > hi) hi = i; }
      }

      prevSod = sod;
      prevAlt = altM;
      prevCircling = circling;
    },

    slices() {
      if (hi < lo) return [];
      const out: BandSlice[] = [];
      for (let i = lo; i <= hi; i++) out.push(sliceAt(i));
      return out;
    },

    best() {
      let bestSlice: BandSlice | null = null;
      for (let i = lo; i <= hi; i++) {
        const s = sliceAt(i);
        if (s.avgMs === null) continue;
        // Strict >, walking upwards: on a tie the LOWER slice wins. The pilot is being told where to
        // work, and height that is not worth more than the height below it is height paid for with
        // time. It is also the answer he can act on soonest — he is usually under it, not over it.
        if (bestSlice === null || s.avgMs > (bestSlice.avgMs as number)) bestSlice = s;
      }
      return bestSlice;
    },
  };
}
