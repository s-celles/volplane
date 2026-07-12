// The MacCready solver, pinned against its own variational property — not against constants
// that would encode the same mistake twice. If speedToFly really minimises height lost per
// metre gained, then EVERY other speed does worse; the test asks exactly that.
import { test, expect } from 'bun:test';
import { DEFAULT_POLAR as PL, sinkAt, minSink } from 'soaring-core/polar';
import { speedToFly, glideRatio, arrival } from './glide';

const s = (v: number): number => -sinkAt(PL, v);

test('speedToFly minimises the height lost per metre gained — the variational property', () => {
  for (const mc of [0, 0.5, 1, 2, 3]) {
    const vStar = speedToFly(PL, mc);
    const cost = (v: number): number => (s(v) + mc) / v;
    for (let v = PL.vMin; v <= PL.vMax; v += 0.5) {
      expect(cost(vStar)).toBeLessThanOrEqual(cost(v) + 1e-9);
    }
  }
});

test('a higher ring speeds the glider up; rising air slows it down', () => {
  const v0 = speedToFly(PL, 0), v2 = speedToFly(PL, 2);
  expect(v2).toBeGreaterThan(v0);
  expect(speedToFly(PL, 1, 1.5)).toBeLessThan(speedToFly(PL, 1, 0));   // netto up → slow down
  expect(speedToFly(PL, 1, -2)).toBeGreaterThan(speedToFly(PL, 1, 0)); // sink → push through
});

test('MC 0 flies best glide, not min sink — the two classic speeds, in order', () => {
  // Min sink is the vertex of the sink curve; best glide (MC 0) is the tangent from the
  // origin and is ALWAYS faster. A solver that confuses them is wrong by ~15 km/h.
  const v0 = speedToFly(PL, 0);
  const vMinSink = Math.pow(-PL.B / (3 * -PL.A), 0.25);
  expect(v0).toBeGreaterThan(vMinSink);
  expect(-sinkAt(PL, vMinSink)).toBeCloseTo(-minSink(PL), 6);
});

test('the envelope caps the ring', () => {
  expect(speedToFly(PL, 50)).toBe(PL.vMax);    // no ring setting flies past Vne's stand-in
});

test('glide ratio degrades into a headwind and dies at zero groundspeed', () => {
  const v = speedToFly(PL, 0);
  const still = glideRatio(PL, v)!;
  const head = glideRatio(PL, v, 10)!;
  const tail = glideRatio(PL, v, -10)!;
  expect(still).toBeGreaterThan(20);           // an ASK 21 glides better than 1:20
  expect(still).toBeLessThan(40);              // and worse than 1:40 — sanity, not flattery
  expect(head).toBeLessThan(still);
  expect(tail).toBeGreaterThan(still);
  expect(glideRatio(PL, v, v)).toBeNull();     // parked over ground: no ratio, not a huge one
});

test('arrival: reachable, short, and impossible are three different answers', () => {
  // 10 km from 1500 m to a goal at 500 m: comfortably reachable.
  const ok = arrival(PL, 0.5, 1500, 10_000, 500)!;
  expect(ok.height).toBeGreaterThan(0);
  // The same glide priced 40 km out: not enough height — negative, but KNOWN.
  const short = arrival(PL, 0.5, 1500, 40_000, 500)!;
  expect(short.height).toBeLessThan(0);
  // A headwind at the speed to fly: no promise at all. Null, not a large negative.
  expect(arrival(PL, 0.5, 1500, 10_000, 500, 60)).toBeNull();
});

test('the reserve is spent before the answer is given (PLA-005)', () => {
  const bare = arrival(PL, 1, 1500, 10_000, 500)!;
  const belt = arrival(PL, 1, 1500, 10_000, 500, 0, 200)!;
  expect(bare.height - belt.height).toBeCloseTo(200, 9);
});

test('headwind eats the arrival monotonically', () => {
  const hs = [0, 5, 10, 15].map(h => arrival(PL, 1, 2000, 20_000, 500, h)!.height);
  for (let i = 1; i < hs.length; i++) expect(hs[i]).toBeLessThan(hs[i - 1]);
});
