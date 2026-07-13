// ============ the loudspeaker, on a fake speaker ============
// The LAW is tested in core/alarmtone.test.ts, where it belongs. What can only be tested HERE
// is the wiring, and the wiring has exactly two ways to betray FLM-002:
//
//   • the alarm gets its own AudioContext, and two contexts mean two sounds at once — which is
//     not twice the warning, it is noise;
//   • the alarm is fed to the oscillator as ONE pitch, which is a vario beep again.
//
// Bun has no Web Audio, so we lend it one: a fake context that records what the oscillator was
// told. It cannot prove the pilot hears anything, but it proves the one voice reaches the one
// oscillator, and it proves the warble really does move.
import { test, expect, afterEach } from 'bun:test';
import { openAudio } from './audio';
import { varioTone } from '../core/vartone';
import { flarmVoice } from '../core/alarmtone';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

interface Spy { contexts: number; hz: number[]; closed: number }

function lendAudio(): Spy {
  const spy: Spy = { contexts: 0, hz: [], closed: 0 };
  const t0 = Date.now();
  const param = (): Record<string, unknown> => ({
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {},
    setTargetAtTime() {}, cancelScheduledValues() {},
  });
  class FakeCtx {
    destination = {};
    constructor() { spy.contexts++; }
    get currentTime() { return (Date.now() - t0) / 1000; }
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          value: 0,
          setTargetAtTime(v: number) { spy.hz.push(v); },
          setValueAtTime(v: number) { spy.hz.push(v); },
        },
        connect: (n: unknown) => n,
        start() {},
      };
    }
    createGain() { return { gain: param(), connect: (n: unknown) => n }; }
    resume() { return Promise.resolve(); }
    close() { spy.closed++; return Promise.resolve(); }
  }
  (globalThis as Record<string, unknown>).AudioContext = FakeCtx;
  return spy;
}

afterEach(() => { delete (globalThis as Record<string, unknown>).AudioContext; });

test('no audio output, no sound, no crash (the spec\'s "where audio is available")', () => {
  delete (globalThis as Record<string, unknown>).AudioContext;
  delete (globalThis as Record<string, unknown>).webkitAudioContext;
  expect(openAudio()).toBeNull();
});

test('the alarm speaks through the SAME oscillator, and it moves', async () => {
  const spy = lendAudio();
  const out = openAudio();
  expect(out).not.toBeNull();

  out!.setTone(varioTone(3));                 // a climb: one pitch, held
  await sleep(120);
  const climb = new Set(spy.hz);
  expect(climb.size).toBe(1);                 // a vario is ONE pitch — that is the whole trap

  spy.hz.length = 0;
  out!.setVoice(flarmVoice(3));               // the urgent warble: 90 ms steps
  await sleep(300);
  const alarm = new Set(spy.hz);
  expect(alarm).toEqual(new Set([880, 1320]));   // both pitches, alternating, from one oscillator
  expect(spy.contexts).toBe(1);                  // ONE context: never two sounds at once

  out!.stop();
  expect(out!.running).toBe(false);
  expect(spy.closed).toBe(1);
});

test('a null voice is silence, and silence is not a zero-hertz tone', async () => {
  const spy = lendAudio();
  const out = openAudio()!;
  out.setVoice(null);
  await sleep(80);
  expect(spy.hz).toEqual([]);                 // nothing was ever written to the oscillator
  out.stop();
});
