// ============ the day's briefing (WX-001, WX-003, WX-005, ANA-004) ============
// The morning's question — "what kind of day is this?" — answered as a value. One hour of a
// weather snapshot goes in; out comes the cloudbase, the thermal ceiling, the stability, the
// wind ladder and the simplified emagram of ANA-004, ready for a screen that only has to draw.
//
// Two rules shape everything here. First, WX-004/OFF-004: an absent snapshot is not an error,
// it is a briefing full of nulls — the pilot flies on sensors and the app does not blink.
// Second, POT-007: every briefing says where it came from. In Phase 1 nothing in it was ever
// measured, and the Provenance type is written so the code CANNOT claim otherwise.
//
// soaring-core does all the meteorology (C4). This file only decides the boundary conventions:
// which Open-Meteo variables the shell must fetch so the kernel's parser finds them, how the
// kernel's "unknown" spellings (NaN, missing) become the app's single spelling (null), and
// what shape the emagram takes as plain geometry — no pixels, the shell scales.

import {
  LEVELS,
  weatherCloudbase, weatherConvTop, weatherStability, weatherSounding,
  envT, parcelT, daySummary, syntheticWx,
  type Wx, type WxKnobs, type Sounding,
} from 'soaring-core/weather';

// ---- WX-001: the fetch contract ----

/** The exact `hourly=` variables the shell must request from Open-Meteo — no more, no less
 *  than what soaring-core's `parseOpenMeteo` reads. The pressure-level block is DERIVED from
 *  the kernel's own `LEVELS`, so if the kernel one day sounds a fourth level, the fetch and
 *  the parser move together instead of silently drifting apart. */
export const OPEN_METEO_HOURLY: readonly string[] = [
  'temperature_2m', 'relative_humidity_2m',
  'wind_speed_10m', 'wind_direction_10m',
  'shortwave_radiation', 'diffuse_radiation',
  'boundary_layer_height',
  ...LEVELS.flatMap(p => [
    `geopotential_height_${p}hPa`,
    `wind_speed_${p}hPa`,
    `wind_direction_${p}hPa`,
    `temperature_${p}hPa`,
  ]),
];

// ---- POT-007: provenance, carried on the value itself ----

/** Where a briefing's numbers come from. Deliberately TWO members: in Phase 1 the app never
 *  measures the atmosphere, so there is no 'measured' — and its absence from the type is the
 *  point. When flight-derived wind arrives (VEN, Phase 2), adding the member here forces every
 *  consumer through the compiler, instead of letting a model quietly pass for a measurement. */
export type Provenance = 'forecast' | 'sandbox';

// ---- the briefing value ----

/** One rung of the wind ladder: altitude AMSL, speed, and the direction the wind blows FROM —
 *  the meteorological convention every pilot reads, undone from the kernel's [u, v] vectors. */
export interface WindRow { alt: number; speed: number /* m/s */; dirFrom: number /* deg, met convention */ }

/** One (temperature, altitude) vertex of an emagram polyline. °C and metres AMSL — the shell
 *  maps them to pixels however it likes. */
export interface EmagramPt { T: number; alt: number }

/** The ANA-004 panel as plain geometry: the environmental sounding and the rising parcel as
 *  polylines over the same altitude span, plus the two horizontal markers a pilot looks for.
 *  A null marker means UNKNOWN — the line is simply not drawn, never drawn at zero. */
export interface EmagramGeom {
  env: EmagramPt[];
  parcel: EmagramPt[];
  cloudbase: number | null;   // AMSL (m)
  ceiling: number | null;     // AMSL (m)
}

/** The day at one hour, as one value. Every field is null (or empty) when the data behind it
 *  is absent — never a fake zero, never a NaN that reaches a screen (WX-004, POT-007). */
export interface Briefing {
  source: Provenance;
  hour: number;
  cloudbase: number | null;   // AMSL (m), from the LCL (WX-003)
  ceiling: number | null;     // AMSL (m), top of dry convection
  stability: number | null;   // Brunt–Väisälä N (1/s)
  wind: WindRow[];
  sounding: EmagramGeom | null;
  summary: { depth: number; isCu: boolean; openTop: boolean } | null;
}

// The kernel spells "unknown" as NaN in places where a number type was kept simple. The app
// spells it null, once, here — so no screen ever has to ask Number.isFinite again.
const finiteOrNull = (x: number): number | null => (Number.isFinite(x) ? x : null);

// The inverse of the kernel's windToUV: a velocity vector blowing TO (east, north) back into
// speed + the direction it blows FROM. Negating both components before atan2 is what turns
// "towards" into "from" — the same convention trap nmea.ts documents for Condor 3.
const toWindRow = (p: { alt: number; u: number; v: number }): WindRow => ({
  alt: p.alt,
  speed: Math.hypot(p.u, p.v),
  dirFrom: (Math.atan2(-p.u, -p.v) * 180 / Math.PI + 360) % 360,
});

const EMAGRAM_SAMPLES = 32;

// The emagram from a kernel Sounding: both curves sampled over the same altitude span, from
// the surface to the top of the sounding. envT clamps rather than extrapolates and parcelT is
// a straight adiabat, so a uniform sampling loses nothing a briefing panel would show.
function emagram(s: Sounding): EmagramGeom {
  const top = s.tprof[s.tprof.length - 1].alt;
  const env: EmagramPt[] = [], parcel: EmagramPt[] = [];
  for (let i = 0; i <= EMAGRAM_SAMPLES; i++) {
    const alt = s.ref + (top - s.ref) * i / EMAGRAM_SAMPLES;
    env.push({ T: envT(s, alt), alt });
    parcel.push({ T: parcelT(s, alt), alt });
  }
  return { env, parcel, cloudbase: s.cloudbase, ceiling: finiteOrNull(s.ceiling) };
}

/** The briefing at a UTC hour. A null snapshot is a legitimate input, not a failure: the
 *  briefing comes back with every field null and the caller renders "—" (WX-004, OFF-004).
 *  The hour arrives as an argument — nothing here reads a clock, so the same snapshot briefs
 *  identically in a test, in a replay and in flight. */
export function briefingAt(wx: Wx | null, hour: number, source: Provenance): Briefing {
  if (!wx || !wx.hours.length) {
    return { source, hour, cloudbase: null, ceiling: null, stability: null, wind: [], sounding: null, summary: null };
  }
  const h = wx.hours[Math.max(0, Math.min(wx.hours.length - 1, hour | 0))];
  const s = weatherSounding(wx, hour);
  // daySummary needs a real ceiling to compute a depth; when the ceiling is unknown the
  // summary is unknown too — a null summary, not a summary built on NaN (POT-007's spirit).
  const summary = s && Number.isFinite(s.ceiling) ? daySummary(s) : null;
  return {
    source, hour,
    cloudbase: weatherCloudbase(wx, hour),
    ceiling: finiteOrNull(weatherConvTop(wx, hour)),
    stability: finiteOrNull(weatherStability(wx, hour)),
    wind: (h?.prof ?? []).map(toWindRow),
    sounding: s ? emagram(s) : null,
    summary,
  };
}

// ---- WX-005: the sandbox ----

/** A synthetic atmosphere from a few knobs, for ground briefing. A thin wrapper over the
 *  kernel's syntheticWx so the shell has ONE import point for weather values — and one caller
 *  contract: whatever comes out of here goes into briefingAt with source 'sandbox', never
 *  'forecast'. The distinction WX-005 demands lives in that argument. */
export function sandboxWx(k: WxKnobs, ref: number): Wx {
  return syntheticWx(k, ref);
}
