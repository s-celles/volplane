// ============ CFG-008: the water and the flies ============
//
// The polar the pilot took off with is not the polar he is flying an hour later, and the two things
// that change it are the two things this file is about.
//
//   WATER. He filled 120 litres on the ground because the day looked strong. Over the ridge the day
//   dies, he pulls the dump valve, and 120 kg leave the aircraft. Nothing about the wing has changed
//   — but every speed on his polar has just dropped by √(m/m₀), and a flight computer still telling
//   him to fly 140 km/h is telling him to spend the height he no longer has. The reverse is worse:
//   he keeps the water, the computer never knew about it, and the speed-to-fly it hands him is the
//   EMPTY glider's — too slow, and the final glide it promises is short.
//
//   FLIES. A wing that has flown a summer afternoon low over a plain is not the wing that was
//   measured in the factory. The insects sit on the leading edge, the boundary layer trips early,
//   and the drag goes up. This does NOT scale the polar: it degrades it. The glider sinks faster at
//   every single speed, and the glide ratio the pilot is counting on for the last 40 km is not the
//   one printed in the manual.
//
// Today the mass is frozen at the instant the pilot picks his glider on the ground (CFG-002's mass
// box). CFG-008 says: TANT QUE le vol est en cours — while the flight is running — he must be able
// to adjust both, and the effect must reach the polar, the speed to fly and the final glide at once.
//
// ---- what this file does NOT do ----
//
// It does not re-derive the mass scaling. soaring-core's `atMass()` already owns that algebra
// (CFG-002 / C4bis), it is the same algebra as `sinkAt()`, and a second copy of it here would be the
// vario-tone incident all over again: two implementations, and on the day they disagree about the
// LS 4 both are worthless, because nothing tells the pilot which one his final glide came from.
// This file composes: water → a MASS, and `atMass` does the rest.
//
// It also does not model the DUMP as it happens. Water leaves through a valve at a rate nobody has
// written down for these gliders, and a drain we invented would be a number the pilot cannot check
// and would not think to doubt. `drained()` therefore takes the flow rate as an argument and returns
// the litres UNTOUCHED when it is null: if we do not know how fast the tanks empty, the litres the
// pilot says are aboard are the litres aboard.

import { atMass, type Polar } from 'soaring-core/polar';

/** Water: one litre, one kilogram. (0.998 kg/L at 20 °C — one part in five hundred, an order of
 *  magnitude below the error in the three points the polar itself was fitted from.) */
export const WATER_KG_PER_L = 1;

/** The most a wing can be degraded and still be described as "dirty".
 *
 *  Measured bug degradation on a glass wing runs a few percent on a clean morning to some 15–20 % of
 *  the glide after a long low afternoon; rain adds more. Fifty is far beyond any of that, and it is
 *  the bound rather than the expectation: past half your glide ratio the aircraft is not a soaring
 *  glider having a bad day, and a pilot who has typed that number has mis-typed it. Refusing it is
 *  the point — see `acceptBugsPct`. */
export const MAX_BUGS_PCT = 50;

/** What the pilot has changed since the polar was published: water aboard, and a dirty wing.
 *
 *  Both are set by hand and both are honest about it. Neither is measured, and neither is guessed:
 *  a computer that inferred bugs from a drifting glide ratio would be telling the pilot his wing is
 *  dirty on the day he flies into sink. */
export interface BallastState {
  /** Litres of water ABOARD RIGHT NOW — not what was loaded on the ground. */
  ballastL: number;
  /** How much worse the sink rate is than the published polar, in percent. 0 = the clean wing. */
  bugsPct: number;
}

/** The glider as the book describes it: dry, and just out of the hangar. This is the state a flight
 *  starts in only because it is the state we can DEFEND — we do not know what the pilot loaded, and
 *  guessing that he took half tanks would put water in an aircraft that has none (POT-007). */
export const CLEAN_AND_DRY: BallastState = { ballastL: 0, bugsPct: 0 };

/** The two masses a `.plr` carries and a `Polar` does not: the mass its three points were measured
 *  at, and the size of the tanks. */
export interface PlrMasses {
  /** MassDryGross — the all-up mass, without water, the curve belongs to. */
  refMassKg: number;
  /** MaxWaterBallast, litres. Null when the file does not give a usable one; 0 for a glider with no
   *  tanks — and in both cases the ballast control has nothing to offer and should not be shown.
   *  We never fill in a plausible tank size: a capacity we invented is a capacity the pilot would
   *  be allowed to pour water into, and the polar would then be scaled by water that is not there. */
  maxBallastL: number | null;
}

/** Read the two masses off a `.plr`, or null if it has no usable polar line.
 *
 *  The line is accepted on EXACTLY the terms soaring-core's `parsePlr` accepts it — same comment
 *  markers, same eight-field minimum, same finiteness check on the six curve fields — and that is
 *  deliberate, not defensive symmetry: the masses must come off the SAME line the curve was fitted
 *  from. Read them off a different line of the same file and you would be scaling one glider's
 *  polar by another glider's tank.
 *
 *  This is a reader, not a second parser: it does not fit anything, and the curve still comes from
 *  soaring-core (C4bis). */
export function plrMasses(text: string): PlrMasses | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('*') || line.startsWith('#') || line.startsWith(';')) continue;
    const n = line.split(',').map(s => parseFloat(s.trim()));
    if (n.length < 8 || n.slice(2, 8).some(x => !Number.isFinite(x))) continue;

    const mass = n[0];
    if (!Number.isFinite(mass) || mass <= 0) return null;   // no reference mass, nothing to scale from
    const water = n[1];
    return {
      refMassKg: mass,
      maxBallastL: Number.isFinite(water) && water >= 0 ? water : null,
    };
  }
  return null;
}

/** The litres the pilot may be held to, or null if what he typed is not a quantity of water.
 *
 *  REFUSED, not clamped, and this is the same argument CFG-002's mass box already settled: a pilot
 *  who types 1600 into a 160-litre glider has slipped a digit, and clamping it to 160 hands him back
 *  a number that LOOKS like the one he meant. He would fly the rest of the day never knowing the box
 *  disagreed with him. An empty box he can see is worth more than a confident one nobody re-reads.
 *
 *  A glider whose capacity we do not know (`maxBallastL` null) can be given no water at all: without
 *  a bound there is nothing to refuse, and a polar scaled by an unbounded typo is the failure this
 *  whole function exists to prevent. */
export function acceptBallastL(raw: number, maxBallastL: number | null): number | null {
  if (maxBallastL === null || !Number.isFinite(maxBallastL) || maxBallastL <= 0) return null;
  if (!Number.isFinite(raw) || raw < 0 || raw > maxBallastL) return null;
  return raw;
}

/** The bug degradation the pilot may be held to, or null.
 *
 *  Negative is refused and not silently taken as zero: bugs make a wing worse, never better, and a
 *  pilot asking for −10 % has asked for a glider that out-performs its own factory polar. Whatever
 *  he meant, we do not know it — and a final glide computed on a wing better than the real one is
 *  the one error in this file that lands short. */
export function acceptBugsPct(raw: number): number | null {
  if (!Number.isFinite(raw) || raw < 0 || raw > MAX_BUGS_PCT) return null;
  return raw;
}

/** The litres left after `dtS` seconds with the dump valve open.
 *
 *  Time is an ARGUMENT. A drain that read the clock would be a drain nobody could test, and the
 *  interesting cases here are all about what the state was at a given instant.
 *
 *  `rateLps` is null for every glider we ship, because soaring-data does not record dump rates and
 *  we are not going to invent one: a tank that drains at a rate we made up would show the pilot a
 *  dry polar while he still carries 80 kg — telling him he climbs better than he does, in exactly
 *  the minutes he pulled the valve because he was not climbing. With no rate, the litres stand where
 *  the pilot put them, and it is his hand on the slider that says the tanks are empty. */
export function drained(ballastL: number, dtS: number, rateLps: number | null): number {
  if (!Number.isFinite(ballastL) || ballastL <= 0) return 0;
  if (rateLps === null || !Number.isFinite(rateLps) || rateLps <= 0) return ballastL;
  if (!Number.isFinite(dtS) || dtS <= 0) return ballastL;
  return Math.max(0, ballastL - rateLps * dtS);
}

/** The glider as it is flying now, from the glider as it was published. */
export interface Effective {
  /** The polar to compute EVERYTHING from — speed to fly, best glide, the reach polygon, the final
   *  glide. There is no second polar anywhere: if the shell keeps the dry one for the speed-to-fly
   *  ring and the wet one for the glide, the pilot has two instruments disagreeing about his day. */
  polar: Polar;
  /** All-up mass, kg: dry plus the water aboard. */
  massKg: number;
  /** kg/m² — null when the wing area is unknown, which it is for twelve of the 155 library wings.
   *  A wing loading over an area of 0 m² is an infinity shown to a pilot (POT-007); a dash is the
   *  true answer. */
  wingLoadingKgM2: number | null;
}

export interface BallastInput {
  /** The glider's published (or imported) polar — dry, at `refMassKg`. */
  polar: Polar;
  /** The mass THAT polar's three points were measured at: `.plr` MassDryGross, via `plrMasses`. */
  refMassKg: number;
  /** Today's all-up mass WITHOUT water — the pilot heavier than the book's, the second seat empty.
   *  Null means "as published": we fly the reference mass rather than invent his. */
  dryMassKg: number | null;
  /** Wing area, for the loading. Null for the wings soaring-data has no area for. */
  wingAreaM2: number | null;
  state: BallastState;
}

/** The effective polar: the published curve, moved to the mass now aboard and degraded by the flies.
 *
 *  Null when we would have to make something up to answer — a reference mass that is not a mass, a
 *  dry mass that is not one, litres that are not litres, a bug figure outside the band. Those states
 *  cannot be reached through `acceptBallastL`/`acceptBugsPct`, which is the point of them; if one is
 *  reached anyway (a settings file edited by hand, a raced write), the honest answer is that we do
 *  not have an effective polar, not a polar computed from a number we chose on the pilot's behalf.
 *
 *  ---- the two effects are NOT the same effect, and this is the whole physics of CFG-008 ----
 *
 *  WATER scales. Every point (V, w) moves to (kV, kw) with k = √(m/m₀), so the GLIDE RATIO at each
 *  corresponding point is unchanged: ballast buys speed, not performance. A pilot who is shown a
 *  better L/D after taking water has been told something false. `atMass` owns this.
 *
 *  BUGS degrade. The sink rate goes up by a percentage at every speed, so A and B both take the same
 *  factor. The glide ratio falls by exactly that factor — and, because A and B move together, the
 *  best-glide and min-sink SPEEDS do not move at all. That is worth knowing at the stick: a dirty
 *  wing does not change where you fly, only how far you get.
 *
 *  The two commute (each is a multiplication on A and on B), so the order below carries no meaning
 *  and no bug is hiding in it. */
export function effectivePolar(i: BallastInput): Effective | null {
  const { polar, refMassKg, dryMassKg, wingAreaM2, state } = i;
  if (!Number.isFinite(refMassKg) || refMassKg <= 0) return null;
  if (dryMassKg !== null && (!Number.isFinite(dryMassKg) || dryMassKg <= 0)) return null;
  if (!Number.isFinite(state.ballastL) || state.ballastL < 0) return null;
  if (!Number.isFinite(state.bugsPct) || state.bugsPct < 0 || state.bugsPct > MAX_BUGS_PCT) return null;

  const dry = dryMassKg ?? refMassKg;
  const massKg = dry + state.ballastL * WATER_KG_PER_L;

  const scaled = atMass(polar, refMassKg, massKg);

  // The sink rate, worse by bugsPct at every speed: w' = (1 + b)·w, and w = A·V³ + B/V, so both
  // coefficients take the factor. Sink is negative, so a factor > 1 sinks the glider harder — which
  // is what a dirty leading edge does.
  const dirt = 1 + state.bugsPct / 100;
  const polarNow: Polar = {
    name: scaled.name,
    A: scaled.A * dirt,
    B: scaled.B * dirt,
    // Bugs are drag, not lift: the speed band is the one the WATER set, and dirt does not move it.
    vMin: scaled.vMin,
    vMax: scaled.vMax,
  };

  return {
    polar: polarNow,
    massKg,
    wingLoadingKgM2: wingAreaM2 !== null && Number.isFinite(wingAreaM2) && wingAreaM2 > 0
      ? massKg / wingAreaM2
      : null,
  };
}
