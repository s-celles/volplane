// The one thing an audio vario must never do: make a sound that means something it does not
// mean. A dead sensor is silent, neutral air is silent, and climb and sink cannot be mistaken
// for one another with your eyes outside the cockpit — which is the whole point of the sound.
import { test, expect } from 'bun:test';
import { varioTone, stfTone, SILENT } from './vartone';

test('an unknown vario is SILENT — there is no honest sound for "I do not know"', () => {
  expect(varioTone(null)).toEqual(SILENT);
  expect(varioTone(undefined)).toEqual(SILENT);
  expect(varioTone(NaN)).toEqual(SILENT);
});

test('neutral air says nothing: the deadband holds', () => {
  expect(varioTone(0).silent).toBe(true);
  expect(varioTone(0.2).silent).toBe(true);
  expect(varioTone(-1).silent).toBe(true);            // between the deadband and the sink alarm
});

test('climb rises in pitch and beats faster; sink growls BELOW the base, continuously', () => {
  const weak = varioTone(1), strong = varioTone(4);
  expect(weak.silent).toBe(false);
  expect(strong.hz).toBeGreaterThan(weak.hz);
  expect(strong.pulsesPerS).toBeGreaterThan(weak.pulsesPerS);
  expect(weak.pulsesPerS).toBeGreaterThan(0);         // climb BEEPS

  const sink = varioTone(-3);
  expect(sink.silent).toBe(false);
  expect(sink.pulsesPerS).toBe(0);                    // sink GROWLS — continuous, not a beep
  expect(sink.hz).toBeLessThan(weak.hz);              // and below the climb's voice, always
});

test('climb and sink can never be confused, at any strength', () => {
  for (const up of [0.5, 1, 2, 5, 9]) {
    for (const down of [-2.5, -4, -8, -12]) {
      const u = varioTone(up), dn = varioTone(down);
      if (u.silent || dn.silent) continue;
      expect(u.hz).toBeGreaterThan(dn.hz);            // up is always higher than down…
      expect(u.pulsesPerS).toBeGreaterThan(0);        // …and up always beeps…
      expect(dn.pulsesPerS).toBe(0);                  // …while down never does
    }
  }
});

test('the tone saturates instead of running away', () => {
  const strong = varioTone(5), absurd = varioTone(50);
  expect(absurd.hz).toBeCloseTo(strong.hz, 6);        // a 50 m/s "climb" is a broken sensor
  expect(absurd.pulsesPerS).toBeCloseTo(strong.pulsesPerS, 6);
  expect(varioTone(-40).hz).toBeGreaterThanOrEqual(120);   // and the growl stays audible
});

test('VAR-005: too slow chirps high and urgent, too fast drones low and lazy', () => {
  const slow = stfTone(-8), fast = stfTone(8);
  expect(slow.silent).toBe(false);
  expect(fast.silent).toBe(false);
  expect(slow.hz).toBeGreaterThan(fast.hz);           // the two errors sound OPPOSITE…
  expect(slow.pulsesPerS).toBeGreaterThan(fast.pulsesPerS);
  expect(slow.duty).toBeLessThan(fast.duty);          // …chirps against a drone
});

test('the speed director shuts up inside its tolerance — one that never does gets muted', () => {
  expect(stfTone(0).silent).toBe(true);
  expect(stfTone(1.9).silent).toBe(true);
  expect(stfTone(-1.9).silent).toBe(true);
  expect(stfTone(3).silent).toBe(false);
  expect(stfTone(null)).toEqual(SILENT);
});
