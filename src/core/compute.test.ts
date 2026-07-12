// The derived values, each pinned at its honesty edge: a missing input must surface as null,
// and the maths must match the kernel's own answers — nettoAt IS the netto, not our copy.
import { test, expect } from 'bun:test';
import { DEFAULT_POLAR as PL, nettoAt, sinkAt } from 'soaring-core/polar';
import { tasAt, qnhAlt, derive, rollingVario, M_PER_HPA } from './compute';
import { apply, EMPTY } from './nav';

const cs = (body: string): string => {
  let c = 0;
  for (let i = 1; i < body.length; i++) c ^= body.charCodeAt(i);
  return `${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`;
};

test('TAS grows with altitude and is IAS at the surface', () => {
  expect(tasAt(30, 0)).toBeCloseTo(30, 6);
  expect(tasAt(30, 2000)).toBeCloseTo(30 * Math.exp(2000 / (2 * 8435)), 6);
  expect(tasAt(30, 3000)).toBeGreaterThan(tasAt(30, 1000));
});

test('QNH altitude re-bases the 1013.25 assumption, both ways', () => {
  expect(qnhAlt(1500, 1013.25)).toBe(1500);
  expect(qnhAlt(1500, 1023.25)).toBeCloseTo(1500 + 10 * M_PER_HPA, 6);
  expect(qnhAlt(1500, 1003.25)).toBeCloseTo(1500 - 10 * M_PER_HPA, 6);
});

test('derive: the netto is the KERNEL netto at the derived TAS', () => {
  // Through the real front door: an LXWP0 with IAS 110 km/h, baro 1480 m, vario 1.5.
  const s = apply(EMPTY, cs('$LXWP0,Y,110.0,1480.0,1.5,,,,,,090,270,20.0'), () => null, 'condor2');
  const d = derive(s, PL);
  const tas = tasAt(110 / 3.6, 1480);
  expect(d.tas).toBeCloseTo(tas, 9);
  expect(d.netto).toBeCloseTo(nettoAt(PL, 1.5, tas), 9);
  expect(d.netto!).toBeGreaterThan(1.5);       // the glider sinks, so the air does better than the vario
  expect(d.superNetto!).toBeLessThan(d.netto!);
  expect(d.qnhAlt).toBeCloseTo(1480, 9);
});

test('derive: no IAS means no TAS and no netto — not a netto priced on ground speed', () => {
  const s = apply(EMPTY, cs('$GPRMC,120000.00,A,4700.0000,N,00800.0000,E,54.0,090.0,110726,,,A'), () => null);
  const d = derive(s, PL);
  expect(s.groundSpeed).toBeDefined();         // we HAVE a speed — just not the right kind
  expect(d.tas).toBeNull();
  expect(d.netto).toBeNull();
  expect(d.superNetto).toBeNull();
});

test('sanity: kernel sink at 30 m/s is a sane glider number', () => {
  const s = -sinkAt(PL, 30);
  expect(s).toBeGreaterThan(0.4);
  expect(s).toBeLessThan(2);
});

test('rollingVario: null before history, windowed after, replay-identical by seconds', () => {
  const r = rollingVario(30);
  expect(r.average()).toBeNull();
  for (let t = 0; t <= 60; t++) r.add(43200 + t, t < 30 ? 0 : 2);   // 30 s of 0, then 30 s of 2
  // The window holds only the last 30 s: all 2s, plus the boundary sample.
  expect(r.average()!).toBeGreaterThan(1.9);
});
