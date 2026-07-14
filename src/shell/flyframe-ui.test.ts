import { test, expect } from 'bun:test';
import { translator } from '../core/i18n';
import { DEFAULT_UNITS } from '../core/units';
import { heroHtml, glideBarHtml } from './flyframe-ui';

const t = translator('en');
const hero = (o: Partial<Parameters<typeof heroHtml>[0]> = {}) =>
  heroHtml({ goalName: 'GOAL', distM: 32_000, arrivalM: 410, phase: 'finalGlide', stale: false, ...o },
    DEFAULT_UNITS, t);

test('THE ARRIVAL HEIGHT CARRIES ITS SIGN, ITS COLOUR AND ITS BAR — three channels, one fact', () => {
  // A screen in direct sunlight will lose one of the three, and a pilot in turbulence reads a
  // direction faster than he reads three digits. A bare `410` beside a red bar needs a second glance
  // to interpret, and a second glance is what the whole design exists to buy back.
  expect(hero({ arrivalM: 410 })).toContain('+410');
  expect(hero({ arrivalM: 410 })).toContain('hero-arrival above');
  expect(hero({ arrivalM: -410 })).toContain('−410');
  expect(hero({ arrivalM: -410 })).toContain('hero-arrival below');
});

test('NO GOAL IS NOT A FAILURE, and it must not look like one', () => {
  // A pilot local-soaring has no goal and wants none. A strip full of `— — —` would be an instrument
  // reporting a fault it does not have.
  const h = hero({ goalName: null });
  expect(h).toContain('no goal');
  expect(h).not.toContain('hero-arrival');
});

test('an UNREACHABLE goal is not a very negative one', () => {
  // arrival() returns NULL when the headwind is at or above the speed to fly: the goal is not far
  // below, it cannot be priced at all. That is the one place a dash is the honest character.
  const h = hero({ arrivalM: null });
  expect(h).toContain('hero-arrival unknown');
  expect(h).toContain('—');
  expect(h).not.toContain('+');
});

test('the PHASE is written on the screen, because a number that changed identity must say why', () => {
  expect(hero({ phase: 'circling' })).toContain('CLIMB');
  expect(hero({ phase: 'cruise' })).toContain('CRUISE');
  expect(hero({ phase: 'finalGlide' })).toContain('FINAL GLIDE');
});

test('a dead fix is not erased under a pilot mid-turn — it stops PRETENDING to be current', () => {
  expect(hero({ stale: true })).toContain('stale');
});

// ---- the bar ----

test('the bar fills UPWARD and green when the goal is made, DOWNWARD and red when it is not', () => {
  expect(glideBarHtml(150, t)).toContain('glidebar-fill above');
  expect(glideBarHtml(150, t)).toContain('bottom:50%');
  expect(glideBarHtml(-150, t)).toContain('glidebar-fill below');
  expect(glideBarHtml(-150, t)).toContain('top:50%');
});

test('NO GOAL, NO BAR — an empty rail, never a bar sitting at the centre line', () => {
  // A bar at the centre would say `you arrive exactly on the reserve`. There is no goal. It would be
  // a picture of a number nobody computed.
  const b = glideBarHtml(null, t);
  expect(b).toContain('glidebar empty');
  expect(b).not.toContain('glidebar-fill');
});
