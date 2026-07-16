import { test, expect } from 'bun:test';
import {
  nextBattery, acknowledgeBattery, INITIAL_BATTERY,
  LOW_FRAC, CRITICAL_FRAC, LOW_CLEAR_FRAC, CRITICAL_CLEAR_FRAC,
  type BatteryState,
} from './battery';

/** Run a whole flight's worth of readings through, returning the last verdict. Discharging. */
const drain = (from: BatteryState, ...fracs: number[]) => {
  let s = from;
  let v = nextBattery(s, { chargeFrac: fracs[0], charging: false });
  for (const f of fracs) {
    v = nextBattery(s, { chargeFrac: f, charging: false });
    s = v.state;
  }
  return v;
};

// ---- the null discipline: what the module REFUSES to claim ----

test('a battery we cannot read is not a flat battery — and it is not a full one either', () => {
  // The tablet has no sensor, or the browser refused the permission. The one answer that must
  // never come out of here is a number. A confident "0 %" fires the siren on a missing driver;
  // a confident "100 %" is worse. The box stays empty and the pilot can SEE that it is empty.
  const v = nextBattery(INITIAL_BATTERY, { chargeFrac: null, charging: null });
  expect(v.percent).toBeNull();
  expect(v.alert).toBeNull();
  expect(v.state.level).toBe('ok');
});

test('a MEASURED zero is a measurement — it is the one thing null must not be confused with', () => {
  // The mirror of the test above, and the reason it matters: 0.0 from a working sensor is a real,
  // terrifying fact and it must scream. If "unknown" were also 0, this alert could not tell the
  // difference between a dead battery and a dead driver.
  const v = nextBattery(INITIAL_BATTERY, { chargeFrac: 0, charging: false });
  expect(v.percent).toBe(0);
  expect(v.alert?.level).toBe('critical');
});

test('a NaN from a flaky driver does not fire the critical alarm', () => {
  // Clamping garbage into range is how a driver bug becomes a cockpit emergency. NaN, -0.2 and
  // 1.5 are not low batteries; they are not batteries at all.
  for (const bad of [NaN, -0.2, 1.5, Infinity]) {
    const v = nextBattery(INITIAL_BATTERY, { chargeFrac: bad, charging: false });
    expect(v.alert).toBeNull();
    expect(v.percent).toBeNull();
  }
});

// ---- the hysteresis: the reason this file exists ----

test('A CHARGE DITHERING ACROSS THE THRESHOLD DOES NOT FLASH THE ALERT ON AND OFF', () => {
  // The failure this module was written to prevent. A reading sags under a GPS fix and a bright
  // screen and steps back when the load drops; wired straight to `charge <= 0.30` the banner
  // appears and vanishes several times a minute for hours. The pilot learns — correctly — that it
  // means nothing, and goes on ignoring it at 8 %.
  let s = INITIAL_BATTERY;
  const seen: (string | null)[] = [];
  for (const f of [0.31, 0.30, 0.32, 0.29, 0.31, 0.30, 0.33, 0.28]) {
    const v = nextBattery(s, { chargeFrac: f, charging: false });
    s = v.state;
    seen.push(v.state.level);
  }
  // It raises ONCE, at the first crossing, and never lets go on a wobble.
  expect(seen).toEqual(['ok', 'low', 'low', 'low', 'low', 'low', 'low', 'low']);
});

test('clearing the alert takes a real recharge, not a wobble', () => {
  // 31…39 % is the reading coming back after a transmit burst, not a pilot who found his cable.
  const low = drain(INITIAL_BATTERY, 0.28);
  expect(low.state.level).toBe('low');
  expect(drain(low.state, 0.35).state.level).toBe('low');
  expect(drain(low.state, 0.39).state.level).toBe('low');
  expect(drain(low.state, 0.45).state.level).toBe('ok');    // genuinely charged: gone
});

test('critical does not de-escalate to low on a wobble either', () => {
  const crit = drain(INITIAL_BATTERY, 0.12);
  expect(crit.state.level).toBe('critical');
  expect(drain(crit.state, 0.18).state.level).toBe('critical');   // still under CRITICAL_CLEAR
  expect(drain(crit.state, 0.28).state.level).toBe('low');        // really climbing again
});

// ---- losing the sensor mid-flight ----

test('losing the sensor does NOT clear an alert we already measured', () => {
  // An absence of measurement is not good news. A battery that was critical one second ago is
  // still critical, and a driver that stopped answering has told us nothing to the contrary. The
  // alert stands — and stops claiming a percentage it no longer has.
  const crit = drain(INITIAL_BATTERY, 0.08);
  const blind = nextBattery(crit.state, { chargeFrac: null, charging: null });
  expect(blind.state.level).toBe('critical');
  expect(blind.alert?.level).toBe('critical');
  expect(blind.alert?.percent).toBeNull();     // no invented number to keep the alert company
  expect(blind.percent).toBeNull();
});

test('but a sensor that never answered cannot RAISE anything', () => {
  // The other half of the same rule. An alarm invented out of an absence is the alarm the pilot
  // learns to silence — and once silenced, it is silenced over the real one too.
  let s = INITIAL_BATTERY;
  for (let i = 0; i < 20; i++) s = nextBattery(s, { chargeFrac: null, charging: null }).state;
  expect(s.level).toBe('ok');
});

// ---- the acknowledgement ----

test('an acknowledged low battery does not come back every minute for the rest of the day', () => {
  // The whole point of the ack. Unlike an airspace — which the glider flies OUT of, so the ack is
  // allowed to expire — a battery only gets worse. Re-shouting 28 % every five minutes tells the
  // pilot nothing he has not already dealt with, and teaches him to swat the banner unread.
  const v = drain(INITIAL_BATTERY, 0.29);
  expect(v.alert?.level).toBe('low');
  const acked = acknowledgeBattery(v.state);
  expect(drain(acked, 0.27).alert).toBeNull();
  expect(drain(acked, 0.22).alert).toBeNull();
  expect(drain(acked, 0.16).alert).toBeNull();   // still merely 'low': nothing new has happened
});

test('BUT IT COMES BACK THE MOMENT THE SITUATION IS WORSE THAN WHAT HE ACKNOWLEDGED', () => {
  // He said "I know" to 29 %. He did not say "I know" to 12 %, and 12 % means something entirely
  // different: stop saving the battery, start assuming you will lose the screen.
  const acked = acknowledgeBattery(drain(INITIAL_BATTERY, 0.29).state);
  const v = drain(acked, 0.12);
  expect(v.alert?.level).toBe('critical');
});

test('and acknowledging THAT silences it, however much further it falls', () => {
  // Nothing worse than 'critical' exists to escalate to, and a critical alert that re-fires on
  // every lost per-cent is the alert he mutes at the device level.
  const s = acknowledgeBattery(drain(INITIAL_BATTERY, 0.10).state);
  expect(drain(s, 0.06).alert).toBeNull();
  expect(drain(s, 0.01).alert).toBeNull();
});

test('a recharge RE-ARMS the warning: a second decline is a second warning', () => {
  // Silenced at 09:40, plugged in over lunch, back to 60 %, drained again by 15:00. That is a NEW
  // low battery on the leg that matters, and an ack that survived it would have muted the day.
  const acked = acknowledgeBattery(drain(INITIAL_BATTERY, 0.28).state);
  const full = drain(acked, 0.45, 0.60);
  expect(full.state.acked).toBeNull();                 // the situation is gone; so is "I know"
  expect(drain(full.state, 0.29).alert?.level).toBe('low');
});

test('you cannot pre-emptively mute a battery that is fine', () => {
  // Tapped on the grid, out of habit, before the flight starts — and the day's warnings go with
  // it. You may only acknowledge what you have actually been shown.
  const ok = drain(INITIAL_BATTERY, 0.90);
  expect(acknowledgeBattery(ok.state).acked).toBeNull();
  expect(drain(acknowledgeBattery(ok.state), 0.28).alert?.level).toBe('low');
});

// ---- charging ----

test('CHARGING DOES NOT SILENCE THE WARNING — a charger can lose to a bright screen', () => {
  // The tempting rule ("plugged in, so shut up") is wrong in exactly this cockpit: a tablet with
  // a 1 Hz GPS and a screen bright enough to read in the sun can draw more than a weak socket
  // gives, and go DOWN while charging. And plugs shake loose in turbulence.
  const v = drain(INITIAL_BATTERY, 0.35);
  const plugged = nextBattery(v.state, { chargeFrac: 0.22, charging: true });
  expect(plugged.alert?.level).toBe('low');
  // ... and the alert says so, because "plugged in and STILL falling" is a sharper sentence for
  // the pilot than "you are low": the cable he thinks is saving him is not.
  expect(plugged.alert?.charging).toBe(true);
});

test('a device that cannot say whether it is charging says NULL, and is never guessed at', () => {
  const v = nextBattery(INITIAL_BATTERY, { chargeFrac: 0.28, charging: null });
  expect(v.charging).toBeNull();
  expect(v.alert?.charging).toBeNull();
});

// ---- the thresholds themselves ----

test('the thresholds mean something for a FIVE-HOUR flight, not for a phone on a desk', () => {
  // At the ~15 %/h a moving map with a bright screen actually costs: 30 % is about two hours —
  // the last moment dimming the screen or finding the cable still saves the flight. 15 % is about
  // one — the advice changes to "assume you will lose the screen". A 20 %-then-5 % pair, borrowed
  // from a phone, warns first when the cheap remedies have already stopped working.
  expect(LOW_FRAC).toBeGreaterThanOrEqual(0.25);
  expect(LOW_FRAC).toBeLessThanOrEqual(0.35);
  expect(CRITICAL_FRAC).toBeGreaterThanOrEqual(0.10);
  expect(CRITICAL_FRAC).toBeLessThan(LOW_FRAC);
});

test('the clear thresholds are far enough above the raise thresholds that noise cannot cross them', () => {
  // Ten points of charge — the better part of an hour of flight. An alert that can be CLEARED by
  // noise is an alert that will be RAISED by noise.
  expect(LOW_CLEAR_FRAC - LOW_FRAC).toBeGreaterThanOrEqual(0.08);
  expect(CRITICAL_CLEAR_FRAC - CRITICAL_FRAC).toBeGreaterThanOrEqual(0.08);
  expect(CRITICAL_CLEAR_FRAC).toBeLessThanOrEqual(LOW_FRAC);   // recovering out of critical must
  // land in 'low', never jump straight to silence.
});

test('the module reads no clock and holds no hidden state: the same inputs give the same verdict', () => {
  // Replay must alert exactly as the live flight did. State is an ARGUMENT here, which is the only
  // reason this is testable at all.
  const a = nextBattery({ level: 'low', acked: null }, { chargeFrac: 0.27, charging: false });
  const b = nextBattery({ level: 'low', acked: null }, { chargeFrac: 0.27, charging: false });
  expect(a).toEqual(b);
});
