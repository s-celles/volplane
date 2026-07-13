// ============ the sound of the air (VAR-004, VAR-005) ============
// There is almost nothing here, and that is the point.
//
// The sound LAW — the exponential pitch, the narrow deadband, the beep rate, the climb/sink
// split — is soaring domain, not app logic, and it now lives in the kernel
// (`soaring-core/varioaudio`, v0.3.0). It was written here first, and it was written WRONG
// here first: a linear pitch ramp, a sine wave, a sink threshold so wide that gentle sink was
// silent. ogn-3d-viewer, in the same family, had had it right for a while — which is exactly
// the situation C4 exists to prevent. So it moved, with the four traps named in its header,
// and both apps now speak one dialect.
//
// What is left in VOLPLANE is the shell's job: the oscillator, the square wave, and beeps
// scheduled on the audio clock (see `src/shell/audio.ts`). The law says WHAT to sound; the
// shell makes the noise.
//
// This file is a re-export, kept so the app's own vocabulary (`core/vartone`) still reads
// naturally at the call sites and so the kernel dependency lands in exactly one place.

export {
  varioTone,
  stfTone,
  toneHz,
  SILENT,
  F0,
  DEADBAND_MS,
  type Tone,
} from 'soaring-core/varioaudio';
