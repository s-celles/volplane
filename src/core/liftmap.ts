// ============ the lift map (POT-001 … POT-007): four modelled fields, one honest picture ====
// Where might the air rise today? Slope lift, thermals, convergence and wave are four
// independent pieces of physics, and every one of them lives in soaring-core (C4: no field
// maths here). This file asks each of them the same question — one centre, one radius, one
// sun, one wind profile — and turns the four answers into paintable patches in the kernel's
// shared colour language.
//
// POT-007 is the shape of the whole file. The map is a MODEL, not a measurement, and the type
// system is made to say so: `modelled: true` is a LITERAL, so an untagged map does not
// compile — the tag is designed into the first screen, not bolted on. An unknown wind is
// null, never a calm one; unknown ground yields an empty layer, never an invented flat one.
// And C3 draws the other line: everything exported here is DISPLAY data. No alert, no glide
// computation, no safety behaviour may ever read a modelled field.

import type { ElevSampler, WindProfile, Probe } from 'soaring-core/ports';
import type { TrackPoint } from 'soaring-core/types';
import { nodeStep, type FieldGrid, type NodeGrid } from 'soaring-core/lift/grid';
import { ridgeField, ridgeActive, insolation } from 'soaring-core/lift/ridge';
import { thermalField, snowLineM, diurnalStore, SUN_MIN } from 'soaring-core/lift/thermal';
import { convergField, convergActive, CONV_FRAC } from 'soaring-core/lift/converg';
import { waveField } from 'soaring-core/lift/wave';
import { LIFT_COMPS, liftWeight } from 'soaring-core/lift/mix';
import { BIN_COLORS, THERMAL_COLORS, liftBin, strataBin, thermalBin } from 'soaring-core/liftviz';
import { weatherRad, weatherConvTop, weatherStability, weatherWind, type Wx } from 'soaring-core/weather';
import { sunLightDir } from 'soaring-core/sky';
import { predictVzAt, calibrationFactor, PRED_MIN } from 'soaring-core/lift/calib';
import { detectThermals } from 'soaring-core/airmass';

// A briefing map, not a render loop: the pilot asks once and reads the answer, so the grids
// can afford to be generous and still be instant. A 97-node lattice (and the matching R/48
// disc step) is ~9k samples per field — milliseconds on anything, detailed enough to show a
// slope face or a wave bar at map scale.
export const FIELD_STEPS = 48;   // disc: step = R / FIELD_STEPS
export const NODE_N = 97;        // lattice: NODE_N × NODE_N nodes
// The weakest wave updraught worth a patch. Mirrors ridge's W_MIN: below this the wave field
// is numerical murmur over the whole lattice, and painting it would bury the real bars.
export const WAVE_W_MIN = 0.4;   // m/s

export type LiftKey = 'thermal' | 'slope' | 'converg' | 'wave';

/** One paintable square of ground (or of air, for the wave): a position, a footprint and a
 *  colour straight off the kernel's shared ramps. Nothing else — what to draw there is the
 *  renderer's business. */
export interface Patch { lon: number; lat: number; sizeM: number; color: [number, number, number, number] }

export interface LiftLayer {
  patches: Patch[];
  /** 0..1: the fraction of the field's samples whose ground was actually KNOWN. An empty
   *  layer at readiness 0 means "the terrain is not loaded here", which is a different fact
   *  from "there is no lift here" — the UI must be able to tell them apart (POT-007). */
  readiness: number;
  /** Whether the component's physical driver was present at all — wind for the slope and
   *  the convergence, sun and radiation for the thermals, resonance for the wave. A quiet
   *  layer that is ACTIVE says "the model looked and found nothing"; inactive says "there
   *  was nothing to model with". */
  active: boolean;
}

/** The composed map. `modelled: true` is a literal type: the compiler itself refuses an
 *  untagged map, so no caller can quietly pass this off as a measurement (POT-007). */
export interface LiftMap {
  modelled: true;
  components: Record<LiftKey, LiftLayer>;
}

/** The wind profile of a forecast hour, as the kernel's port. When there is no forecast the
 *  profile answers null at every altitude — an unknown wind is NOT a calm wind, and a [0, 0]
 *  here would put invented slope lift on every face (POT-007's principle, applied upstream
 *  of every field). */
export function windProfileOf(wx: Wx | null, hour: number): WindProfile {
  return alt => (wx ? weatherWind(wx, hour, alt) : null);
}

/** Global-horizontal shortwave → direct-normal irradiance: DNI = (SW − diffuse) / sin(sun
 *  elevation). Zero at (and just after) sunset, where the division would explode on a beam
 *  that no longer exists. NaN inputs — a forecast without radiation — also come out as zero:
 *  no radiation means no thermal field, not a NaN field. */
export function dniOf(sw: number, diff: number, sunZ: number): number {
  if (!Number.isFinite(sw) || !Number.isFinite(diff)) return 0;
  return sunZ <= 0.02 ? 0 : Math.max(0, (sw - diff) / sunZ);
}

/** A parsed track, seen as the kernel's atmospheric probe: linear interpolation over the
 *  [lon, lat, alt, sod] samples, clamped to the ends. Null for fewer than two points — one
 *  point is a place, not a trajectory. Small glue, and a candidate to migrate into
 *  soaring-core one day (C4) — it is not there at v0.2.0, so it lives here for now. */
export function probeFromTrack(pts: TrackPoint[]): Probe | null {
  if (pts.length < 2) return null;
  const rstart = pts[0][3], rend = pts[pts.length - 1][3];
  if (!(rend > rstart)) return null;
  const at = (t: number): readonly [number, number, number] => {
    if (t <= rstart) return [pts[0][0], pts[0][1], pts[0][2]];
    if (t >= rend) { const e = pts[pts.length - 1]; return [e[0], e[1], e[2]]; }
    // Binary search for the segment: the detectors resample every few seconds over a whole
    // flight, so a linear scan here would make calibration quadratic in the track length.
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][3] <= t) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi];
    const f = (t - a[3]) / Math.max(1e-9, b[3] - a[3]);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
  return { rstart, rend, at };
}

/** What one track's calibration attempt actually established. `factor` is 1 on refusal —
 *  which is exactly why the factor ALONE cannot be shown: a refusal and a genuinely neutral
 *  day both read ×1.00, and only `usable` tells them apart. The UI's gate must be the
 *  kernel's gate, so the kernel's count travels with the number (POT-007). */
export interface Calibration {
  factor: number;
  /** Climbs the kernel could actually form a ratio from — predicted, and above PRED_MIN.
   *  Below MIN_RATIOS the factor is a refusal, and must be displayed as one. */
  usable: number;
}

/** The day-scale calibration factor from one track (POT-006): detect the real climbs, predict
 *  Vz at each one's place and time with the same physics the map uses, and take the kernel's
 *  robust ratio. `factor` is 1 — a refusal to guess, not a guess of 1 — when there is no
 *  track, no forecast, or fewer USABLE pairs than calib's MIN_RATIOS; `usable` carries the
 *  kernel's own count so a caller can tell the refusal from a neutral day. */
export function calibrateFromTrack(
  pts: TrackPoint[], elev: ElevSampler, dayMs: number, wx: Wx | null, hour: number,
): Calibration {
  const probe = probeFromTrack(pts);
  if (!probe || !wx) return { factor: 1, usable: 0 };
  const { sw, diff, blh } = weatherRad(wx, hour);
  const convTop = weatherConvTop(wx, hour);
  const diffS = Number.isFinite(diff) ? diff : 0;
  const pairs = detectThermals([probe]).map(th => {
    // The climb's own place and time: the middle of its drift, at the middle of its window.
    // sunLightDir points the way the LIGHT travels; the fields want the vector TOWARDS the sun.
    const lon = (th.c0[0] + th.c1[0]) / 2, lat = (th.c0[1] + th.c1[1]) / 2;
    const ld = sunLightDir(dayMs + ((th.t0 + th.t1) / 2) * 1000, lat, lon);
    const sun: [number, number, number] = [-ld[0], -ld[1], -ld[2]];
    return {
      observed: th.strength,
      predicted: predictVzAt(lon, lat, elev, sun, {
        dni: dniOf(sw, diff, sun[2]), diff: diffS, convTop, ziFallback: blh,
      }),
    };
  });
  // The SAME usability rule calibrationFactor applies internally — counted here so the
  // display's gate cannot drift from the kernel's. If calib.ts ever changes its rule, this
  // count follows it or the tests below catch the divergence.
  const usable = pairs.filter(p => p.predicted != null && p.predicted > PRED_MIN).length;
  return { factor: calibrationFactor(pairs), usable };
}

const emptyLayer = (): LiftLayer => ({ patches: [], readiness: 0, active: false });

// How many positions the disc sampler will visit — the readiness denominator. The loop is a
// deliberate replica of sampleDisc's own (same bounds, same accumulation), so floating-point
// drift in `y += step` can never make the two disagree about the count.
function discCount(R: number, step: number): number {
  let n = 0;
  for (let y = -R; y <= R; y += step) for (let x = -R; x <= R; x += step)
    if (!(x * x + y * y > R * R)) n++;
  return n;
}

/** Compute the four lift components around a centre. `dayMs` is the UTC midnight of the day
 *  (the origin the track's seconds-of-day count from), `hour` the UTC hour of interest, `cal`
 *  the day-scale factor from calibrateFromTrack (1 when uncalibrated). Pure and synchronous:
 *  terrain comes through the sampler, weather as a value, and nothing here fetches. */
export function computeLiftMap(
  centre: { lon: number; lat: number }, R: number, elev: ElevSampler,
  wx: Wx | null, hour: number, dayMs: number, cal: number,
): LiftMap {
  const ms = dayMs + hour * 3600000;
  const ld = sunLightDir(ms, centre.lat, centre.lon);
  const sun: [number, number, number] = [-ld[0], -ld[1], -ld[2]];
  const wind = windProfileOf(wx, hour);
  const { sw, diff, blh } = wx ? weatherRad(wx, hour) : { sw: NaN, diff: NaN, blh: NaN };
  const ng: NodeGrid = { cLon: centre.lon, cLat: centre.lat, R, n: NODE_N };
  const sp = nodeStep(ng);

  // ---- slope (POT-001): wind · ∇terrain, plus the sun's anabatic term on calm days ----
  const fg: FieldGrid = { cLon: centre.lon, cLat: centre.lat, R, step: R / FIELD_STEPS };
  const rf = ridgeField(fg, elev, wind, { sun });
  const slope: LiftLayer = {
    patches: rf.cells.map(c => ({
      lon: c.lon, lat: c.lat, sizeM: fg.step, color: BIN_COLORS[liftBin(c.w)],
    })),
    readiness: rf.sampled / discCount(R, fg.step),
    active: ridgeActive(rf.wind, sun),
  };

  // ---- thermal (POT-002): sun on the facets → convective velocity scale ----
  // The gate is honest: sun below the horizon, or a forecast that carries no radiation, means
  // there is nothing to model — an empty layer, not a field of zeros dressed up as physics.
  const dni = dniOf(sw, diff, sun[2]);
  const diffS = Number.isFinite(diff) ? diff : 0;
  let thermal = emptyLayer();
  if (sun[2] > SUN_MIN && (dni > 0 || diffS > 0)) {
    const tf = thermalField(ng, elev, {
      sun, dni, diff: diffS,
      convTop: wx ? weatherConvTop(wx, hour) : NaN,
      ziFallback: blh, cal,
      // The storage knob is a future UI affordance; until it exists the full diurnal
      // physics is the default, not an option.
      heatStore: 1, dM: diurnalStore(ms, centre.lat, centre.lon),
      snowLine: snowLineM(ms, centre.lat),
      // No land-cover pack in Phase 1: uniform albedo, no water mask, no cloud streets.
      lc: null, street: null,
    });
    const patches: Patch[] = [];
    for (let j = 0; j < tf.nw; j++) for (let i = 0; i < tf.nw; i++) {
      const vz = tf.vz[j * tf.nw + i];
      if (Number.isNaN(vz)) continue;                       // unknown ground: no patch, ever
      const bin = thermalBin(vz, tf.wRef, tf.scaleRef);
      if (bin == null) continue;                            // unremarkable ground stays clean
      patches.push({
        lon: (tf.lon[i] + tf.lon[i + 1]) / 2,               // the quad's centre, not a corner node
        lat: (tf.lat[j] + tf.lat[j + 1]) / 2,
        sizeM: sp, color: THERMAL_COLORS[bin],
      });
    }
    thermal = { patches, readiness: tf.ready / tf.total, active: true };
  }

  // ---- convergence (POT-003): divergence of the terrain-deflected wind ----
  // water: null — no land-cover pack in Phase 1, so no lake/sea breeze yet. The kernel takes
  // the mask as data; when the pack exists, it plugs in here.
  const cf = convergField(ng, elev, wind, { insol: insolation(sun), water: null });
  const converg: LiftLayer = {
    patches: cf.cells.map(c => ({
      lon: c.lon, lat: c.lat, sizeM: sp, color: BIN_COLORS[strataBin(c.c, CONV_FRAC)],
    })),
    readiness: cf.ready / cf.total,
    active: convergActive(cf.wind, false),
  };

  // ---- wave (POT-004): resonant response downwind of the ridges, λ = 2π·U/N ----
  const wf = waveField(ng, elev, wind, { N: wx ? weatherStability(wx, hour) : NaN });
  const wavePatches: Patch[] = [];
  if (wf.res) {
    for (let j = 0; j < ng.n; j++) for (let i = 0; i < ng.n; i++) {
      const idx = j * ng.n + i;
      if (!wf.ok[idx]) continue;
      const w = wf.w[idx];
      if (Math.abs(w) < WAVE_W_MIN) continue;
      wavePatches.push({ lon: wf.lon[i], lat: wf.lat[j], sizeM: sp, color: BIN_COLORS[liftBin(w)] });
    }
  }
  const wave: LiftLayer = {
    patches: wavePatches,
    readiness: wf.ready / wf.total,
    active: wf.res != null,
  };

  return { modelled: true, components: { thermal, slope, converg, wave } };
}

/** The pilot's blend (POT-005): which components are on, and at what weight. The simplex
 *  maths — barycentric weights, renormalisation over the enabled rest — is the kernel's
 *  liftWeight; the UI never sees it. A disabled component is ABSENT from the result, not
 *  painted at alpha zero: what is off is off. */
export function applyWeights(
  map: LiftMap, on: boolean[], mixVals: number[],
): { key: LiftKey; patches: Patch[]; alpha: number }[] {
  const out: { key: LiftKey; patches: Patch[]; alpha: number }[] = [];
  for (const c of LIFT_COMPS) {
    const key = c.key as LiftKey;
    const layer = map.components[key];
    if (!layer) continue;                       // a component the kernel grew that this map predates
    const alpha = liftWeight(key, on, mixVals);
    if (alpha <= 0) continue;
    out.push({ key, patches: layer.patches, alpha });
  }
  return out;
}
