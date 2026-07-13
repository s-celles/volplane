// ============ the crash journal (SYS-001/005) ============
// The in-memory logger holds the flight; this file is the insurance against the app dying
// with it. Every few seconds the records drained from the logger land in the KV as a chunk,
// so an unexpected kill loses at most one buffer's worth (SYS-001: "en bornant la perte";
// SYS-005: the periodic save of volatile state). At the next startup, recoverOrphan finds
// whatever a crash left behind and rebuilds the file with the SAME assembly the live logger
// uses — core's assembleIgc — so a recovered flight cannot differ from a recorded one.
//
// One flight at a time, by design: the 'journal/' prefix belongs to THE current flight, and
// opening a journal claims it whole. A pilot flies one flight; a journal that tried to hold
// several would need a lifecycle policy this app has no business inventing. The corollary is
// the recovery rule: a journal that still exists at startup IS a crash, because the clean
// stop path discards it.
//
// The journal is best-effort on purpose. The logger in memory remains the primary record;
// a KV write that fails must not take the 1 Hz flight loop down with it (SYS-002's spirit:
// degrade, never stop). Failed records stay buffered for the next attempt, and lastError
// tells the UI the insurance has lapsed — it never pretends.

import type { KV } from './store';
import { putJson, getJson } from './store';
import { assembleIgc, type LogMeta } from '../core/igclog';

const PREFIX = 'journal/';
const META_KEY = 'journal/meta';
const REC_PREFIX = 'journal/rec/';

/** Records buffered before a chunk is written: ≈10 s at 1 Hz. That is the bound on what a
 *  crash can cost, and the knob between write wear and loss window. */
export const FLUSH_EVERY = 10;

/** Chunk keys are zero-padded so keys('journal/rec/') sorts lexicographically in exactly
 *  chronological order — recovery reads them back sorted and needs no other index. Six
 *  digits is 999999 chunks ≈ 115 days of flight at one chunk per 10 s; enough. */
const chunkKey = (n: number): string => REC_PREFIX + String(n).padStart(6, '0');

export interface Journal {
  /** Buffer records (the logger's drain output); a full buffer triggers a background chunk
   *  write. Never throws and never blocks — this is called from the 1 Hz flight loop. */
  add(records: string[]): void;
  /** Write whatever is buffered now. The stop path calls this before offering the download,
   *  so even the tail of the flight survives a crash between stop and save. */
  flush(): Promise<void>;
  /** Delete every journal key: the CLEAN stop. After this, a journal found at startup can
   *  only mean a crash. */
  discard(): Promise<void>;
  /** Resolves when every write triggered so far has settled — the ordering fence for
   *  shutdown paths and tests. It never rejects; failures show up in lastError instead. */
  settled(): Promise<void>;
  /** The most recent KV write failure, or null while the insurance is holding. The UI shows
   *  this; the journal itself keeps retrying on the next chunk. */
  readonly lastError: string | null;
  /** Records held in memory, not yet persisted — what a crash right now would cost. */
  readonly buffered: number;
}

export async function openJournal(kv: KV, meta: LogMeta): Promise<Journal> {
  // A new flight owns the prefix. Whatever a previous crash left behind was either recovered
  // at startup or knowingly dismissed by now — the integrator's contract — so leftovers here
  // are garbage that would otherwise splice a dead flight's fixes into this one.
  for (const k of await kv.keys(PREFIX)) await kv.del(k);
  await putJson(kv, META_KEY, meta);

  const buf: string[] = [];
  let written = 0;                                    // chunks successfully persisted
  let lastError: string | null = null;
  // All writes ride one promise chain: chunk N is on disk before chunk N+1 is attempted, so
  // the key order recovery relies on is also the order the bytes actually landed in.
  let chain: Promise<void> = Promise.resolve();

  const persist = (everything: boolean): Promise<void> =>
    (chain = chain.then(async () => {
      while (everything ? buf.length > 0 : buf.length >= FLUSH_EVERY) {
        const n = everything ? buf.length : FLUSH_EVERY;
        try {
          await kv.put(
            chunkKey(written + 1),
            new TextEncoder().encode(buf.slice(0, n).join('\r\n') + '\r\n'),
          );
        } catch (e) {
          // The write failed; the records did NOT. They stay in the buffer and go out with
          // the next chunk that succeeds — the loss window grows, honesty about it too.
          lastError = e instanceof Error ? e.message : String(e);
          return;
        }
        written++;
        buf.splice(0, n);
        lastError = null;
      }
    }));

  return {
    add(records: string[]): void {
      buf.push(...records);
      if (buf.length >= FLUSH_EVERY) void persist(false);
    },
    flush: () => persist(true),
    async discard(): Promise<void> {
      await chain;                                    // let in-flight writes land first
      buf.length = 0;
      for (const k of await kv.keys(PREFIX)) await kv.del(k);
    },
    settled: () => chain,
    get lastError() { return lastError; },
    get buffered() { return buf.length; },
  };
}

/** What a crash left behind, rebuilt into a downloadable file — or null when there is
 *  genuinely nothing: no meta AND no chunks (absent is null, store.ts's one honesty rule).
 *
 *  A rotten meta — unparsable JSON, or missing while chunks exist — must not cost the pilot
 *  the fixes: they are the flight, the meta is only its label. Those recover under the day
 *  '0000-00-00', a date no real flight carries — honest as unknown, never an invented today
 *  (POT-007 wearing its recovery hat). */
export async function recoverOrphan(
  kv: KV,
): Promise<{ meta: LogMeta; igc: string; fixes: number } | null> {
  const chunkKeys = (await kv.keys(REC_PREFIX)).sort();

  let meta: LogMeta | null = null;
  let rotten = false;
  try {
    const m = await getJson<LogMeta>(kv, META_KEY);
    if (m !== null && typeof m === 'object' && typeof m.day === 'string') meta = m;
    else if (m !== null) rotten = true;               // parsed, but it is not a LogMeta
  } catch {
    rotten = true;                                    // stored bytes that are not JSON
  }

  if (meta === null && !rotten && chunkKeys.length === 0) return null;
  if (meta === null) meta = { day: '0000-00-00' };

  const records: string[] = [];
  const dec = new TextDecoder();
  for (const k of chunkKeys) {
    const bytes = await kv.get(k);
    if (bytes === null) continue;                     // deleted between keys() and get()
    for (const line of dec.decode(bytes).split('\r\n')) if (line) records.push(line);
  }

  return {
    meta,
    igc: assembleIgc(meta, records),
    fixes: records.filter(r => r.startsWith('B')).length,
  };
}

/** Delete every journal key. The integrator calls this once the pilot has downloaded the
 *  orphan or knowingly dismissed it — not before, because an undownloaded journal is the
 *  only copy of the flight there is. */
export async function clearJournal(kv: KV): Promise<void> {
  for (const k of await kv.keys(PREFIX)) await kv.del(k);
}
