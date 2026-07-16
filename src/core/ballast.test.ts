import { test, expect } from 'bun:test';
import { sinkAt, parsePlr, type Polar } from 'soaring-core/polar';
import {
  plrMasses, acceptBallastL, acceptBugsPct, drained, effectivePolar,
  CLEAN_AND_DRY, MAX_BUGS_PCT, WATER_KG_PER_L,
} from './ballast';

// A real ballasted glider: an LS 8-shaped 15 m wing, 350 kg dry gross, 160 litres of water.
const PLR = [
  '* LS 8 — three-point polar',
  '* MassDryGross[kg], MaxWaterBallast[l], V1[km/h], w1[m/s], V2, w2, V3, w3, WingArea[m2]',
  '350, 160, 100, -0.63, 130, -0.85, 170, -1.45, 10.5',
].join('\n');

const REF = parsePlr(PLR, 'LS 8')!;
const REF_MASS = 350;
const AREA = 10.5;

/** The best glide ratio anywhere in the band, and the speed it happens at — the two numbers a pilot
 *  actually flies on, recomputed from the curve rather than trusted from the coefficients. */
const bestGlide = (p: Polar): { ld: number; vMs: number } => {
  let ld = 0, vMs = 0;
  for (let v = p.vMin; v <= p.vMax; v += 0.01) {
    const g = v / -sinkAt(p, v);
    if (g > ld) { ld = g; vMs = v; }
  }
  return { ld, vMs };
};

const at = (b: Partial<Parameters<typeof effectivePolar>[0]> = {}) => effectivePolar({
  polar: REF, refMassKg: REF_MASS, dryMassKg: null, wingAreaM2: AREA, state: CLEAN_AND_DRY, ...b,
})!;

// ---------------------------------------------------------------- what the module REFUSES

test('1600 LITRES INTO A 160-LITRE GLIDER IS A SLIPPED DIGIT, AND IT IS REFUSED, NOT CLAMPED', () => {
  // The whole reason this bound exists. Clamped to 160 the pilot gets back a number that looks like
  // the one he meant and he never learns the box disagreed with him; refused, the box stays empty
  // and he looks at it. Nothing he can type may scale his polar by water that is not aboard.
  expect(acceptBallastL(1600, 160)).toBeNull();
  expect(acceptBallastL(161, 160)).toBeNull();
  expect(acceptBallastL(160, 160)).toBe(160);   // full tanks are not a typo
});

test('a glider whose tank size we do not know may be given no water at all', () => {
  // Without a bound there is nothing to refuse, and an unbounded typo is exactly the failure above.
  // A capacity we invented would be a capacity he is allowed to pour water into.
  expect(acceptBallastL(50, null)).toBeNull();
  expect(acceptBallastL(50, 0)).toBeNull();     // no tanks: an unballasted glider is not a dry one
});

test('negative water, and NaN, are not quantities of water', () => {
  expect(acceptBallastL(-1, 160)).toBeNull();
  expect(acceptBallastL(NaN, 160)).toBeNull();
  expect(acceptBallastL(0, 160)).toBe(0);       // dumped is a legitimate answer, and it is not null
});

test('BUGS MAY NOT MAKE THE WING BETTER THAN THE FACTORY MEASURED IT', () => {
  // The one error in this module that lands SHORT. A wing polished past its own published polar is
  // a final glide computed on a glider that does not exist — so −10 % is refused, not read as 0.
  expect(acceptBugsPct(-10)).toBeNull();
  expect(acceptBugsPct(0)).toBe(0);
  expect(acceptBugsPct(MAX_BUGS_PCT)).toBe(MAX_BUGS_PCT);
  expect(acceptBugsPct(MAX_BUGS_PCT + 1)).toBeNull();   // half the glide gone is not a bug problem
  expect(acceptBugsPct(NaN)).toBeNull();
});

test('a .plr that names no reference mass gives no masses — and therefore no ballast', () => {
  // Every litre in this file is scaled against MassDryGross. Without it there is nothing to scale
  // FROM, and the answer is null rather than some default airframe.
  expect(plrMasses('0, 160, 100, -0.63, 130, -0.85, 170, -1.45, 10.5')).toBeNull();
  expect(plrMasses('* nothing but comments\n')).toBeNull();
  expect(plrMasses('')).toBeNull();
});

test('the masses are read off the SAME line the curve was fitted from', () => {
  // Read them off any other line and you scale one glider's polar by another glider's tank. The
  // line-acceptance rules are parsePlr's, to the letter: comments skipped, eight fields, six finite
  // curve values. A short line is not the polar line, whatever numbers it starts with.
  const decoy = ['; 999, 999', '# 888, 888', '4, 4', PLR].join('\n');
  expect(plrMasses(decoy)).toEqual({ refMassKg: 350, maxBallastL: 160 });
});

test('a glider with no tanks reports 0 litres, not "unknown", and not a plausible tank', () => {
  const dry = plrMasses('350, 0, 100, -0.63, 130, -0.85, 170, -1.45, 10.5');
  expect(dry).toEqual({ refMassKg: 350, maxBallastL: 0 });
  expect(acceptBallastL(1, dry!.maxBallastL)).toBeNull();
});

test('an effective polar is not computed from a mass nobody could have meant', () => {
  // Unreachable through the accept* doors — which is what they are for. Reached anyway (a settings
  // file edited by hand), the honest answer is "no polar", never a polar we chose the numbers of.
  expect(effectivePolar({ polar: REF, refMassKg: 0, dryMassKg: null, wingAreaM2: AREA, state: CLEAN_AND_DRY })).toBeNull();
  expect(effectivePolar({ polar: REF, refMassKg: REF_MASS, dryMassKg: 0, wingAreaM2: AREA, state: CLEAN_AND_DRY })).toBeNull();
  expect(effectivePolar({ polar: REF, refMassKg: REF_MASS, dryMassKg: null, wingAreaM2: AREA, state: { ballastL: -5, bugsPct: 0 } })).toBeNull();
  expect(effectivePolar({ polar: REF, refMassKg: REF_MASS, dryMassKg: null, wingAreaM2: AREA, state: { ballastL: 0, bugsPct: 80 } })).toBeNull();
});

test('a wing of unknown area has NO wing loading — never an infinity, never a zero', () => {
  // Twelve of the 155 library wings have no area. A dash is the true answer (POT-007).
  expect(at({ wingAreaM2: null }).wingLoadingKgM2).toBeNull();
  expect(at({ wingAreaM2: 0 }).wingLoadingKgM2).toBeNull();
  expect(at().wingLoadingKgM2).toBeCloseTo(REF_MASS / AREA, 6);
});

// ---------------------------------------------------------------- the water

test('WATER BUYS SPEED, NOT PERFORMANCE — the best glide RATIO is unchanged, the speed is not', () => {
  // A pilot shown a better L/D after taking water has been told something false. 160 litres on 350
  // kg dry is k = √(510/350) = 1.207: every speed on the curve moves up by 21 %, and the glide he
  // can hold is the same one he had empty.
  const dry = bestGlide(at().polar);
  const wet = bestGlide(at({ state: { ballastL: 160, bugsPct: 0 } }).polar);
  const k = Math.sqrt((350 + 160) / 350);
  expect(wet.ld).toBeCloseTo(dry.ld, 2);
  expect(wet.vMs).toBeCloseTo(dry.vMs * k, 1);
  expect(wet.vMs).toBeGreaterThan(dry.vMs);
});

test('one litre is one kilogram, and the mass is what the polar gets scaled by', () => {
  const e = at({ state: { ballastL: 120, bugsPct: 0 } });
  expect(e.massKg).toBe(350 + 120 * WATER_KG_PER_L);
  expect(e.wingLoadingKgM2).toBeCloseTo(470 / AREA, 6);
});

test('DUMPING THE WATER GIVES BACK THE DRY POLAR EXACTLY — the day died, and he is light again', () => {
  // The scenario the requirement was written for: he filled on the ground, the day collapsed, he
  // pulled the valve. If the computer keeps a trace of the water he no longer has, every speed to
  // fly it gives him for the rest of the flight is too fast.
  const wet = at({ state: { ballastL: 160, bugsPct: 0 } });
  const back = at({ state: { ballastL: 0, bugsPct: 0 } });
  expect(back.polar.A).toBeCloseTo(REF.A, 12);
  expect(back.polar.B).toBeCloseTo(REF.B, 12);
  expect(back.massKg).toBe(350);
  expect(sinkAt(back.polar, 30)).not.toBeCloseTo(sinkAt(wet.polar, 30), 3);   // it really had changed
});

test('the pilot heavier than the book: his dry mass replaces the reference, and the water sits on top', () => {
  // The mass box (CFG-002) says 385 kg dry today; he then takes 100 litres. All-up is 485, not
  // 450 — the two adjustments must compose, or one of them is silently thrown away.
  const e = at({ dryMassKg: 385, state: { ballastL: 100, bugsPct: 0 } });
  expect(e.massKg).toBe(485);
});

test('a ballasted glider does not fly the empty one\'s stall speed', () => {
  // The usable band stretches with the curve. A vMin left behind would let the speed-to-fly ring ask
  // for a speed below the wet glider's stall.
  const wet = at({ state: { ballastL: 160, bugsPct: 0 } });
  expect(wet.polar.vMin).toBeGreaterThan(REF.vMin);
  expect(wet.polar.vMin).toBeCloseTo(REF.vMin * Math.sqrt(510 / 350), 6);
});

// ---------------------------------------------------------------- the flies

test('FLIES COST GLIDE, AND THE GLIDE IS EXACTLY WHAT THE PILOT LOSES', () => {
  // 10 % of bug degradation is a wing that sinks 10 % faster everywhere, so the final glide he can
  // hold is 1/1.1 of the book's. On a 40 km run at 1000 m that is the difference between the field
  // and the fence.
  const clean = bestGlide(at().polar);
  const dirty = bestGlide(at({ state: { ballastL: 0, bugsPct: 10 } }).polar);
  expect(dirty.ld).toBeCloseTo(clean.ld / 1.1, 2);
  expect(dirty.ld).toBeLessThan(clean.ld);
});

test('but flies do NOT move the speed you fly at — a dirty wing changes how far, not where', () => {
  // A and B take the same factor, so the vertex of the curve does not move. Worth knowing at the
  // stick, and worth pinning here: a module that shifted the best-glide speed under a bug figure
  // would be sending the pilot to a speed the physics never asked for.
  const clean = bestGlide(at().polar);
  const dirty = bestGlide(at({ state: { ballastL: 0, bugsPct: 20 } }).polar);
  expect(dirty.vMs).toBeCloseTo(clean.vMs, 1);
});

test('flies sink the glider HARDER, at every speed in the band — the sign is not an accident', () => {
  // Sink is negative. A factor applied with the wrong sign would show the pilot a wing that gets
  // BETTER as it gets dirtier, and he would find out on the last glide.
  const clean = at().polar;
  const dirty = at({ state: { ballastL: 0, bugsPct: 15 } }).polar;
  for (const v of [20, 25, 30, 40, 50]) {
    expect(sinkAt(dirty, v)).toBeLessThan(sinkAt(clean, v));
    expect(sinkAt(dirty, v)).toBeCloseTo(sinkAt(clean, v) * 1.15, 6);
  }
});

test('water AND flies together: he is heavy and he is dirty, and both reach the polar', () => {
  // The realistic afternoon. The two effects commute, and neither is allowed to swallow the other.
  const both = at({ state: { ballastL: 160, bugsPct: 12 } });
  const waterOnly = at({ state: { ballastL: 160, bugsPct: 0 } });
  expect(both.massKg).toBe(510);
  expect(sinkAt(both.polar, 35)).toBeCloseTo(sinkAt(waterOnly.polar, 35) * 1.12, 6);
  expect(bestGlide(both.polar).ld).toBeCloseTo(bestGlide(waterOnly.polar).ld / 1.12, 2);
});

// ---------------------------------------------------------------- the dump valve, and time

test('WE DO NOT KNOW HOW FAST THE TANKS EMPTY, SO WE DO NOT PRETEND TO', () => {
  // soaring-data records no dump rates. A drain rate we made up would show a dry polar to a pilot
  // still carrying 80 kg — telling him he climbs better than he does, in the very minutes he pulled
  // the valve because he was not climbing. With no rate, his litres stand.
  expect(drained(160, 60, null)).toBe(160);
  expect(drained(160, 60, 0)).toBe(160);
  expect(drained(160, 60, NaN)).toBe(160);
});

test('given a rate the pilot actually knows, the litres go down with the clock — which is an argument', () => {
  // Time is passed in, never read: a drain that called Date.now() is a drain nobody can test at the
  // instant that matters.
  expect(drained(160, 60, 1)).toBe(100);
  expect(drained(160, 30, 2)).toBe(100);
  expect(drained(160, 600, 1)).toBe(0);      // the tanks do not go negative
  expect(drained(0, 600, 1)).toBe(0);
  expect(drained(160, -5, 1)).toBe(160);     // time does not run backwards into the tanks
  expect(drained(160, NaN, 1)).toBe(160);
});

test('the flight starts clean and dry, because that is the only state we can defend', () => {
  // Guessing half tanks would put water in an aircraft that has none (POT-007).
  expect(CLEAN_AND_DRY).toEqual({ ballastL: 0, bugsPct: 0 });
  expect(at({ state: CLEAN_AND_DRY }).massKg).toBe(REF_MASS);
});
