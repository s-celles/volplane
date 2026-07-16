// ============ the battery warning (SYS-003) ============
//
// The pilot's question is not "how full is it?" — the number is on the screen already. It is
// "WILL THIS THING STILL BE ALIVE WHEN I NEED IT?", and he needs it at the end: the final glide,
// the diversion, the airspace under the arrival. A flight computer that dies at hour four dies in
// the hour it mattered.
//
// So this file answers with TIME, not with a percentage — not by predicting minutes remaining
// (we have no honest drain model, and an invented "1 h 20 left" is exactly the confident empty
// box this project refuses), but by putting the thresholds where a soaring pilot still has room
// to ACT. See LOW_FRAC.
//
// ---- WHY THE HYSTERESIS IS THE POINT OF THE FILE ----
//
// A battery reading does not fall smoothly. It sags under a GPS fix and the screen at full
// brightness, it recovers when the radio stops transmitting, it steps backwards when the driver
// recalibrates. An alert wired straight to `charge <= 0.30` therefore fires, clears, and fires
// again, several times per minute, for as long as the flight lasts. That is not a warning; that
// is training. The pilot learns, correctly, that this banner means nothing, and he goes on
// ignoring it at 8 % — which is the one moment it was ever for.
//
// The gap between the raise threshold and the clear threshold is deliberately enormous (ten
// points of charge, most of an hour of flying): only a genuine recharge clears this alert, never
// a wobble in the reading.
//
// ---- AND WHY "CHARGING" DOES NOT SILENCE ANYTHING ----
//
// The obvious rule — plugged in, so shut up — is wrong, and it is wrong in the cockpit
// specifically. A tablet drawing a GPS fix at 1 Hz with the screen legible in sunlight can draw
// MORE than a weak USB socket delivers: it charges and still goes down. And the commonest
// electrical failure in a glider is not a flat battery, it is a plug shaken loose by turbulence.
// `charging` is a fact about this instant, never a promise about the next hour.
//
// So charging silences nothing. It is carried through to the verdict for one reason: an alert
// that fires while `charging === true` is telling the pilot something sharper than "you are low"
// — it is telling him THE CHARGER IS NOT KEEPING UP, and that the cable he thinks is saving him
// is not.
//
// Pure, and the previous state is an argument (phase.ts's rule): a hysteresis whose state you
// cannot see is a hysteresis you cannot test.

/** 'ok' is not an alert; it is the absence of one. Ranked, because the ack below turns on it. */
export type BatteryLevel = 'ok' | 'low' | 'critical';

const RANK: Readonly<Record<BatteryLevel, number>> = { ok: 0, low: 1, critical: 2 };

/** What the shell managed to read. Both fields are honestly nullable: a device with no battery
 *  sensor, a permission the browser refused, a driver that has not answered yet. */
export interface BatteryReading {
  /** State of charge, 0…1. `null` = WE DO NOT KNOW. Never 0 for "no reading" — a flat battery
   *  and an unreadable one are opposite facts and only one of them is an emergency. */
  chargeFrac: number | null;
  /** `null` = we could not tell. Never guessed as `false`. */
  charging: boolean | null;
}

/** RAISE 'low' at 30 %.
 *
 *  A cross-country day is four to six hours. A tablet running a moving map, a 1 Hz GPS and a
 *  screen bright enough to read in the sun spends roughly 15 % of its charge per hour, so 30 % is
 *  about two hours: still time to do every cheap thing that saves the flight — dim the screen,
 *  find the cable, put the phone on the panel instead of in the sun — and still time for those
 *  things to work. Warned at 15 % he has an hour, and the only remedies left cost him the task.
 *
 *  This is the threshold's whole justification: it is not a round number, it is the last moment a
 *  CHEAP action still helps. */
export const LOW_FRAC = 0.30;

/** RAISE 'critical' at 15 % — about an hour, at which point the honest advice changes completely.
 *  Not "save the battery" any more, but "assume you will lose the screen": look at the map now,
 *  fix the airfield and the airspace in your head, and stop planning a flight that depends on an
 *  instrument that may not be there. */
export const CRITICAL_FRAC = 0.15;

/** CLEAR 'low' only above 40 %, and 'critical' only above 25 %.
 *
 *  Ten points of charge, deliberately: at the drain above that is the better part of an hour of
 *  flight. A reading sagging under a transmit burst, or a driver stepping its estimate around,
 *  cannot walk back across a gap that wide — only a charger can. An alert that can be cleared by
 *  noise is an alert that will be RAISED by noise, and one raised by noise is one the pilot has
 *  already stopped reading. */
export const LOW_CLEAR_FRAC = 0.40;
export const CRITICAL_CLEAR_FRAC = 0.25;

export interface BatteryState {
  /** The level being held, hysteresis included. */
  level: BatteryLevel;
  /** The level the pilot has SILENCED, or null. Never 'ok' — you cannot acknowledge good news. */
  acked: Exclude<BatteryLevel, 'ok'> | null;
}

export const INITIAL_BATTERY: BatteryState = { level: 'ok', acked: null };

export interface BatteryAlert {
  level: 'low' | 'critical';
  /** null when the sensor has since gone quiet on an alert we already measured — the alert
   *  survives (see nextBattery), the NUMBER does not get invented to keep it company. */
  percent: number | null;
  /** true = plugged in and still going down: the charger is not keeping up, and that is a
   *  different sentence for the pilot than "you are low". null = we could not tell. */
  charging: boolean | null;
}

export interface BatteryVerdict {
  /** Feed this back in on the next reading. */
  state: BatteryState;
  /** What to DISPLAY. `null` = unknown, and it stays an empty box: a battery we cannot read is
   *  not a flat one, and it is not a full one either (the null discipline, SYS-003's corner of
   *  it). Never 0 to mean "no idea". */
  percent: number | null;
  charging: boolean | null;
  /** What to SHOUT — null when there is nothing NEW to say: the battery is fine, or unreadable,
   *  or the pilot has already acknowledged this exact situation. The level in `state` still says
   *  what is true; `alert` only says whether it deserves the pilot's eyes again. Same separation
   *  as airspace's incursions vs activeIncursions: silencing is a view, never a change to the
   *  verdict. */
  alert: BatteryAlert | null;
}

/** A charge we are willing to believe. A NaN from a flaky driver, a negative, a 1.5: none of
 *  these are measurements, and none of them may be coerced into one. Clamping a NaN to 0 would
 *  fire the critical alert on a driver bug — the loudest possible way to be wrong. */
function believable(f: number | null): f is number {
  return f !== null && Number.isFinite(f) && f >= 0 && f <= 1;
}

/** The level, from the previous level and the charge. Rising thresholds sit far above falling
 *  ones (LOW_CLEAR_FRAC, CRITICAL_CLEAR_FRAC) so the alert cannot dither. */
function nextLevel(prev: BatteryLevel, f: number): BatteryLevel {
  if (f <= CRITICAL_FRAC) return 'critical';
  // Already critical: it takes a real recharge to be merely 'low' again, not a wobble.
  if (prev === 'critical' && f <= CRITICAL_CLEAR_FRAC) return 'critical';
  if (f <= LOW_FRAC) return 'low';
  if (prev !== 'ok' && f <= LOW_CLEAR_FRAC) return 'low';
  return 'ok';
}

/** One reading in, one verdict out.
 *
 *  An UNREADABLE reading does not clear an alert we already earned. Losing the sensor is not a
 *  recharge; a battery that was critical a second ago is still critical, and terrainalarm's rule
 *  applies here word for word — an absence of measurement is not good news, and must never be
 *  read as any. The level is HELD and the percentage goes to null: the alert keeps standing, and
 *  it stops claiming a number it no longer has.
 *
 *  It cannot, however, RAISE anything: an alert invented out of an absence is the alert the pilot
 *  learns to silence, and once silenced it is silenced over the real one too. */
export function nextBattery(prev: BatteryState, r: BatteryReading): BatteryVerdict {
  const charging = r.charging;

  if (!believable(r.chargeFrac)) {
    const state: BatteryState = { level: prev.level, acked: prev.acked };
    return {
      state,
      percent: null,
      charging,
      alert: shout(state, null, charging),
    };
  }

  const f = r.chargeFrac;
  const level = nextLevel(prev.level, f);

  // THE RE-ARM. The acknowledgement dies the moment the battery genuinely recovers — and only
  // then. "I know" is an answer to a SITUATION, and when the situation is gone so is the answer:
  // a pilot who silenced a low battery at 09:40, plugged in, climbed back to 60 % and drained it
  // again by 15:00 has a NEW low battery, and telling him about it is the entire job. Anything
  // else mutes the warning for the rest of the day on one tap, which is the failure this whole
  // file exists to avoid.
  const acked = level === 'ok' ? null : prev.acked;

  const state: BatteryState = { level, acked };
  return {
    state,
    // Rounded for the eye only. Every threshold above is compared on the fraction: a display that
    // rounds 0.304 to "30 %" must not be what decides whether the alert exists.
    percent: Math.round(f * 100),
    charging,
    alert: shout(state, Math.round(f * 100), charging),
  };
}

/** Does this state deserve the pilot's eyes? Only if it is an alert at all, and only if it is
 *  WORSE than what he already told us he had understood. */
function shout(s: BatteryState, percent: number | null, charging: boolean | null): BatteryAlert | null {
  if (s.level === 'ok') return null;
  if (s.acked !== null && RANK[s.level] <= RANK[s.acked]) return null;
  return { level: s.level, percent, charging };
}

/** The pilot says "I know". Pure, airspace's `acknowledge` in shape: a new state, never a mutation.
 *
 *  Two things it deliberately does NOT do:
 *
 *   · It does not expire. Airspace acks time out after five minutes because a glider FLIES OUT of
 *     an airspace — the fact goes stale on its own. A battery does the opposite: it only ever gets
 *     worse, so re-shouting the same 28 % every five minutes tells the pilot nothing he has not
 *     already been told and dealt with, and teaches him to swat the banner without reading it.
 *     What brings it back is AGGRAVATION (low → critical), which `shout` above lets through, or a
 *     recharge followed by a new decline (the re-arm in nextBattery).
 *
 *   · It does not silence a battery that is fine. There is nothing to acknowledge, and a pre-emptive
 *     mute — tapped on the grid, out of habit, before the flight even starts — would take the whole
 *     day's warnings with it. You may only acknowledge what you have actually been shown. */
export function acknowledgeBattery(prev: BatteryState): BatteryState {
  if (prev.level === 'ok') return prev;
  return { level: prev.level, acked: prev.level };
}
