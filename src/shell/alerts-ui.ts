// ============ the two banners that interrupt (FLM-002, FLM-005, TER-008) ============
// The only two things on this screen that are allowed to shout. Everything else on the Fly
// view answers a question the pilot asked; these answer one he did not — and both of them are
// about a thing that is about to hit him.
//
// Pure, like every renderer here (xsection-ui, landables-ui): values in, an HTML string out,
// no DOM and no fetch. So this file never judges. The FLARM level is the instrument's own, the
// terrain verdict is core/terrainalarm's, and neither is re-derived here — a banner that made
// up its own level would be a second, untested alarm sitting on top of the tested one.
//
// The sound is elsewhere (core/alarmtone). This is the eye's half of both alerts, and it must
// stand alone: a pilot flying with the volume down still has to be told.
//
// Two rules it exists to enforce, and they pull the same way:
//   · FLM-005 is a DISPLAY requirement, not a footnote. The see-and-avoid sentence ships with
//     every FLARM alarm, imported verbatim from core/flarm — never retyped, so the day the
//     sentence changes it changes here too or the test dies.
//   · TER-008's hard clause is "LÀ OÙ le relief est chargé". An `unmeasured` verdict is
//     therefore NOT an alarm and must not look like one: no red, no siren word, no danger. It
//     is the same fact the cross-section already prints in its own voice — the ground ahead is
//     not loaded — and dressing an absence of measurement as a threat is how a pilot learns to
//     ignore the threat that is real.

import { SEE_AND_AVOID, type FlarmStatus, type Traffic } from '../core/flarm';
import type { TerrainVerdict } from '../core/terrainalarm';

/** An unknown renders as an em dash, here as everywhere. A bearing we were not given is not
 *  straight ahead, a distance we were not given is not zero (POT-007). */
const DASH = '—';

/** The threat's direction as a CLOCK, because that is the word a pilot already thinks in and
 *  the only one he can act on without arithmetic: "traffic at two o'clock" turns a head, "+58°"
 *  does not. `bearing` is degrees relative to OWN TRACK — 0 is dead ahead, positive to the
 *  right — so 12 o'clock is straight ahead by construction, and the hour is just the bearing
 *  read on a 30°-per-hour dial.
 *
 *  Null in, null out. There is no default direction: an instrument that gives no bearing has
 *  told us WHERE the threat is not, and inventing "12 o'clock" would send the pilot's eyes to
 *  the one place we have no reason to believe it is. */
export function clockOf(bearing: number | null): string | null {
  if (bearing == null || !Number.isFinite(bearing)) return null;
  // Round to the nearest hour on a 12-hour dial; 0 h is 12 o'clock, not "0 o'clock".
  const h = ((Math.round(bearing / 30) % 12) + 12) % 12;
  return `${h === 0 ? 12 : h} o'clock`;
}

/** The same direction as a glyph, for the eye that has not read the words yet. Eight arrows is
 *  the resolution an arrow honestly carries at a glance — a 24-way arrow reads as a smudge. */
export function arrowOf(bearing: number | null): string | null {
  if (bearing == null || !Number.isFinite(bearing)) return null;
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const i = ((Math.round(bearing / 45) % 8) + 8) % 8;
  return arrows[i]!;
}

function flarmBanner(f: FlarmStatus | null): string {
  // No instrument, or nothing it calls a threat: no banner. A banner that is always there is
  // a banner the eye stops seeing, and the traffic panel (main.ts) already carries the quiet
  // case — with FLM-005's sentence, which belongs to every traffic display, not only to this one.
  if (!f || f.alarm < 1) return '';

  const clock = clockOf(f.bearing);
  const arrow = arrowOf(f.bearing);
  // The header names its own units, because "2 o'clock" and "+58°" are the same fact in two
  // languages and a pilot must never have to guess which one he is reading.
  const dir = clock == null || arrow == null
    ? DASH
    : `${arrow} ${clock} (${f.bearing! > 0 ? '+' : ''}${Math.round(f.bearing!)}° rel. track)`;

  const vert = f.relVertical == null
    ? DASH
    : `${f.relVertical > 0 ? '+' : ''}${Math.round(f.relVertical)} m`;
  const dist = f.relDistance == null ? DASH : `${Math.round(f.relDistance)} m`;

  // alarm-2 and alarm-3 are two different duties — "he is there" and "turn NOW" — and they
  // already own two different colours in app.css. The class carries the level so they can
  // never be told apart by the words alone.
  return `<div class="alert flarm-alert alarm-${f.alarm}">`
    + `<div class="alert-head">FLARM — ALARM ${f.alarm}</div>`
    + `<div class="alert-dir">Threat: ${dir}</div>`
    + `<div class="alert-detail">${vert} · ${dist}</div>`
    + `<div class="see-avoid">${SEE_AND_AVOID}</div>`
    + `</div>`;
}

/** What the two causes mean in words. A colour says something is wrong; only the word says
 *  which way out — a ridge is flown AROUND, a glide that reaches the ground is flown SLOWER or
 *  turned back (TER-005's two mistakes). */
const CAUSE_WORD: Record<'terrain' | 'glide', string> = {
  terrain: 'ridge in the way',
  glide: 'glide reaches the ground',
};

function terrainBanner(t: TerrainVerdict): string {
  if (t.kind === 'clear') return '';

  if (t.kind === 'unmeasured') {
    // Deliberately NOT an alarm: no `alert` class, no level, no siren word. The cross-section
    // says this same thing in this same voice a few pixels away, and the two must agree — the
    // ground ahead is not loaded, which is an absence of measurement and not a danger. Saying
    // "TERRAIN" here would teach the pilot to discount the word he must not discount.
    const km = (t.distanceM / 1000).toFixed(1);
    return `<div class="note terrain-note">`
      + `The ground ahead is NOT loaded beyond ${km} km — unmeasured, not clear`
      + `</div>`;
  }

  const tti = t.timeToImpactS == null ? DASH : `${Math.round(t.timeToImpactS)} s`;
  return `<div class="alert terrain-alert alarm-${t.level}">`
    + `<div class="alert-head">TERRAIN — ALARM ${t.level}</div>`
    + `<div class="alert-detail">${CAUSE_WORD[t.cause]} · ${(t.distanceM / 1000).toFixed(1)} km · ${tti} to impact</div>`
    + `</div>`;
}

/** Both banners, in the order they must be read: traffic first. The rock is thirty seconds
 *  away and will still be there after the glider that is thirteen seconds away has passed. */
export function alertsHtml(x: { flarm: FlarmStatus | null; terrain: TerrainVerdict }): string {
  return flarmBanner(x.flarm) + terrainBanner(x.terrain);
}

/** The traffic PICTURE — who is out there, how far, how high. It moved here out of main.ts for
 *  one reason: FLM-005's sentence is shared between this panel and the banner above, and a rule
 *  about "exactly once" that is spread across two files is a rule that holds until someone edits
 *  one of them. Here, both halves are pure and one test can pin the pair.
 *
 *  It does NOT restate the alarm. A fact worth interrupting the pilot for gets exactly one voice
 *  on the screen: two spellings of "ALARM 2" a centimetre apart are not twice the warning, they
 *  are one warning the pilot has to reconcile mid-turn. The banner shouts the level; the rows
 *  keep its colour, because "which of these five is the one shouting" is the question the banner
 *  cannot answer and this panel can.
 *
 *  Drawn only once a FLARM has spoken. A permanently empty traffic panel teaches the eye to skip
 *  that strip of screen, and the eye keeps skipping on the day it fills. */
export function trafficPanelHtml(f: FlarmStatus | null, pic: readonly Traffic[]): string {
  if (!f) return '';
  const rows = pic.slice(0, 5).map(t => {
    const dist = Math.hypot(t.relNorth, t.relEast);
    const vert = t.relVertical == null
      ? DASH
      : `${t.relVertical > 0 ? '+' : ''}${t.relVertical.toFixed(0)} m`;
    return `<div class="traffic-row alarm-${t.alarm}">${t.id} · ${(dist / 1000).toFixed(1)} km · ${vert}`
      + `${t.climbRate != null ? ` · ${t.climbRate.toFixed(1)} m/s` : ''}</div>`;
  }).join('');
  // FLM-005 rides whichever of the two is on screen — the banner when there is an alarm, this
  // panel when there is not. Exactly once whenever traffic is shown, and never zero times.
  const seeAvoid = f.alarm >= 1 ? '' : `<div class="see-avoid">${SEE_AND_AVOID}</div>`;
  return `<div class="flarm alarm-${f.alarm}">`
    + `<div class="flarm-status">FLARM — ${f.rx} heard</div>`
    + rows
    + seeAvoid
    + `</div>`;
}
