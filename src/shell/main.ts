// ============ the shell's two screens: Fly (Phase 0) and Briefing (Phase 1) ============
// One window, two questions. "Where am I and what is under me?" is the Fly screen — Phase 0's
// six numbers, untouched: every one of them is still checkable against Condor. "What kind of
// day is this, and will the cache carry it?" is the Briefing screen, and everything on it is
// a MODEL or a promise about data — so everything on it is badged (POT-007), and nothing on
// it may ever feed an alert (C3).
//
// This file is deliberately the dumbest one in the shell: the values come from core
// (pack/briefing/liftmap), the words and pixels from briefing-ui/liftmap-ui, the bytes from
// store/provision. What is left here is the one job nobody else may do — the DOM, the events,
// and the order things happen in.
//
// One rule, and it is IHM's and POT-007's rule both: a value we do not know is shown as
// UNKNOWN, never as zero. A flight computer that shows "0 m AGL" over an unloaded mountain is
// worse than one that shows nothing, because the pilot believes it.
import { navigate, reground, EMPTY, type NavState } from '../core/nav';
import { lines, withHealth, type Device, type LinkState } from '../core/device';
import { igcToSentences } from '../core/replay';
import { derive, rollingVario } from '../core/compute';
import { speedToFly, arrival } from '../core/glide';
import { windEstimator } from '../core/wind';
import { completeness, type PackSpec, type Held } from '../core/pack';
import { briefingAt, sandboxWx, type Provenance } from '../core/briefing';
import { computeLiftMap, calibrateFromTrack, type LiftMap } from '../core/liftmap';
import { tcpDevice, replaySource, closeLinks } from './tauri-source';
import { terrainStore, Z } from './terrain';
import { openStore, isPersistent } from './store';
import { downloadPack, heldFor, loadWeather } from './provision';
import { completenessHtml, offlineBadgeHtml, briefingHtml, emagramSvg } from './briefing-ui';
import { paintLiftMap, mixerSvg, mixerHit, legendHtml, type Paint2D, type View } from './liftmap-ui';
import { elevAtFromTiles, mPerLng, M_PER_LAT, distM, bearingDeg } from 'soaring-core/geo';
import { DEFAULT_POLAR } from 'soaring-core/polar';
import { parseIGC } from 'soaring-core/igc';
import { MIN_RATIOS } from 'soaring-core/lift/calib';
import { LIFT_COMPS } from 'soaring-core/lift/mix';
import type { Wx, WxKnobs } from 'soaring-core/weather';

// The cache under everything (OFF-002), opened before the terrain store exists because the
// store's very first read may already be a disk hit. openStore never throws — worst case the
// KV is memory-only and the offline badge says so out loud (OFF-005).
const kv = await openStore('volplane');

// The DEM, read disk-first and network-second (OFF-004): over ground this machine has visited
// — or been provisioned for — the radio is never consulted, so the Fly screen survives a
// network cut over known terrain. Until a tile lands, the ground is NULL: UNKNOWN, which the
// whole chain is built to carry honestly.
const terrain = terrainStore(() => {
  // A tile arrived: the ground under the unmoved glider may just have become known. Repricing
  // costs a lookup; waiting for the next fix would show UNKNOWN over terrain we now hold.
  const s = reground(state, elev);
  if (s !== state) { state = s; render(state, link); }
  // The briefing has the same stake in a tile as the Fly screen: the lift map's ground and
  // the sounding's surface reference both just changed under it. Debounced — a provisioning
  // burst lands hundreds of tiles, and one re-brief at the end says all of it.
  onTilesChanged();
}, undefined, Date.now, kv);
const elev = (lon: number, lat: number) => elevAtFromTiles(lon, lat, terrain.lookup, Z, 8);

// Assigned once the briefing exists below; the terrain store is built before the screens are.
let onTilesChanged: () => void = () => {};

// ---- the window: two tabs over the one #app ----

const root = document.getElementById('app')!;
root.innerHTML = `
  <nav class="tabs">
    <button id="tab-fly" class="active" type="button">Fly</button>
    <button id="tab-briefing" type="button">Briefing</button>
  </nav>
  <div id="fly"></div>
  <div id="briefing" hidden></div>
`;
const app = root.querySelector<HTMLElement>('#fly')!;
const bf = root.querySelector<HTMLElement>('#briefing')!;

// ============ the Fly screen — Phase 0's six numbers + Phase 2's computer ============
// Built ONCE, like the briefing: the settings and connect forms are things the pilot types
// into, and a 1 Hz render that rebuilt them would eat the caret mid-QNH (the briefing learnt
// this first; the Fly screen inherits the lesson). Only #fly-view repaints per state.

app.innerHTML = `
  <h1>VOLPLANE</h1>
  <div id="fly-view"></div>
  <form id="fly-set" class="fly-set">
    <label>MC <input id="set-mc" size="3" value="1.0" inputmode="decimal" /> m/s</label>
    <label>QNH <input id="set-qnh" size="5" value="1013.25" inputmode="decimal" /> hPa</label>
    <label>reserve <input id="set-reserve" size="4" value="200" inputmode="numeric" /> m</label>
    <button id="set-goal" type="button" title="make the current position and ground the final-glide goal">goal: here</button>
    <span id="goal-label" class="goal-label">no goal</span>
  </form>
  <form id="connect">
    <input id="host" value="127.0.0.1" size="12" />
    <input id="port" value="4353" size="5" />
    <button type="submit">Connect (Condor / TCP)</button>
    <label class="replay">or replay an IGC file <input id="igc" type="file" accept=".igc" /></label>
  </form>
  <div class="link">Condor: Setup → Options → NMEA output → TCP, port 4353.</div>
`;
const flyView = app.querySelector<HTMLElement>('#fly-view')!;

const fmt = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? null : v.toFixed(digits);

function box(k: string, v: string | null, u = '', badge = ''): string {
  return `<div class="box${v == null ? ' unknown' : ''}">
    <div class="k">${k}${badge}</div>
    <div class="v">${v ?? '—'}<span class="u">${v == null ? '' : u}</span></div>
  </div>`;
}

// ---- the flight computer's own state (Phase 2) ----

const polar = DEFAULT_POLAR;                       // PLA-010: .plr import arrives with settings UI
const estimator = windEstimator();                 // VEN-001: OUR wind, never merged with theirs
const avgVario = rollingVario(30);                 // POS-006
let goal: { lon: number; lat: number; elev: number } | null = null;

const setting = (id: string, fallback: number): number => {
  const v = Number((app.querySelector(id) as HTMLInputElement).value);
  return Number.isFinite(v) ? v : fallback;
};

/** The ESTIMATED badge (VEN-001). Same loud honesty as the briefing's MODELLED: this wind is
 *  our inference from circle drift, not the instrument's measurement, and the two must never
 *  wear the same label. */
const EST_BADGE = ' <span class="badge estimated" title="from circle drift — an estimate, not the instrument">est</span>';

function render(s: NavState, link: LinkState): void {
  const mc = setting('#set-mc', 1);
  const qnh = setting('#set-qnh', 1013.25);
  const reserve = setting('#set-reserve', 200);
  const d = derive(s, polar, qnh);
  const estWind = estimator.estimate();
  const stf = speedToFly(polar, mc, d.netto ?? 0);

  // PLA-004: the glide to the goal, priced against the headwind component of OUR estimated
  // wind (the instrument's, when we have no estimate yet — the box's title says which).
  let arr: ReturnType<typeof arrival> = null;
  let windUsed = '';
  if (goal && s.fix && s.fix.alt != null) {
    const dist = distM(s.fix.lon, s.fix.lat, goal.lon, goal.lat);
    const brg = bearingDeg(s.fix.lon, s.fix.lat, goal.lon, goal.lat);
    const w = estWind ?? s.reportedWind ?? null;
    windUsed = w === estWind && estWind ? 'estimated wind' : w ? 'instrument wind' : 'no wind';
    const head = w ? w.speed * Math.cos((w.direction - brg) * Math.PI / 180) : 0;
    arr = arrival(polar, mc, s.fix.alt, dist, goal.elev, head, reserve);
  }

  flyView.innerHTML = `
    <div class="boxes">
      ${box('Latitude', fmt(s.fix?.lat, 5), '°')}
      ${box('Longitude', fmt(s.fix?.lon, 5), '°')}
      ${box('Altitude', fmt(s.fix?.alt), 'm')}
      ${box('Alt QNH', fmt(d.qnhAlt), 'm')}
      ${box('Ground', fmt(s.groundElev), 'm')}
      ${box('Height AGL', fmt(s.agl), 'm')}
      ${box('Vario', fmt(s.vario, 1), 'm/s')}
      ${box('Avg 30 s', fmt(avgVario.average(), 1), 'm/s')}
      ${box('Netto', fmt(d.netto, 1), 'm/s')}
      ${box('TAS', fmt(d.tas && d.tas * 3.6), 'km/h')}
      ${box('Ground speed', fmt(s.groundSpeed && s.groundSpeed * 3.6), 'km/h')}
      ${box('Speed to fly', fmt(stf * 3.6), 'km/h')}
      ${box('Wind (instrument)', s.reportedWind ? `${s.reportedWind.direction.toFixed(0)}°` : null,
            s.reportedWind ? `/ ${(s.reportedWind.speed * 3.6).toFixed(0)} km/h` : '')}
      ${box('Wind', estWind ? `${estWind.direction.toFixed(0)}°` : null,
            estWind ? `/ ${(estWind.speed * 3.6).toFixed(0)} km/h` : '', EST_BADGE)}
      ${goal ? box(`Arrival <span class="goal-hint" title="${windUsed}">▸ goal</span>`,
                   fmt(arr && arr.height), 'm') : ''}
    </div>
    <div class="link ${link.state}">Link: ${link.state}${
      link.state === 'closed' && link.error ? ` — ${link.error}` : ''
    }</div>
  `;
}

(app.querySelector('#connect') as HTMLFormElement).onsubmit = e => {
  e.preventDefault();
  const host = (app.querySelector('#host') as HTMLInputElement).value;
  const port = Number((app.querySelector('#port') as HTMLInputElement).value);
  void run(tcpDevice(host, port));
};
(app.querySelector('#igc') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  // ACQ-010, through the front door: the file becomes sentences, and from here on the
  // computer cannot tell it from Condor. 100 ms per fix ≈ a flight at 10× real time —
  // fast enough to sweep a whole flight, slow enough to watch the numbers move.
  const sentences = igcToSentences(await f.text());
  void run({ id: `replay:${f.name}`, label: f.name, link: 'replay', open: replaySource(sentences, 100) });
};
(app.querySelector('#set-goal') as HTMLButtonElement).onclick = () => {
  // The goal is where the glider IS, at the ground the DEM knows there. No fix or no ground
  // means no goal — a final glide to an invented elevation is exactly the number PLA-004
  // must never show.
  if (!state.fix || state.groundElev == null) {
    (app.querySelector('#goal-label') as HTMLElement).textContent = 'no goal — need a fix over known ground';
    return;
  }
  goal = { lon: state.fix.lon, lat: state.fix.lat, elev: state.groundElev };
  (app.querySelector('#goal-label') as HTMLElement).textContent =
    `goal ${goal.lat.toFixed(3)}, ${goal.lon.toFixed(3)} @ ${goal.elev.toFixed(0)} m`;
  render(state, link);
};
app.querySelector<HTMLFormElement>('#fly-set')!.oninput = () => render(state, link);

let state: NavState = EMPTY;
let link: LinkState = { state: 'idle' };

// One source at a time. A second Connect (or a replay over a live link) SUPERSEDES the first:
// without this, both loops keep running and race their writes to `state`, and the screen
// interleaves two flights — a confirmed bug, reproduced with two live streams.
let runGen = 0;
let stopCurrent: (() => void) | null = null;

async function run(dev: Device): Promise<void> {
  const gen = ++runGen;
  // Retire the old loop at its next yield, and close its native link BEFORE opening the new
  // one — this ordering is what keeps the close off the successor's socket.
  stopCurrent?.();
  await closeLinks();
  if (gen !== runGen) return;                    // superseded while the old link was closing
  const watched = withHealth(dev.open(), s => {
    if (gen !== runGen) return;                  // a dead loop's link chip is nobody's news
    link = s; render(state, link);
  });
  // The whole flight computer, in one expression: a stream of sentences, a terrain sampler,
  // a driver. It does not know that Tauri, or a TCP socket, or Condor exist.
  const it = navigate(lines(watched), elev, 'condor2')[Symbol.asyncIterator]();
  stopCurrent = () => void it.return?.();
  for (;;) {
    const { value, done } = await it.next();
    if (done || gen !== runGen) break;
    state = value;
    if (state.fix) {
      terrain.ensure(state.fix.lon, state.fix.lat);
      // The estimator eats every fix; the averager only real vario samples, clocked by the
      // fix's own seconds — a replay must average exactly as the live flight did.
      if (state.fix.alt != null) estimator.add(state.fix.lon, state.fix.lat, state.fix.alt, state.fix.sod);
      if (state.vario != null) avgVario.add(state.fix.sod, state.vario);
    }
    render(state, link);
  }
}

// ============ the Briefing screen — Phase 1 ============
// The skeleton is built exactly ONCE: these are inputs the pilot TYPES into, and a re-render
// that eats the caret mid-longitude is a form nobody trusts. Only the output containers
// (#bf-net, #bf-completeness, #bf-briefing, …) are ever repainted.

bf.innerHTML = `
  <h1>VOLPLANE — briefing</h1>
  <div id="bf-net"></div>
  <form id="bf-form">
    <label>lon <input id="bf-lon" size="8" inputmode="decimal" placeholder="—" /></label>
    <label>lat <input id="bf-lat" size="8" inputmode="decimal" placeholder="—" /></label>
    <label>radius <input id="bf-radius" size="4" value="20" /> km</label>
    <label>day <input id="bf-day" type="date" /></label>
    <button type="submit">Provision pack</button>
    <span id="bf-progress" class="progress"></span>
  </form>
  <div id="bf-completeness"></div>
  <label class="hour">hour (UTC)
    <input id="bf-hour" type="range" min="0" max="23" value="12" />
    <span id="bf-hour-val" class="val">12:00</span>
  </label>
  <fieldset id="bf-sandbox" class="sandbox-controls">
    <legend><label><input id="bf-sandbox-on" type="checkbox" /> sandbox — synthetic atmosphere</label></legend>
    <label>wind <input id="k-wind" size="4" value="4" /> m/s</label>
    <label>dir <input id="k-dir" size="4" value="270" /> °</label>
    <label>shear <input id="k-shear" size="4" value="2" /> m/s·km⁻¹</label>
    <label>N <input id="k-nStab" size="6" value="0.010" /> s⁻¹</label>
    <label>Tsurf <input id="k-tsurf" size="4" value="22" /> °C</label>
    <label>RH <input id="k-rh" size="4" value="45" /> %</label>
  </fieldset>
  <div id="bf-briefing"></div>
  <div id="bf-emagram" class="emagram-frame"></div>
  <div class="liftmap">
    <div class="canvas-frame"><canvas id="bf-canvas" width="480" height="480"></canvas></div>
    <div class="mixer-side">
      <div id="bf-comps" class="comp-toggles"></div>
      <div id="bf-mixer"></div>
      <div id="bf-legend"></div>
      <label class="replay">calibrate from today's IGC <input id="bf-igc" type="file" accept=".igc" /></label>
      <div id="bf-cal" class="cal">calibration —</div>
    </div>
  </div>
`;

const q = <T extends HTMLElement>(sel: string): T => bf.querySelector(sel) as T;
const lonIn = q<HTMLInputElement>('#bf-lon');
const latIn = q<HTMLInputElement>('#bf-lat');
const radiusIn = q<HTMLInputElement>('#bf-radius');
const dayIn = q<HTMLInputElement>('#bf-day');
const hourIn = q<HTMLInputElement>('#bf-hour');
const hourVal = q('#bf-hour-val');
const progressEl = q('#bf-progress');
const netEl = q('#bf-net');
const completenessEl = q('#bf-completeness');
const briefingEl = q('#bf-briefing');
const emagramEl = q('#bf-emagram');
const sandboxFs = q<HTMLFieldSetElement>('#bf-sandbox');
const sandboxIn = q<HTMLInputElement>('#bf-sandbox-on');
const compsEl = q('#bf-comps');
const mixerEl = q('#bf-mixer');
const legendEl = q('#bf-legend');
const canvas = q<HTMLCanvasElement>('#bf-canvas');
const igcIn = q<HTMLInputElement>('#bf-igc');
const calEl = q('#bf-cal');

// Today is the day a briefing is usually for (OFF-003's common case: brief now, fly today).
// A DEFAULT, not a measurement — the pilot changes it for tomorrow's pack.
dayIn.value = new Date().toISOString().slice(0, 10);

// One checkbox per kernel component: built from LIFT_COMPS, so a component the kernel grows
// appears here without this file changing (the same contract mixerSvg lives by).
compsEl.innerHTML = LIFT_COMPS.map((c, i) =>
  `<label><input type="checkbox" data-i="${i}" checked /> ${c.key}</label>`).join('');

// ---- briefing state ----

let bfSpec: PackSpec | null = null;
let bfHeld: Held | null = null;
let bfWx: Wx | null = null;
let bfHour = 12;
let bfSource: Provenance = 'forecast';
let bfCal = 1;                                          // POT-006 factor; 1 = uncalibrated
let bfMap: LiftMap | null = null;
const bfOn: boolean[] = LIFT_COMPS.map(() => true);
let bfMix: number[] = LIFT_COMPS.map(() => 1 / LIFT_COMPS.length);
// Refreshes overlap (a keystroke mid-download, a tab switch mid-read); the newest one wins
// and the stale ones discard their answer instead of painting yesterday's spec.
let bfEpoch = 0;

// ---- reading the form ----

// An empty or unparsable input is null — the form's spelling of UNKNOWN, same as the screen's.
const num = (el: HTMLInputElement): number | null => {
  if (el.value.trim() === '') return null;
  const v = Number(el.value);
  return Number.isFinite(v) ? v : null;
};

/** The pack the form currently asks for, or null while the ask is incomplete. The id folds
 *  day and centre (2 decimals ≈ 1 km — packs a village apart share their cache); the area is
 *  the radius turned into degrees at this latitude. |lat| ≤ 85 is web mercator's own edge:
 *  beyond it the tile pyramid has nothing to promise. */
function readSpec(): PackSpec | null {
  const lon = num(lonIn), lat = num(latIn), radius = num(radiusIn), day = dayIn.value;
  if (lon == null || lat == null || radius == null || !day) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 85 || !(radius > 0)) return null;
  const dLat = radius * 1000 / M_PER_LAT;
  const dLon = radius * 1000 / mPerLng(lat);
  return {
    id: `${day}:${lon.toFixed(2)}:${lat.toFixed(2)}`,
    name: `${radius} km around ${lat.toFixed(2)}, ${lon.toFixed(2)} on ${day}`,
    area: { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat },
    day,
  };
}

// Sandbox knobs are the pilot's what-if dials (WX-005), not measurements — a blank dial reads
// as 0 by choice, because the pilot set it, not because the sky did.
const knob = (id: string): number => {
  const v = Number(q<HTMLInputElement>(id).value);
  return Number.isFinite(v) ? v : 0;
};
const readKnobs = (): WxKnobs => ({
  wind: knob('#k-wind'), dir: knob('#k-dir'), shear: knob('#k-shear'),
  nStab: knob('#k-nStab'), tsurf: knob('#k-tsurf'), rh: knob('#k-rh'),
});

const centreOf = (s: PackSpec) =>
  ({ lon: (s.area.west + s.area.east) / 2, lat: (s.area.south + s.area.north) / 2 });
const radiusMOf = (s: PackSpec) => (s.area.north - s.area.south) / 2 * M_PER_LAT;
const dayMsOf = (s: PackSpec) => Date.parse(`${s.day}T00:00:00Z`);

// ---- painting, from the bottom up ----

const MIXER_SIZE = 200;

/** Repaint the canvas, mixer and legend from what is already computed. The cheap end of the
 *  refresh ladder: a mixer drag lands here and nowhere higher. */
function paintMap(): void {
  const ctx = canvas.getContext('2d')!;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#10141a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (bfMap && bfSpec) {
    const view: View = {
      centre: centreOf(bfSpec), widthM: 2 * radiusMOf(bfSpec),
      wPx: canvas.width, hPx: canvas.height,
    };
    // The MODELLED watermark is inside paintLiftMap, unconditionally — not this caller's to
    // remember, by design (POT-007). The cast is only about fillStyle's union: the painter
    // writes strings and a real 2D context accepts them, but TS reads the property's wider
    // getter type and refuses the structural match.
    paintLiftMap(ctx as unknown as Paint2D, bfMap, view, bfOn, bfMix);
  } else {
    // No area chosen yet: the honest dash, not an empty map pretending to be a quiet sky.
    ctx.fillStyle = '#8b93a1';
    ctx.font = '32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('—', canvas.width / 2, canvas.height / 2);
    ctx.textAlign = 'start';
  }
  mixerEl.innerHTML = mixerSvg(bfOn, bfMix, MIXER_SIZE);
  // The map rides along so the legend can say WHY a layer is quiet: unknown terrain, no
  // driver, or genuinely nothing — three facts one empty canvas cannot distinguish (POT-007).
  legendEl.innerHTML = legendHtml(bfOn, bfMap);
}

/** Re-brief the hour from the weather already in hand: panel, emagram, lift map. The hour
 *  slider lands here — computeLiftMap is milliseconds at briefing grid sizes, so the map
 *  follows the slider live. */
function renderDay(): void {
  const b = briefingAt(bfWx, bfHour, bfSource);
  briefingEl.innerHTML = briefingHtml(b);
  emagramEl.innerHTML = emagramSvg(b.sounding, 460, 300);
  bfMap = bfSpec
    ? computeLiftMap(centreOf(bfSpec), radiusMOf(bfSpec), elev, bfWx, bfHour, dayMsOf(bfSpec), bfCal)
    : null;
  paintMap();
}

/** The connectivity chip (OFF-005): link state, snapshot age, and — when the KV fell back to
 *  memory — the warning that this cache dies with the app. */
function renderNet(): void {
  netEl.innerHTML = offlineBadgeHtml(
    navigator.onLine, isPersistent(kv), bfHeld?.weather?.fetchedAt ?? null, Date.now());
}

/** The full refresh: form → spec → holdings → completeness → weather → day. Runs on screen
 *  entry, on any spec-shaping input, on the sandbox controls, and after a provisioning run —
 *  everything that can change WHAT is being briefed rather than merely which hour of it. */
async function refreshBriefing(): Promise<void> {
  const epoch = ++bfEpoch;
  const prevId = bfSpec?.id;
  bfSpec = readSpec();
  // A calibration is a claim about ONE site, day and atmosphere. Any change of what is being
  // briefed retires it — silently carrying it to another mountain would scale that mountain's
  // thermals by this one's error (the finding that put this reset here).
  if (bfSpec?.id !== prevId) {
    bfCal = 1;
    calEl.textContent = 'calibration —';
  }
  if (!bfSpec) {
    bfHeld = null;
    completenessEl.innerHTML =
      '<div class="pack-status unknown">No pack — enter a centre, a radius and a day above.</div>';
    renderNet();
    // The sandbox needs no pack: a synthetic sky can be briefed with nothing on disk. The
    // surface reference is unknown without a centre, so the kernel's documented fallback (0)
    // stands in — the briefing's altitudes say what the model was given, nothing more.
    bfWx = bfSource === 'sandbox' ? sandboxWx(readKnobs(), 0) : null;
    renderDay();
    return;
  }
  const c = centreOf(bfSpec);
  // Pull the WHOLE briefing area into memory (off the KV when offline): the lift fields
  // sample the full pack radius, and a map computed over the centre's 3×3 ring alone would
  // be mostly-unknown ground presented as a quiet sky. onTilesChanged re-briefs as they land.
  terrain.ensure(c.lon, c.lat);
  terrain.ensureArea(bfSpec.area);
  const held = await heldFor(bfSpec, kv);
  if (epoch !== bfEpoch) return;
  bfHeld = held;
  completenessEl.innerHTML = completenessHtml(completeness(bfSpec, held, Z, Date.now()));
  renderNet();
  const refElev = elev(c.lon, c.lat);
  if (bfSource === 'sandbox' && refElev == null) {
    // The synthetic sky is anchored to the surface under it, and that surface is UNKNOWN —
    // not sea level. Building the sandbox on an invented 0 m would put its cloudbase, wind
    // ladder and whole sounding at wrong altitudes while looking entirely plausible. Brief
    // nothing; the tile is on its way, and onTilesChanged re-enters here when it lands.
    bfWx = null;
    renderDay();
    return;
  }
  const wx = bfSource === 'sandbox'
    ? sandboxWx(readKnobs(), refElev!)              // non-null: the guard above just returned
    : await loadWeather(bfSpec, kv, refElev ?? 0);
  if (epoch !== bfEpoch) return;
  bfWx = wx;
  renderDay();
}

// ---- events ----

// window.fetch called through a plain reference can throw "Illegal invocation" in some
// webviews; a wrapper arrow keeps the receiver and the cast keeps bun's wider fetch type.
const boundFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, init)) as typeof fetch;

q<HTMLFormElement>('#bf-form').onsubmit = e => {
  e.preventDefault();
  const spec = readSpec();
  if (!spec) {
    progressEl.textContent = 'enter a centre, a radius and a day first';
    return;
  }
  progressEl.textContent = 'starting…';
  void downloadPack(spec, kv, boundFetch, (done, total) => {
    progressEl.textContent = `${done}/${total}`;
  }, Date.now).then(({ ok, failed }) => {
    // Counts, not verdicts: the completeness panel below is where failures become words
    // (OFF-010), and refreshBriefing repaints it from what actually landed.
    progressEl.textContent = failed === 0
      ? `done — ${ok} items held`
      : `${ok} held, ${failed} failed — see completeness below`;
    void refreshBriefing();
  }, () => {
    // downloadPack counts item failures instead of throwing; only the store itself dying can
    // land here. What was written IS written — re-measure and let completeness say the rest.
    progressEl.textContent = 'download interrupted — see completeness below';
    void refreshBriefing();
  });
};

for (const el of [lonIn, latIn, radiusIn, dayIn]) el.onchange = () => void refreshBriefing();

hourIn.oninput = () => {
  bfHour = Number(hourIn.value);
  hourVal.textContent = `${bfHour}:00`;
  renderDay();
};

// The whole fieldset shares one handler: the toggle and every knob re-derive the source and
// re-brief. The .sandbox banner and the badges come from the DATA (briefingAt carries the
// provenance) — nothing here styles anything, so the UI cannot disagree with the value.
sandboxFs.onchange = () => {
  bfSource = sandboxIn.checked ? 'sandbox' : 'forecast';
  // A different atmosphere is a different day to calibrate against: the factor was measured
  // against ONE sky, and it does not follow the pilot across the toggle.
  bfCal = 1;
  calEl.textContent = 'calibration —';
  void refreshBriefing();
};

compsEl.onchange = e => {
  const t = e.target as HTMLInputElement;
  const i = Number(t.dataset.i);
  if (Number.isInteger(i) && i >= 0 && i < bfOn.length) {
    bfOn[i] = t.checked;
    paintMap();                       // applyWeights renormalises; what is off is off
  }
};

// The mixer drag. Handlers sit on the CONTAINER, which survives the innerHTML repaint each
// drag step causes — capture on the svg itself would die with the first repaint.
let dragging = false;
const mixFromEvent = (e: PointerEvent): void => {
  const svg = mixerEl.querySelector('svg');
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  bfMix = mixerHit(
    (e.clientX - r.left) * MIXER_SIZE / r.width,
    (e.clientY - r.top) * MIXER_SIZE / r.height,
    bfOn, MIXER_SIZE);
  paintMap();
};
mixerEl.onpointerdown = e => { dragging = true; mixerEl.setPointerCapture(e.pointerId); mixFromEvent(e); };
mixerEl.onpointermove = e => { if (dragging) mixFromEvent(e); };
mixerEl.onpointerup = mixerEl.onpointercancel = e => {
  dragging = false;
  mixerEl.releasePointerCapture(e.pointerId);
};

// POT-006: today's real climbs against today's modelled ones, one factor out. The factor is
// itself a model product, so it wears the badge; when the kernel refuses (no forecast, fewer
// climbs than it will presume on) the display refuses too — a dash, not a fake ×1.00.
igcIn.onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  if (!bfSpec) {
    calEl.textContent = 'calibration — (choose an area and day first)';
    return;
  }
  const pts = parseIGC(await f.text());
  // The display's gate IS the kernel's gate: `usable` is calib's own count of climbs it could
  // form a ratio from, carried out of calibrateFromTrack precisely so this cannot drift. A
  // refused calibration (factor forced to 1) must read as a dash, not as a confident ×1.00 —
  // that was a confirmed finding, and counting DETECTED climbs instead of usable ones was it.
  const { factor, usable } = calibrateFromTrack(pts, elev, dayMsOf(bfSpec), bfWx, bfHour);
  const accepted = bfWx != null && usable >= MIN_RATIOS;
  bfCal = accepted ? factor : 1;
  calEl.innerHTML = accepted
    ? `calibration ×${bfCal.toFixed(2)}`
      + ' <span class="badge modelled" title="indicative, not validated — not a measurement">modelled</span>'
      + ` (from ${usable} usable climbs)`
    : `calibration — (needs a forecast and ≥ ${MIN_RATIOS} usable climbs)`;
  renderDay();
};

// Connectivity is a state, not an event to miss: the chip follows the browser's own word.
window.addEventListener('online', renderNet);
window.addEventListener('offline', renderNet);

// Age is a clock, not a snapshot: a "2 h old" chip rendered at breakfast must not still say
// 2 h at noon, and a snapshot crosses the 48 h staleness line without any event firing. One
// minute is far finer than either scale and costs nothing.
setInterval(() => {
  if (bf.hidden) return;                        // re-measured on entry anyway (OFF-010)
  renderNet();
  if (bfSpec && bfHeld)
    completenessEl.innerHTML = completenessHtml(completeness(bfSpec, bfHeld, Z, Date.now()));
}, 60_000);

// Tiles land asynchronously — from provisioning, from the briefing's own ensureArea, from the
// Fly screen's wake. Each landing changes what the briefing's ground knows; the debounce
// turns a provisioning burst into one re-brief instead of hundreds.
let tileTimer: ReturnType<typeof setTimeout> | undefined;
onTilesChanged = () => {
  if (bf.hidden || !bfSpec) return;
  clearTimeout(tileTimer);
  tileTimer = setTimeout(() => void refreshBriefing(), 500);
};

// ---- tabs ----

const tabFly = root.querySelector<HTMLButtonElement>('#tab-fly')!;
const tabBf = root.querySelector<HTMLButtonElement>('#tab-briefing')!;
function showTab(which: 'fly' | 'briefing'): void {
  app.hidden = which !== 'fly';
  bf.hidden = which !== 'briefing';
  tabFly.classList.toggle('active', which === 'fly');
  tabBf.classList.toggle('active', which === 'briefing');
  if (which === 'briefing') {
    // The form opens already pointed at where the glider is — prefilled from the last fix,
    // but only into EMPTY inputs: a centre the pilot typed is the pilot's.
    if (state.fix && lonIn.value.trim() === '' && latIn.value.trim() === '') {
      lonIn.value = state.fix.lon.toFixed(3);
      latIn.value = state.fix.lat.toFixed(3);
    }
    // Screen entry re-measures (OFF-010): the completeness shown is of the disk as it IS,
    // not as it was when something last rendered.
    void refreshBriefing();
  }
}
tabFly.onclick = () => showTab('fly');
tabBf.onclick = () => showTab('briefing');

render(state, link);
