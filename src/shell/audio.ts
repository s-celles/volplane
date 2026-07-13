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
//
// FLM-002 widened what this file plays, but not what it decides. It is fed a VOICE — a looped
// sequence of tones (core/alarmtone.ts) — instead of a single tone, and it asks `voiceAt` which
// tone is due at the audio clock's current instant. The vario and the STF director are one-step
// voices and sound exactly as they always did. The alarms are two-step WARBLES, and the warble
// is the whole point: a fast high beep is what a 5 m/s climb sounds like, so an alarm built out
// of rate and pitch alone would be a compliment to the pilot's centring. Two alternating
// pitches inside one continuous cry cannot be heard as any vario. Which voice wins is not this
// file's business either — `chooseVoice` decides that, upstairs, where a test can reach it.

import { type Tone } from '../core/vartone';
import { type Voice, steady, voiceAt } from '../core/alarmtone';

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
  /** Feed a voice — a looped sequence, which is what an alarm is. Null is silence. */
  setVoice(v: Voice | null): void;
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

  let voice: Voice | null = null;
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
    // The voice's own clock is the AUDIO clock, not the event loop's: the warble's steps land
    // where the sound is, not where setInterval happened to fire.
    const tone = voiceAt(voice, now * 1000);
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
    // A tone is just a voice with one step, so there is one code path and no chance of the two
    // drifting apart. main.ts keeps calling setTone and keeps sounding identical.
    setTone(t: Tone): void { if (running) voice = steady(t); },
    setVoice(v: Voice | null): void { if (running) voice = v; },
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
