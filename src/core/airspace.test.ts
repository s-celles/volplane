// Airspace, pinned at its edges: the parser's refusal discipline, the two verdicts that must
// never blur (ESP-003), and the worst case an unknown altitude must assume (ESP-005).
import { test, expect } from 'bun:test';
import { parseOpenAir, incursions, LOOKAHEAD_S } from './airspace';

const TMA = `
* a comment
AC D
AN GENEVA TMA 1
AL 3500ft AMSL
AH FL195
DP 46:20:00 N 006:00:00 E
DP 46:20:00 N 006:30:00 E
DP 46:00:00 N 006:30:00 E
DP 46:00:00 N 006:00:00 E
`;

const CTR = `
AC CTR
AN ANNECY CTR
AL SFC
AH 3000ft
V X=45:55:00 N 006:06:00 E
DC 5
`;

test('parseOpenAir: a polygon TMA and a circle CTR, altitudes in metres', () => {
  const { spaces, refused } = parseOpenAir(TMA + CTR);
  expect(refused).toBe(0);
  expect(spaces.length).toBe(2);
  const [tma, ctr] = spaces;
  expect(tma.class).toBe('D');
  expect(tma.floor).toBeCloseTo(3500 * 0.3048, 3);
  expect(tma.ceiling).toBeCloseTo(19500 * 0.3048, 3);
  expect(tma.polygon!.length).toBe(4);
  expect(ctr.floor).toBeNull();                        // SFC: open at the bottom
  expect(ctr.circle!.radiusM).toBeCloseTo(5 * 1852, 6);
});

test('a volume with an unparsable line is refused WHOLE and counted', () => {
  const { spaces, refused } = parseOpenAir('AC D\nAN BROKEN\nAL garbage\nAH FL100\nDP 46:00:00 N 006:00:00 E\nDP 46:10:00 N 006:00:00 E\nDP 46:10:00 N 006:10:00 E\n' + CTR);
  expect(refused).toBe(1);
  expect(spaces.length).toBe(1);                       // the CTR still loads
  expect(spaces[0].name).toBe('ANNECY CTR');
});

test('inside vs predicted are two different verdicts (ESP-002/003)', () => {
  const { spaces } = parseOpenAir(TMA);
  // In the middle of the TMA band, inside the polygon: a fact.
  const now = incursions(spaces, 6.25, 46.17, 2000);
  expect(now.length).toBe(1);
  expect(now[0].kind).toBe('inside');
  // Just west of the boundary, flying east at 30 m/s: 60 s puts us in — a claim.
  const soon = incursions(spaces, 5.985, 46.17, 2000, 90, 30);
  expect(soon.length).toBe(1);
  expect(soon[0].kind).toBe('predicted');
  // Same place flying AWAY: nothing.
  expect(incursions(spaces, 5.985, 46.17, 2000, 270, 30).length).toBe(0);
});

test('below the floor or above the ceiling is not an incursion', () => {
  const { spaces } = parseOpenAir(TMA);
  expect(incursions(spaces, 6.25, 46.17, 800).length).toBe(0);      // under the 3500 ft floor
  expect(incursions(spaces, 6.25, 46.17, 7000).length).toBe(0);     // over FL195
});

test('an UNKNOWN altitude assumes the worst and says so (ESP-005)', () => {
  const { spaces } = parseOpenAir(TMA);
  const inc = incursions(spaces, 6.25, 46.17, null);
  expect(inc.length).toBe(1);                          // vertical test worst-cases to inside
  expect(inc[0].worstCase).toBe(true);                 // and the alert can SAY it is cautious
  const measured = incursions(spaces, 6.25, 46.17, 2000);
  expect(measured[0].worstCase).toBe(false);
});

test('the lookahead is a named constant a pilot-facing setting can cite', () => {
  expect(LOOKAHEAD_S).toBe(60);
});
