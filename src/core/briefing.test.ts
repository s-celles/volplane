// The briefing's claims, pinned. Not how briefingAt walks the arrays — what it PROMISES:
// a missing snapshot briefs as nulls without a throw (WX-004), the cloudbase is the kernel's
// LCL (WX-003), no NaN ever escapes into a Briefing, the wind ladder undoes the kernel's own
// vector convention exactly, the emagram is the geometry ANA-004 asks for, and the fetch list
// stays glued to what parseOpenMeteo actually reads (WX-001).
import { test, expect } from 'bun:test';
import {
  OPEN_METEO_HOURLY, briefingAt, sandboxWx,
  type Briefing, type Provenance,
} from './briefing';
import {
  LEVELS, TRIGGER_EXCESS, DRY,
  windToUV, lclBase, parseOpenMeteo,
  type Wx, type WxKnobs,
} from 'soaring-core/weather';

// A pleasant convective sandbox day: light wind, some shear, a stable-ish layer, warm and dry
// enough for a cloudbase well above the surface.
const KNOBS: WxKnobs = { wind: 4, dir: 270, shear: 3, nStab: 0.012, tsurf: 24, rh: 45 };
const REF = 400;

// No field of a briefing may carry NaN — "unknown" is null, everywhere (POT-007). Walk the
// whole value, because the leak could hide anywhere a kernel NaN slips through unconverted.
function assertNoNaN(x: unknown, path = 'briefing'): void {
  if (typeof x === 'number') { expect(`${path} = ${x}`).not.toInclude('NaN'); return; }
  if (Array.isArray(x)) { x.forEach((v, i) => assertNoNaN(v, `${path}[${i}]`)); return; }
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) assertNoNaN(v, `${path}.${k}`);
}

// ---- WX-004 / OFF-004: absence is a value, not an error ----

test('no snapshot → an all-null briefing, and no throw', () => {
  const b = briefingAt(null, 13, 'forecast');
  expect(b.source).toBe('forecast');
  expect(b.hour).toBe(13);
  expect(b.cloudbase).toBeNull();
  expect(b.ceiling).toBeNull();
  expect(b.stability).toBeNull();
  expect(b.wind).toEqual([]);
  expect(b.sounding).toBeNull();
  expect(b.summary).toBeNull();
});

test('an empty snapshot (zero hours) briefs like no snapshot at all', () => {
  const b = briefingAt({ hours: [], ref: REF }, 12, 'forecast');
  expect(b.cloudbase).toBeNull();
  expect(b.sounding).toBeNull();
  assertNoNaN(b);
});

// ---- WX-003 / WX-005: the numbers of a real day ----

test('cloudbase is the kernel LCL for the surface T/RH; ceiling and stability are real numbers', () => {
  const b = briefingAt(sandboxWx(KNOBS, REF), 12, 'sandbox');
  expect(b.cloudbase).toBe(lclBase(KNOBS.tsurf, KNOBS.rh, REF)!);   // WX-003, via C4
  expect(b.ceiling).not.toBeNull();
  expect(b.ceiling!).toBeGreaterThan(REF);
  expect(b.stability).not.toBeNull();
  expect(b.stability!).toBeGreaterThan(0);
  expect(b.summary).not.toBeNull();
  expect(b.summary!.depth).toBeGreaterThan(0);
  assertNoNaN(b);
});

test('the sandbox stays labelled sandbox — provenance rides on the value (WX-005, POT-007)', () => {
  const b = briefingAt(sandboxWx(KNOBS, REF), 12, 'sandbox');
  expect(b.source).toBe('sandbox');
  // And the type has no 'measured' to reach for: in Phase 1 nothing here is a measurement.
  const p: Provenance = b.source;
  expect(['forecast', 'sandbox']).toContain(p);
});

test('a one-level sounding: stability is null, never NaN', () => {
  // The kernel spells this NaN; the boundary must respell it null before any screen sees it.
  const wx: Wx = {
    ref: REF,
    hours: [{ cloudbase: null, prof: [], sw: NaN, diff: NaN, blh: NaN, t2m: 15, tprof: [{ alt: REF, T: 15 }] }],
  };
  const b = briefingAt(wx, 0, 'forecast');
  expect(b.stability).toBeNull();
  expect(b.ceiling).toBeNull();
  expect(b.sounding).toBeNull();
  expect(b.summary).toBeNull();
  assertNoNaN(b);
});

// ---- the wind ladder: the exact inverse of the kernel's convention ----

test('windToUV round-trips through the wind rows to within 1e-6', () => {
  const cases: [number, number][] = [[4, 0], [7.5, 90], [12, 179.5], [3, 270], [9, 359]];
  const wx: Wx = {
    ref: 0,
    hours: [{
      cloudbase: null, sw: NaN, diff: NaN, blh: NaN, t2m: 10, tprof: [],
      prof: cases.map(([sp, dir], i) => ({ ...windToUV(sp, dir), alt: 100 * (i + 1) })),
    }],
  };
  const b = briefingAt(wx, 0, 'forecast');
  expect(b.wind.length).toBe(cases.length);
  for (let i = 0; i < cases.length; i++) {
    expect(b.wind[i].alt).toBe(100 * (i + 1));
    expect(Math.abs(b.wind[i].speed - cases[i][0])).toBeLessThan(1e-6);
    expect(Math.abs(b.wind[i].dirFrom - cases[i][1])).toBeLessThan(1e-6);
  }
});

// ---- ANA-004: the emagram as geometry ----

test('emagram: both polylines start at the surface, the parcel leads by TRIGGER_EXCESS, and they cross below the top', () => {
  const stable: WxKnobs = { ...KNOBS, nStab: 0.02 };   // strongly stable: the crossing is low
  const b = briefingAt(sandboxWx(stable, REF), 12, 'sandbox');
  const g = b.sounding!;
  expect(g.env[0].alt).toBe(REF);
  expect(g.parcel[0].alt).toBe(REF);
  expect(g.parcel[0].T - g.env[0].T).toBeCloseTo(TRIGGER_EXCESS, 6);

  // The parcel cools at DRY per metre while the stable environment barely cools: somewhere
  // below the sounding top the curves must meet — that meeting IS the day's structure.
  const top = g.env[g.env.length - 1].alt;
  const crossing = g.parcel.findIndex((p, i) => p.T <= g.env[i].T);
  expect(crossing).toBeGreaterThan(0);
  expect(g.parcel[crossing].alt).toBeLessThan(top);
  // And the markers are drawable numbers, at plausible heights.
  expect(g.ceiling).not.toBeNull();
  expect(g.ceiling!).toBeGreaterThan(REF);
  expect(g.cloudbase).not.toBeNull();
  assertNoNaN(g);
});

test('the parcel line is the dry adiabat, not an approximation of one', () => {
  const b = briefingAt(sandboxWx(KNOBS, REF), 12, 'sandbox');
  const p = b.sounding!.parcel;
  const a = p[0], z = p[p.length - 1];
  expect(z.T).toBeCloseTo(a.T - DRY * (z.alt - a.alt), 6);
});

// ---- WX-001: the fetch list cannot drift from the parser ----

test('OPEN_METEO_HOURLY carries every variable, for every kernel level', () => {
  for (const base of ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m',
    'shortwave_radiation', 'diffuse_radiation', 'boundary_layer_height']) {
    expect(OPEN_METEO_HOURLY).toContain(base);
  }
  for (const p of LEVELS) {
    expect(OPEN_METEO_HOURLY).toContain(`geopotential_height_${p}hPa`);
    expect(OPEN_METEO_HOURLY).toContain(`wind_speed_${p}hPa`);
    expect(OPEN_METEO_HOURLY).toContain(`wind_direction_${p}hPa`);
    expect(OPEN_METEO_HOURLY).toContain(`temperature_${p}hPa`);
  }
});

test('a payload with EXACTLY the requested variables parses to a full profile', () => {
  // The real pin: feed parseOpenMeteo a payload restricted to OPEN_METEO_HOURLY and nothing
  // else. If the parser needs a variable the list forgot, the profile comes out short here —
  // long before a pilot briefs on a hollow snapshot.
  const value: Record<string, number> = {
    temperature_2m: 24, relative_humidity_2m: 45, wind_speed_10m: 4, wind_direction_10m: 270,
    shortwave_radiation: 700, diffuse_radiation: 120, boundary_layer_height: 1500,
  };
  LEVELS.forEach((p, i) => {
    value[`geopotential_height_${p}hPa`] = 800 + 1500 * i;
    value[`wind_speed_${p}hPa`] = 6 + 2 * i;
    value[`wind_direction_${p}hPa`] = 270;
    value[`temperature_${p}hPa`] = 20 - 8 * i;
  });
  const hourly: Record<string, unknown> = { time: ['2026-07-12T12:00'] };
  for (const v of OPEN_METEO_HOURLY) hourly[v] = [value[v]];
  expect(Object.keys(value).sort()).toEqual([...OPEN_METEO_HOURLY].sort());   // exactly, both ways

  const wx = parseOpenMeteo({ elevation: 400, hourly }, 0)!;
  expect(wx).not.toBeNull();
  expect(wx.hours[0].prof.length).toBe(1 + LEVELS.length);      // 10 m + every pressure level
  expect(wx.hours[0].tprof.length).toBe(1 + LEVELS.length);     // surface + every pressure level
  const b: Briefing = briefingAt(wx, 0, 'forecast');
  expect(b.cloudbase).not.toBeNull();
  assertNoNaN(b);
});
