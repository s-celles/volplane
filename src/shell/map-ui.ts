// ============ the moving map (CAR) ============
// One canvas: where am I, where may I not fly, who is near me, how far does the height in
// hand reach. Same painter discipline as the lift map: pure function of its inputs, testable
// with a recording context, and the glide range wears its honesty in its label — it is a
// STILL-AIR estimate off the polar, not a promise about the valley's sink.

import { project, type Paint2D, type View } from './liftmap-ui';
import type { NavState } from '../core/nav';
import type { Airspace } from '../core/airspace';
import type { Traffic } from '../core/flarm';
import type { ReachRay } from '../core/reach';
import { shadeGrid, type ShadeGrid, type ShadeView } from '../core/hillshade';
import type { Alternate } from '../core/landables';
import type { ElevSampler } from 'soaring-core/ports';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';

export interface MapPaint2D extends Paint2D {
  strokeStyle: string;
  lineWidth: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  stroke(): void;
  fill(): void;
  closePath(): void;
}

export interface MapInput {
  state: NavState;
  trail: [number, number][];                       // recent fixes, oldest first
  spaces: readonly Airspace[];
  traffic: readonly Traffic[];
  goal: { lon: number; lat: number } | null;
  /** Still-air glide range (m over ground) at the current height in hand, or null when the
   *  AGL or the polar cannot say. The label states the assumption; the CIRCLE must too.
   *  Drawn ONLY when `reach` is absent — the circle is the fallback, not the truth. */
  rangeM: number | null;
  /** TER-005: the reach polygon over the terrain actually in the way, one ray per bearing.
   *  When present it SUPERSEDES the circle, because the circle is wrong wherever a ridge
   *  stands — and it is wrong in exactly the direction that kills. */
  reach?: readonly ReachRay[] | null;
  /** TER-001: the measured DEM, plus an epoch the shell bumps whenever a tile lands, so the
   *  shade raster can be memoised instead of recomputed at 1 Hz over unchanged ground. */
  terrain?: { elev: ElevSampler; epoch: number } | null;
  /** LND-002/003: the landables, already judged by core. The painter judges nothing. */
  landables?: readonly Alternate[] | null;
}

export const RANGE_LABEL = 'range: still air, no wind';
export const REACH_LABEL = 'reach: over terrain, wind included';

/** Ground the DEM has not answered for. It is neither the hypsometric ramp (which would read as
 *  flat ground) nor the black background (which reads as sea): it is a hatch, laid on every
 *  second cell, and the eye files it under "no data" without being told. */
export const UNLOADED_FILL = '#1c222b';

/** The readiness figure, said out loud, in the cross-section's voice (xsection-ui.ts). A map
 *  that is 40% guesswork must SAY it is 40% guesswork; the hatch alone is a hint, the number is
 *  the confession. */
export const TERRAIN_UNLOADED_LABEL = (pct: number) => `${pct}% of the visible ground is NOT loaded`;

/** LND-003's three states, deliberately wearing the same three colours the reach polygon already
 *  uses for glide / terrain / unknown. One visual vocabulary for one distinction, learnt once:
 *  green is ground you can have, red is ground you cannot, grey is ground nobody has measured.
 *
 *  The grey is the whole point of the table. An indeterminate field painted GREEN is the one bug
 *  in this file that could kill someone: it invites a pilot to commit a final glide to a field
 *  whose ground the DEM never answered for, and he finds out at 200 ft. Green is a measurement.
 *  Grey is the absence of one. They are never interchangeable, whatever a designer says about
 *  the map looking busy. */
export const LANDABLE_COLOR: Record<Alternate['state'], string> = {
  reachable: '#4caf78',
  unreachable: '#e05252',
  indeterminate: '#8b93a1',
};

/** The shade cells are 8 px square: fine enough that a ridge line survives, coarse enough that a
 *  400×400 map is ~2500 fillRects at 1 Hz — which is nothing, and which keeps the whole terrain
 *  layer going through the same Paint2D the tests can record. */
const CELL_PX = 8;

/** One entry is enough, and the epoch IS the invalidation: the shell bumps it when a tile lands,
 *  so there is no stale-cache problem to solve — a key that still matches describes ground that
 *  has not changed under a view that has not moved.
 *
 *  The sampler itself is part of the identity, and not for tidiness: two different DEMs can sit at
 *  the same epoch (a fresh pack loaded, an empty one swapped in), and a cache that matched on the
 *  numbers alone would hand back the OLD terrain under the NEW ground. A wrong hillshade is worse
 *  than none — it is confidently drawn. */
let cached: { key: string; elev: ElevSampler; grid: ShadeGrid } | null = null;

/** The shade view is the EXACT inverse of liftmap-ui's `project`. It has to be: if the layer and
 *  the lines disagree about where a metre is, the ridge is drawn beside the ray that stopped at
 *  it, and the pilot reads open ground where the reach march found rock. */
function shadeView(view: View): ShadeView {
  const pxPerM = view.wPx / view.widthM;
  const { centre } = view;
  return {
    wPx: view.wPx,
    hPx: view.hPx,
    cellPx: CELL_PX,
    mPerPx: view.widthM / view.wPx,
    at: (px, py) => [
      centre.lon + (px - view.wPx / 2) / (mPerLng(centre.lat) * pxPerM),
      centre.lat - (py - view.hPx / 2) / (M_PER_LAT * pxPerM),
    ],
  };
}

function shadeFor(view: View, terrain: { elev: ElevSampler; epoch: number }): ShadeGrid {
  const { centre } = view;
  const key = `${centre.lon}|${centre.lat}|${view.widthM}|${view.wPx}|${view.hPx}|${terrain.epoch}`;
  if (cached && cached.key === key && cached.elev === terrain.elev) return cached.grid;
  const grid = shadeGrid(terrain.elev, shadeView(view));
  cached = { key, elev: terrain.elev, grid };
  return grid;
}

/** TER-001, on the canvas. The measured ground goes down first, in its own colour; the unmeasured
 *  ground goes down as a hatch. Note what is NOT here: no interpolation across a hole, no
 *  "nearest known cell", no smoothing that would carry a colour over ground the DEM never
 *  answered for. A hole stays a hole all the way to the pixel. */
function paintTerrain(ctx: MapPaint2D, view: View, terrain: { elev: ElevSampler; epoch: number }): void {
  const grid = shadeFor(view, terrain);
  ctx.globalAlpha = 1;

  for (let cy = 0; cy < grid.hCells; cy++) {
    for (let cx = 0; cx < grid.wCells; cx++) {
      const c = grid.cells[cy * grid.wCells + cx];
      const x = cx * grid.cellPx, y = cy * grid.cellPx;
      if (c) {
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.fillRect(x, y, grid.cellPx, grid.cellPx);
      } else if ((cx + cy) % 2 === 0) {
        // Every second cell only: the darker background showing through on the other parity is
        // what makes it a visible HATCH rather than a flat grey plateau — a solid fill over
        // unloaded ground would just be a different lie about what is down there.
        ctx.fillStyle = UNLOADED_FILL;
        ctx.fillRect(x, y, grid.cellPx, grid.cellPx);
      }
    }
  }

  // Below half a percent the hatch says it well enough and the sentence is noise. Above it, the
  // number goes on the map — including the 100% case, where there is no terrain layer at all and
  // the pilot must not be left to infer that from an empty screen.
  if (grid.unknownFraction > 0.005) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#8b93a1';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(TERRAIN_UNLOADED_LABEL(Math.round(100 * grid.unknownFraction)), 8, view.hPx - 8);
  }
}

/** LND-003, on the canvas. Every field wears its state's colour and nothing else decides it —
 *  core judged, the painter paints. The type is read from the ring: a gliding airfield is filled,
 *  an outlanding field is hollow. Only the TOP reachable field is named, because the map is not
 *  the alternates list; the panel is, and a map with thirty names on it is a map with none. */
function paintLandables(ctx: MapPaint2D, view: View, landables: readonly Alternate[]): void {
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 1;
  let named = false;

  for (const a of landables) {
    const [x, y] = project(view, a.point.lon, a.point.lat);
    const colour = LANDABLE_COLOR[a.state];
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.stroke();
    if (a.point.cat === 'airfield-gliding') {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (!named && a.state === 'reachable') {
      named = true;
      ctx.fillStyle = colour;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(a.point.name, x + 9, y + 4);
    }
  }
}

/** The reach edge's colour says WHY it ends there — the TER-005 distinction, carried to the
 *  pixel. Green: the glide simply ran out. Red: a ridge is in the way, and everything behind
 *  it is unreachable however low it lies. Grey: nobody has loaded that ground. */
const LIMIT_COLOR: Record<ReachRay['limit'], string> = {
  glide: '#4caf78',
  terrain: '#e05252',
  unknown: '#8b93a1',
};

/** Paint the map, centred on the glider (or the view centre when there is no fix yet). */
export function paintMap(ctx: MapPaint2D, view: View, input: MapInput): void {
  const { state: s, trail, spaces, traffic, goal, rangeM, reach, terrain, landables } = input;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#10141a';
  ctx.fillRect(0, 0, view.wPx, view.hPx);

  // The ground goes down before anything that stands on it (TER-001). Everything after this —
  // the wall the reach march found, the field the glide can still have — is a claim ABOUT this
  // terrain, and a claim drawn under its own subject reads as a claim about something else.
  if (terrain) paintTerrain(ctx, view, terrain);

  // Airspace next (ESP-001's display).
  for (const a of spaces) {
    ctx.strokeStyle = '#e05252';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.8;
    if (a.polygon) {
      ctx.beginPath();
      a.polygon.forEach(([lon, lat], i) => {
        const [x, y] = project(view, lon, lat);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    } else if (a.circle) {
      const [x, y] = project(view, a.circle.lon, a.circle.lat);
      ctx.beginPath();
      ctx.arc(x, y, a.circle.radiusM * view.wPx / view.widthM, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  // The reach, when the terrain has been marched (TER-005). Each edge segment is drawn in the
  // colour of ITS OWN limit, so a red arc is not decoration: it is a wall, and the ground
  // behind it cannot be had. This is the whole reason the circle below is only a fallback.
  if (reach && reach.length > 1 && s.fix) {
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    for (let i = 0; i < reach.length; i++) {
      const a = reach[i], b = reach[(i + 1) % reach.length];
      const [x1, y1] = project(view, a.lon, a.lat);
      const [x2, y2] = project(view, b.lon, b.lat);
      // The segment wears the WORSE of its two ends: an edge running from open glide into a
      // ridge is part of the wall, and rounding it down to green would sell the mountain.
      const worst = a.limit === 'terrain' || b.limit === 'terrain' ? 'terrain'
        : a.limit === 'unknown' || b.limit === 'unknown' ? 'unknown' : 'glide';
      ctx.strokeStyle = LIMIT_COLOR[worst];
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#8b93a1';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(REACH_LABEL, 8, 16);
  } else if (rangeM != null && s.fix) {
    // The fallback circle: still air, no terrain. It is drawn ONLY when the reach could not
    // be marched, and it keeps saying out loud what it assumes — an unlabelled range ring is
    // a promise the polar never made.
    const [x, y] = project(view, s.fix.lon, s.fix.lat);
    ctx.strokeStyle = '#4caf78';
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, rangeM * view.wPx / view.widthM, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#4caf78';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(RANGE_LABEL, 8, 16);
  }

  // The trail, then the glider on top of it.
  if (trail.length > 1) {
    ctx.strokeStyle = '#8b93a1';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    trail.forEach(([lon, lat], i) => {
      const [x, y] = project(view, lon, lat);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // The fields, over the trail and under the glider: they belong to the ground, but the glider
  // must never be hidden by one.
  if (landables && landables.length > 0) paintLandables(ctx, view, landables);

  if (s.fix) {
    const [x, y] = project(view, s.fix.lon, s.fix.lat);
    const rad = ((s.track ?? 0) - 90) * Math.PI / 180;   // canvas 0 rad points east
    ctx.fillStyle = '#e8eaed';
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x + 9 * Math.cos(rad), y + 9 * Math.sin(rad));
    ctx.lineTo(x + 6 * Math.cos(rad + 2.5), y + 6 * Math.sin(rad + 2.5));
    ctx.lineTo(x + 6 * Math.cos(rad - 2.5), y + 6 * Math.sin(rad - 2.5));
    ctx.closePath();
    ctx.fill();
  }

  // Traffic, FLARM's relative frame anchored to our fix: north is metres, not a bearing.
  if (s.fix) {
    for (const t of traffic) {
      const lon = s.fix.lon + t.relEast / mPerLng(s.fix.lat);
      const lat = s.fix.lat + t.relNorth / M_PER_LAT;
      const [x, y] = project(view, lon, lat);
      ctx.fillStyle = t.alarm >= 3 ? '#e05252' : t.alarm === 2 ? '#e0a030' : '#6ab0f3';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  if (goal) {
    const [x, y] = project(view, goal.lon, goal.lat);
    ctx.strokeStyle = '#4caf78';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.stroke();
  }
}
