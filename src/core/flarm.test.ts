// FLARM sentences from the wild (the FTD-012 dataport spec's own examples, checksummed),
// through the same refusal discipline as every sentence: malformed is null, never half a threat.
import { test, expect } from 'bun:test';
import {
  parsePflau, parsePflaa, trafficStore, freshStatus, SEE_AND_AVOID, TRAFFIC_TTL_S,
} from './flarm';

const cs = (body: string): string => {
  let c = 0;
  for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i);
  return `$${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`;
};

test('PFLAU: the loudest threat, read whole', () => {
  const s = parsePflau(cs('PFLAU,3,1,2,1,2,-30,2,-32,755'), 43200)!;
  expect(s.rx).toBe(3);
  expect(s.alarm).toBe(2);
  expect(s.bearing).toBe(-30);
  expect(s.relVertical).toBe(-32);
  expect(s.relDistance).toBe(755);
});

test('PFLAU with no alarm carries no bearing — null, not zero degrees', () => {
  const s = parsePflau(cs('PFLAU,2,1,2,1,0,,0,,,'), 43200)!;
  expect(s.alarm).toBe(0);
  expect(s.bearing).toBeNull();          // "dead ahead" and "no threat" must never share a value
});

test('PFLAA: one aircraft of the picture, and the store ages it out', () => {
  const t = parsePflaa(cs('PFLAA,0,-1234,1234,220,2,DD8F12,180,,30,-1.4,1'), 43200)!;
  expect(t.relNorth).toBe(-1234);
  expect(t.relEast).toBe(1234);
  expect(t.id).toBe('DD8F12');
  expect(t.climbRate).toBe(-1.4);

  const store = trafficStore();
  store.add(t);
  expect(store.picture(43201).length).toBe(1);
  expect(store.picture(43200 + TRAFFIC_TTL_S + 1).length).toBe(0);   // silence means gone
});

test('the picture sorts loudest first, then nearest', () => {
  const store = trafficStore();
  store.add(parsePflaa(cs('PFLAA,0,-5000,0,0,2,FAR,0,,25,0.0,1'), 100)!);
  store.add(parsePflaa(cs('PFLAA,2,-800,0,0,2,LOUD,0,,25,0.0,1'), 100)!);
  store.add(parsePflaa(cs('PFLAA,0,-300,0,0,2,NEAR,0,,25,0.0,1'), 100)!);
  expect(store.picture(101).map(t => t.id)).toEqual(['LOUD', 'NEAR', 'FAR']);
});

test('a bad checksum or a placeless threat is refused whole (ACQ-005)', () => {
  expect(parsePflau('$PFLAU,3,1,2,1,2,-30,2,-32,755*00', 100)).toBeNull();
  expect(parsePflaa(cs('PFLAA,2,,,220,2,XX,,,,,'), 100)).toBeNull();
});

test('FLM-005 is a sentence the screen can quote, not a comment', () => {
  expect(SEE_AND_AVOID).toContain('does not replace looking out');
});

// An alarm nobody can retract is an alarm the pilot learns to ignore. The instrument's own
// judgement is a claim about the next few seconds, so it ages exactly as the picture it judges:
// a FLARM that stops speaking mid-alarm must fall silent, not warble for the rest of the flight.
test('a FLARM that stops speaking mid-alarm is AGED OUT, never left standing', () => {
  const st = parsePflau(cs('PFLAU,3,1,2,1,3,-30,2,-32,755'), 43200)!;
  expect(st.alarm).toBe(3);
  expect(st.at).toBe(43200);

  // Still speaking: the alarm stands, as it must.
  expect(freshStatus(st, 43201)?.alarm).toBe(3);
  expect(freshStatus(st, 43200 + TRAFFIC_TTL_S)?.alarm).toBe(3);
  // The cable comes out, the FLARM goes quiet, the fixes keep coming. There is no evidence for
  // the alarm any more — and no PFLAU will ever arrive to withdraw it.
  expect(freshStatus(st, 43200 + TRAFFIC_TTL_S + 1)).toBeNull();
  expect(freshStatus(st, 43200 + 600)).toBeNull();
  // A clock that jumped backwards is a different flight: last flight's threat is not this one's.
  expect(freshStatus(st, 32000)).toBeNull();
  expect(freshStatus(null, 43200)).toBeNull();
});
