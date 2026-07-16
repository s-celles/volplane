// The one thing the browser harness could never show me: the canvas actually turning. So it is pinned
// here, as matrix geometry, which is testable where a live canvas in a headless tab is not.

import { test, expect } from 'bun:test';
import { mapTransform, gliderDrawPoint, apply, OVERSCAN } from './maprotate';

const W = 800, H = 600;

test('THE GLIDER STAYS UNDER THE PIVOT — it lands on the canvas centre at every rotation', () => {
  // The pilot's own position is the middle of his moving map, and it may not slide off it as he
  // changes orientation. The glider is drawn at the centre of the overscanned view; wherever the map
  // is turned, that point must map back to the true canvas centre.
  const [gx, gy] = gliderDrawPoint(W, H);
  for (const deg of [0, 15, 90, 179, 270, 359]) {
    const [x, y] = apply(mapTransform(deg * Math.PI / 180, W, H), gx, gy);
    expect(x).toBeCloseTo(W / 2, 6);
    expect(y).toBeCloseTo(H / 2, 6);
  }
});

test('north-up is the identity in every way that matters — the glider is centred, nothing turns', () => {
  const [gx, gy] = gliderDrawPoint(W, H);
  const [x, y] = apply(mapTransform(0, W, H), gx, gy);
  expect(x).toBeCloseTo(W / 2, 6);
  expect(y).toBeCloseTo(H / 2, 6);
});

test('turning the map RIGHT sends "straight ahead" to the upper-right, not to the long way round', () => {
  // A point directly above the glider in draw-space (smaller y) is "ahead". Rotate the map clockwise
  // by 90° and ahead should swing to the RIGHT of centre — a quarter turn, the short way. If the sign
  // were wrong it would swing left, and a track-up map would put the pilot's course behind him.
  const [gx, gy] = gliderDrawPoint(W, H);
  const ahead: [number, number] = [gx, gy - 100];        // 100 px up in the drawn picture
  const [x, y] = apply(mapTransform(Math.PI / 2, W, H), ...ahead);
  expect(x).toBeGreaterThan(W / 2 + 50);                  // swung to the right
  expect(y).toBeCloseTo(H / 2, 4);                        // and level with the centre
});

test('the overscan clears a square turned to 45 degrees', () => {
  // The reason the factor exists: a corner of the true canvas, after the inverse turn, must fall
  // INSIDE the overscanned draw area, or the dark background shows through as a triangle.
  expect(OVERSCAN).toBeGreaterThan(Math.SQRT2);
});
