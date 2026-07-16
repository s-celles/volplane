// ============ which wind, and who said so (VEN-002) ============
//
// Three claims about the same air, and they disagree:
//
//   MANUAL      the pilot typed it. The briefing at 08:00, the windsock on the launch line, the
//               club-mate on the radio who has just landed and says "it's 20 kt at 2000 ft".
//   INSTRUMENT  the vario sent it down the wire ($LXWP0). Someone else's algorithm, someone else's
//               conventions — see nmea.ts, where Condor 2 and Condor 3 disagree about which way the
//               wind blows and get it REVERSED, silently and plausibly.
//   ESTIMATE    ours, from the drift of the circles we actually flew (wind.ts, VEN-001).
//
// Until VEN-002 the pilot could not contribute at all: the wind was whatever the drift said, or
// whatever the box said. He was the only one in the cockpit with a MET briefing and he had nowhere
// to put it. So he learned to distrust the wind field, and a wind field a pilot distrusts is a final
// glide he flies with a private safety margin nobody can see.
//
// ---- THE QUESTION THIS FILE EXISTS TO ANSWER: does a typed wind expire? ----
//
// Yes, and it must, in two steps — because the failure is not the pilot typing a wrong wind, it is
// the pilot typing a RIGHT wind and the app believing it for the rest of the day. He enters 20 kt at
// 10:00 from the morning briefing. At 17:00 the sea breeze has come through, the gradient has backed
// forty degrees and halved, and the box still says 20 kt because he told it so — with his own hand,
// which is exactly why he will not doubt it. A number that a human authored is the number a human
// checks LEAST.
//
// So the manual wind is not a setting. It is a CLAIM WITH A TIMESTAMP:
//
//   · fresh   (≤ MANUAL_FRESH_S)  it outranks everything. He knows things the drift cannot know.
//   · stale   (≤ MANUAL_MAX_S)    it stops outranking. Live sources take over; it survives only for
//                                 want of anything better, and it is FLAGGED so the screen can grey
//                                 it and ask him for a new one.
//   · expired (>  MANUAL_MAX_S)   it is gone. Not renewed, not extrapolated: gone.
//
// The same clock runs over the other two. An instrument that stopped sending two minutes ago is a
// dead link, not a calm; a drift estimate older than the estimator's own memory is another valley's
// wind. Every source has a freshness and a hard limit, and past the hard limit it does not vote.
//
// ---- and when there is nothing left, there is NOTHING ----
//
// Not zero. A calm wind is a CLAIM — it prices a final glide as generously as a tailwind does — and
// this module never makes it on anyone's behalf. Unknown is null, and the shell must draw an empty
// box a human can see rather than a confident number no one will re-check.
//
// (A manual 0 m/s, on the other hand, IS a claim: the pilot looked at the sock and said "dead calm".
// It is honoured like any other manual value. The difference between "he said calm" and "we have no
// idea" is the whole point of this file, and they must never wear the same label.)
//
// ---- everything that leaves here says where it came from ----
//
// VEN-001 forbids merging the instrument's wind with ours. This module does not average, blend or
// interpolate between the three: it CHOOSES one, whole, and stamps its provenance and its age on it.
// A wind box that says "18 kt" is worth less than one that says "18 kt · you, 40 min ago".
//
// Metres per second and meteorological degrees (the direction the wind blows FROM), like wind.ts and
// like nmea.ts after it converts. Knots and the pilot's keyboard belong at the edge, in units.ts: a
// core module that guesses its own units is how a 20-kt wind gets flown as 20 m/s.

export type WindSource = 'manual' | 'instrument' | 'estimate';

export interface WindVector {
  /** m/s. */
  speedMs: number;
  /** Meteorological degrees: where the wind blows FROM. */
  directionDeg: number;
}

/** A wind, and WHEN it was true. `at` is seconds-of-day, on the same clock as the fixes — the flight
 *  clock, never the wall clock, so that a replay arbitrates exactly as the flight did. */
export interface WindClaim extends WindVector {
  at: number;
}

export interface WindSources {
  /** What the pilot typed. Build it with `manualWind` — that is where nonsense is refused. */
  manual: WindClaim | null;
  /** What the instrument last reported, stamped with the fix at which it arrived. */
  instrument: WindClaim | null;
  /** Ours, from circle drift (wind.ts). */
  estimate: WindClaim | null;
}

/** The one wind the whole computer must use — the reach polygon, the alternates, the final glide and
 *  the terrain alarm, all priced against the same air, because a panel priced against one wind beside
 *  a polygon priced against another is two computers arguing on one screen. */
export interface WindInUse extends WindVector {
  source: WindSource;
  /** Seconds since it was true. The display's staleness clock, not ours to hide. */
  ageS: number;
  /** Past its freshness: it is being shown for want of anything better. The screen must SAY so —
   *  greyed, or with its age — and, when it is the pilot's own, invite him to type a new one. */
  stale: boolean;
}

/** The pilot's wind outranks the machines for half an hour.
 *
 *  Half an hour because that is roughly how long a soaring day's wind stays the wind he was told
 *  about: the boundary layer deepens, the gradient veers and strengthens through the afternoon, a
 *  sea breeze arrives over tens of minutes. Shorter, and we would be nagging him to retype a wind
 *  that has not changed, which teaches him to ignore the nag. Longer, and this morning's briefing is
 *  still steering his evening final glide. */
export const MANUAL_FRESH_S = 30 * 60;

/** …and it is DISCARDED after ninety minutes. Between thirty and ninety it is demoted, not deleted:
 *  a wind the pilot gave us an hour ago is still a human claim about this day, and it beats handing
 *  the glide computer a null that it will silently fly as still air. Past ninety minutes it is
 *  archaeology, and archaeology has no place in an arrival height. */
export const MANUAL_MAX_S = 90 * 60;

/** The estimator only remembers WINDOW_S = 1200 s of track (wind.ts), so an estimate older than that
 *  cannot be refreshed by anything it still holds — it is the wind of the last thermal, and after
 *  twenty minutes of glide that thermal is fifty kilometres behind us. */
export const ESTIMATE_FRESH_S = 1200;

/** Kept as a last resort for an hour. On a blue day between two long glides, an hour-old circle drift
 *  is thin evidence — but it is evidence, and it beats an invented calm. */
export const ESTIMATE_MAX_S = 60 * 60;

/** The instrument talks at about 1 Hz. Two minutes of silence is not a steady wind, it is a dropped
 *  Bluetooth link — and the last frame of a dead link is not a measurement. */
export const INSTRUMENT_FRESH_S = 120;

/** Ten minutes, and then the box is simply not there. Nothing renews it: unlike the pilot, it cannot
 *  be asked. */
export const INSTRUMENT_MAX_S = 10 * 60;

/** A wind faster than this is a typo, not a wind. 50 m/s is 97 kt: nobody soars in it, and the way
 *  this number actually arrives is a direction typed into the speed box (270 → "270 kt of wind"), or
 *  a km/h figure that never got converted. Refuse it; do not clamp it. A clamped 50 m/s would be a
 *  confident, plausible, catastrophically wrong headwind, and clamping is how a fat finger becomes a
 *  final glide. */
export const MAX_SPEED_MS = 50;

/** Sanity, applied to EVERY source and not only the keyboard. `nmea.ts` can hand us a NaN out of a
 *  truncated sentence, and one NaN in the wind is a NaN in the arrival height, the reach polygon and
 *  the terrain alarm — three instruments blank at once, for a comma. */
const sane = (w: WindClaim | null): WindClaim | null => {
  if (!w) return null;
  if (!Number.isFinite(w.speedMs) || !Number.isFinite(w.directionDeg) || !Number.isFinite(w.at)) return null;
  if (w.speedMs < 0 || w.speedMs > MAX_SPEED_MS) return null;
  return w;
};

/** Age, never negative.
 *
 *  A negative age means the CLOCK is wrong, not that the wind is from the future: seconds-of-day
 *  wraps at midnight, and a replay can be scrubbed backwards under a wind the pilot typed. Either
 *  would make a fresh value look 24 hours old and vanish from the screen mid-glide. Treat it as
 *  fresh — a clock problem must not silently delete the wind. */
const ageOf = (w: WindClaim, nowS: number): number => Math.max(0, nowS - w.at);

const LIMITS: Readonly<Record<WindSource, { fresh: number; max: number }>> = {
  manual: { fresh: MANUAL_FRESH_S, max: MANUAL_MAX_S },
  estimate: { fresh: ESTIMATE_FRESH_S, max: ESTIMATE_MAX_S },
  instrument: { fresh: INSTRUMENT_FRESH_S, max: INSTRUMENT_MAX_S },
};

/** THE PRECEDENCE. One order, and it does not reshuffle when things go stale — a screen whose wind
 *  source changes rank as well as value is a screen no pilot can predict.
 *
 *   1. MANUAL, because the pilot has information no algorithm in this box will ever have (the MET
 *      briefing, the sock, the radio) — and because a value he typed that the app then overrules in
 *      silence teaches him the instrument is broken. If we are not going to use it, we must not ask
 *      for it.
 *   2. ESTIMATE over INSTRUMENT, which is the precedence this repo has always flown (`estimate() ??
 *      reportedWind` in the reach march, the alternates, the terrain alarm) and this module inherits
 *      it rather than reversing it behind everyone's back. The reason it was chosen: the vario's
 *      "measured" wind is another estimator, run on data we cannot see, under a direction convention
 *      that nmea.ts documents as an outright trap (Condor 3 reversed Condor 2's, and the arrow points
 *      backwards while looking entirely reasonable). Our drift comes from circles we flew, in this
 *      air, in a convention we own. A claim we can check beats a claim we cannot.
 *   3. INSTRUMENT last — but not never: on a blue glide with no circle behind us, it is all there is.
 */
const RANK: readonly WindSource[] = ['manual', 'estimate', 'instrument'];

/** The wind in use, or null.
 *
 *  Pure: `nowS` is an argument. An expiry you cannot wind the clock forward over is an expiry nobody
 *  tests, and this whole file is expiry. */
export function windInUse(s: WindSources, nowS: number): WindInUse | null {
  if (!Number.isFinite(nowS)) return null;

  const claims: Partial<Record<WindSource, { w: WindClaim; ageS: number }>> = {};
  for (const src of RANK) {
    const w = sane(s[src]);
    if (!w) continue;
    const ageS = ageOf(w, nowS);
    if (ageS > LIMITS[src].max) continue;   // past the hard limit it does not vote at all
    claims[src] = { w, ageS };
  }

  // Two passes, same order. Every FRESH source beats every stale one — a live instrument beats the
  // wind the pilot typed an hour ago — and only then does rank decide. Within a pass, rank decides.
  for (const stale of [false, true])
    for (const src of RANK) {
      const c = claims[src];
      if (!c) continue;
      if ((c.ageS > LIMITS[src].fresh) !== stale) continue;
      return {
        speedMs: c.w.speedMs,
        directionDeg: c.w.directionDeg,
        source: src,
        ageS: c.ageS,
        stale,
      };
    }

  // Nothing fresh, nothing stale, nothing at all. NOT a calm. The shell shows an empty box, and the
  // pilot knows what he does not know.
  return null;
}

/** What the screen should say about the pilot's own entry — so it can ask him for a new one BEFORE
 *  the old one is silently overruled, rather than after. */
export type ManualStatus = 'none' | 'fresh' | 'stale' | 'expired';

export function manualStatus(manual: WindClaim | null, nowS: number): ManualStatus {
  const w = sane(manual);
  if (!w || !Number.isFinite(nowS)) return 'none';
  const age = ageOf(w, nowS);
  if (age <= MANUAL_FRESH_S) return 'fresh';
  if (age <= MANUAL_MAX_S) return 'stale';
  return 'expired';
}

/** Everything the keyboard hands us, before it is a wind.
 *
 *  `Number('')` is 0, and `Number('  ')` is 0. That single line of JavaScript is how an empty box
 *  becomes a confident dead calm in a glide computer, and it is why parsing lives HERE and not in the
 *  shell's input handler: an empty field is an unknown wind, and an unknown wind is null. */
const num = (v: string | number): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (s === '') return null;
  // A French keyboard types "4,5". Number() calls that NaN and we would refuse a perfectly good wind.
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** The pilot's entry, refused rather than repaired.
 *
 *  Returns null on anything that is not a wind — blank, letters, a negative speed, a hurricane. The
 *  caller shows the field as rejected and the PREVIOUS wind stands; it never quietly substitutes
 *  something plausible, because a plausible substitute is precisely the number nobody re-reads.
 *
 *  The direction is the one thing we do normalise: 370° is 10° and −10° is 350°, on any compass ever
 *  made, and refusing that would be pedantry rather than safety. */
export function manualWind(
  speedMs: string | number,
  directionDeg: string | number,
  atS: number,
): WindClaim | null {
  const spd = num(speedMs);
  const dir = num(directionDeg);
  if (spd === null || dir === null || !Number.isFinite(atS)) return null;
  if (spd < 0 || spd > MAX_SPEED_MS) return null;
  return {
    speedMs: spd,
    directionDeg: ((dir % 360) + 360) % 360,
    at: atS,
  };
}
