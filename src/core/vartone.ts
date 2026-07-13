// ============ the sound of the air (VAR-004, VAR-005) ============
// A glider pilot does not look at the vario. He listens to it — his eyes are outside, where
// FLM-005 says they belong. So the audio is not a decoration on the vario: in a thermal it IS
// the vario, and a tone that lies is worse than silence.
//
// The tone is computed HERE, as a pure value, and merely played in the shell. That split is
// not ceremony: pitch/pulse mappings are the part that can be subtly wrong — a deadband that
// squeaks at zero, a pulse rate that saturates just where the pilot is centring — and a
// mapping in an oscillator callback is a mapping no test can reach.
//
// Two modes, and they must never be confused (VAR-005 is a DIFFERENT claim from VAR-004):
// the vario tone says how the AIR is moving; the speed-to-fly tone says how the PILOT should
// move. Same speaker, opposite meanings — so they are opposite sounds, and only one plays.

export interface Tone {
  /** Nothing to say: the deadband, or no data. Silence is a legitimate answer and the ONLY
   *  honest one when the vario is unknown — a 0 m/s beep over a dead sensor is a lie the
   *  pilot cannot see through, because he is not looking. */
  silent: boolean;
  hz: number;
  /** Beeps per second; 0 = a continuous tone (the classic sink growl). */
  pulsesPerS: number;
  /** Fraction of each pulse that sounds — short chirps high, long ones low. */
  duty: number;
}

export const SILENT: Tone = { silent: true, hz: 0, pulsesPerS: 0, duty: 0 };

export interface VarioAudioOpts {
  /** Climb below this stays silent — the deadband that keeps a glider from squeaking in
   *  neutral air all afternoon. */
  deadbandMs?: number;
  /** Sink beyond this growls. Between the two thresholds: nothing. */
  sinkAlarmMs?: number;
  /** Pitch at zero climb, and how much it rises per m/s. */
  baseHz?: number;
  hzPerMs?: number;
}

const V_DEFAULTS = { deadbandMs: 0.25, sinkAlarmMs: -2.0, baseHz: 440, hzPerMs: 110 };

/** VAR-004: the classic vario voice — climb rises in pitch and beeps faster the stronger it
 *  gets; sink is a low, continuous growl; the band between them is silent. A null vario is
 *  SILENT, never a zero-tone: there is no honest sound for "I do not know". */
export function varioTone(vario: number | null | undefined, o: VarioAudioOpts = {}): Tone {
  const { deadbandMs, sinkAlarmMs, baseHz, hzPerMs } = { ...V_DEFAULTS, ...o };
  if (vario == null || !Number.isFinite(vario)) return SILENT;

  if (vario > deadbandMs) {
    // Pitch and pulse rate both rise with the climb, and both saturate: past ~5 m/s the ear
    // cannot tell 6 from 7 anyway, and an ever-faster beep becomes a buzz that says nothing.
    const v = Math.min(vario, 5);
    return {
      silent: false,
      hz: baseHz + hzPerMs * v,
      pulsesPerS: 1.5 + 1.7 * v,
      duty: 0.5,
    };
  }
  if (vario < sinkAlarmMs) {
    // Sink: below the base pitch, continuous, and the harder it sinks the lower it growls.
    const v = Math.max(vario, -8);
    return {
      silent: false,
      hz: Math.max(120, baseHz + hzPerMs * 0.55 * v),
      pulsesPerS: 0,                                  // continuous — a growl, not a beep
      duty: 1,
    };
  }
  return SILENT;                                      // the deadband: neutral air says nothing
}

/** VAR-005: the speed-to-fly voice, active in cruise. `deltaMs` is (current airspeed −
 *  commanded speed): positive means flying TOO FAST, negative means TOO SLOW.
 *
 *  The two errors get opposite sounds on purpose — a pilot must know which way to push
 *  WITHOUT thinking. Too slow: high, urgent, fast chirps ("pull the nose down"). Too fast: a
 *  low, slow, lazy tone ("ease off"). And the tolerance band in between is silent, because a
 *  speed director that never shuts up is a speed director that gets muted. */
export function stfTone(deltaMs: number | null | undefined, toleranceMs = 2): Tone {
  if (deltaMs == null || !Number.isFinite(deltaMs)) return SILENT;
  if (Math.abs(deltaMs) <= toleranceMs) return SILENT;
  const err = Math.min(Math.abs(deltaMs), 15);
  if (deltaMs < 0) {
    return { silent: false, hz: 700 + 40 * err, pulsesPerS: 3 + 0.5 * err, duty: 0.35 };
  }
  return { silent: false, hz: Math.max(160, 320 - 8 * err), pulsesPerS: 1.2, duty: 0.6 };
}
