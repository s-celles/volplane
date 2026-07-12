// ============ painting the lift potential (POT-001 … POT-005, POT-007) ============
// The core computed the map; this file only puts it on screen. That division is C3 made
// concrete: nothing here samples terrain, blends physics or invents a number — it takes the
// patches core-liftmap produced, the blend applyWeights resolved, and turns them into
// rectangles. If a value the painter needs is not finite, the patch is simply not painted;
// a NaN never reaches the canvas, because a NaN alpha is a patch of unknown honesty.
//
// POT-007 lives here in its display form: the watermark is part of paintLiftMap itself,
// painted last on every frame, patches or no patches. It is deliberately NOT a parameter and
// NOT a separate call the integrator could forget — a lift map without its "MODELLED" stamp
// must be unproducible by construction.

import { applyWeights, type LiftMap } from '../core/liftmap';
import {
  LIFT_COMPS, simplexVerts, weightsFromPoint, pointFromWeights, clampToSimplex,
} from 'soaring-core/lift/mix';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';

// ---- the canvas, reduced to what we actually use ----

/** The painter's whole demand on a canvas. A real CanvasRenderingContext2D satisfies it
 *  structurally; a test hands in a recorder and reads the ops back. Keeping the surface this
 *  small is what makes the paint path testable without a DOM. */
export interface Paint2D {
  fillStyle: string;
  globalAlpha: number;
  font: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
}

// ---- the view ----

/** A briefing window: a centre, a ground width in metres, and a pixel canvas. No pan, no
 *  zoom — Phase 1 shows the pack's area and nothing else. */
export interface View {
  centre: { lon: number; lat: number };
  widthM: number;
  wPx: number;
  hPx: number;
}

/** Equirectangular projection around the view centre. Over a briefing window of a few tens
 *  of kilometres the meridian convergence across the frame is a fraction of a pixel, so a
 *  flat lon/lat scaling by mPerLng/M_PER_LAT is exact enough — Mercator would buy nothing
 *  here but the code to maintain it. The y axis flips: north is up, canvas y grows down. */
export function project(view: View, lon: number, lat: number): [number, number] {
  const pxPerM = view.wPx / view.widthM;
  return [
    view.wPx / 2 + (lon - view.centre.lon) * mPerLng(view.centre.lat) * pxPerM,
    view.hPx / 2 - (lat - view.centre.lat) * M_PER_LAT * pxPerM,
  ];
}

// ---- the paint pass ----

/** The POT-007 stamp. One string, exported so the test can pin the exact words. */
export const WATERMARK = 'MODELLED — indicative, not a measurement';

/** Paint the blended lift map into the view. applyWeights decides which layers exist and at
 *  what weight (POT-005); this loop only projects, scales and fills. A patch is drawn as a
 *  square centred on its position — never below 1 px, so a strong patch cannot vanish at a
 *  wide zoom — and skipped entirely when it falls outside the frame or its alpha is not a
 *  finite positive number. */
export function paintLiftMap(
  ctx: Paint2D, map: LiftMap, view: View, on: boolean[], mixVals: number[],
): void {
  const pxPerM = view.wPx / view.widthM;
  for (const layer of applyWeights(map, on, mixVals)) {
    for (const p of layer.patches) {
      const [r, g, b, a] = p.color;
      const alpha = (a / 255) * layer.alpha;
      if (!(alpha > 0) || !Number.isFinite(alpha)) continue;   // NaN or ≤0: nothing to say
      const [x, y] = project(view, p.lon, p.lat);
      const s = Math.max(1, p.sizeM * pxPerM);
      if (x + s / 2 < 0 || x - s / 2 > view.wPx || y + s / 2 < 0 || y - s / 2 > view.hPx) continue;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
  // The watermark, LAST and ALWAYS. This is POT-007: the map itself carries the "modelled"
  // stamp, over the patches, on every frame, even over an empty map. It must never grow a
  // condition, a flag or an off switch — a caller who wants it gone wants to break the spec.
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.max(11, Math.round(view.hPx / 40))}px system-ui, sans-serif`;
  ctx.fillText(WATERMARK, 8, view.hPx - 8);
}

// ---- the mixer (POT-005) ----

/** Margin between the simplex and the widget edge, in px — room for the vertex labels. */
export const MIXER_PAD = 26;

/** Indices into LIFT_COMPS of the enabled components, in mixer (= vertex) order. */
const enabledIdx = (on: boolean[]): number[] =>
  LIFT_COMPS.map((_, i) => i).filter(i => on[i] !== false);

/** The simplex vertices for the current enable set, in widget coordinates. One geometry,
 *  used by BOTH mixerSvg and mixerHit — the widget the pilot sees and the widget the pointer
 *  hits must be the same polygon, so the vertices are computed in exactly one place. */
export function mixerVerts(on: boolean[], sizePx: number): [number, number][] {
  const c = sizePx / 2;
  return simplexVerts(enabledIdx(on).length, c, c, Math.max(1, c - MIXER_PAD));
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/** The mixer widget as an SVG string: the simplex outline, a swatch and label per enabled
 *  component, and the handle at the point the current weights map to. The kernel owns all
 *  the geometry (C4); this only turns coordinates into markup. Labels are the component
 *  keys — i18n arrives with the rest of the shell's translation layer, not here. */
export function mixerSvg(on: boolean[], mixVals: number[], sizePx: number): string {
  const idx = enabledIdx(on);
  const V = mixerVerts(on, sizePx);
  const parts: string[] = [
    `<svg class="mixer" viewBox="0 0 ${sizePx} ${sizePx}" width="${sizePx}" height="${sizePx}">`,
  ];
  if (idx.length === 2) {
    parts.push(`<line class="mixer-shape" x1="${fmt(V[0][0])}" y1="${fmt(V[0][1])}" x2="${fmt(V[1][0])}" y2="${fmt(V[1][1])}"/>`);
  } else if (idx.length >= 3) {
    parts.push(`<polygon class="mixer-shape" points="${V.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')}"/>`);
  }
  idx.forEach((ci, vi) => {
    const c = LIFT_COMPS[ci];
    const [x, y] = V[vi];
    // The label sits outside the vertex, pushed away from the widget centre so it never
    // overlaps the shape whatever the polygon's orientation.
    const cx = sizePx / 2;
    const ux = x - cx, uy = y - sizePx / 2, L = Math.hypot(ux, uy) || 1;
    parts.push(`<circle class="mixer-vertex" cx="${fmt(x)}" cy="${fmt(y)}" r="5" fill="rgb(${c.color[0]},${c.color[1]},${c.color[2]})"/>`);
    parts.push(`<text class="mixer-label" x="${fmt(x + 14 * ux / L)}" y="${fmt(y + 14 * uy / L)}" text-anchor="middle" dominant-baseline="middle">${c.key}</text>`);
  });
  if (idx.length > 0) {
    const [hx, hy] = pointFromWeights(idx.map(i => Math.max(0, mixVals[i] || 0)), V);
    parts.push(`<circle class="mixer-handle" cx="${fmt(hx)}" cy="${fmt(hy)}" r="7"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/** Pointer position → the full-length mix array. The drag point is clamped into the simplex
 *  first (the kernel's clampToSimplex), so a finger that wanders off the widget slides the
 *  handle along the edge instead of flinging the weights negative. Disabled components stay
 *  at weight 0 — they have no vertex, and what is off is off. */
export function mixerHit(px: number, py: number, on: boolean[], sizePx: number): number[] {
  const idx = enabledIdx(on);
  const out = new Array<number>(LIFT_COMPS.length).fill(0);
  if (idx.length === 0) return out;
  const V = mixerVerts(on, sizePx);
  const [cx, cy] = clampToSimplex(px, py, V);
  const w = weightsFromPoint(cx, cy, V);
  idx.forEach((ci, vi) => { out[ci] = w[vi]; });
  return out;
}

// ---- the legend ----

/** One line per enabled component: its swatch, its key — and the layer's own account of
 *  itself. This is where readiness and active reach the pilot (POT-007): an empty canvas is
 *  three different facts wearing one look, and the legend is what tells them apart —
 *  "terrain 40% known" (the ground is not loaded), "inactive" (there was nothing to model
 *  with: no wind, no sun, no resonance), or nothing (the model looked and found nothing).
 *  The `.modelled` class is the same vocabulary shell-briefing-ui uses for forecast-derived
 *  values — coordinated by class NAME so the two files stay disjoint. */
export function legendHtml(on: boolean[], map?: LiftMap | null): string {
  const rows = enabledIdx(on).map(i => {
    const c = LIFT_COMPS[i];
    const layer = map?.components[c.key as keyof LiftMap['components']];
    const note = !layer ? ''
      : !layer.active ? `<span class="legend-note inactive">inactive — nothing to model with</span>`
      : layer.readiness < 0.995 ? `<span class="legend-note">terrain ${Math.round(layer.readiness * 100)}% known</span>`
      : '';
    return `<div class="legend-row modelled">`
      + `<span class="swatch" style="background:rgb(${c.color[0]},${c.color[1]},${c.color[2]})"></span>`
      + `<span class="legend-key">${c.key}</span>${note}</div>`;
  });
  return `<div class="lift-legend">${rows.join('')}</div>`;
}
