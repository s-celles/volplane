import { test, expect } from 'bun:test';
import { nextPhase, glideBar, PHASE_BOXES, FULL_M, type Phase } from './phase';

const at = (prev: Phase, circling: boolean, arrivalM: number | null): Phase =>
  nextPhase(prev, { circling, arrivalM });

test('circling wins over everything — a glider in a turn is climbing', () => {
  // Whatever else is true of him, the horizon is going round and no arrival number is worth reading.
  expect(at('cruise', true, null)).toBe('circling');
  expect(at('finalGlide', true, 400)).toBe('circling');
});

test('final glide begins the moment the goal is REACHABLE, and that is when the QUESTION changes', () => {
  // Up to here he is hunting for the next climb. From here he is holding a slope. The screen should
  // know that before he has to think about it.
  expect(at('cruise', false, -10)).toBe('cruise');
  expect(at('cruise', false, 0)).toBe('finalGlide');
  expect(at('cruise', false, 350)).toBe('finalGlide');
});

test('AND IT DOES NOT LEAVE AT ZERO — an instrument that changes its mind cannot be read', () => {
  // An arrival height hovering around the reserve would flip the entire screen back and forth at
  // 1 Hz. Fifty metres of hysteresis: once he is on the slope he stays on the final-glide screen
  // until he has genuinely fallen off it — which is exactly when he most needs to see that he has.
  expect(at('finalGlide', false, -20)).toBe('finalGlide');   // still on it, and still says so
  expect(at('finalGlide', false, -49)).toBe('finalGlide');
  expect(at('finalGlide', false, -51)).toBe('cruise');       // genuinely fallen off
});

test('no goal is not a slope — and an unreachable goal is not a negative one', () => {
  // `arrival()` returns NULL when the headwind exceeds the speed to fly: the goal is not far below,
  // it is not reachable at all, and the two are different shapes. Neither is a final glide.
  expect(at('finalGlide', false, null)).toBe('cruise');
  expect(at('cruise', false, null)).toBe('cruise');
});

test('leaving a thermal on the slope goes straight back to final glide', () => {
  // He climbed for it. He should not have to watch the screen decide.
  expect(at('circling', false, 300)).toBe('finalGlide');
  expect(at('circling', false, -200)).toBe('cruise');
});

// ---- the six slots ----

test('SIX SLOTS, ALWAYS SIX, and the phase decides only what STANDS in them', () => {
  // The content changes. The positions do not. A pilot reads an instrument by knowing WHERE a number
  // lives — a layout that reflows under him has taken away the only thing that made it glanceable.
  for (const p of ['circling', 'cruise', 'finalGlide'] as const) {
    expect(PHASE_BOXES[p].length).toBe(6);
  }
});

test('the wind is in all three, because it is the one thing true of the whole flight', () => {
  for (const p of ['circling', 'cruise', 'finalGlide'] as const) {
    expect(PHASE_BOXES[p]).toContain('windSpeed');
  }
});

test('the ARRIVAL HEIGHT is in none of them, and that is the point', () => {
  // It is the hero of the top strip, drawn as a bar with a sign and a colour. A pilot on a marginal
  // final glide should not have to READ.
  for (const p of ['circling', 'cruise', 'finalGlide'] as const) {
    expect(PHASE_BOXES[p]).not.toContain('arrival');
  }
});

// ---- the bar ----

test('the bar is the instrument and the number is the caption', () => {
  expect(glideBar(150)).toEqual({ frac: 0.5, state: 'above' });
  expect(glideBar(-150)).toEqual({ frac: -0.5, state: 'below' });
  expect(glideBar(0)).toEqual({ frac: 0, state: 'above' });   // on the slope, reserve intact: you have it
});

test('a comfortable glide does not draw a bar off the top of the screen', () => {
  // Beyond ±300 m the exact number has stopped mattering: you have it, or you very much do not.
  expect(glideBar(FULL_M * 4)!.frac).toBe(1);
  expect(glideBar(-FULL_M * 4)!.frac).toBe(-1);
});

test('NO GOAL, NO SLOPE, NO BAR — and never a bar at zero', () => {
  // A bar sitting at the centre line would say `you arrive exactly on the reserve`. There is no goal.
  // It would be a picture of a number nobody computed.
  expect(glideBar(null)).toBeNull();
});
