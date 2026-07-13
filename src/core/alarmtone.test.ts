// The LAW is the kernel's, and the kernel tests it (soaring-core/src/alarmvoice.test.ts). What
// this pins is the one thing a re-export can silently break: that VOLPLANE speaks the kernel's
// dialect and has not quietly grown a second one — and, above all, that the alarm is still
// STRUCTURALLY unlike the vario. Loudness can be turned down. Speed can be mimicked by a good
// thermal. A pitch that changes inside one continuous cry can be neither, and that is the whole
// safety argument.
import { test, expect } from 'bun:test';
import { chooseVoice, flarmVoice, terrainVoice, voiceAt, steady } from './alarmtone';
import { varioTone } from './vartone';
import * as kernel from 'soaring-core/alarmvoice';

test('the app sounds the KERNEL law, not a local copy of it', () => {
  for (const lvl of [0, 1, 2, 3] as const) expect(flarmVoice(lvl)).toEqual(kernel.flarmVoice(lvl));
  expect(terrainVoice(3)).toEqual(kernel.terrainVoice(3));
  const cruise = varioTone(3);
  expect(chooseVoice({ flarm: 2, terrain: null, cruise }))
    .toEqual(kernel.chooseVoice({ flarm: 2, terrain: null, cruise }));
  expect(voiceAt(flarmVoice(3)!, 120)).toEqual(kernel.voiceAt(kernel.flarmVoice(3)!, 120));
});

test('an alarm CHANGES PITCH inside one cry; no vario ever does', () => {
  // The structural difference the whole design rests on. A 5 m/s climb is a fast high beep — so
  // an alarm built from rate and pitch alone would be a compliment to the pilot's centring.
  const strongClimb = varioTone(5);
  const alarm = flarmVoice(3)!;
  const pitches = new Set(alarm.steps.map(s => s.tone.hz));
  expect(pitches.size).toBe(2);                    // two pitches, one continuous cry
  expect(alarm.steps.every(s => s.tone.pulsesPerS === 0)).toBe(true);   // continuous, not chopped

  // The vario, at ANY strength, holds ONE pitch for the whole of its voice.
  for (const vz of [0.5, 2, 5, 9]) {
    const v = steady(varioTone(vz));
    expect(new Set(v.steps.map(s => s.tone.hz)).size).toBe(1);
  }
  expect(strongClimb.pulsesPerS).toBeGreaterThan(0);   // and it BEEPS, while the alarm does not
});

test('the alarm supersedes the vario, and the two alarms are unlike each other', () => {
  const climb = varioTone(4);
  // A collision warning does not wait for a beep to finish.
  expect(chooseVoice({ flarm: 3, terrain: null, cruise: climb })).toEqual(flarmVoice(3)!);
  expect(chooseVoice({ flarm: 0, terrain: 3, cruise: climb })).toEqual(terrainVoice(3));
  // Traffic RISES; terrain FALLS. A pilot who confuses them turns the wrong way.
  const traffic = flarmVoice(3)!.steps.map(s => s.tone.hz);
  const ground = terrainVoice(3).steps.map(s => s.tone.hz);
  expect(traffic[1]).toBeGreaterThan(traffic[0]);
  expect(ground[1]).toBeLessThan(ground[0]);
  expect(Math.min(...ground)).toBeLessThan(Math.min(...traffic));   // and the ground sits LOW
  // Nothing to say: the vario has the speaker back.
  expect(chooseVoice({ flarm: 0, terrain: null, cruise: climb })).toEqual(steady(climb));
});

test('voiceAt is total: a mad clock is silence, never undefined', () => {
  expect(voiceAt(null, 0).silent).toBe(true);
  expect(voiceAt(flarmVoice(3)!, -1e9).silent).toBe(false);
  expect(voiceAt(flarmVoice(3)!, NaN).silent).toBe(true);
});
