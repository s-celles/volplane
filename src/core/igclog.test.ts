// The logger judged by its own ecosystem: what igclog writes, soaring-core's parseIGC must
// read back fix-for-fix. An encoder tested against its round trip cannot quietly drift from
// the format the scorers speak.
import { test, expect } from 'bun:test';
import { parseIGC, parseIgcHeaders } from 'soaring-core/igc';
import { igcLogger, bRecord } from './igclog';
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
