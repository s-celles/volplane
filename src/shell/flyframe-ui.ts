// ============ the frame: the one question, and the bar that answers it ============
//
// Every mature soaring computer converges on the same answer, and this app had none of it.
//
//   · the MAP takes 70–85 % of the pixels
//   · the numbers live in a FIXED FRAME the pilot never has to search
//   · the ARRIVAL HEIGHT AT THE GOAL is the hero — the single most-read number in the sport
//   · glide state is a BAR, a SIGN and a COLOUR, redundantly, because a sun-washed screen eats one
//     of the three and a pilot in turbulence reads a direction faster than he reads three digits
//
// What this app did instead: the map went LAST, under nine stacked blocks of text — the tabs, nine
// infoboxes, the goal hint, the alerts, the traffic panel, the airspace list, the task panel, THE
// LIST OF LANDABLE FIELDS, and the link status. The map got whatever was left. The arrival height was
// a 1.6 rem number in a 0.7 rem-labelled box, on one page out of three, and to see it the pilot had
// to tap a tab — in a thermal.
//
// This file is the frame. It is pure: it takes numbers and returns HTML, and it knows nothing about
// the DOM, the canvas, or the clock.

import { formatText, type UnitPrefs } from '../core/units';
import { glideBar, type Phase } from '../core/phase';

export type T = (id: string, params?: Record<string, string | number>) => string;

export interface Hero {
  /** What the pilot is flying at — the goal's name, or null when he has not set one. */
  goalName: string | null;
  /** Metres to it, great-circle. Null when there is no goal. */
  distM: number | null;
  /** Height above it on arrival, RESERVE ALREADY SPENT. Null when there is no goal, or when the
   *  maths cannot promise an arrival at all (headwind ≥ speed to fly) — which is not the same as a
   *  large negative number, and must not be drawn as one. */
  arrivalM: number | null;
  /** Which phase the screen is in, so the pilot can see WHY a number changed identity under him. */
  phase: Phase;
  /** The fix has aged out. The numbers stay on screen — a value is not erased under a pilot mid-turn
   *  — but they stop pretending to be current. */
  stale: boolean;
}

/** The top strip: the goal, the distance, and the arrival height.
 *
 *  THE ARRIVAL HEIGHT CARRIES ITS SIGN. `+410` and `−410` are two different flights, and a bare
 *  `410` beside a red bar is a number that needs a second glance to interpret. The sign is written,
 *  the colour is set, and the bar points. Three channels for one fact, because a screen in direct
 *  sunlight will lose one of them. */
export function heroHtml(h: Hero, units: UnitPrefs, t: T): string {
  const phase = `<span class="hero-phase" title="${t(`phase.${h.phase}.title`)}">${t(`phase.${h.phase}`)}</span>`;

  if (h.goalName === null) {
    // NO GOAL IS NOT A FAILURE, and it must not look like one. A pilot local-soaring has no goal and
    // wants none; an empty strip that says `— — —` would be an instrument reporting a fault.
    return `<div class="hero no-goal">${phase}<span class="hero-none">${t('hero.noGoal')}</span></div>`;
  }

  const bar = glideBar(h.arrivalM);
  const state = bar === null ? 'unknown' : bar.state;
  const arrival = bar === null
    // The goal exists and the glide cannot be priced: the headwind is at or above the speed to fly.
    // That is UNKNOWN, not `very negative`, and this is the one place a dash is the honest character.
    ? `<span class="hero-arrival unknown">—</span>`
    : `<span class="hero-arrival ${state}">${h.arrivalM! >= 0 ? '+' : '−'}${
        formatText(Math.abs(h.arrivalM!), 'altitude', units.altitude)}</span>`;

  return `
    <div class="hero ${state}${h.stale ? ' stale' : ''}">
      ${phase}
      <span class="hero-goal">${h.goalName}</span>
      <span class="hero-dist">${h.distM === null ? '—' : formatText(h.distM, 'distance', units.distance)}</span>
      ${arrival}
    </div>`;
}

/** The glide bar, standing up the left edge of the map.
 *
 *  It fills FROM THE CENTRE LINE: upward and green when the goal is made, downward and red when it is
 *  not. The centre line is the reserve — not the ground — so `on the line` already means `arriving
 *  with the reserve still in hand`, which is the only definition of arriving that is any use.
 *
 *  Chevrons every fifth of the bar, so the pilot can read a TREND in peripheral vision without
 *  reading a length: two chevrons becoming one is a glide going away, and he will see it before he
 *  has decided to look. */
export function glideBarHtml(arrivalM: number | null, t: T): string {
  const bar = glideBar(arrivalM);
  if (bar === null) {
    // No goal, no slope, no bar. An empty rail rather than a bar sitting at zero: a bar at the centre
    // line would say `you arrive exactly on the reserve`, which is a picture of a number nobody
    // computed.
    return `<div class="glidebar empty" title="${t('hero.noGoal')}"><div class="glidebar-rail"></div></div>`;
  }
  const pct = Math.abs(bar.frac) * 50;
  const style = bar.state === 'above'
    ? `bottom:50%;height:${pct}%`
    : `top:50%;height:${pct}%`;
  return `
    <div class="glidebar ${bar.state}" title="${t('hero.glideBar.title')}">
      <div class="glidebar-rail">
        <div class="glidebar-fill ${bar.state}" style="${style}"></div>
        <div class="glidebar-zero"></div>
      </div>
    </div>`;
}
