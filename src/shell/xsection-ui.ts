// ============ the cross-section ahead (ANA-002) ============
// What the map cannot show: what is IN THE WAY. A plan view flattens the one dimension that
// kills — a ridge and a valley look alike from above, and the glide slope that clears one
// buries into the other. This draws the vertical slice straight ahead: the ground, the
// glider's own glide slope over it, and the airspace floors that cut across both.
//
// Pure, like every other renderer here: values in, an SVG string out, no DOM and no fetch.
// The terrain comes through the sampler the whole app shares — so where the DEM has not
// loaded, the profile has a HOLE, drawn as a hole. A cross-section that interpolated across
// unloaded ground would draw a smooth valley where a mountain may be standing.

import type { Airspace } from '../core/airspace';
import type { ElevSampler } from 'soaring-core/ports';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';
import type { T } from './infobox-ui';

export interface XSectionInput {
  lon: number;
  lat: number;
  /** Degrees true — the glider's track: the slice is drawn along where it is GOING, not
   *  where it is pointing. */
  bearing: number;
  altM: number;
  /** How far ahead to slice (m). */
  rangeM: number;
  /** The glide slope to draw over the ground: metres of height lost per metre forward, at the
   *  polar's best glide. Null draws the ground alone — an honest omission, never a flat line
   *  standing in for a slope nobody computed. */
  glideRatio: number | null;
  elev: ElevSampler;
  spaces: readonly Airspace[];
}

const SAMPLES = 120;

/** The slice, as an SVG string. The ground is a filled path with GAPS where the DEM is
 *  unknown; the glide slope is a straight line from the glider; airspace floors crossing the
 *  slice are horizontal bars at their own altitude. */
export function xsectionSvg(input: XSectionInput, t: T, wPx = 480, hPx = 200): string {
  const { lon, lat, bearing, altM, rangeM, glideRatio: ld, elev, spaces } = input;
  const rad = bearing * Math.PI / 180;
  const dLon = Math.sin(rad) / mPerLng(lat), dLat = Math.cos(rad) / M_PER_LAT;

  // Sample the ground ahead. null stays null: the hole is the point.
  const ground: (number | null)[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const d = rangeM * i / SAMPLES;
    ground.push(elev(lon + d * dLon, lat + d * dLat));
  }

  const known = ground.filter((g): g is number => g != null);
  // The vertical window: from a little under the lowest known ground to a little over the
  // glider. With NO known ground at all the window still has to exist — the glider is in it.
  const loM = Math.min(altM, known.length ? Math.min(...known) : altM) - 100;
  const hiM = Math.max(altM, known.length ? Math.max(...known) : altM) + 200;
  const x = (d: number): number => (d / rangeM) * wPx;
  const y = (m: number): number => hPx - ((m - loM) / Math.max(1, hiM - loM)) * hPx;

  // The ground, in runs of known samples — each run its own path, so the gaps stay gaps.
  const paths: string[] = [];
  let run: string[] = [];
  const closeRun = (endIdx: number): void => {
    if (run.length < 2) { run = []; return; }
    const startX = x(rangeM * (endIdx - run.length + 1) / SAMPLES);
    const endX = x(rangeM * endIdx / SAMPLES);
    paths.push(`<path class="ground" d="M ${startX.toFixed(1)} ${hPx} L ${run.join(' L ')} L ${endX.toFixed(1)} ${hPx} Z"/>`);
    run = [];
  };
  ground.forEach((g, i) => {
    if (g == null) { closeRun(i - 1); return; }
    run.push(`${x(rangeM * i / SAMPLES).toFixed(1)} ${y(g).toFixed(1)}`);
  });
  closeRun(SAMPLES);

  // The gaps, named. An unmeasured stretch is not flat ground and must not read as flat
  // ground — it gets a hatch band and the word, because silence here is a lie.
  const unknownCount = ground.filter(g => g == null).length;
  const unknownBand = unknownCount > 0
    ? `<text class="xs-unknown" x="6" y="14">${t('xs.groundUnloaded', {
        pct: Math.round(100 * unknownCount / ground.length),
      })}</text>`
    : '';

  // The glide slope: where the glider will be, if it flies straight and the air does nothing.
  const slope = ld == null ? ''
    : `<line class="slope" x1="0" y1="${y(altM).toFixed(1)}" x2="${wPx}" y2="${y(altM - rangeM / ld).toFixed(1)}"/>`;

  // Airspace floors that cut the slice. Only the FLOOR matters here: it is what a climbing
  // glider hits. A null floor is the surface — nothing to draw, the ground already says it.
  const bars = spaces
    .filter(s => s.floor != null && s.floor > loM && s.floor < hiM)
    .map(s => `<line class="asp-floor" x1="0" y1="${y(s.floor!).toFixed(1)}" x2="${wPx}" y2="${y(s.floor!).toFixed(1)}"/>`
      + `<text class="asp-label" x="4" y="${(y(s.floor!) - 3).toFixed(1)}">${s.class} ${s.name}</text>`)
    .join('');

  return `<svg class="xsection" viewBox="0 0 ${wPx} ${hPx}" width="${wPx}" height="${hPx}">`
    + paths.join('') + bars + slope
    + `<circle class="glider" cx="0" cy="${y(altM).toFixed(1)}" r="4"/>`
    + unknownBand
    + `</svg>`;
}
