// ACQ-010's proof: an IGC file goes in, and what comes out is indistinguishable from an
// instrument — so much so that our own parser is the judge. Round-tripping through parse()
// is the whole test: if the generated sentence has a wrong checksum, a miscounted field or
// sixty minutes in it, the same code that rejects a lying instrument rejects it here.
import { test, expect } from 'bun:test';
import { gga, igcToSentences } from './replay';
import { parse } from './nmea';

const IGC = [
  'AXCT7cf5f292ba0a2708',
  'HFDTEDATE:110726',
  'B1200014700000N00800012EA0148001502',    // 47°00.000'N 8°00.012'E, GPS alt 1502
  'B1200024659999S00759988WA0148101504',    // the other hemispheres
].join('\n');

test('a replayed IGC survives our own parser — checksum, fields and all', () => {
  const [n, s] = igcToSentences(IGC);
  const rn = parse(n)!;
  expect(rn.fix!.sod).toBe(12 * 3600 + 1);
  expect(rn.fix!.lat).toBeCloseTo(47.0, 5);
  expect(rn.fix!.lon).toBeCloseTo(8 + 0.012 / 60, 5);
  expect(rn.fix!.alt).toBeCloseTo(1502, 1);

  const rs = parse(s)!;
  expect(rs.fix!.lat).toBeCloseTo(-(46 + 59.999 / 60), 5);
  expect(rs.fix!.lon).toBeCloseTo(-(7 + 59.988 / 60), 5);
});

test('minutes that round to sixty carry into the degree', () => {
  // 46.99999999° is 46°60.0000' after rounding to four decimals — a sentence our own coord()
  // must reject. The encoder carries instead, and the parser is again the judge.
  const r = parse(gga(8.0, 46.99999999, 1000, 43200));
  expect(r).not.toBeNull();
  expect(r!.fix!.lat).toBeCloseTo(47, 5);
});

test('non-B lines are not sentences, and do not become them', () => {
  expect(igcToSentences('HFDTEDATE:110726\nLXXX some log line')).toEqual([]);
});

test('a replay carries COURSE and SPEED, because a replayed flight must behave like a flight', () => {
  // A B-record has neither, but the course and speed BETWEEN two fixes are real geometry, not an
  // invention — the same numbers a GPS computes from the same movement. Without them a pilot cannot
  // rehearse a track-up screen on the ground, which is half the point of a replay.
  const igc = [
    'HFDTE010100',
    'B0000004403000N00551000E A0100001000',   // 44.05, 5.85
    'B0000104403300N00551000E A0100001000',   // +0.0055° lat in 10 s: due NORTH
  ].join('\n');
  const out = igcToSentences(igc);
  const rmcs = out.filter(s => s.startsWith('$GPRMC'));
  expect(rmcs.length).toBe(1);                 // the first fix has no previous one to measure from
  // course ~000° (due north), and a non-zero speed
  const f = rmcs[0]!.split(',');
  expect(Number(f[8])).toBeCloseTo(0, 0);      // course, degrees
  expect(Number(f[7])).toBeGreaterThan(0);     // speed, knots
});

test('the FIRST fix gets no RMC — course and speed are unknown there, and unknown is not zero', () => {
  const igc = ['HFDTE010100', 'B0000004403000N00551000E A0100001000'].join('\n');
  expect(igcToSentences(igc).filter(s => s.startsWith('$GPRMC')).length).toBe(0);
});
