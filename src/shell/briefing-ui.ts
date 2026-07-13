// ============ the briefing panel, as strings (OFF-005/010/011, WX-003/005, ANA-004, POT-007) ============
// Everything the pilot reads BEFORE flying — pack completeness, offline state, the day's
// structure — rendered as HTML/SVG strings from values that core already computed. No document,
// no listeners, no Tauri: main.ts owns the DOM, this file owns the words. That split is not
// cosmetic; it is what lets bun test assert, without a browser, the claims that matter here —
// that a null is a dash, that a modelled number is badged, that a sandbox cannot pass for a sky.
//
// Two disciplines run through every function. main.ts's: an unknown value renders as '—' with
// the 'unknown' class, never as a zero the pilot would believe (POT-007). And briefing.ts's:
// provenance travels ON the value — the sandbox banner and the modelled badges are derived from
// the data, so no render path exists where a synthetic atmosphere comes out dressed as a real one.

import type { Completeness, CompletenessItem, PackClass } from '../core/pack';
import type { Briefing, EmagramGeom, EmagramPt } from '../core/briefing';
import { format, unitFor, type UnitPrefs } from '../core/units';
import type { T } from './infobox-ui';

// The same spelling of "unknown" main.ts uses: null in, null out, and NaN — which should never
// reach the shell, but a screen is the wrong place to trust that — collapses to null too.
const fmt = (v: number | null | undefined, digits = 0): string | null =>
  v == null || !Number.isFinite(v) ? null : v.toFixed(digits);

// Free text (a completeness detail names days and areas) must not be able to break the markup
// around it — everything else rendered here is a number or a closed union.
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---- POT-007: the badge every modelled number wears ----

// One badge, one spelling, used everywhere a forecast-derived number appears. In Phase 1 the
// app never measures the atmosphere, so EVERY briefing value gets one — the badge is attached
// where the value is rendered, not sprinkled by the caller, so a value cannot slip past it.
// A '—' carries no badge: an unknown claims nothing, so there is no claim to qualify.
const badge = (t: T): string =>
  `<span class="badge modelled" title="${esc(t('badge.modelled.title'))}">${esc(t('badge.modelled'))}</span>`;

// main.ts's box, extended with the badge on known values. Same classes (box/k/v/u/unknown) so
// app.css styles both screens with one vocabulary.
function box(k: string, v: string | null, u: string, t: T): string {
  return `<div class="box${v == null ? ' unknown' : ''}">
    <div class="k">${k}</div>
    <div class="v">${v ?? '—'}<span class="u">${v == null ? '' : u}</span>${v == null ? '' : badge(t)}</div>
  </div>`;
}

// ---- OFF-010/011: completeness, said out loud ----

const itemRow = (i: CompletenessItem): string =>
  `<div class="pack-item ${i.status}">
    <span class="kind">${i.kind}</span>
    <span class="count">${i.heldCount}/${i.totalCount}</span>
    <span class="status">${i.status}</span>
    ${i.detail == null ? '' : `<span class="detail">${esc(i.detail)}</span>`}
  </div>`;

/** The pre-flight completeness screen (OFF-010): one row per pack item, grouped by OFF-008's
 *  class so "owed" and "offered" never blur into one list. When the pack cannot carry the
 *  flight the header SAYS so, in words, naming what is missing — OFF-011 asks for an explicit
 *  warning, and a coloured dot is not one. Enrichment shortfalls keep their status row (that
 *  is their warning) but never poison the header: a stale forecast must not read as a grounded
 *  glider. */
export function completenessHtml(c: Completeness, t: T): string {
  const gaps = c.items
    .filter(i => i.cls === 'flight' && i.status !== 'held')
    .map(i => `${i.kind} ${i.status}`)
    .join(', ');
  const header = c.ready
    ? `<div class="pack-status ready">${esc(t('pack.ready'))}</div>`
    : `<div class="pack-status not-ready">${esc(t('pack.notReady', { gaps }))}</div>`;
  const section = (cls: PackClass, titleId: string): string =>
    `<section class="pack-class ${cls}">
      <h3>${esc(t(titleId))}</h3>
      ${c.items.filter(i => i.cls === cls).map(itemRow).join('')}
    </section>`;
  return `<div class="completeness">
    ${header}
    ${section('flight', 'pack.flight')}
    ${section('enrichment', 'pack.enrichment')}
  </div>`;
}

// ---- OFF-005: offline as a state, not a failure ----

// A snapshot's age, in the units a pilot thinks in. Below the hour the rounding to whole hours
// would say '0 h old' — a fake-zero cousin — so minutes take over there.
const ageText = (ms: number, t: T): string => {
  const clamped = Math.max(0, ms);
  return clamped < 3_600_000
    ? t('age.min', { n: Math.round(clamped / 60_000) })
    : t('age.hours', { n: Math.round(clamped / 3_600_000) });
};

/** The connectivity badge. Offline is a legitimate state the whole app is built for
 *  (OFF-005: "sans bloquer l'usage"), so the words here describe, they do not alarm — no
 *  'error', no 'failed'. What the pilot needs next to the state is the VALIDITY of what is
 *  cached: how old the weather snapshot is, or '—' when none is held. And when the store fell
 *  back to memory (store.ts could not open a durable KV), the badge says the one thing that
 *  matters about that: this cache dies with the app. */
export function offlineBadgeHtml(
  online: boolean, persistent: boolean, wxFetchedAt: number | null, now: number, t: T,
): string {
  const age = wxFetchedAt == null ? null : ageText(now - wxFetchedAt, t);
  const state = esc(online ? t('net.online') : t('net.offline'));
  return `<div class="net ${online ? 'online' : 'offline'}">
    <span class="state">${state}</span>
    <span class="wx-age${age == null ? ' unknown' : ''}">${esc(t('net.weather'))}: ${age == null ? '—' : esc(age)}</span>
    ${persistent ? '' : `<span class="volatile">${esc(t('net.volatile'))}</span>`}
  </div>`;
}

// ---- WX-003/005, ANA-004: the day, as numbers ----

// A wind-table cell: number plus badge, or a dash. The badge rides in the CELL, not once per
// table — POT-007 badges values, and a table row is three of them.
const cell = (v: string | null, t: T): string =>
  v == null ? '<td class="unknown">—</td>' : `<td>${v}${badge(t)}</td>`;

/** The briefing panel: cloudbase (WX-003), ceiling, stability, the day's convection summary
 *  and the wind ladder — speeds in km/h, directions FROM, the conventions a pilot reads.
 *  Every known number carries the modelled badge; every unknown is a '—'. When the briefing's
 *  source is 'sandbox' the panel wears the .sandbox class and a banner saying so in capitals —
 *  and because both come from the source field the value itself carries, a synthetic
 *  atmosphere CANNOT render unbadged (WX-005), whatever the caller forgot. */
export function briefingHtml(b: Briefing, u: UnitPrefs, t: T): string {
  const sandbox = b.source === 'sandbox';
  // CFG-003 reaches the briefing as well. The cloudbase used to be metres and the wind ladder km/h
  // whatever the pilot had chosen — and a cloudbase is precisely the number he then compares with
  // the altitude his InfoBoxes print in feet. Two units for one quantity, one screen apart.
  const alt = (v: number | null | undefined): string | null => {
    const f = format(v, 'altitude', u.altitude);
    return f.unit === '' ? null : f.text;                 // '' is format's own spelling of unknown
  };
  const altUnit = unitFor('altitude', u.altitude);
  const sky = b.summary == null ? null
    : `${alt(b.summary.depth)} ${altUnit} ${esc(b.summary.isCu ? t('bf.cumulus') : t('bf.blue'))}${
        b.summary.openTop ? `, ${esc(t('bf.openTop'))}` : ''}`;
  const speed = (ms: number): string | null => {
    const f = format(ms, 'speed', u.speed);
    return f.unit === '' ? null : f.text;
  };
  const wind = b.wind.length === 0
    ? `<div class="box unknown"><div class="k">${esc(t('bf.windProfile'))}</div><div class="v">—</div></div>`
    : `<table class="wind">
        <thead><tr><th>${esc(t('bf.wind.alt', { unit: altUnit }))}</th><th>${
          esc(t('bf.wind.speed', { unit: unitFor('speed', u.speed) }))}</th><th>${
          esc(t('bf.wind.from'))}</th></tr></thead>
        <tbody>${b.wind.map(r =>
          `<tr>${cell(alt(r.alt), t)}${cell(speed(r.speed), t)}${cell(fmt(r.dirFrom), t)}</tr>`).join('')}
        </tbody>
      </table>`;
  return `<div class="briefing${sandbox ? ' sandbox' : ''}">
    ${sandbox ? `<div class="sandbox-banner">${esc(t('bf.sandboxBanner'))}</div>` : ''}
    <h2>${esc(t('bf.title', { hour: b.hour }))}</h2>
    <div class="boxes">
      ${box(esc(t('bf.cloudbase')), alt(b.cloudbase), altUnit, t)}
      ${box(esc(t('bf.ceiling')), alt(b.ceiling), altUnit, t)}
      ${box(esc(t('bf.stability')), fmt(b.stability, 3), 's⁻¹', t)}
      ${box(esc(t('bf.convection')), sky, '', t)}
    </div>
    ${wind}
  </div>`;
}

// ---- ANA-004: the emagram, geometry to pixels ----

/** The simplified emagram: temperature rightward, altitude upward, both mapped linearly from
 *  the data's own bounds with a small margin — an emagram has no canonical scale a fixed axis
 *  could honour. The environment is a solid polyline, the parcel a dashed one, and cloudbase
 *  and ceiling are horizontal lines with labels — drawn ONLY when known. A null marker means
 *  the line simply is not there; a line at y(0) would be an invented measurement. A null or
 *  empty geometry yields an empty-state svg with a '—', because "no sounding" deserves the
 *  same honest dash as any other unknown. viewBox only, no width/height: app.css sizes it. */
export function emagramSvg(g: EmagramGeom | null, w: number, h: number): string {
  const open = `<svg class="emagram" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  if (!g || g.env.length === 0) {
    return `${open}<text class="unknown" x="${w / 2}" y="${h / 2}" text-anchor="middle">—</text></svg>`;
  }
  // Bounds cover both curves AND the markers, so a cloudbase above the sampled span still
  // lands inside the frame instead of silently clipping out of it.
  let tMin = Infinity, tMax = -Infinity, aMin = Infinity, aMax = -Infinity;
  for (const p of [...g.env, ...g.parcel]) {
    tMin = Math.min(tMin, p.T); tMax = Math.max(tMax, p.T);
    aMin = Math.min(aMin, p.alt); aMax = Math.max(aMax, p.alt);
  }
  for (const m of [g.cloudbase, g.ceiling]) {
    if (m != null) { aMin = Math.min(aMin, m); aMax = Math.max(aMax, m); }
  }
  // A degenerate span (an isothermal two-point sounding, a single altitude) must not divide
  // by zero — a unit span parks the flat data mid-frame instead.
  const tSpan = tMax - tMin || 1, aSpan = aMax - aMin || 1;
  const pad = Math.min(w, h) * 0.08;
  const x = (T: number): string => (pad + (T - tMin) / tSpan * (w - 2 * pad)).toFixed(1);
  const y = (alt: number): string => (h - pad - (alt - aMin) / aSpan * (h - 2 * pad)).toFixed(1);
  const poly = (ps: EmagramPt[], cls: string, dashed: boolean): string =>
    `<polyline class="${cls}" fill="none"${dashed ? ' stroke-dasharray="6 4"' : ''} points="${
      ps.map(p => `${x(p.T)},${y(p.alt)}`).join(' ')}"/>`;
  const marker = (alt: number | null, cls: string): string =>
    alt == null ? '' :
      `<line class="${cls}" x1="${pad.toFixed(1)}" y1="${y(alt)}" x2="${(w - pad).toFixed(1)}" y2="${y(alt)}"/>` +
      `<text class="${cls}" x="${pad.toFixed(1)}" y="${(Number(y(alt)) - 4).toFixed(1)}">${cls} ${Math.round(alt)} m</text>`;
  return open
    + poly(g.env, 'env', false)
    + poly(g.parcel, 'parcel', true)
    + marker(g.cloudbase, 'cloudbase')
    + marker(g.ceiling, 'ceiling')
    + '</svg>';
}
