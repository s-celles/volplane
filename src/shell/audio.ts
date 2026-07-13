// ============ playing the tone (VAR-004, VAR-005) ============
// core/vartone.ts decides WHAT to sound; this file only makes the noise. All the judgement —
// the deadband, the exponential pitch law, climb-versus-sink — lives upstairs where a test can
// reach it, and what is left here is an oscillator, a gate and a clock.
//
// Two details separate a vario that sounds real from one that sounds like a doorbell, and
// both live in THIS file rather than in the law:
//
//   • The waveform is SQUARE. A sine is a doorbell. Every electronic vario a pilot has flown
//     is harsh, and the harshness is what makes it audible under a canopy at 100 km/h.
//   • The beeps are scheduled on the AUDIO clock, with attack and release ramps, a horizon
//     ahead of now. Toggling a gain from setInterval — which this file used to do — lands the
//     edges wherever the event loop happens to be, and every one of them clicks. A vario that
//     clicks is a vario the pilot turns off.
//
// Ported from ogn-3d-viewer's src/vario-audio.ts, which already had both right.
//
// Browsers refuse sound before a gesture, and that refusal is not a bug to work around:
// `openAudio()` is called from the pilot's own click. Until then there is no context at all.

import { type Tone } from '../core/vartone';

/** Master gain. Loud enough to hear over the airflow, quiet enough not to be the first thing
 *  a pilot mutes. */
const VOL = 0.32;
/** Scheduler tick (ms) and how far ahead of `currentTime` beeps are queued (s). The horizon
 *  must exceed the tick, or a late tick leaves a hole in the beep train. */
const LOOK_MS = 25;
const AHEAD_S = 0.13;

export interface AudioOut {
  /** Feed the tone. Cheap and idempotent — call it every fix. */
  setTone(t: Tone): void;
  stop(): void;
  readonly running: boolean;
}

export function openAudio(): AudioOut | null {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;                    // the spec's own "LÀ OÙ une sortie audio est disponible"

  const ctx = new Ctor();
  const osc = ctx.createOscillator();
  const gate = ctx.createGain();             // the beep envelope
  const master = ctx.createGain();           // the volume
  osc.type = 'square';                       // NOT a sine — see the header
  osc.frequency.value = 600;
  gate.gain.value = 0;
  master.gain.value = VOL;
  osc.connect(gate).connect(master).connect(ctx.destination);
  osc.start();
  void ctx.resume();                         // we are inside the gesture that unlocks it

  let tone: Tone = { silent: true, hz: 0, pulsesPerS: 0, duty: 0 };
  let nextBeep = ctx.currentTime;
  let running = true;

  /** One beep, written into the future with real edges. The ramps are what kill the click:
   *  a gain that steps from 0 to 1 is a discontinuity, and a discontinuity is a pop. */
  const beep = (at: number, period: number, duty: number): void => {
    const on = Math.max(0.03, duty * period);
    const attack = 0.006, release = 0.012;
    const gg = gate.gain;
    gg.setValueAtTime(0, at);
    gg.linearRampToValueAtTime(1, at + attack);
    gg.setValueAtTime(1, Math.max(at + attack, at + on - release));
    gg.linearRampToValueAtTime(0, at + on);
  };

  /** Hold the gate open (sink) or shut (silence), smoothly. */
  const hold = (level: number): void => {
    const t = ctx.currentTime;
    gate.gain.cancelScheduledValues(t);
    gate.gain.setTargetAtTime(level, t, 0.012);
  };

  const timer = setInterval(() => {
    if (!running) return;
    const now = ctx.currentTime;
    if (tone.silent) { hold(0); nextBeep = now; return; }
    // The pitch glides rather than jumps: setTargetAtTime over ~20 ms follows a strengthening
    // thermal without the stepped, robotic quality of an abrupt frequency write.
    osc.frequency.setTargetAtTime(tone.hz, now, 0.02);
    if (tone.pulsesPerS <= 0) { hold(1); nextBeep = now; return; }   // sink: continuous growl
    const period = 1 / tone.pulsesPerS;
    // Queue every beep whose start falls inside the horizon. `nextBeep` carries across ticks,
    // so the train stays phase-continuous even as the rate changes under it.
    if (nextBeep < now) nextBeep = now;
    while (nextBeep < now + AHEAD_S) {
      beep(nextBeep, period, tone.duty);
      nextBeep += period;
    }
  }, LOOK_MS);

  return {
    setTone(t: Tone): void { if (running) tone = t; },
    stop(): void {
      running = false;
      clearInterval(timer);
      gate.gain.cancelScheduledValues(ctx.currentTime);
      gate.gain.value = 0;
      void ctx.close();
    },
    get running() { return running; },
  };
}
