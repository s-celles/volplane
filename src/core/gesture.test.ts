import { test, expect } from 'bun:test';
import { recogniser, MIN_PAN_PX, type Gesture } from './gesture';

const p = (id: number, x: number, y: number, t: number) => ({ id, x, y, t });

test('A TAP THAT SLID IS NOT A PAN — this is the failure pilots name themselves', () => {
  // Verbatim, from people who fly with these tools: you get one BY ACCIDENT if you "smear" the
  // screen while trying to make a selection in turbulence. The aircraft moved under the finger. A
  // map that panned away from the glider on that is a map that has quietly stopped being about him.
  const g = recogniser();
  g.down(p(1, 100, 100, 0));
  expect(g.move(p(1, 104, 103, 40))).toEqual({ kind: 'none' });   // 5 px: the aircraft moved, not him
  expect(g.move(p(1, 108, 106, 80))).toEqual({ kind: 'none' });   // 10 px: still a jolt
  expect(g.up(p(1, 108, 106, 120))).toEqual({ kind: 'none' });
});

test('and a real drag pans — but only once it has committed, and never by a jump', () => {
  const g = recogniser();
  g.down(p(1, 100, 100, 0));
  // The move that CROSSES the threshold does not itself pan: replaying the 12 px would jump the map
  // at the instant of commitment, which reads as a glitch and is one.
  expect(g.move(p(1, 100, 130, 40))).toEqual({ kind: 'none' });
  expect(g.move(p(1, 100, 150, 80))).toEqual({ kind: 'pan', dxPx: 0, dyPx: 20 });
  expect(g.move(p(1, 110, 150, 120))).toEqual({ kind: 'pan', dxPx: 10, dyPx: 0 });
});

test('once it is a pan, a slow deliberate drag does not STUTTER', () => {
  // The threshold is a gate to pass ONCE, not a floor to clear on every frame. Re-testing it per move
  // would drop every small step of a careful drag and the map would move in lurches.
  const g = recogniser();
  g.down(p(1, 0, 0, 0));
  g.move(p(1, 0, 30, 50));
  g.move(p(1, 0, 40, 100));
  expect(g.move(p(1, 0, 41, 150))).toEqual({ kind: 'pan', dxPx: 0, dyPx: 1 });
});

test('fingers APART is zoom IN — the map gets narrower', () => {
  const g = recogniser();
  g.down(p(1, 100, 100, 0));
  g.down(p(2, 200, 100, 10));            // 100 px apart
  const z = g.move(p(2, 300, 100, 50)) as Extract<Gesture, { kind: 'zoom' }>;   // now 200 px apart
  expect(z.kind).toBe('zoom');
  expect(z.factor).toBeCloseTo(0.5);     // width × 0.5 = zoomed IN
});

test('fingers TOGETHER is zoom out', () => {
  const g = recogniser();
  g.down(p(1, 100, 100, 0));
  g.down(p(2, 300, 100, 10));
  const z = g.move(p(2, 200, 100, 50)) as Extract<Gesture, { kind: 'zoom' }>;
  expect(z.factor).toBeCloseTo(2);
});

test('DOUBLE TAP PUTS IT BACK, and one tap does nothing at all', () => {
  // A single tap on a map is how a pilot rests a finger on the screen. It must cost nothing. The
  // second tap is the decision, and the only decision this gesture makes is `follow me again`.
  const g = recogniser();
  g.down(p(1, 50, 50, 0));
  expect(g.up(p(1, 50, 50, 60))).toEqual({ kind: 'none' });
  g.down(p(1, 52, 51, 200));
  expect(g.up(p(1, 52, 51, 250))).toEqual({ kind: 'reset' });
});

test('two taps far apart in TIME are two taps', () => {
  const g = recogniser();
  g.down(p(1, 50, 50, 0));
  g.up(p(1, 50, 50, 60));
  g.down(p(1, 50, 50, 900));
  expect(g.up(p(1, 50, 50, 950))).toEqual({ kind: 'none' });
});

test('two taps far apart in SPACE are two taps', () => {
  const g = recogniser();
  g.down(p(1, 50, 50, 0));
  g.up(p(1, 50, 50, 60));
  g.down(p(1, 400, 400, 200));
  expect(g.up(p(1, 400, 400, 250))).toEqual({ kind: 'none' });
});

test('a PAN does not end in a tap, however briefly the finger was down', () => {
  // Otherwise a quick flick pans the map and then resets it, and the pilot sees nothing happen.
  const g = recogniser();
  g.down(p(1, 0, 0, 0));
  g.move(p(1, 0, 40, 30));
  g.move(p(1, 0, 80, 60));
  expect(g.up(p(1, 0, 80, 90))).toEqual({ kind: 'none' });
});

test('a finger lifting off a PINCH is not a tap', () => {
  const g = recogniser();
  g.down(p(1, 100, 100, 0));
  g.down(p(2, 200, 100, 10));
  expect(g.up(p(2, 200, 100, 60))).toEqual({ kind: 'none' });
  expect(g.up(p(1, 100, 100, 70))).toEqual({ kind: 'none' });
});

test('a LONG press is not a tap, so it cannot become half a double tap', () => {
  const g = recogniser();
  g.down(p(1, 50, 50, 0));
  expect(g.up(p(1, 50, 50, 900))).toEqual({ kind: 'none' });
  g.down(p(1, 50, 50, 1000));
  expect(g.up(p(1, 50, 50, 1040))).toEqual({ kind: 'none' });   // the FIRST tap never happened
});

test('a cancelled touch is FORGOTTEN, not half-remembered', () => {
  // The browser takes the pointer, or the finger slides off the canvas. A gesture completed by the
  // NEXT touch is how a map ends up somewhere nobody asked for.
  const g = recogniser();
  g.down(p(1, 50, 50, 0));
  g.up(p(1, 50, 50, 50));       // one tap banked
  g.cancel();
  g.down(p(1, 50, 50, 200));
  expect(g.up(p(1, 50, 50, 250))).toEqual({ kind: 'none' });    // no double: the first was forgotten
});

test('MIN_PAN_PX is the number this file exists for', () => {
  // Too small and the map wanders off under a mis-aimed tap. Too large and a deliberate short pan
  // does nothing, the pilot learns the gesture is unreliable, and he stops using it.
  expect(MIN_PAN_PX).toBeGreaterThanOrEqual(8);
  expect(MIN_PAN_PX).toBeLessThanOrEqual(20);
});
