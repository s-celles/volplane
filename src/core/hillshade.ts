// ============ the terrain, shaded (TER-001) ============
// "LÀ OÙ un fichier de relief numérique est chargé, le système DOIT afficher un ombrage
// géoréférencé du relief." The requirement has a hinge in it — *là où un fichier est chargé* —
// and this file is built around that hinge rather than around the pretty picture. A DEM is
// loaded in patches: over some of the map there is ground, over the rest there is nothing yet.
// The rest is a HOLE, exactly as the cross-section draws it (src/shell/xsection-ui.ts): never
// flat ground, never black-as-if-sea. A pilot who mistakes "not loaded" for "flat" is a pilot
// who reads a valley where a ridge is standing.
//
// So this module answers in colours OR in nulls, and nothing else. It knows no canvas: the
// shell turns a cell into a fillRect through Paint2D, which keeps the whole terrain layer
// testable with the recorder and keeps the maths here honest and headless.

import type { ElevSampler } from 'soaring-core/ports';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';

export interface Shade { r: number; g: number; b: number }

export interface ShadeGrid {
  /** Row-major, wCells × hCells. NULL = the DEM has nothing there — the caller MUST paint that
   *  as 'unloaded', not as ground. */
  cells: (Shade | null)[];
  wCells: number;
  hCells: number;
  cellPx: number;
  /** 0…1 — the share of visible cells with no data. The map's honest readiness figure. */
  unknownFraction: number;
}

export interface ShadeView {
  wPx: number;
  hPx: number;
  cellPx: number;
  /** pixel → lon/lat. The shell passes the inverse of liftmap-ui's `project`; core must not
   *  know what a View is. */
  at: (px: number, py: number) => [number, number];
  /** ground metres per pixel — the horizontal step the slope is measured over. */
  mPerPx: number;
}

/** The cartographic convention: light from the north-west, half-way up the sky. It is a lie
 *  about the sun (the real one is never in the north at noon in Europe) and every map has told
 *  it for a century, because a relief lit from the upper-left reads as raised rather than sunk. */
const SUN_DEFAULT = { azDeg: 315, elDeg: 45 };

// A shadowed face must stay legible and a lit one must not blow out to white: the hillshade is
// there to make the shape of the ground readable, not to model radiance. Clamping the factor
// keeps the hypsometric colour — which carries the ALTITUDE, the thing a pilot actually reads —
// recognisable on both flanks of every ridge.
const F_MIN = 0.35;
const F_MAX = 1.15;

/** The hypsometric ramp: valley green through pasture, rock and scree to snow. Interpolated in
 *  RGB, which is not perceptually even but is what every aviation chart does, and matches what
 *  the eye expects of a relief map. */
const STOPS: [number, Shade][] = [
  [0, { r: 0x2f, g: 0x4f, b: 0x34 }],
  [500, { r: 0x6b, g: 0x7f, b: 0x45 }],
  [1000, { r: 0xa8, g: 0x9a, b: 0x5c }],
  [1800, { r: 0x8a, g: 0x6b, b: 0x52 }],
  [2600, { r: 0xb9, g: 0xb2, b: 0xab }],
  [3500, { r: 0xf2, g: 0xf2, b: 0xf2 }],
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** Colour of a bare elevation, before any light falls on it. Below the lowest stop it clamps —
 *  a polder at −4 m is still ground — and above the highest it stays snow. */
export function elevColor(m: number): Shade {
  if (m <= STOPS[0][0]) return { ...STOPS[0][1] };
  for (let i = 1; i < STOPS.length; i++) {
    const [hi, cHi] = STOPS[i];
    if (m <= hi) {
      const [lo, cLo] = STOPS[i - 1];
      const t = (m - lo) / (hi - lo);
      return { r: clamp255(lerp(cLo.r, cHi.r, t)), g: clamp255(lerp(cLo.g, cHi.g, t)), b: clamp255(lerp(cLo.b, cHi.b, t)) };
    }
  }
  return { ...STOPS[STOPS.length - 1][1] };
}

/** A sample that is not a finite number is not a sample. A DEM can hand back a NaN where a tile
 *  decoded badly, and a NaN painted as a colour is an invented ground. */
const sample = (elev: ElevSampler, lon: number, lat: number): number | null => {
  const z = elev(lon, lat);
  return z != null && Number.isFinite(z) ? z : null;
};

/**
 * Shade every cell of the view. The centre sample decides whether the cell is ground at all;
 * the four neighbours decide, when they can, how the light falls on it.
 */
export function shadeGrid(elev: ElevSampler, view: ShadeView, sun = SUN_DEFAULT): ShadeGrid {
  const { wPx, hPx, cellPx, at, mPerPx } = view;
  const wCells = Math.max(0, Math.ceil(wPx / cellPx));
  const hCells = Math.max(0, Math.ceil(hPx / cellPx));

  // The slope is measured over one cell to either side: any shorter and the shading is DEM
  // quantisation noise, any longer and a ridge line is smeared into a hill.
  const stepM = mPerPx * cellPx;
  const zenith = (90 - sun.elDeg) * Math.PI / 180;   // from the vertical, as the illumination formula wants it
  const azR = sun.azDeg * Math.PI / 180;
  const cosZ = Math.cos(zenith);
  const sinZ = Math.sin(zenith);

  const cells: (Shade | null)[] = [];
  let unknown = 0;

  for (let j = 0; j < hCells; j++) {
    for (let i = 0; i < wCells; i++) {
      const [lon, lat] = at((i + 0.5) * cellPx, (j + 0.5) * cellPx);
      const z = sample(elev, lon, lat);
      if (z == null) { cells.push(null); unknown++; continue; }

      const dLon = stepM / Math.max(1e-6, mPerLng(lat));   // degrees of longitude shrink toward the poles
      const dLat = stepM / M_PER_LAT;
      const zE = sample(elev, lon + dLon, lat);
      const zW = sample(elev, lon - dLon, lat);
      const zN = sample(elev, lon, lat + dLat);
      const zS = sample(elev, lon, lat - dLat);

      // The honesty rule, and it is the requirement rather than a nicety. A central difference
      // taken against unloaded ground is not a slope, it is a slope INVENTED at the edge of the
      // data — and it would draw a cliff along the boundary of every DEM tile. Where a neighbour
      // is missing we keep the altitude colour (the centre is real ground, and TER-001 asks us to
      // show it) and light it flat: an honest colour with no relief, rather than relief we made up.
      let f = 1;
      if (zE != null && zW != null && zN != null && zS != null) {
        const dzdx = (zE - zW) / (2 * stepM);
        const dzdy = (zN - zS) / (2 * stepM);
        const slope = Math.atan(Math.hypot(dzdx, dzdy));
        // Aspect = the compass bearing the slope FACES, i.e. the downhill direction: minus the
        // gradient, as an azimuth clockwise from north.
        const aspect = Math.atan2(-dzdx, -dzdy);
        f = cosZ * Math.cos(slope) + sinZ * Math.sin(slope) * Math.cos(azR - aspect);
      }
      f = Math.max(F_MIN, Math.min(F_MAX, f));

      const c = elevColor(z);
      cells.push({ r: clamp255(c.r * f), g: clamp255(c.g * f), b: clamp255(c.b * f) });
    }
  }

  const total = wCells * hCells;
  return { cells, wCells, hCells, cellPx, unknownFraction: total > 0 ? unknown / total : 0 };
}
