// ============ the device port (C5) ============
// A flight computer is fed by an instrument. Which instrument, over what link, is the one
// thing that differs most between platforms — and the one thing Apple, Android and a desktop
// OS each decide for themselves (see spec §3bis). So it is the one thing the computer must
// not know about.
//
// Everything upstream of this file is a shell concern: a serial port, a BLE characteristic,
// a UDP socket, a Rust task, a Kotlin plugin. Everything downstream sees a stream of lines.
//
// Three consequences, and they are why C5 exists:
//   - the app shell (Tauri today, something else tomorrow) is REPLACEABLE;
//   - the platform differences of §3bis are confined to one place;
//   - ACQ-010 (replay) is FREE — a replayed IGC is a source like any other.

/** A source of sentences. One line per NMEA sentence, as the instrument sent it.
 *
 *  Async, because every real source is: a socket blocks, a serial port waits, a replay
 *  sleeps between fixes. And finite-or-not is the source's business, not the computer's —
 *  a file ends, a socket does not. */
export type DeviceSource = () => AsyncIterable<string>;

/** What a source says about itself, so the UI can name it and ACQ-012 can refuse to offer a
 *  link the platform does not permit. */
export interface DeviceInfo {
  id: string;
  label: string;
  /** The link this source uses. The shell decides which of these it can even build. */
  link: 'tcp' | 'udp' | 'serial' | 'bluetooth-classic' | 'bluetooth-le' | 'internal' | 'replay';
}

export interface Device extends DeviceInfo {
  open: DeviceSource;
}

// ---- health (ACQ-006) ----

/** How long a source may stay silent before it is presumed dead. A glider computer that
 *  quietly keeps showing the last known position of a disconnected instrument is worse than
 *  one that says nothing: the pilot believes it. */
export const SILENCE_TIMEOUT_MS = 5_000;

export type LinkState =
  | { state: 'idle' }
  | { state: 'live'; lastSentenceAt: number }
  | { state: 'silent'; since: number }      // still open, but nothing is coming
  | { state: 'closed'; error?: string };

/** Wrap a source so that a silence longer than `timeoutMs` is REPORTED rather than endured.
 *  The stream itself is untouched — this only watches it. */
export async function* withHealth(
  src: AsyncIterable<string>,
  onState: (s: LinkState) => void,
  timeoutMs = SILENCE_TIMEOUT_MS,
  now: () => number = Date.now,
): AsyncIterable<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => onState({ state: 'silent', since: now() }), timeoutMs);
  };
  try {
    arm();
    for await (const line of src) {
      arm();
      onState({ state: 'live', lastSentenceAt: now() });
      yield line;
    }
    onState({ state: 'closed' });
  } catch (e) {
    onState({ state: 'closed', error: String(e) });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Split a byte stream into lines. A socket does not hand you sentences — it hands you
 *  whatever arrived, which may be half a sentence, three sentences, or a sentence split
 *  across two packets. Getting this wrong corrupts every driver downstream. */
export async function* lines(chunks: AsyncIterable<string>): AsyncIterable<string> {
  let buf = '';
  for await (const chunk of chunks) {
    buf += chunk;
    let i: number;
    while ((i = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + (buf[i] === '\r' && buf[i + 1] === '\n' ? 2 : 1));
      if (line.length) yield line;
    }
  }
  if (buf.length) yield buf;   // a last sentence with no trailing newline is still a sentence
}
