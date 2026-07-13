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

// IHM-006: the words arrive through the catalogue, the FACTS do not. SEE_AND_AVOID is still
// imported from the kernel and still asserted equal to the English catalogue entry (i18n.test.ts),
// so the sentence has one source and the French is a real translation of it rather than a second
// promise nobody checked.
//
// CFG-003 reaches the banners too. They used to print metres and kilometres whatever the pilot had
// chosen, a centimetre under InfoBoxes printing feet: two units for one quantity, on the screen
// where he has the least time to notice. The numbers here are the same numbers, formatted by the
// same table — a relative height is an ALTITUDE (metres, or feet if that is what he flies), a range
// to the rock or to the traffic is a DISTANCE.
import type { FlarmStatus, Traffic } from '../core/flarm';
import type { TerrainVerdict } from '../core/terrainalarm';
import { format, formatText, type UnitPrefs } from '../core/units';
import type { T } from './infobox-ui';

/** An unknown renders as an em dash, here as everywhere. A bearing we were not given is not
 *  straight ahead, a distance we were not given is not zero (POT-007). */
const DASH = '—';

/** A relative HEIGHT, signed — the sign is the whole message (he is above you, he is below you),
 *  and format() has no notion of a signed height: rounding a −0.4 m separation to "−0" would be a
 *  minus sign standing in front of nothing. So the magnitude is formatted and the sign put back. */
function signedAltText(m: number, u: UnitPrefs): string {
  const { text, unit } = format(Math.abs(m), 'altitude', u.altitude);
  return `${m < 0 ? '−' : '+'}${text} ${unit}`;
}

/** The threat's direction as a CLOCK, because that is the word a pilot already thinks in and
 *  the only one he can act on without arithmetic: "traffic at two o'clock" turns a head, "+58°"
 *  does not. `bearing` is degrees relative to OWN TRACK — 0 is dead ahead, positive to the
 *  right — so 12 o'clock is straight ahead by construction, and the hour is just the bearing
 *  read on a 30°-per-hour dial.
 *
 *  Null in, null out. There is no default direction: an instrument that gives no bearing has
 *  told us WHERE the threat is not, and inventing "12 o'clock" would send the pilot's eyes to
 *  the one place we have no reason to believe it is. */
export function clockOf(bearing: number | null, t: T): string | null {
  if (bearing == null || !Number.isFinite(bearing)) return null;
  // Round to the nearest hour on a 12-hour dial; 0 h is 12 o'clock, not "0 o'clock".
  const h = ((Math.round(bearing / 30) % 12) + 12) % 12;
  return t('alert.clock', { h: h === 0 ? 12 : h });
}

/** The same direction as a glyph, for the eye that has not read the words yet. Eight arrows is
 *  the resolution an arrow honestly carries at a glance — a 24-way arrow reads as a smudge. */
export function arrowOf(bearing: number | null): string | null {
  if (bearing == null || !Number.isFinite(bearing)) return null;
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const i = ((Math.round(bearing / 45) % 8) + 8) % 8;
  return arrows[i]!;
}

function flarmBanner(f: FlarmStatus | null, u: UnitPrefs, t: T): string {
  // No instrument, or nothing it calls a threat: no banner. A banner that is always there is
  // a banner the eye stops seeing, and the traffic panel (main.ts) already carries the quiet
  // case — with FLM-005's sentence, which belongs to every traffic display, not only to this one.
  if (!f || f.alarm < 1) return '';

  const clock = clockOf(f.bearing, t);
  const arrow = arrowOf(f.bearing);
  // The header names its own units, because "2 o'clock" and "+58°" are the same fact in two
  // languages and a pilot must never have to guess which one he is reading.
  const dir = clock == null || arrow == null
    ? DASH
    : `${arrow} ${clock} (${f.bearing! > 0 ? '+' : ''}${Math.round(f.bearing!)}° ${t('alert.relTrack')})`;

  const vert = f.relVertical == null ? DASH : signedAltText(f.relVertical, u);
  const dist = f.relDistance == null ? DASH : formatText(f.relDistance, 'distance', u.distance, 1);

  // alarm-2 and alarm-3 are two different duties — "he is there" and "turn NOW" — and they
  // already own two different colours in app.css. The class carries the level so they can
  // never be told apart by the words alone.
  return `<div class="alert flarm-alert alarm-${f.alarm}">`
    + `<div class="alert-head">${t('alert.flarm.head', { level: f.alarm })}</div>`
    + `<div class="alert-dir">${t('alert.threat')}: ${dir}</div>`
    + `<div class="alert-detail">${vert} · ${dist}</div>`
    + `<div class="see-avoid">${t('flarm.seeAndAvoid')}</div>`
    + `</div>`;
}

/** What the two causes mean in words. A colour says something is wrong; only the word says
 *  which way out — a ridge is flown AROUND, a glide that reaches the ground is flown SLOWER or
 *  turned back (TER-005's two mistakes). The terrain cause shares its id with the divert panel's
 *  limit word: it is the same rock, and the pilot must not have to learn two names for it. */
const CAUSE_ID: Record<'terrain' | 'glide', string> = {
  terrain: 'lnd.limit.terrain',
  glide: 'alert.cause.glide',
};

function terrainBanner(v: TerrainVerdict, u: UnitPrefs, t: T): string {
  if (v.kind === 'clear') return '';

  if (v.kind === 'unmeasured') {
    // Deliberately NOT an alarm: no `alert` class, no level, no siren word. The cross-section
    // says this same thing in this same voice a few pixels away, and the two must agree — the
    // ground ahead is not loaded, which is an absence of measurement and not a danger. Saying
    // "TERRAIN" here would teach the pilot to discount the word he must not discount.
    // The distance reaches the catalogue ALREADY FORMATTED. The message used to read "beyond {km}
    // km", with the kilometre baked into the sentence — a unit no unit setting could ever reach,
    // living in a translation file. It takes a preformatted {dist} now, and the unit lives where
    // every other unit in this app lives.
    const dist = formatText(v.distanceM, 'distance', u.distance, 1);
    return `<div class="note terrain-note">${t('alert.groundAhead', { dist })}</div>`;
  }

  const tti = v.timeToImpactS == null ? DASH : `${Math.round(v.timeToImpactS)} s`;
  return `<div class="alert terrain-alert alarm-${v.level}">`
    + `<div class="alert-head">${t('alert.terrain.head', { level: v.level })}</div>`
    + `<div class="alert-detail">${t(CAUSE_ID[v.cause])} · ${formatText(v.distanceM, 'distance', u.distance, 1)} · ${tti} ${t('alert.toImpact')}</div>`
    + `</div>`;
}

/** Both banners, in the order they must be read: traffic first. The rock is thirty seconds
 *  away and will still be there after the glider that is thirteen seconds away has passed. */
export function alertsHtml(
  x: { flarm: FlarmStatus | null; terrain: TerrainVerdict }, u: UnitPrefs, t: T,
): string {
  return flarmBanner(x.flarm, u, t) + terrainBanner(x.terrain, u, t);
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
export function trafficPanelHtml(
  f: FlarmStatus | null, pic: readonly Traffic[], u: UnitPrefs, t: T,
): string {
  if (!f) return '';
  const rows = pic.slice(0, 5).map(a => {
    const dist = Math.hypot(a.relNorth, a.relEast);
    const vert = a.relVertical == null ? DASH : signedAltText(a.relVertical, u);
    const climb = a.climbRate == null
      ? ''
      : ` · ${formatText(a.climbRate, 'vario', u.vario)}`;
    return `<div class="traffic-row alarm-${a.alarm}">${a.id} · ${formatText(dist, 'distance', u.distance, 1)} · ${vert}`
      + `${climb}</div>`;
  }).join('');
  // FLM-005 rides whichever of the two is on screen — the banner when there is an alarm, this
  // panel when there is not. Exactly once whenever traffic is shown, and never zero times.
  const seeAvoid = f.alarm >= 1 ? '' : `<div class="see-avoid">${t('flarm.seeAndAvoid')}</div>`;
  return `<div class="flarm alarm-${f.alarm}">`
    + `<div class="flarm-status">${t('flarm.heard', { rx: f.rx })}</div>`
    + rows
    + seeAvoid
    + `</div>`;
}
