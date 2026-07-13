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
}

export const RANGE_LABEL = 'range: still air, no wind';
export const REACH_LABEL = 'reach: over terrain, wind included';

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
  const { state: s, trail, spaces, traffic, goal, rangeM, reach } = input;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#10141a';
  ctx.fillRect(0, 0, view.wPx, view.hPx);

  // Airspace first — it is the ground the rest stands on (ESP-001's display).
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
