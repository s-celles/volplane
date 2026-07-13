// ============ playing the tone (VAR-004, VAR-005) ============
// core/vartone.ts decides WHAT to sound; this file only makes the noise. All the judgement —
// deadbands, pitch mapping, climb-versus-sink — lives upstairs where a test can reach it, and
// what is left here is an oscillator, a gain node and a clock.
//
// One oscillator for the life of the app, its frequency and gain steered: creating a node per
// beep would garbage-collect under the pilot's ear at 1 Hz, and a vario that stutters in a
// thermal is a vario he stops trusting.
//
// Browsers refuse to make sound before a gesture, and that refusal is not a bug to work
// around: `start()` is called from the pilot's own click. Until then the audio is idle and
// SAYS it is idle — a mute flight computer that thinks it is singing is the worst of both.

import { type Tone } from '../core/vartone';

/** The slice of Web Audio this file uses. A real AudioContext satisfies it structurally; a
 *  test hands in a recorder — the same trick Paint2D plays on the canvas. */
export interface AudioOut {
  setTone(t: Tone): void;
  stop(): void;
  readonly running: boolean;
}

/** Build an audio output over the browser's AudioContext, or null where there is none — the
 *  spec's own "LÀ OÙ une sortie audio est disponible" (VAR-004), answered honestly rather than
 *  by throwing at the first beep. */
export function openAudio(): AudioOut | null {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  gain.gain.value = 0;                       // silent until told otherwise
  osc.connect(gain).connect(ctx.destination);
  osc.start();

  let timer: ReturnType<typeof setInterval> | undefined;
  let running = true;

  /** The pulse train. A tone with pulsesPerS = 0 is continuous (the sink growl); otherwise the
   *  gain is switched on for `duty` of each period. The interval is re-armed on every tone
   *  change, so a climb that strengthens speeds its beeps up immediately rather than at the
   *  end of the current pulse — the centring feedback a pilot actually flies on. */
  const arm = (t: Tone): void => {
    clearInterval(timer);
    timer = undefined;
    if (t.silent) { gain.gain.value = 0; return; }
    osc.frequency.value = t.hz;
    if (t.pulsesPerS <= 0) { gain.gain.value = 0.12; return; }   // continuous
    const period = 1000 / t.pulsesPerS;
    let on = false;
    const tick = (): void => {
      on = !on;
      gain.gain.value = on ? 0.12 : 0;
    };
    gain.gain.value = 0.12;
    on = true;
    // Two half-steps per period, weighted by the duty: on for duty·period, off for the rest.
    timer = setInterval(tick, Math.max(20, period * (on ? t.duty : 1 - t.duty)));
  };

  let last: Tone | null = null;
  return {
    setTone(t: Tone): void {
      if (!running) return;
      // Re-arming an unchanged tone would restart the pulse train on every fix and turn a
      // steady beep into a stutter. Only a CHANGE re-arms.
      if (last && last.silent === t.silent && last.hz === t.hz
        && last.pulsesPerS === t.pulsesPerS && last.duty === t.duty) return;
      last = t;
      arm(t);
    },
    stop(): void {
      running = false;
      clearInterval(timer);
      gain.gain.value = 0;
      void ctx.close();
    },
    get running() { return running; },
  };
}
