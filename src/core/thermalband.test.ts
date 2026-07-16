import { test, expect } from 'bun:test';
import { thermalBand, SLICE_M, MIN_SLICE_S, MAX_GAP_S } from './thermalband';

/** n one-second fixes of a spiral, climbing (or sinking) at a constant rate. Returns where it ends. */
const spiral = (
  b: ReturnType<typeof thermalBand>, t0: number, alt0: number, rateMs: number, n: number,
): { t: number; alt: number } => {
  for (let k = 0; k <= n; k++) b.add(t0 + k, alt0 + rateMs * k, true);
  return { t: t0 + n, alt: alt0 + rateMs * n };
};

/** The same, wings level: this is the glide, and NONE of it is evidence about the air. */
const glide = (
  b: ReturnType<typeof thermalBand>, t0: number, alt0: number, rateMs: number, n: number,
): { t: number; alt: number } => {
  for (let k = 0; k <= n; k++) b.add(t0 + k, alt0 + rateMs * k, false);
  return { t: t0 + n, alt: alt0 + rateMs * n };
};

const at = (b: ReturnType<typeof thermalBand>, baseM: number) =>
  b.slices().find(s => s.baseM === baseM);

test('A SLICE CLIPPED FOR THREE SECONDS HAS NO AVERAGE — and it is not 0.0 m/s either', () => {
  // The top three seconds of a climb through slice 900–1000 is two GPS altitudes divided by 3 s:
  // an average with an error bar of ±2 m/s. Printed as a number it looks exactly like a reading,
  // and the pilot would fly to that height. If this rule went, the band would recommend altitudes
  // where nothing ever climbed.
  const b = thermalBand();
  spiral(b, 0, 996.5, 1, 3);            // midpoints 997…999.5: three seconds inside slice 9
  const s = at(b, 900);
  expect(s?.avgMs).toBeNull();
  // and the time IS shown, so a human reading the dash can see why it is a dash
  expect(s?.timeS).toBe(3);
  expect(b.best()).toBeNull();
});

test('THE GLIDE IS NOT EVIDENCE — a cruise through the whole band leaves it empty', () => {
  // A glider crossing a slice at −1.5 m/s is measuring its own polar, not the day. Mix the cruise in
  // and every slice reads "sink", the pilot is told the band is dead, and the one thing he wanted to
  // know is buried under a number he already had on his placard.
  const b = thermalBand();
  glide(b, 0, 2000, -1.5, 600);         // ten minutes down through nine slices
  expect(b.slices()).toEqual([]);
  expect(b.best()).toBeNull();
});

test('THE PULL-UP INTO THE THERMAL IS NOT LIFT — the entry step is thrown away', () => {
  // Twenty knots traded for thirty metres in a second. Billed to a slice, that is +30 m/s of "air".
  // One of those in a thin slice and the band points at a height where the glider zoomed, not climbed.
  const b = thermalBand();
  glide(b, 0, 1000, 0, 5);              // wings level at 1000 m
  b.add(6, 1030, true);                 // rolls in, +30 m in one second: stored energy, not air
  spiral(b, 7, 1031, 1, 60);            // then a genuine 1 m/s climb, 1031 → 1091
  const s = at(b, 1000);
  expect(s?.timeS).toBe(61);            // the entry second is gone: 61 s of spiral, not 62
  expect(s?.gainM).toBeCloseTo(61, 3);  // and so are its thirty metres — 61 m climbed, not 91
  expect(s?.avgMs).toBeCloseTo(1.0, 3); // it would read 1.47 m/s if the zoom were counted as air
});

test('A HOLE IN THE FIXES IS NOT BRIDGED — sixty seconds of nothing is not sixty seconds of climb', () => {
  // The receiver lost the sky under a wing. We know the glider was circling before and after, and
  // nothing about what happened in between: it may have centred, it may have left and come back.
  // Crediting the whole height change to the slice the midpoint fell in invents a measurement.
  const b = thermalBand();
  b.add(0, 1000, true);
  b.add(60, 1100, true);                // gap of 60 s ≫ MAX_GAP_S
  expect(b.slices()).toEqual([]);
  // and the accumulator picks straight back up afterwards, on the fixes it can actually see
  spiral(b, 61, 1101, 1, 40);
  expect(at(b, 1100)?.timeS).toBe(41);   // 40 s of spiral + the one second that closes the hole
  expect(MAX_GAP_S).toBe(10);
});

test('a slice that SANK reports its negative average — hiding it would be the lie', () => {
  // Circles that go down at that height are a fact, and a fact the pilot must be told: it is where
  // the day has a hole in it. Only "no data" is a dash.
  const b = thermalBand();
  spiral(b, 0, 1250, -0.5, 60);         // sixty seconds of sinking circles inside slice 12
  expect(at(b, 1200)?.avgMs).toBeCloseTo(-0.5, 3);
});

test('THE LADDER HAS NO MISSING RUNGS — an unvisited slice comes back EMPTY, not absent', () => {
  // Two climbs, one low and one high, nothing circled in between. If the middle slices simply did
  // not appear, the ladder would read as a short band rather than an unexplored one, and the pilot
  // would draw his inversion three hundred metres too low.
  const b = thermalBand();
  spiral(b, 0, 1000, 1, 60);            // slice 10
  glide(b, 100, 1400, 0, 5);            // gets there without circling (a ridge run, a tow, whatever)
  spiral(b, 200, 1400, 1, 60);          // slice 14
  const l = b.slices();
  expect(l.map(s => s.baseM)).toEqual([1000, 1100, 1200, 1300, 1400]);
  for (const base of [1100, 1200, 1300]) {
    const s = at(b, base);
    expect(s?.avgMs).toBeNull();        // never 0: nobody has been there
    expect(s?.timeS).toBe(0);
  }
  expect(at(b, 1400)?.avgMs).toBeCloseTo(1.0, 3);
});

test('the whole DAY goes into a slice, not the last thermal — two climbs average together', () => {
  // This is what makes it a band and not a variometer: the same height, revisited an hour later,
  // weighted by the time actually spent there.
  const b = thermalBand();
  spiral(b, 0, 1000, 1, 40);            // 40 s at 1 m/s inside slice 10 → +40 m
  glide(b, 200, 1040, -1, 40);          // back down, wings level: contributes nothing
  spiral(b, 300, 1000, 3, 20);          // 20 s at 3 m/s in the same slice → +60 m
  const s = at(b, 1000);
  expect(s?.timeS).toBe(60);
  expect(s?.gainM).toBeCloseTo(100, 3);
  expect(s?.avgMs).toBeCloseTo(100 / 60, 3);   // time-weighted, not a mean of the means (2 m/s)
});

test('BEST() IS NULL UNTIL A SLICE HAS EARNED AN AVERAGE — it never falls back on a plausible height', () => {
  const b = thermalBand();
  expect(b.slices()).toEqual([]);
  expect(b.best()).toBeNull();
  spiral(b, 0, 1000, 1, MIN_SLICE_S - 2);      // 28 s: under the floor, whatever it read
  expect(b.best()).toBeNull();
  spiral(b, 100, 1000, 1, MIN_SLICE_S);        // now one slice has 30 s
  expect(b.best()?.baseM).toBe(1000);
});

test('best() is the strongest slice, and on a tie the LOWER one — height you gain nothing by paying for', () => {
  const b = thermalBand();
  spiral(b, 0, 1000, 1, 200);          // 1000 → 1200 at a flat 1 m/s: slices 10 and 11 tie exactly
  expect(b.best()?.baseM).toBe(1000);
  spiral(b, 400, 1300, 2.5, 60);       // now slice 13 beats them both
  expect(b.best()?.baseM).toBe(1300);
  expect(b.best()?.avgMs).toBeCloseTo(2.5, 3);
  expect(b.best()?.topM).toBe(1300 + SLICE_M);
});

test('A CLOCK THAT GOES BACKWARDS IS A DIFFERENT FLIGHT — yesterday`s band does not survive into today', () => {
  // Replay an afternoon log (sod ≈ 50000), then plug the instrument in the next morning (sod ≈ 32000).
  // A band that kept accumulating would show yesterday's inversion, in plain measured styling, as
  // today's. circling.ts resets on exactly this fix; so does this.
  const b = thermalBand();
  spiral(b, 50000, 1000, 2, 60);
  expect(b.best()?.baseM).toBe(1000);
  spiral(b, 32000, 1800, 1, 60);
  expect(b.slices().map(s => s.baseM)).toEqual([1800]);
  expect(b.best()?.baseM).toBe(1800);
});

test('a corrupt fix does not blow the ladder open', () => {
  // An uninitialised altitude field (or a NaN out of a bad NMEA sentence) would otherwise become a
  // slice index, and slices() would walk from sea level to the exosphere building empty rungs.
  const b = thermalBand();
  spiral(b, 0, 1000, 1, 60);
  b.add(100, NaN, true);
  b.add(101, 9e9, true);
  b.add(102, 1101, true);
  expect(b.slices().map(s => s.baseM)).toEqual([1000]);
});
