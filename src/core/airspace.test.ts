// Airspace, pinned at its edges: the parser's refusal discipline, the two verdicts that must
// never blur (ESP-003), and the worst case an unknown altitude must assume (ESP-005).
import { test, expect } from 'bun:test';
import {
  parseOpenAir, incursions, LOOKAHEAD_S,
  acknowledge, activeIncursions, ackKey, ACK_S,
  type Airspace, type Incursion,
} from './airspace';

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

// ---- arcs (ESP-001: real national files mix DP and DA/DB) ----

// A France-style CTR: a DA arc about a V X= centre closed by a DP corner, the shape most
// LFLB/LFLP-like blocks take.
const CHAMBERY = `
AC D
AN CHAMBERY CTR
AL SFC
AH 3500ft AMSL
V X=45:38:00 N 005:52:48 E
DA 5,270,90
DP 45:30:00 N 005:40:00 E
`;

test('a DA arc mixed with DP parses without refusals and judges the arc side', () => {
  const { spaces, refused } = parseOpenAir(CHAMBERY);
  expect(refused).toBe(0);
  expect(spaces.length).toBe(1);
  // At most 5° per step over a 180° sweep: at least 37 arc vertices, plus the DP corner.
  expect(spaces[0].polygon!.length).toBeGreaterThanOrEqual(38);
  // Due north of the centre, 4.5 NM out: inside the 5 NM arc — a fact.
  const inside = incursions(spaces, 5.88, 45.633333 + 4.5 * 1852 / 111320, 500);
  expect(inside.length).toBe(1);
  expect(inside[0].kind).toBe('inside');
  // Same bearing, 5.5 NM out: beyond the radius — nothing.
  expect(incursions(spaces, 5.88, 45.633333 + 5.5 * 1852 / 111320, 500).length).toBe(0);
});

test('V D=- bends the arc the other way, and the NEXT volume is clockwise again', () => {
  const { spaces, refused } = parseOpenAir(`
AC R
AN CCW ARC
AL SFC
AH FL100
V X=45:00:00 N 006:00:00 E
V D=-
DA 5,0,90
AC R
AN CW AGAIN
AL SFC
AH FL100
V X=46:00:00 N 007:00:00 E
DA 5,0,90
`);
  expect(refused).toBe(0);
  expect(spaces.length).toBe(2);
  // Counter-clockwise from 0 to 90 goes the long way round, THROUGH due west: the arc
  // must pass a vertex 5 NM west of the centre. Clockwise would jump north→east directly.
  const westLon = 6 - 5 * 1852 / (111320 * Math.cos(45 * Math.PI / 180));
  expect(spaces[0].polygon!.some(([x, y]) =>
    Math.abs(x - westLon) < 1e-6 && Math.abs(y - 45) < 1e-6)).toBe(true);
  // Direction reset at the AC flush: the second volume's 0→90 arc stays in the NE
  // quadrant. A leaked '-' would drag it through the west half.
  for (const [x, y] of spaces[1].polygon!) {
    expect(x).toBeGreaterThanOrEqual(7 - 1e-9);
    expect(y).toBeGreaterThanOrEqual(46 - 1e-9);
  }
});

test('DB: the arc ends VERBATIM on the file\'s second coordinate', () => {
  const { spaces, refused } = parseOpenAir(`
AC D
AN DB RING
AL SFC
AH FL100
V X=45:00:00 N 006:00:00 E
DB 45:05:00 N 006:00:00 E, 45:00:00 N 006:07:00 E
`);
  expect(refused).toBe(0);
  const poly = spaces[0].polygon!;
  // The interior is drawn at the first point's radius, starting on the first point…
  expect(poly[0][0]).toBeCloseTo(6, 9);
  expect(poly[0][1]).toBeCloseTo(45 + 5 / 60, 9);
  // …and the last vertex is the second coordinate EXACTLY, so the ring closes on the
  // file's own numbers rather than a re-projection of them.
  expect(poly[poly.length - 1][0]).toBe(6 + 7 / 60);
  expect(poly[poly.length - 1][1]).toBe(45);
});

test('the hemisphere letter may be GLUED to the longitude — a real national file writes it so', () => {
  // Found on the actual French airspace file, and it is not a curiosity: it writes
  //     DP 45:39:57 N00:47:20 W
  // with no space after the N. A parser demanding one refused the volume WHOLE — and the volume
  // it refused was WHISKEY 1 VV, a RESTRICTED area. A stricter regex is not a safer one: it is an
  // airspace the pilot does not see.
  const { spaces, refused } = parseOpenAir(`
AC UNC
AY R
AN WHISKEY 1 VV
AH 4000FT AMSL
AL 3000FT AMSL
DP 45:39:57 N00:47:20 W
DP 45:39:57 N00:33:00 W
DP 45:38:52 N00:34:01 W
`);
  expect(refused).toBe(0);
  expect(spaces.length).toBe(1);
  expect(spaces[0].name).toBe('WHISKEY 1 VV');
  expect(spaces[0].polygon!.length).toBe(3);
  // And the coordinates really were read, not merely accepted: 00:47:20 W is a NEGATIVE longitude.
  expect(spaces[0].polygon![0][0]).toBeCloseTo(-(47 / 60 + 20 / 3600), 6);
  expect(spaces[0].polygon![0][1]).toBeCloseTo(45 + 39 / 60 + 57 / 3600, 6);
  // The spaced spelling still parses identically — the separator is optional, not forbidden.
  const spaced = parseOpenAir(`
AC UNC
AN SPACED
AH 4000FT AMSL
AL 3000FT AMSL
DP 45:39:57 N 000:47:20 W
DP 45:39:57 N 000:33:00 W
DP 45:38:52 N 000:34:01 W
`);
  expect(spaced.refused).toBe(0);
  expect(spaced.spaces[0].polygon![0]).toEqual(spaces[0].polygon![0]);
});

test('a DA with no centre refuses the volume whole; the next volume still loads', () => {
  const { spaces, refused } = parseOpenAir(`
AC D
AN NO CENTRE
AL SFC
AH FL100
DA 5,0,90
` + CTR);
  expect(refused).toBe(1);
  expect(spaces.length).toBe(1);
  expect(spaces[0].name).toBe('ANNECY CTR');
});

// ---- ESP-004: filter and acknowledge, a view over the verdicts ----

const vol = (name: string, cls: string): Airspace =>
  ({ name, class: cls, floor: null, ceiling: null });
const hit = (space: Airspace, kind: 'inside' | 'predicted' = 'inside'): Incursion =>
  ({ space, kind, worstCase: false });

const CHY = vol('CHAMBERY CTR', 'D');
const ANY = vol('ANNECY CTR', 'D');
const GVA = vol('GENEVA E', 'E');

test('an acked space is silent for BOTH verdicts, then alerts again past untilSod', () => {
  const acks = acknowledge([], CHY, 1000);
  const both = [hit(CHY, 'inside'), hit(CHY, 'predicted')];
  expect(activeIncursions(both, null, acks, 1000).length).toBe(0);
  expect(activeIncursions(both, null, acks, 1000 + ACK_S - 1).length).toBe(0);
  // One second past the silence, the volume shouts again — an ack is temporary (ESP-004).
  expect(activeIncursions(both, null, acks, 1000 + ACK_S + 1).length).toBe(2);
  expect(ACK_S).toBe(300);
});

test('an ack names ONE volume: a different space in the same class stays loud', () => {
  const acks = acknowledge([], CHY, 1000);
  const out = activeIncursions([hit(CHY), hit(ANY)], null, acks, 1000);
  expect(out.length).toBe(1);
  expect(out[0].space.name).toBe('ANNECY CTR');
  expect(ackKey(CHY)).not.toBe(ackKey(ANY));
});

test('the class filter drops unmonitored classes, case-insensitively', () => {
  const incs = [hit(CHY), hit(GVA)];
  const kept = activeIncursions(incs, ['d'], [], 0);
  expect(kept.length).toBe(1);
  expect(kept[0].space.class).toBe('D');
});

test('classes === null means the filter is UNKNOWN, and unknown filters NOTHING', () => {
  expect(activeIncursions([hit(CHY), hit(GVA)], null, [], 0).length).toBe(2);
});

test('re-acknowledging extends the silence rather than duplicating the ack', () => {
  const first = acknowledge([], CHY, 1000);
  const again = acknowledge(first, CHY, 1200);
  expect(again.length).toBe(1);
  expect(again[0].untilSod).toBe(1200 + ACK_S);
  expect(activeIncursions([hit(CHY)], null, again, 1400).length).toBe(0);
  expect(activeIncursions([hit(CHY)], null, again, 1200 + ACK_S + 1).length).toBe(1);
});
