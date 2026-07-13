// The logger judged by its own ecosystem: what igclog writes, soaring-core's parseIGC must
// read back fix-for-fix. An encoder tested against its round trip cannot quietly drift from
// the format the scorers speak.
import { test, expect } from 'bun:test';
import { parseIGC, parseIgcHeaders } from 'soaring-core/igc';
import { igcLogger, bRecord, assembleIgc } from './igclog';
import { apply, EMPTY } from './nav';

const cs = (body: string): string => {
  let c = 0;
  for (let i = 1; i < body.length; i++) c ^= body.charCodeAt(i);
  return `${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`;
};
const gga = (t: string, lat: string, latH: string, lon: string, lonH: string, alt: number): string =>
  cs(`$GPGGA,${t},${lat},${latH},${lon},${lonH},1,08,1.0,${alt.toFixed(1)},M,47.0,M,,`);

test('round trip: our B records through the kernel parser, fix for fix', () => {
  const log = igcLogger({ day: '2026-07-12', pilot: 'Test', gliderType: 'ASK 21' });
  let s = EMPTY;
  s = apply(s, gga('120001.00', '4700.0000', 'N', '00800.0120', 'E', 1502), () => null);
  log.add(s);
  s = apply(s, gga('120002.00', '4659.9990', 'S', '00759.9880', 'W', 1504), () => null);
  log.add(s);
  const pts = parseIGC(log.file());
  expect(pts.length).toBe(2);
  expect(pts[0][3]).toBe(12 * 3600 + 1);
  expect(pts[0][1]).toBeCloseTo(47.0, 4);
  expect(pts[0][0]).toBeCloseTo(8 + 0.012 / 60, 4);
  expect(pts[0][2]).toBeCloseTo(1502, 0);
  expect(pts[1][1]).toBeCloseTo(-(46 + 59.999 / 60), 4);
  expect(pts[1][0]).toBeCloseTo(-(7 + 59.988 / 60), 4);
  const h = parseIgcHeaders(log.file());
  expect(h.date).toBe('2026-07-12');
  expect(h.pilot).toBe('Test');
});

test('one record per second, whatever the sentence rate', () => {
  const log = igcLogger({ day: '2026-07-12' });
  let s = EMPTY;
  for (let i = 0; i < 5; i++) {                       // GGA + RMC of the same second, looped
    s = apply(s, gga('120001.00', '4700.0000', 'N', '00800.0000', 'E', 1500 + i), () => null);
    log.add(s);
  }
  expect(log.count()).toBe(1);
});

test('a fix without GPS altitude logs V, not a fake 3D fix', () => {
  const rmc = cs('$GPRMC,120000.00,A,4700.0000,N,00800.0000,E,54.0,090.0,110726,,,A');
  const s = apply(EMPTY, rmc, () => null);
  const rec = bRecord(s)!;
  expect(rec[24]).toBe('V');                          // the validity flag says what we had
});

test('no fix, no record — an empty log is a header, not invented fixes', () => {
  const log = igcLogger({ day: '2026-07-12' });
  log.add(EMPTY);
  expect(log.count()).toBe(0);
  expect(parseIGC(log.file()).length).toBe(0);
});

// ---- the journal's view of the logger (SYS-001/005) ----
// drain() is what the crash journal reads. These tests pin its contract: only the new
// records, no repeats, and no effect whatsoever on the file the pilot downloads.

const feed = (log: ReturnType<typeof igcLogger>, sec: number): void => {
  const t = `12${String(Math.floor(sec / 60)).padStart(2, '0')}${String(sec % 60).padStart(2, '0')}.00`;
  log.add(apply(EMPTY, gga(t, '4700.0000', 'N', '00800.0120', 'E', 1500 + sec), () => null));
};

test('drain hands over only the records since the last drain, and empties on repeat', () => {
  const log = igcLogger({ day: '2026-07-12' });
  feed(log, 1);
  feed(log, 2);
  expect(log.drain().length).toBe(2);
  expect(log.drain()).toEqual([]);                    // nothing new, nothing handed over
  feed(log, 3);
  const next = log.drain();
  expect(next.length).toBe(1);
  expect(next[0]!.startsWith('B1200')).toBe(true);
});

test('draining does not change file() or count() — a reader, not a second writer', () => {
  const log = igcLogger({ day: '2026-07-12' });
  feed(log, 1);
  feed(log, 2);
  const before = log.file();
  log.drain();
  log.drain();
  expect(log.file()).toBe(before);
  expect(log.count()).toBe(2);
});

test('assembleIgc over the concatenated drains rebuilds exactly file()', () => {
  // The recovery invariant itself: chunks journaled between drains, glued back together and
  // assembled, are the SAME file the live logger holds. If this ever breaks, a recovered
  // flight differs from a recorded one.
  const meta = { day: '2026-07-12', pilot: 'Test' };
  const log = igcLogger(meta);
  const chunks: string[][] = [];
  feed(log, 1);
  feed(log, 2);
  chunks.push(log.drain());
  feed(log, 3);
  chunks.push(log.drain());
  const rebuilt = assembleIgc(meta, chunks.flat());
  expect(rebuilt).toBe(log.file());
  expect(parseIGC(rebuilt).length).toBe(3);           // and the kernel parser agrees
});

test('assembleIgc of no records is a bare header — no trailing blank line invented', () => {
  const meta = { day: '2026-07-12' };
  expect(assembleIgc(meta, [])).toBe(igcLogger(meta).file());
  expect(assembleIgc(meta, []).endsWith('HFFTYFRTYPE:VOLPLANE\r\n')).toBe(true);
});
