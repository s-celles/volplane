// The LAW is the kernel's, and the kernel tests it (soaring-core/src/varioaudio.test.ts).
// What this file pins is the thing a re-export can silently break: that VOLPLANE really is
// speaking the kernel's dialect, and has not quietly grown a second one.
//
// It is a small test with a real job. The first version of this app had its OWN sound law —
// linear pitch, a sine wave, a sink threshold so wide that gentle sink was mute — and it
// sounded nothing like the vario in ogn-3d-viewer, its sibling. That divergence is exactly
// what C4 forbids and exactly what a re-export can reintroduce by accident.
import { test, expect } from 'bun:test';
import { varioTone, stfTone, toneHz, F0, DEADBAND_MS } from './vartone';
import * as kernel from 'soaring-core/varioaudio';

test('the app sounds the KERNEL law, not a local copy of it', () => {
  for (const vz of [null, -9, -2, -0.5, -0.1, 0, 0.1, 0.5, 2, 5, 12, NaN]) {
    expect(varioTone(vz)).toEqual(kernel.varioTone(vz));
  }
  for (const d of [null, -12, -3, -1, 0, 1, 3, 12]) {
    expect(stfTone(d)).toEqual(kernel.stfTone(d));
  }
  expect(F0).toBe(kernel.F0);
  expect(DEADBAND_MS).toBe(kernel.DEADBAND_MS);
});

test('the pitch really is exponential, and gentle sink really does speak', () => {
  // The two regressions that made the first attempt sound wrong. If either comes back, it
  // comes back HERE, not in a pilot's ear.
  expect(toneHz(0)).toBeCloseTo(F0, 6);
  expect(toneHz(4) - toneHz(3)).toBeGreaterThan((toneHz(1) - toneHz(0)) * 1.5);
  expect(varioTone(-0.5).silent).toBe(false);
  expect(varioTone(-0.5).pulsesPerS).toBe(0);     // sink growls, continuously
  expect(varioTone(2).pulsesPerS).toBeGreaterThan(0);   // climb beeps
});
