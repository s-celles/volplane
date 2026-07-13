// ============ the alarm, out loud (FLM-002, TER-008) ============
// There is almost nothing here, and that is the point.
//
// The tone LAW — the warble, the two alarm voices, and the priority law that decides which one
// speaker says what — is soaring DOMAIN, not app logic. It now lives in the kernel
// (`soaring-core/alarmvoice`, v0.5.0), beside the vario law it composes.
//
// It was WRITTEN here, with a header declaring itself in the wrong repository, because the phase
// that produced it was not allowed to edit the kernel. That header was the process working; this
// re-export is the process finishing. It is the fourth thing to make the trip — after the vario
// sound law, the .cup parser and the spots dataset — and every one of those consolidations found
// a bug that the duplication had made structurally invisible.
//
// What VOLPLANE keeps is what an app keeps: the oscillator (src/shell/audio.ts).

export {
  steady,
  voiceAt,
  flarmVoice,
  terrainVoice,
  chooseVoice,
  SILENT_VOICE,
  type Voice,
  type ToneStep,
} from 'soaring-core/alarmvoice';
