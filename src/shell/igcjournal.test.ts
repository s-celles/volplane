// The crash journal pinned to its claims: the loss is bounded to one buffer, a failing store
// costs retries but never records, and whatever a crash leaves behind comes back as a file
// the kernel parser reads — under an honest '0000-00-00' when the label rotted with the
// crash. All on memKV, the documented double that is also the shipped degraded mode.
import { test, expect } from 'bun:test';
import { parseIGC, parseIgcHeaders } from 'soaring-core/igc';
import { memKV, type KV } from './store';
import { openJournal, recoverOrphan, clearJournal, FLUSH_EVERY } from './igcjournal';

const META = { day: '2026-07-12', pilot: 'Test' };

// Well-formed B records, one per second — what the logger's drain() would hand over.
const brec = (i: number): string =>
  `B12${String(Math.floor(i / 60)).padStart(2, '0')}${String(i % 60).padStart(2, '0')}` +
  '4700000N00800012EA0150001502';
const brecs = (n: number, from = 0): string[] =>
  Array.from({ length: n }, (_, i) => brec(from + i));

test('a full buffer becomes a chunk; the remainder waits for flush()', async () => {
  const kv = memKV();
  const j = await openJournal(kv, META);
  for (const r of brecs(25)) j.add([r]);
  await j.settled();
  // 25 records at FLUSH_EVERY=10: two chunks persisted, five still only in memory — the
  // bounded loss SYS-001 talks about, made countable.
  expect(await kv.keys('journal/rec/')).toEqual(['journal/rec/000001', 'journal/rec/000002']);
  expect(j.buffered).toBe(25 - 2 * FLUSH_EVERY);
  await j.flush();
  expect((await kv.keys('journal/rec/')).sort()).toEqual([
    'journal/rec/000001', 'journal/rec/000002', 'journal/rec/000003',
  ]);
  expect(j.buffered).toBe(0);
});

test('recoverOrphan rebuilds a file the kernel parser reads fix-for-fix', async () => {
  const kv = memKV();
  const j = await openJournal(kv, META);
  j.add(brecs(25));
  await j.flush();
  // No discard: this is the crash. The next startup finds the flight.
  const orphan = await recoverOrphan(kv);
  expect(orphan).not.toBeNull();
  expect(orphan!.fixes).toBe(25);
  expect(parseIGC(orphan!.igc).length).toBe(25);
  const h = parseIgcHeaders(orphan!.igc);
  expect(h.date).toBe('2026-07-12');
  expect(h.pilot).toBe('Test');
  expect(orphan!.meta.day).toBe('2026-07-12');
});

test('discard is the clean stop: nothing under journal/ survives it', async () => {
  const kv = memKV();
  const j = await openJournal(kv, META);
  j.add(brecs(12));
  await j.flush();
  await j.discard();
  expect(await kv.keys('journal/')).toEqual([]);
  expect(await recoverOrphan(kv)).toBeNull();
});

test('a fresh store has no orphan — absent is null, not an empty flight', async () => {
  expect(await recoverOrphan(memKV())).toBeNull();
});

test('clearJournal empties the prefix once the pilot has taken the orphan', async () => {
  const kv = memKV();
  const j = await openJournal(kv, META);
  j.add(brecs(10));
  await j.settled();
  await clearJournal(kv);
  expect(await kv.keys('journal/')).toEqual([]);
});

test('a failing put neither throws from add nor loses records', async () => {
  const inner = memKV();
  let failing = false;
  const kv: KV = {
    ...inner,
    put: (k, v) => (failing ? Promise.reject(new Error('disk says no')) : inner.put(k, v)),
  };
  const j = await openJournal(kv, META);
  failing = true;
  expect(() => j.add(brecs(10))).not.toThrow();       // the 1 Hz loop must never feel this
  await j.settled();
  expect(await inner.keys('journal/rec/')).toEqual([]);
  expect(j.buffered).toBe(10);                        // buffered, not dropped
  expect(j.lastError).toContain('disk says no');      // and the UI can say so
  failing = false;
  j.add(brecs(5, 10));
  await j.flush();
  expect(j.lastError).toBeNull();
  const orphan = await recoverOrphan(kv);
  expect(orphan!.fixes).toBe(15);                     // the failed batch landed with the next
});

test('opening after a crash-that-never-discarded starts chunk numbering cleanly', async () => {
  const kv = memKV();
  const first = await openJournal(kv, { day: '2026-07-11' });
  first.add(brecs(20));
  await first.flush();
  // Crash: no discard. The integrator recovered (or dismissed) the orphan; a NEW flight now
  // opens the journal and must own the prefix outright — no dead flight's fixes spliced in.
  const second = await openJournal(kv, META);
  second.add(brecs(10));
  await second.settled();
  expect(await kv.keys('journal/rec/')).toEqual(['journal/rec/000001']);
  const orphan = await recoverOrphan(kv);
  expect(orphan!.fixes).toBe(10);
  expect(orphan!.meta.day).toBe('2026-07-12');
});

test('a rotten meta does not cost the fixes: recovered under 0000-00-00, never today', async () => {
  const kv = memKV();
  const j = await openJournal(kv, META);
  j.add(brecs(10));
  await j.flush();
  // The crash corrupted the label mid-write. The fixes are the flight; they must survive.
  await kv.put('journal/meta', new TextEncoder().encode('{"day": garbage'));
  const orphan = await recoverOrphan(kv);
  expect(orphan!.fixes).toBe(10);
  expect(orphan!.meta.day).toBe('0000-00-00');        // honest as unknown — not an invented today
  expect(parseIGC(orphan!.igc).length).toBe(10);
});

test('meta missing while chunks exist is still a flight, not a null', async () => {
  const kv = memKV();
  const j = await openJournal(kv, META);
  j.add(brecs(10));
  await j.flush();
  await kv.del('journal/meta');
  const orphan = await recoverOrphan(kv);
  expect(orphan).not.toBeNull();
  expect(orphan!.fixes).toBe(10);
  expect(orphan!.meta.day).toBe('0000-00-00');
});
