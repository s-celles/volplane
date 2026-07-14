// ============ the gestures, and the one that must never fire ============
//
// A button has a size. A gesture does not — and that is the whole argument for using one in a moving
// aircraft. The pilot is being thrown about, one hand is on the stick, and he is looking OUT: the
// screen gets a glance, not a gaze. Flight-deck research puts a usable touch target at 18–22 mm and
// shows the error rate growing EXPONENTIALLY as the target shrinks; vibration alone takes it from
// 10 % to 17 %. A stroke across the map has effectively infinite target size, and none of that
// applies to it.
//
// ---- THE FAILURE MODE PILOTS THEMSELVES NAME ----
//
// From the people who fly with these tools, verbatim: you get one BY ACCIDENT if you "SMEAR" the
// screen while trying to make a selection in turbulence. A tap that slid. The aircraft moved under
// the finger, and the map panned away from the glider — and a pilot who has lost the map without
// noticing is flying with an instrument that has quietly stopped being about him.
//
// So a drag is not a pan until it has travelled far enough to be a DECISION rather than a jolt. That
// is MIN_PAN_PX, and it is the most important number in this file.
//
// ---- and what a gesture may NOT decide ----
//
// This module is pure. It turns pointer events into intentions, and it knows nothing about maps,
// metres or the glider. Whether panning away from the glider is allowed, and what the pilot is told
// when he does, belongs to whoever owns the view — not here.

export interface Pointer {
  /** The pointer's identity. Two of them at once is a pinch; one is a drag or a tap. */
  id: number;
  x: number;
  y: number;
  /** Milliseconds, monotonic. Passed in rather than read, because a recogniser that reads the clock
   *  is a recogniser that cannot be tested. */
  t: number;
}

export type Gesture =
  | { kind: 'none' }
  /** The map should move under the finger, by this many pixels. */
  | { kind: 'pan'; dxPx: number; dyPx: number }
  /** Multiply the map's width by this. < 1 zooms IN. */
  | { kind: 'zoom'; factor: number }
  /** Put it back: follow the glider again, at the default range. */
  | { kind: 'reset' };

const NONE: Gesture = { kind: 'none' };

/** A drag shorter than this is A TAP THAT SLID, not a pan.
 *
 *  It is the guard against the failure the pilots named — smearing the screen while trying to hit
 *  something in turbulence — and 12 px is chosen to sit well above the jitter of a hand on a bumpy
 *  day and well below any movement a person would call a swipe. Too small and the map wanders off
 *  under a mis-aimed tap; too large and a deliberate short pan does nothing, which teaches the pilot
 *  the gesture is unreliable and he stops using it. */
export const MIN_PAN_PX = 12;

/** Two taps closer together than this, in time AND in space, are a double tap. */
const DOUBLE_MS = 350;
const DOUBLE_PX = 40;

/** A press longer than this is not a tap, whatever it did afterwards. */
const TAP_MS = 300;

export interface Recogniser {
  down(p: Pointer): Gesture;
  move(p: Pointer): Gesture;
  up(p: Pointer): Gesture;
  /** The pointer left the surface without a proper up — the browser took it, or the finger slid off
   *  the canvas. Forget everything: a half-remembered gesture completed by the NEXT touch is how a
   *  map ends up somewhere nobody asked for. */
  cancel(): void;
}

export function recogniser(): Recogniser {
  /** Live pointers, by id. Two = pinch. */
  const live = new Map<number, Pointer>();
  /** Where each pointer went down, so a tap can be told from a drag. */
  const start = new Map<number, Pointer>();
  /** The pinch's separation last time we looked. */
  let pinchPx: number | null = null;
  /** Has this touch already committed to being a pan? Once it has, every further move pans — the
   *  threshold is a gate to pass ONCE, not a floor to clear on every frame, or a slow deliberate drag
   *  would stutter. */
  let panning = false;
  /** The last completed tap, for the double. */
  let lastTap: Pointer | null = null;

  const spread = (): number => {
    const [a, b] = [...live.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  return {
    down(p) {
      live.set(p.id, p);
      start.set(p.id, p);
      if (live.size === 2) {
        // A second finger arrives: whatever the first was doing, it is a pinch now.
        pinchPx = spread();
        panning = false;
      }
      return NONE;
    },

    move(p) {
      if (!live.has(p.id)) return NONE;
      const prev = live.get(p.id)!;
      live.set(p.id, p);

      if (live.size === 2 && pinchPx !== null) {
        const now = spread();
        if (now <= 0 || pinchPx <= 0) return NONE;
        const factor = pinchPx / now;      // fingers apart → now > pinchPx → factor < 1 → zoom IN
        pinchPx = now;
        return { kind: 'zoom', factor };
      }

      if (live.size !== 1) return NONE;
      const from = start.get(p.id)!;
      if (!panning) {
        // THE SMEAR GUARD. Until the finger has travelled a real distance, this is a tap that is
        // sliding, and a tap that slides must not move the map.
        if (Math.hypot(p.x - from.x, p.y - from.y) < MIN_PAN_PX) return NONE;
        panning = true;
        // And when it commits, it commits from where the finger IS — not from where it went down.
        // Replaying the threshold distance would make the map jump by 12 px at the moment of
        // commitment, which reads as a glitch and is one.
        return NONE;
      }
      return { kind: 'pan', dxPx: p.x - prev.x, dyPx: p.y - prev.y };
    },

    up(p) {
      const from = start.get(p.id);
      const wasPanning = panning;
      const hadTwo = live.size === 2;
      live.delete(p.id);
      start.delete(p.id);
      if (live.size < 2) pinchPx = null;
      if (live.size === 0) panning = false;

      // A finger lifting off a pinch is not a tap, however briefly it was down.
      if (from === undefined || wasPanning || hadTwo) { lastTap = null; return NONE; }

      const moved = Math.hypot(p.x - from.x, p.y - from.y);
      const held = p.t - from.t;
      if (moved >= MIN_PAN_PX || held > TAP_MS) { lastTap = null; return NONE; }

      // A TAP. Is it the second of two?
      if (lastTap !== null
        && p.t - lastTap.t <= DOUBLE_MS
        && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) <= DOUBLE_PX) {
        lastTap = null;
        return { kind: 'reset' };
      }
      lastTap = p;
      return NONE;
    },

    cancel() {
      live.clear();
      start.clear();
      pinchPx = null;
      panning = false;
      lastTap = null;
    },
  };
}
