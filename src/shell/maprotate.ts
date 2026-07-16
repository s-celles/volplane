// ============ CAR-002: turning the canvas, and keeping the glider under the pivot ============
//
// orient.ts decides BY HOW MUCH the map turns. This is the geometry of actually turning it, and it
// is pulled out of the shell into a pure function for one reason: the browser test harness cannot
// feed the replay a fix, so the one thing it could never show me is the canvas pixels rotating. A
// transform I cannot watch is a transform I must be able to TEST, and a 2×3 matrix is testable where
// a live canvas in a headless tab is not.
//
// The problem the overscan solves: a square turned about its centre pulls its own corners inward, and
// the four triangles it uncovers show the dark background through. So the map is drawn OVERSCANNED —
// the same scale over a larger area, F times the canvas — and then turned, so the enlarged picture
// still covers the corners after the rotation. F must exceed √2 (a square turned 45° needs that much
// to cover); 1.5 has margin. North-up passes F = 1 and this whole path is skipped in the shell.
//
// The invariant that must hold, and that the test pins: the GLIDER — drawn at the centre of the
// overscanned view — must land exactly on the canvas centre, whatever the rotation. If it drifts, the
// pilot's own position slides off the middle of his screen as he changes orientation, which is the
// one thing a moving map may never do.

/** F must exceed √2 to cover a square turned to any angle. */
export const OVERSCAN = 1.5;

/** A 2×3 affine transform, in the canvas convention: [a, b, c, d, e, f] maps (x, y) to
 *  (a·x + c·y + e, b·x + d·y + f). */
export type Mat = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Compose two transforms: `apply(mul(m, n), p) === apply(m, apply(n, p))`. `n` is the INNER one —
 *  the last `ctx.translate/rotate` called before drawing, in canvas terms. */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const translate = (dx: number, dy: number): Mat => [1, 0, 0, 1, dx, dy];
/** Canvas rotation: clockwise on screen, because y grows down. */
const rotate = (rad: number): Mat => [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];

/** The transform the shell sets before painting the overscanned map: rotate about the canvas centre,
 *  then shift so the overscanned view is centred on it.
 *
 *  Returned as a matrix rather than applied, so the shell can hand it to `ctx.setTransform(...m)` and
 *  a test can hand it a point. The order is exactly the sequence of `ctx` calls in repaintMap:
 *  translate(c) · rotate · translate(−c) · translate(overscan offset). */
export function mapTransform(rotationRad: number, wPx: number, hPx: number, overscan = OVERSCAN): Mat {
  const cx = wPx / 2, cy = hPx / 2;
  const off = -(overscan - 1) / 2;
  return mul(mul(mul(
    translate(cx, cy),
    rotate(rotationRad)),
    translate(-cx, -cy)),
    translate(off * wPx, off * hPx));
}

/** Where the shell draws the glider: the centre of the OVERSCANNED view. */
export function gliderDrawPoint(wPx: number, hPx: number, overscan = OVERSCAN): [number, number] {
  return [wPx * overscan / 2, hPx * overscan / 2];
}
