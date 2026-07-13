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
import { speedToFly, arrival, glideRatio } from '../core/glide';
import { windEstimator } from '../core/wind';
import { parsePflau, parsePflaa, trafficStore, SEE_AND_AVOID, type FlarmStatus } from '../core/flarm';
import { igcLogger, type IgcLogger } from '../core/igclog';
import { openJournal, recoverOrphan, clearJournal, type Journal } from './igcjournal';
import {
  parseOpenAir, incursions, activeIncursions, acknowledge, ackKey,
  type Airspace, type Ack,
} from '../core/airspace';
import {
  RULES, simpleTask, freshProgress, advance, freshAat, advanceAat, scoredDistanceM,
  type Task, type TaskProgress, type Waypoint, type AatProgress,
} from '../core/task';
import { reachable, type ReachRay } from '../core/reach';
import { varioTone, stfTone } from '../core/vartone';
import { barograph, effectiveGlide, climbs } from '../core/analysis';
import { freeDistance, faiTriangle } from '../core/optimise';
import { openAudio, type AudioOut } from './audio';
import { xsectionSvg } from './xsection-ui';
import { paintMap as paintMovingMap, type MapPaint2D } from './map-ui';
import type { View as MapView } from './liftmap-ui';
import { completeness, specFor, type Completeness, type PackSpec, type Held } from '../core/pack';
import { normalizeSettings, activePolar, type Settings } from '../core/config';
import { upsertPack, touchPack, setPinned, removePack, sortedShelf, updateOffers, type Shelf } from '../core/shelf';
import type { EvictionPlan } from '../core/cachebudget';
import { briefingAt, sandboxWx, type Provenance } from '../core/briefing';
import { computeLiftMap, calibrateFromTrack, type LiftMap } from '../core/liftmap';
import { offerableLinks, missingLinks, type Platform } from '../core/links';
import type { Driver } from '../core/nmea';
import { tcpDevice, udpDevice, replaySource, closeLinks } from './tauri-source';
import { terrainStore, Z } from './terrain';
import { openStore, isPersistent } from './store';
import { downloadPack, heldFor, loadWeather } from './provision';
import {
  loadShelf, saveShelf, heldForShelf, tileInventory, enforceBudget,
  saveFlightFile, loadFlightFile, loadSettings, saveSettings,
} from './packstore';
import { shelfHtml, cacheHtml, BYTES_PER_MB } from './shelf-ui';
import { completenessHtml, offlineBadgeHtml, briefingHtml, emagramSvg } from './briefing-ui';
import { paintLiftMap, mixerSvg, mixerHit, legendHtml, type Paint2D, type View } from './liftmap-ui';
import { elevAtFromTiles, mPerLng, M_PER_LAT, distM, bearingDeg } from 'soaring-core/geo';
import { DEFAULT_POLAR, type Polar } from 'soaring-core/polar';
import { parseIGC } from 'soaring-core/igc';
import { MIN_RATIOS } from 'soaring-core/lift/calib';
import { LIFT_COMPS } from 'soaring-core/lift/mix';
import type { Wx, WxKnobs } from 'soaring-core/weather';
import type { TrackPoint } from 'soaring-core/types';

// The cache under everything (OFF-002), opened before the terrain store exists because the
// store's very first read may already be a disk hit. openStore never throws — worst case the
// KV is memory-only and the offline badge says so out loud (OFF-005).
const kv = await openStore('volplane');

// The shelf as the last session left it (OFF-002): the packs the pilot promised himself,
// read back before any screen renders. The settings come back the same way, through core's
// own normalizer (garbage bytes are the factory defaults, never a throw), and everything
// below READS this one value: the cache ceiling, the polar that flies, the airspace classes
// that alert. Every write goes back through normalizeSettings first — the disk only ever
// holds a shape the normalizer already blessed.
let shelf: Shelf = await loadShelf(kv);
let settings: Settings = await loadSettings(kv);

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
    <button id="tab-analysis" type="button">Analysis</button>
  </nav>
  <div id="fly"></div>
  <div id="briefing" hidden></div>
  <div id="analysis" hidden></div>
`;
const app = root.querySelector<HTMLElement>('#fly')!;
const bf = root.querySelector<HTMLElement>('#briefing')!;

// ============ the Fly screen — Phase 0's six numbers + Phase 2's computer ============
// Built ONCE, like the briefing: the settings and connect forms are things the pilot types
// into, and a 1 Hz render that rebuilt them would eat the caret mid-QNH (the briefing learnt
// this first; the Fly screen inherits the lesson). Only #fly-view repaints per state.

// The connect form is built from ACQ-012's capability matrix, not hand-written: a link the
// OS forbids never reaches the DOM, and a link the OS allows but this build cannot drive yet
// is NAMED below the form — the pilot learns the gap from the screen, not from failure.
const platform: Platform =
  navigator.platform.startsWith('Mac') ? 'macos'
  : navigator.platform.startsWith('Win') ? 'windows' : 'linux';
const offered = offerableLinks(platform).filter(l => l !== 'replay');   // replay has its own file input
const notYet = missingLinks(platform);

app.innerHTML = `
  <h1>VOLPLANE</h1>
  <div id="fly-view"></div>
  <form id="fly-set" class="fly-set">
    <label>MC <input id="set-mc" size="3" value="1.0" inputmode="decimal" /> m/s</label>
    <label>QNH <input id="set-qnh" size="5" value="1013.25" inputmode="decimal" /> hPa</label>
    <label>reserve <input id="set-reserve" size="4" value="200" inputmode="numeric" /> m</label>
    <button id="set-goal" type="button" title="make the current position and ground the final-glide goal">goal: here</button>
    <span id="goal-label" class="goal-label">no goal</span>
    <button id="rec" type="button" title="record the flight as an IGC file (LOG)">● record</button>
    <label class="replay">airspace (OpenAir) <input id="oa" type="file" accept=".txt,.openair" /></label>
    <span id="oa-label" class="goal-label"></span>
    <label class="replay" title="TSK: waypoints as 'name,lon,lat[,aat]' lines — start first, finish last, fai-2024 sectors; 'aat' marks an assigned area">task (CSV)
      <input id="tsk" type="file" accept=".csv,.txt" /></label>
    <span id="tsk-label" class="goal-label"></span>
    <label class="replay" title="PLA-010: your glider's polar, as a WinPilot .plr file">polar (.plr)
      <input id="plr" type="file" accept=".plr,.txt" /></label>
    <span id="plr-label" class="polar-label"></span>
    <button id="plr-default" type="button" title="forget the imported polar and fly the built-in default">default</button>
    <label class="replay" title="ESP-004: airspace classes that ALERT, comma-separated — empty means all; the map always draws everything">alert classes
      <input id="set-classes" size="10" placeholder="all" /></label>
  </form>
  <div class="canvas-frame map-frame">
    <canvas id="map" width="480" height="480"></canvas>
    <div class="map-zoom">
      <button id="zoom-in" type="button">+</button>
      <button id="zoom-out" type="button">−</button>
    </div>
  </div>
  <div id="xsection" class="xsection-frame"></div>
  <form id="audio-set" class="fly-set">
    <button id="audio-on" type="button" title="VAR-004: the vario, out loud. Browsers only allow sound after a click — this is that click.">🔇 audio off</button>
    <label><input id="audio-stf" type="checkbox" /> speed-to-fly mode (VAR-005)</label>
  </form>
  <form id="connect">
    <select id="linksel">${offered.map(l => `<option value="${l}">${l.toUpperCase()}</option>`).join('')}</select>
    <input id="host" value="127.0.0.1" size="12" />
    <input id="port" value="4353" size="5" />
    <select id="driver" title="ACQ-003: Condor 2 and 3 disagree on the LXWP0 wind direction — the driver is a claim about the instrument, not a preference">
      <option value="condor2">Condor 2</option>
      <option value="condor3">Condor 3</option>
      <option value="generic">generic NMEA</option>
    </select>
    <button type="submit">Connect</button>
    <label class="replay">or replay an IGC file <input id="igc" type="file" accept=".igc" /></label>
  </form>
  <div class="link">Condor: Setup → Options → NMEA output → TCP, port 4353.${
    notYet.length ? ` Not yet drivable in this build: ${notYet.join(', ')}.` : ''}</div>
`;
const flyView = app.querySelector<HTMLElement>('#fly-view')!;
const linkSel = app.querySelector<HTMLSelectElement>('#linksel')!;
const hostIn = app.querySelector<HTMLInputElement>('#host')!;
// UDP listens; it has no host to ask for. The field follows the selected link.
linkSel.onchange = () => { hostIn.hidden = linkSel.value === 'udp'; };

const fmt = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? null : v.toFixed(digits);

function box(k: string, v: string | null, u = '', badge = ''): string {
  return `<div class="box${v == null ? ' unknown' : ''}">
    <div class="k">${k}${badge}</div>
    <div class="v">${v ?? '—'}<span class="u">${v == null ? '' : u}</span></div>
  </div>`;
}

// ---- the flight computer's own state (Phase 2) ----

// PLA-010: the polar that flies is a SETTING, and activePolar is the one spelling of which
// one that is — every glide call below reads this binding, so importing a .plr swaps the
// whole computer's polar in one assignment.
let polar: Polar = activePolar(settings);
const estimator = windEstimator();                 // VEN-001: OUR wind, never merged with theirs
const avgVario = rollingVario(30);                 // POS-006
let goal: { lon: number; lat: number; elev: number } | null = null;

// ---- Phase 4: traffic, the logger, the airspace ----
const traffic = trafficStore();                    // FLM: the picture, aged on read
let flarm: FlarmStatus | null = null;              // FLM: the instrument's own judgement
let logger: IgcLogger | null = null;               // LOG: recording when non-null
let journal: Journal | null = null;                // SYS-001: the on-disk copy of the recording
let orphanBanner: HTMLElement | null = null;       // SYS-001: the recovered-flight offer, if up
let orphanFixes = 0;                               // what letting it go would cost, in fixes

/** Every path that destroys a recovered flight asks first — INCLUDING the accidental one.
 *  The journal the banner offers from is that flight's only copy, and starting a recording
 *  wipes the whole 'journal/' prefix: so tapping "record" with an offer still up is a
 *  destructive act wearing an innocent label, and it gets exactly the confirm the deliberate
 *  "dismiss" gets. Guarding the deliberate path and leaving the accidental one silent is the
 *  wrong way round. Answers true when there is nothing left to lose. */
async function releaseOrphan(): Promise<boolean> {
  if (!orphanBanner) return true;
  if (!confirm(`Discard the recovered flight (${orphanFixes} fixes)? It exists nowhere else.`)) return false;
  await clearJournal(kv);
  orphanBanner.remove();
  orphanBanner = null;
  return true;
}
let spaces: Airspace[] = [];                       // ESP: what the loaded file holds
let acks: Ack[] = [];                              // ESP-004: what the pilot silenced, and until when
let task: Task | null = null;                      // TSK: the declared task, if any
let taskProgress: TaskProgress | null = null;
let aat: AatProgress | null = null;                // TSK: best scoring fixes per assigned area
const trail: [number, number][] = [];              // CAR: the recent track
let mapWidthM = 20_000;                            // CAR: zoom, metres across the canvas
let audio: AudioOut | null = null;                 // VAR-004/005: null = silent, and it SAYS so
const flightTrack: TrackPoint[] = [];              // ANA/CNC: the flight, for the analysis tab

const setting = (id: string, fallback: number): number => {
  const v = Number((app.querySelector(id) as HTMLInputElement).value);
  return Number.isFinite(v) ? v : fallback;
};

/** The ESTIMATED badge (VEN-001). Same loud honesty as the briefing's MODELLED: this wind is
 *  our inference from circle drift, not the instrument's measurement, and the two must never
 *  wear the same label. */
const EST_BADGE = ' <span class="badge estimated" title="from circle drift — an estimate, not the instrument">est</span>';

/** FLM: the alarm and the picture, never without FLM-005's sentence. Shown only once a
 *  FLARM has spoken — a permanently empty traffic panel would teach the eye to skip it. */
function flarmHtml(s: NavState): string {
  if (!flarm) return '';
  const pic = traffic.picture(s.fix?.sod ?? 0);
  const rows = pic.slice(0, 5).map(t => {
    const dist = Math.hypot(t.relNorth, t.relEast);
    const vert = t.relVertical != null ? `${t.relVertical > 0 ? '+' : ''}${t.relVertical.toFixed(0)} m` : '—';
    return `<div class="traffic-row alarm-${t.alarm}">${t.id} · ${(dist / 1000).toFixed(1)} km · ${vert}${
      t.climbRate != null ? ` · ${t.climbRate.toFixed(1)} m/s` : ''}</div>`;
  }).join('');
  return `<div class="flarm alarm-${flarm.alarm}">
    <div class="flarm-status">FLARM${flarm.alarm ? ` — ALARM ${flarm.alarm}${
      flarm.bearing != null ? `, ${flarm.bearing > 0 ? '+' : ''}${flarm.bearing}°` : ''}${
      flarm.relDistance != null ? `, ${flarm.relDistance} m` : ''}` : ` — ${flarm.rx} heard`}</div>
    ${rows}
    <div class="see-avoid">${SEE_AND_AVOID}</div>
  </div>`;
}

/** ESP: the verdicts for now. 'inside' and 'predicted' never share a colour (ESP-003), and a
 *  worst-cased vertical says so in words (ESP-005). The verdicts are computed over ALL
 *  spaces, always — the class filter and the pilot's acknowledgements (ESP-004) mute the
 *  ALERTS, through activeIncursions, and never the judging or the map's picture. The ack
 *  button carries its volume's key; the delegated listener on #fly-view catches it, because
 *  these rows repaint at 1 Hz and a handler on the row would die with the first repaint. */
function airspaceHtml(s: NavState): string {
  if (!spaces.length || !s.fix) return '';
  const inc = incursions(spaces, s.fix.lon, s.fix.lat, s.fix.alt ?? null, s.track, s.groundSpeed);
  const act = activeIncursions(inc, settings.monitoredClasses, acks, s.fix.sod);
  if (!act.length) return '';
  const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<div class="airspace">${act.map(i =>
    `<div class="asp-row ${i.kind}">${i.kind === 'inside' ? 'INSIDE' : 'AHEAD 60 s'} — ${
      i.space.class} ${i.space.name}${i.worstCase ? ' (altitude unknown: worst case assumed)' : ''
    }<button class="ack-btn" type="button" data-ack="${attr(ackKey(i.space))
    }" title="silence this volume for five minutes — it alerts again after">ack 5 min</button></div>`,
  ).join('')}</div>`;
}

/** TSK: the declared task's live state — which point is next, which are turned, and what
 *  the flight has SCORED so far (TSK-003). The scored distance is null before the start
 *  validates, and null renders as the dash: an unstarted task has no scored distance, and
 *  showing 0.0 km would be a fake zero (POT-007). */
function taskHtml(): string {
  if (!task || !taskProgress) return '';
  const rows = task.points.map((p, i) => {
    const done = taskProgress!.validatedAt[i] != null;
    const current = i === taskProgress!.next;
    return `<span class="tsk-pt${done ? ' done' : ''}${current ? ' current' : ''}">${p.wp.name}</span>`;
  }).join(' → ');
  const scored = aat ? scoredDistanceM(task, taskProgress, aat) : null;
  return `<div class="tsk">Task (${task.rules}): ${rows} — scored ${
    scored == null ? '—' : `${(scored / 1000).toFixed(1)} km`}${
    taskProgress.next >= task.points.length ? ' — COMPLETE' : ''}</div>`;
}

/** CAR + TER-005: repaint the canvas from the current state. Called from render, cheap at
 *  1 Hz — the reach march is 72 bearings over a cached tile lookup. */
function repaintMap(s: NavState): void {
  const canvasEl = app.querySelector<HTMLCanvasElement>('#map');
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d') as unknown as MapPaint2D;
  const centre = s.fix ? { lon: s.fix.lon, lat: s.fix.lat } : { lon: 8, lat: 47 };
  const view: MapView = { centre, widthM: mapWidthM, wPx: canvasEl.width, hPx: canvasEl.height };
  // The still-air range: AGL × best-glide L/D, no wind. It is the FALLBACK now — kept only
  // for when the reach cannot be marched, and still stamped with its assumption.
  const ld = glideRatio(polar, speedToFly(polar, 0));
  const rangeM = s.agl != null && ld != null && s.agl > 0 ? s.agl * ld : null;

  // TER-005/PLA-007: the reach over the terrain actually in the way, priced against the wind
  // we estimated. Needs an altitude — without one there is no glide slope to march.
  let reach: ReachRay[] | null = null;
  if (s.fix?.alt != null) {
    const w = estimator.estimate() ?? s.reportedWind ?? null;
    reach = reachable(elev, s.fix.lon, s.fix.lat, s.fix.alt, polar, {
      wind: w, safetyM: setting('#set-reserve', 200),
    });
    // Every ray blocked at zero means the DEM holds nothing here: an empty polygon painted as
    // a reach would say "you can go nowhere", which is a claim, not an absence.
    if (reach.every(r => r.distanceM === 0)) reach = null;
  }
  paintMovingMap(ctx, view, {
    state: s, trail, spaces, traffic: traffic.picture(s.fix?.sod ?? 0),
    goal: goal ? { lon: goal.lon, lat: goal.lat } : null, rangeM, reach,
  });

  // ANA-002: the slice straight ahead — the dimension the plan view flattens away.
  const xs = app.querySelector<HTMLElement>('#xsection');
  if (xs && s.fix?.alt != null && s.track != null) {
    xs.innerHTML = xsectionSvg({
      lon: s.fix.lon, lat: s.fix.lat, bearing: s.track, altM: s.fix.alt,
      rangeM: Math.min(mapWidthM, 30_000), glideRatio: ld, elev, spaces,
    });
  } else if (xs) {
    xs.innerHTML = '';                      // no track, no slice: nothing to draw ahead of
  }
}

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

  // SYS-002: a silent or closed source degrades the DISPLAY, not the application. The last
  // known values stay — a pilot mid-turn must not lose his numbers — but they visibly age:
  // dimmed, and captioned with what happened. A screen that keeps showing a dead
  // instrument's last position as current is the failure mode this class exists to prevent.
  const stale = link.state === 'silent' || link.state === 'closed';
  flyView.innerHTML = `
    <div class="boxes${stale ? ' stale' : ''}">
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
    ${flarmHtml(s)}
    ${airspaceHtml(s)}
    ${taskHtml()}
    <div class="link ${link.state}">Link: ${link.state}${
      link.state === 'closed' && link.error ? ` — ${link.error}` : ''
    }${stale ? ' — values are the LAST RECEIVED, not current' : ''}${
      journal?.lastError ? ` — journal writes failing (${journal.lastError}): a crash now loses the whole flight` : ''}</div>
  `;
  repaintMap(s);
}

(app.querySelector('#connect') as HTMLFormElement).onsubmit = e => {
  e.preventDefault();
  const port = Number((app.querySelector('#port') as HTMLInputElement).value);
  driver = (app.querySelector('#driver') as HTMLSelectElement).value as Driver;
  void run(linkSel.value === 'udp' ? udpDevice(port) : tcpDevice(hostIn.value, port));
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
// ESP-004: the ack rides the shelfEl pattern — ONE delegated listener on the container that
// is built once, because the alert rows under it repaint every second. The ack is keyed, not
// indexed: between the paint and the tap the row order may have changed, but the key still
// names the volume the pilot read.
flyView.onclick = e => {
  const btn = (e.target as HTMLElement).closest('button[data-ack]') as HTMLButtonElement | null;
  if (!btn || !state.fix) return;
  const space = spaces.find(sp => ackKey(sp) === btn.dataset.ack);
  if (!space) return;                     // a click racing a file reload: nothing left to ack
  acks = acknowledge(acks, space, state.fix.sod);
  render(state, link);
};
(app.querySelector('#rec') as HTMLButtonElement).onclick = async e => {
  const btn = e.target as HTMLButtonElement;
  if (!logger) {
    // openJournal below claims the 'journal/' prefix WHOLE — including the fixes a
    // recovered-flight banner is still offering. Ask before that becomes true; a pilot who
    // says no wanted to download the crashed flight first, and taking off with the recorder
    // running is not worth silently shredding it.
    if (!await releaseOrphan()) return;
    const day = new Date().toISOString().slice(0, 10);
    // The logger records; the journal insures it (SYS-001): every few seconds the drained
    // records land in the KV, so a crash costs at most one buffer, not the flight.
    logger = igcLogger({ day });
    btn.textContent = '■ stop & save';
    journal = await openJournal(kv, { day });
    return;
  }
  // Stop and hand the file over — a Blob download works in every webview the shell targets.
  // The journal is flushed BEFORE the file is assembled (belt and braces: even a death
  // between here and the download loses nothing) and discarded only AFTER the download was
  // offered — a journal found at the next startup then always means a crash.
  const lg = logger, j = journal;
  logger = null;
  journal = null;
  btn.textContent = '● record';
  if (j) await j.flush();
  const igc = lg.file();
  const n = lg.count();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([igc], { type: 'application/octet-stream' }));
  a.download = `volplane-${new Date().toISOString().slice(0, 10)}.igc`;
  a.click();
  URL.revokeObjectURL(a.href);
  if (j) await j.discard();
  (app.querySelector('#oa-label') as HTMLElement).textContent = `saved ${n} fixes`;
};
/** TSK: adopt a task from CSV text — one waypoint per line, "name,lon,lat" with an optional
 *  fourth field "aat" marking that point an assigned area (TSK-003). Lines that fail to
 *  parse are counted, not guessed at — same refusal discipline as OpenAir, and it covers the
 *  fourth field too: an unrecognised token there is refused, never silently read as a
 *  cylinder the pilot meant to be an area. Returns the label to show, or null when the text
 *  does not amount to a task. This is the ONE parse path: the file input and the restart
 *  restore (OFF-002) both come through here, so a restored task cannot behave differently
 *  from one just chosen. */
function adoptTask(text: string): string | null {
  const wps: { wp: Waypoint; aat: boolean }[] = [];
  let refused = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, lonS, latS, flag] = line.split(',').map(x => x.trim());
    const lon = Number(lonS), lat = Number(latS);
    const mark = (flag ?? '').toLowerCase();
    if (name && Number.isFinite(lon) && Number.isFinite(lat) && (mark === '' || mark === 'aat'))
      wps.push({ wp: { name, lon, lat }, aat: mark === 'aat' });
    else refused++;
  }
  if (wps.length < 2) return null;
  // No area marked: the club default, exactly as before. Any area marked: the same shape —
  // line start, line finish — with each marked point an aatArea at the rules' own radius.
  // First and last are gates regardless of a mark: a task cannot start or finish in an
  // assigned area under these rules, and advanceAat would refuse to score one anyway.
  if (wps.some(w => w.aat)) {
    const r = RULES['fai-2024'];
    task = {
      rules: 'fai-2024',
      points: wps.map((w, i) => ({
        wp: w.wp,
        sector: i === 0 ? { kind: 'line', lengthM: r.startLineM }
          : i === wps.length - 1 ? { kind: 'line', lengthM: r.finishLineM }
          : w.aat ? { kind: 'aatArea', radiusM: r.aatAreaM }
          : { kind: 'cylinder', radiusM: r.tpCylinderM },
      })),
    };
  } else {
    task = simpleTask(wps.map(w => w.wp), 'fai-2024');
  }
  taskProgress = freshProgress(task);
  aat = freshAat(task);
  const areas = task.points.filter(p => p.sector.kind === 'aatArea').length;
  return `${wps.length} points, ${task.rules}${areas ? `, ${areas} assigned area${areas > 1 ? 's' : ''}` : ''}${
    refused ? `, ${refused} lines refused` : ''}`;
}
(app.querySelector('#tsk') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const text = await f.text();
  const label = adoptTask(text);
  (app.querySelector('#tsk-label') as HTMLElement).textContent =
    label ?? 'a task needs at least a start and a finish';
  // OFF-002: the task survives the restart — saved as the RAW text, and only once adopted:
  // a file refused above is not a task, and must not come back next launch as one.
  if (label) void saveFlightFile(kv, 'task', { name: f.name, text });
  render(state, link);
};
// PLA-010: the name of the polar that FLIES, as words the pilot can check against his
// glider. The default is named as the default — an imported polar and the built-in one must
// never be mistaken for each other.
const polarName = (): string =>
  settings.polar ? settings.polar.name : `${DEFAULT_POLAR.name} (default)`;
const plrLabel = app.querySelector('#plr-label') as HTMLElement;
(app.querySelector('#plr') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  // The normalizer IS the gatekeeper: repairPolar runs the file through parsePlr and nulls
  // what the parser refuses — a second parse opinion here could only ever disagree with it.
  const next = normalizeSettings({ ...settings, polar: { name: f.name, plr: await f.text() } });
  if (next.polar === null) {
    plrLabel.textContent = `not a .plr the parser accepts — keeping ${polarName()}`;
    return;
  }
  settings = next;
  polar = activePolar(settings);
  void saveSettings(kv, settings);
  plrLabel.textContent = polarName();
  render(state, link);
};
(app.querySelector('#plr-default') as HTMLButtonElement).onclick = () => {
  settings = normalizeSettings({ ...settings, polar: null });
  polar = activePolar(settings);
  void saveSettings(kv, settings);
  plrLabel.textContent = polarName();
  render(state, link);
};
// ESP-004: which classes ALERT. Committed onchange, not per keystroke — a half-typed list
// must not mute anything — and echoed back normalized (trimmed, uppercase, deduped), so the
// input always shows exactly the filter that rules. Empty means all: silence is chosen per
// class, never defaulted into.
(app.querySelector('#set-classes') as HTMLInputElement).onchange = e => {
  const el = e.target as HTMLInputElement;
  const raw = el.value.trim();
  settings = normalizeSettings({
    ...settings, monitoredClasses: raw === '' ? null : raw.split(','),
  });
  void saveSettings(kv, settings);
  el.value = settings.monitoredClasses?.join(', ') ?? '';
  render(state, link);
};
// VAR-004: the browser refuses sound before a gesture, and that refusal is not a bug to work
// around — this button IS the gesture. A platform with no audio out says so (the spec's own
// "LÀ OÙ une sortie audio est disponible") rather than pretending to sing.
(app.querySelector('#audio-on') as HTMLButtonElement).onclick = e => {
  const btn = e.target as HTMLButtonElement;
  if (audio?.running) {
    audio.stop();
    audio = null;
    btn.textContent = '🔇 audio off';
    return;
  }
  audio = openAudio();
  btn.textContent = audio ? '🔊 audio on' : 'no audio output on this platform';
};
(app.querySelector('#zoom-in') as HTMLButtonElement).onclick = () => { mapWidthM = Math.max(2000, mapWidthM / 1.5); render(state, link); };
(app.querySelector('#zoom-out') as HTMLButtonElement).onclick = () => { mapWidthM = Math.min(200_000, mapWidthM * 1.5); render(state, link); };
/** ESP: adopt an OpenAir file's text. ESP-001's display starts as words; the map (CAR) draws
 *  them. Refusals are COUNTED out loud — a volume silently dropped is a TMA the pilot thinks
 *  is loaded. One parse path for the file input and the restore (OFF-002), like adoptTask.
 *
 *  A file that parses to ZERO volumes is refused WHOLE: memory keeps the working airspace
 *  and the disk keeps the file that produced it, so this session and the next launch agree.
 *  The half-way state — memory wiped, disk kept — flew one session with no airspace and
 *  silently re-armed the superseded file at every later launch (a confirmed finding, twice). */
function adoptAirspace(text: string): { adopted: boolean; label: string } {
  const { spaces: loaded, refused } = parseOpenAir(text);
  if (loaded.length === 0) {
    return { adopted: false, label: `0 volumes parsed (${refused} refused) — file rejected, keeping the current airspace` };
  }
  spaces = loaded;
  return { adopted: true, label: `${loaded.length} volumes loaded${refused ? `, ${refused} refused` : ''}` };
}
(app.querySelector('#oa') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const text = await f.text();
  const r = adoptAirspace(text);
  (app.querySelector('#oa-label') as HTMLElement).textContent = r.label;
  if (r.adopted) void saveFlightFile(kv, 'airspace', { name: f.name, text });
  render(state, link);
};

let state: NavState = EMPTY;
let link: LinkState = { state: 'idle' };

// One source at a time. A second Connect (or a replay over a live link) SUPERSEDES the first:
// without this, both loops keep running and race their writes to `state`, and the screen
// interleaves two flights — a confirmed bug, reproduced with two live streams. This IS the
// deterministic priority policy ACQ-007 asks for, in its one-source form: the last source
// the pilot chose wins, wholly, and the screen never blends two instruments.
let runGen = 0;
let stopCurrent: (() => void) | null = null;
// ACQ-003: the driver is a claim about the instrument on the other end, chosen at connect
// time. Condor 2 and 3 disagree about the LXWP0 wind direction; a wrong claim here reverses
// the instrument wind silently, which is why it sits in the connect form, not in a settings
// page nobody rereads.
let driver: Driver = 'condor2';

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
  // The FLARM tap: PFLAU/PFLAA ride the same NMEA stream but are not navigation — nmea.ts
  // rightly ignores them. This tee reads them BEFORE navigate, so one stream feeds both the
  // position and the picture, and a replay with FLARM lines replays the traffic too.
  async function* tee(src: AsyncIterable<string>): AsyncIterable<string> {
    for await (const line of src) {
      if (line.startsWith('$PFLAU')) {
        const st = parsePflau(line);
        if (st) flarm = st;
      } else if (line.startsWith('$PFLAA')) {
        const t = parsePflaa(line, state.fix?.sod ?? 0);
        if (t) traffic.add(t);
      }
      yield line;
    }
  }
  const it = navigate(tee(lines(watched)), elev, driver)[Symbol.asyncIterator]();
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
      logger?.add(state);                          // LOG: every fix, once per second
      // SYS-001: the journal drinks from the logger's cursor — the logger stays the ONE
      // encoder, the journal merely a second sink for the same records. add never throws
      // and never blocks; a failing KV degrades the insurance, not this loop.
      if (logger && journal) journal.add(logger.drain());
      trail.push([state.fix.lon, state.fix.lat]);  // CAR: the tail the map draws
      if (trail.length > 600) trail.shift();       // ~10 min at 1 Hz
      // ANA/CNC: the WHOLE flight, kept for the analysis tab. The trail above forgets after
      // ten minutes because the map only draws a tail; the scorers need every fix there was.
      if (state.fix.alt != null)
        flightTrack.push([state.fix.lon, state.fix.lat, state.fix.alt, state.fix.sod]);
      // VAR-004/005: the air, out loud. In speed-to-fly mode the tone says how to fly rather
      // than how the air moves — the same speaker, the opposite meaning, so only one plays.
      if (audio?.running) {
        const d = derive(state, polar, setting('#set-qnh', 1013.25));
        const stfMode = (app.querySelector('#audio-stf') as HTMLInputElement).checked;
        audio.setTone(stfMode && d.tas != null
          ? stfTone(d.tas - speedToFly(polar, setting('#set-mc', 1), d.netto ?? 0))
          : varioTone(state.vario));
      }
      if (task && taskProgress) {                  // TSK: the folds, fix by fix
        taskProgress = advance(task, taskProgress, state.fix.lon, state.fix.lat, state.fix.sod);
        // AAT scoring runs AFTER advance on the same fix, by advanceAat's own contract:
        // entry into an area both validates it and plants its first scoring candidate.
        if (aat) aat = advanceAat(task, taskProgress, aat, state.fix.lon, state.fix.lat);
      }
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
  <h2>pack shelf</h2>
  <div id="bf-shelf"></div>
  <div class="cache-line">
    <label>cache budget <input id="bf-budget" size="5" value="200" inputmode="numeric" /> MB</label>
    <div id="bf-cache"></div>
  </div>
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
const shelfEl = q('#bf-shelf');
const cacheEl = q('#bf-cache');
const budgetIn = q<HTMLInputElement>('#bf-budget');
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
// The last eviction plan actually executed, so the cache line can say what happened rather
// than implying an enforcement nobody ran. Null until one runs — a dash, not "evicted
// nothing" (POT-007's rule applies to housekeeping too).
let lastPlan: EvictionPlan | null = null;

// ---- reading the form ----

// An empty or unparsable input is null — the form's spelling of UNKNOWN, same as the screen's.
const num = (el: HTMLInputElement): number | null => {
  if (el.value.trim() === '') return null;
  const v = Number(el.value);
  return Number.isFinite(v) ? v : null;
};

/** The pack the form currently asks for, or null while the ask is incomplete. The fold
 *  itself is core's specFor — the ONE spelling, shared with the shelf's 'open', so an opened
 *  pack re-provisions the IDENTICAL spec instead of a rounded cousin under the same id (a
 *  confirmed finding). |lat| ≤ 85 is web mercator's own edge. */
function readSpec(): PackSpec | null {
  const lon = num(lonIn), lat = num(latIn), radius = num(radiusIn), day = dayIn.value;
  if (lon == null || lat == null || radius == null || !day) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 85 || !(radius > 0)) return null;
  return specFor(lon, lat, radius, day);
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

/** The cache ceiling as typed, normalized by core's own rule (OFF-002/006): an unparsable
 *  or non-positive value falls back to the default rather than to zero — a 0 MB ceiling read
 *  off a typo would evict everything the pilot provisioned. */
const budgetMB = (): number => normalizeSettings({ cacheBudgetMB: Number(budgetIn.value) }).cacheBudgetMB;

/** Persist the shelf and repaint — WITH a catch (a confirmed finding): a pin that fails to
 *  write exists only in memory and silently dies at the very restart it exists for. The
 *  failure becomes words on the cache line; the repaint still runs so the screen shows the
 *  in-memory truth it is now the only holder of. */
async function persistShelf(): Promise<void> {
  try {
    await saveShelf(kv, shelf);
  } catch (e) {
    cacheEl.innerHTML = `<div class="cache"><div class="over-budget">shelf could not be saved — ${
      String(e)} — pins and packs shown here will NOT survive a restart</div></div>`;
  }
  await refreshShelf();
}

/** Repaint the shelf and the cache line from a fresh measurement (OFF-010): what each pack
 *  holds is re-measured off the store, never remembered from the last paint. Offers exist
 *  only while the network does — OFF-009's own wording is "when the connection reappears,
 *  PROPOSE" — and nothing here downloads anything; the offer's button does, when tapped.
 *  Same overlap discipline as refreshBriefing: the newest call wins, stale answers are
 *  dropped unpainted. */
let shelfEpoch = 0;
async function refreshShelf(): Promise<void> {
  const epoch = ++shelfEpoch;
  const snap = shelf;
  try {
    const heldById = await heldForShelf(snap, kv);
    const inv = await tileInventory(kv);
    if (epoch !== shelfEpoch) return;
    const now = Date.now();
    const completenessById = new Map<string, Completeness>();
    for (const e of snap)
      completenessById.set(e.spec.id, completeness(e.spec, heldById.get(e.spec.id)!, Z, now));
    const offers = navigator.onLine ? updateOffers(snap, heldById, Z, now) : [];
    shelfEl.innerHTML = shelfHtml(sortedShelf(snap), completenessById, offers);
    cacheEl.innerHTML = cacheHtml(inv.reduce((sum, e) => sum + e.bytes, 0), budgetMB(), lastPlan);
  } catch (e) {
    if (epoch !== shelfEpoch) return;
    // A failed re-measurement must not leave yesterday's panel posing as fresh (OFF-010's
    // promise is the MEASUREMENT, not the pixels): say the measurement failed, in place.
    shelfEl.innerHTML = `<div class="shelf"><div class="shelf-empty">shelf could not be re-measured — ${String(e)}</div></div>`;
    cacheEl.innerHTML = '';
  }
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

/** One provisioning run: the download, then the bookkeeping the download earns — the pack
 *  goes on the shelf (OFF-010), the shelf is saved (OFF-002), and the budget is enforced
 *  right after the cache grew, the one moment eviction has fresh facts to work from
 *  (OFF-006). Shared by the form's Provision button and by an accepted update offer:
 *  OFF-009's "accept" is nothing more than provisioning the same spec again. */
async function provision(spec: PackSpec): Promise<void> {
  progressEl.textContent = 'starting…';
  // The pack goes on the shelf BEFORE the download (a confirmed finding): an eviction that
  // runs mid-download — a remove click, a concurrent provision finishing — must see the
  // arriving tiles as OWNED, or it classifies them as orphans and evicts the pack while it
  // is being written. Shelving is the claim of ownership; downloading fills it.
  shelf = upsertPack(shelf, spec, Date.now());
  await persistShelf();
  try {
    const { ok, failed } = await downloadPack(spec, kv, boundFetch, (done, total) => {
      progressEl.textContent = `${done}/${total}`;
    }, Date.now);
    // Counts, not verdicts: the completeness panel below is where failures become words
    // (OFF-010), and refreshBriefing repaints it from what actually landed.
    progressEl.textContent = failed === 0
      ? `done — ${ok} items held`
      : `${ok} held, ${failed} failed — see completeness below`;
  } catch {
    // downloadPack counts item failures instead of throwing; only the store itself dying can
    // land here. What was written IS written — re-measure and let completeness say the rest.
    progressEl.textContent = 'download interrupted — see completeness below';
  }
  // The bookkeeping is NOT inside the try (a confirmed finding): a failed shelf-save must
  // not print 'download interrupted' over a download that completed. Each failure gets its
  // own words, in its own place.
  try {
    lastPlan = await enforceBudget(kv, shelf, budgetMB() * BYTES_PER_MB);
  } catch (e) {
    progressEl.textContent += ` — cache enforcement failed: ${String(e)}`;
  }
  void refreshShelf();
  void refreshBriefing();
}

q<HTMLFormElement>('#bf-form').onsubmit = e => {
  e.preventDefault();
  const spec = readSpec();
  if (!spec) {
    progressEl.textContent = 'enter a centre, a radius and a day first';
    return;
  }
  void provision(spec);
};

// The shelf's four verbs ride ONE listener on the container — the delegation contract
// shelf-ui documents. The rows repaint freely underneath it, the handler survives, and the
// data-act / data-id pair is the entire coupling between those strings and this code.
shelfEl.onclick = e => {
  const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
  const id = btn?.dataset.id;
  if (!btn || !id) return;
  const entry = shelf.find(en => en.spec.id === id);
  if (!entry) return;                     // a click racing a repaint: nothing left to act on
  switch (btn.dataset.act) {
    case 'pin':
      // OFF-007: the pilot's mark, toggled and saved in the same breath — a pin living only
      // in memory would protect nothing past the very restart it exists for. persistShelf
      // says so out loud if the write fails, instead of losing the pin silently.
      shelf = setPinned(shelf, id, !entry.pinned);
      void persistShelf();
      break;
    case 'remove':
      // removePack refuses a pinned pack on its own (and the row hides the button); the save
      // and the sweep run on whatever core answered. The sweep matters: the removed pack's
      // unshared tiles just became orphans, exactly what the budget evicts first.
      shelf = removePack(shelf, id);
      void (async () => {
        try { lastPlan = await enforceBudget(kv, shelf, budgetMB() * BYTES_PER_MB); } catch { /* next sweep */ }
        await persistShelf();
      })();
      break;
    case 'open': {
      // Opening is copying the promise back into the form — the TYPED ask when the spec
      // carries it (specFor keeps centre and radiusKm verbatim), so re-provisioning rebuilds
      // the IDENTICAL spec; the derived-and-rounded form is only for shelves persisted
      // before the typed ask existed. The touch keeps the MRU order telling the truth.
      const c = entry.spec.centre ?? centreOf(entry.spec);
      lonIn.value = String(c.lon);
      latIn.value = String(c.lat);
      radiusIn.value = String(entry.spec.radiusKm ?? Math.round(radiusMOf(entry.spec) / 100) / 10);
      dayIn.value = entry.spec.day;
      shelf = touchPack(shelf, id, Date.now());
      void persistShelf();
      void refreshBriefing();
      break;
    }
    case 'update':
      // The accepted offer (OFF-009): provisioning again, nothing more — same spec, same
      // progress line, same bookkeeping. Nothing downloaded until this click.
      void provision(entry.spec);
      break;
  }
};

// A committed ceiling ACTS (a confirmed finding: a setting that only repaints is inert —
// lowering it never evicted anything until the next provisioning). onchange fires on commit
// (blur/enter), never per keystroke, so a half-typed number cannot start an eviction; the
// committed value is persisted (OFF-002) and enforced in the same breath.
budgetIn.onchange = () => void (async () => {
  // The committed value joins the ONE settings record — through the normalizer, like every
  // other write — so saving the ceiling can never drop the polar or the classes beside it.
  settings = normalizeSettings({ ...settings, cacheBudgetMB: Number(budgetIn.value) });
  budgetIn.value = String(settings.cacheBudgetMB);   // show the value that will actually rule
  try {
    await saveSettings(kv, settings);
    lastPlan = await enforceBudget(kv, shelf, settings.cacheBudgetMB * BYTES_PER_MB);
  } catch { /* the cache line repaints from what really happened either way */ }
  await refreshShelf();
})();

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

// Connectivity is a state, not an event to miss: the chip follows the browser's own word,
// and the shelf re-derives its offers — OFF-009's moment is exactly this listener, and the
// only thing that happens here is a PROPOSAL appearing; no byte moves until the pilot taps.
const onNetChange = (): void => {
  renderNet();
  if (!bf.hidden) void refreshShelf();
};
window.addEventListener('online', onNetChange);
window.addEventListener('offline', onNetChange);

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
const tabAna = root.querySelector<HTMLButtonElement>('#tab-analysis')!;
function showTab(which: 'fly' | 'briefing' | 'analysis'): void {
  app.hidden = which !== 'fly';
  bf.hidden = which !== 'briefing';
  ana.hidden = which !== 'analysis';
  tabFly.classList.toggle('active', which === 'fly');
  tabBf.classList.toggle('active', which === 'briefing');
  tabAna.classList.toggle('active', which === 'analysis');
  if (which === 'analysis') renderAnalysis();
  if (which === 'briefing') {
    // The form opens already pointed at where the glider is — prefilled from the last fix,
    // but only into EMPTY inputs: a centre the pilot typed is the pilot's.
    if (state.fix && lonIn.value.trim() === '' && latIn.value.trim() === '') {
      lonIn.value = state.fix.lon.toFixed(3);
      latIn.value = state.fix.lat.toFixed(3);
    }
    // Screen entry re-measures (OFF-010): the completeness and the shelf shown are of the
    // disk as it IS, not as it was when something last rendered.
    void refreshBriefing();
    void refreshShelf();
  }
}
tabFly.onclick = () => showTab('fly');
tabBf.onclick = () => showTab('briefing');
tabAna.onclick = () => showTab('analysis');

// ============ the Analysis screen — Phase 6 (ANA-001/003, CNC-001/002/003) ============
// Everything here is ABOUT a flight, and every number on it is either a measurement of what
// happened or a score under a NAMED barème. The distinction ANA-003 turns on is the one the
// whole app turns on: the achieved glide ratio is a fact, the polar's is a claim about the
// glider, and they are shown side by side rather than fused into a single flattering number.

const ana = root.querySelector<HTMLElement>('#analysis')!;

/** The barograph, as an SVG. Altitude against time, and the climbs the kernel found marked
 *  under it — the day's real work, where it came from. */
function barographSvg(track: TrackPoint[], wPx = 640, hPx = 200): string {
  const b = barograph(track);
  if (!b) return '<div class="link">No flight yet — connect, or replay an IGC, and come back.</div>';
  const span = Math.max(1, b.endSod - b.startSod);
  const lo = b.minAltM - 50, hi = b.maxAltM + 50;
  const x = (sod: number): number => ((sod - b.startSod) / span) * wPx;
  const y = (m: number): number => hPx - ((m - lo) / Math.max(1, hi - lo)) * hPx;
  const line = b.samples.map(([t, m]) => `${x(t).toFixed(1)} ${y(m).toFixed(1)}`).join(' L ');
  // The climbs, as bands under the trace: where the height came from, in the kernel's own
  // judgement of what counts as a climb (C4 — we do not re-decide it here).
  const bands = climbs(track).map(c =>
    `<rect class="climb-band" x="${x(b.startSod + c.t0).toFixed(1)}" y="0"
       width="${Math.max(1, x(b.startSod + c.t1) - x(b.startSod + c.t0)).toFixed(1)}" height="${hPx}"/>`).join('');
  return `<svg class="barograph" viewBox="0 0 ${wPx} ${hPx}" width="${wPx}" height="${hPx}">
    ${bands}<path class="baro-line" d="M ${line}"/></svg>`;
}

function renderAnalysis(): void {
  const track = flightTrack;
  if (track.length < 2) {
    ana.innerHTML = `<h1>VOLPLANE — analysis</h1>
      <div class="link">No flight yet — connect to Condor, or replay an IGC on the Fly screen,
      and this screen fills itself from the fixes as they arrive.</div>`;
    return;
  }
  const b = barograph(track)!;
  // ANA-003, wind-corrected when we have a wind of our own: the ratio is then a claim about
  // the GLIDER rather than about the day. The badge says which it is, because they are not
  // the same number and a pilot comparing gliders must know which he is reading.
  const wind = estimator.estimate() ?? null;
  const eg = effectiveGlide(track, polar, wind);
  const free = freeDistance(track);
  const fai = faiTriangle(track);
  const km = (m: number | null | undefined): string | null => m == null ? null : (m / 1000).toFixed(1);

  ana.innerHTML = `
    <h1>VOLPLANE — analysis</h1>
    <div class="boxes">
      ${box('Max altitude', fmt(b.maxAltM), 'm')}
      ${box('Height gained', fmt(b.gainM), 'm')}
      ${box('Climbs', fmt(climbs(track).length))}
      ${box('Achieved L/D', fmt(eg.achievedLD, 1), '',
            eg.windCorrected ? '' : ' <span class="badge estimated" title="ground distance, no wind estimate yet — a downwind glide flatters it">uncorr.</span>')}
      ${box('Polar L/D', fmt(eg.theoreticalLD, 1), '',
            ' <span class="badge modelled" title="what the polar claims — a model of the glider, not a measurement of this flight">modelled</span>')}
      ${box('Achieved / book', fmt(eg.ratio, 2))}
    </div>
    <h2>Scoring — ${free?.rules ?? fai?.rules ?? 'olc-2024'}</h2>
    <div class="boxes">
      ${box('Free distance', km(free?.distanceM ?? null), 'km')}
      ${box('Free points', fmt(free?.points ?? null, 1))}
      ${box('FAI triangle', km(fai?.distanceM ?? null), 'km')}
      ${box('FAI points', fmt(fai?.points ?? null, 1))}
      ${box('Shortest leg', fai ? (fai.minLegFraction * 100).toFixed(1) : null, '%',
            fai ? ' <span class="badge ready" title="CNC-003: the 28% shape rule is satisfied — the search only ever returns legal triangles">FAI ok</span>' : '')}
    </div>
    <div class="link">A cockpit estimate on a decimated track (CNC). The IGC file, scored by
      the league's own software, is the judge of record — this number is for flying by, not
      for claiming with.</div>
    <h2>Barograph</h2>
    ${barographSvg(track)}
    <div class="link">Shaded: the climbs, as soaring-core's detector found them.</div>
  `;
}

// ---- what came back from disk (OFF-002) ----

// The airspace and task the pilot loaded last session, fed through the SAME adopt paths the
// file inputs use — a restored file that parsed differently from a chosen one would be two
// truths about one file. The label names the file so the pilot knows what is armed without
// re-picking it, and says "(restored)" so it cannot be mistaken for a choice made today.
async function restoreFlightFiles(): Promise<void> {
  const oa = await loadFlightFile(kv, 'airspace');
  if (oa) {
    (app.querySelector('#oa-label') as HTMLElement).textContent =
      `${adoptAirspace(oa.text).label} (restored: ${oa.name})`;
  }
  const tk = await loadFlightFile(kv, 'task');
  if (tk) {
    const label = adoptTask(tk.text);
    if (label) {
      (app.querySelector('#tsk-label') as HTMLElement).textContent =
        `${label} (restored: ${tk.name})`;
    }
  }
  if (oa || tk) render(state, link);
}

// The settings, back into the forms they rule from (OFF-002: configuration persists). The
// inputs' built-in values are only the defaults of a first launch; `settings` itself came
// back with the shelf, before any screen rendered.
function restoreSettings(): void {
  budgetIn.value = String(settings.cacheBudgetMB);
  (app.querySelector('#set-classes') as HTMLInputElement).value =
    settings.monitoredClasses?.join(', ') ?? '';
  plrLabel.textContent = polarName();
}

// SYS-001's other half: a journal still on disk at startup IS a crash — the clean stop path
// discards it — and what it holds is the only copy of that flight. The banner offers the
// rebuilt file and clears the journal only once the pilot has downloaded it or knowingly let
// it go; recoverOrphan itself deletes nothing.
async function restoreOrphan(): Promise<void> {
  const orphan = await recoverOrphan(kv);
  if (!orphan) return;
  const banner = document.createElement('div');
  banner.className = 'recovered-banner';
  banner.innerHTML = `recovered flight from a crash — ${orphan.fixes} fixes —
    <button id="orphan-dl" type="button">download</button>
    <button id="orphan-x" type="button">dismiss</button>`;
  flyView.before(banner);
  orphanBanner = banner;
  orphanFixes = orphan.fixes;
  (banner.querySelector('#orphan-dl') as HTMLButtonElement).onclick = async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([orphan.igc], { type: 'application/octet-stream' }));
    // The recovered day, not today: the crash may be days old, and a recovered flight
    // stamped with the download date would be an invented fact (POT-007).
    a.download = `volplane-${orphan.meta.day}-recovered.igc`;
    a.click();
    URL.revokeObjectURL(a.href);
    await clearJournal(kv);
    banner.remove();
    orphanBanner = null;
  };
  // The deliberate discard and the accidental one (starting a recording) now go through the
  // SAME guard — one confirm, one clearJournal, no path that quietly wins.
  (banner.querySelector('#orphan-x') as HTMLButtonElement).onclick = () => void releaseOrphan();
}

render(state, link);
// The orphan check runs before anything else can touch the 'journal/' prefix — a recording
// started first would wipe exactly the fixes the banner is about to offer.
await restoreOrphan();
void restoreFlightFiles();
restoreSettings();
