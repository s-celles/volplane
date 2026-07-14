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
import { parsePflau, parsePflaa, trafficStore, freshStatus, type FlarmStatus } from '../core/flarm';
import { igcLogger, type IgcLogger } from '../core/igclog';
import { openJournal, recoverOrphan, clearJournal, type Journal } from './igcjournal';
import {
  parseOpenAir, incursions, activeIncursions, acknowledge, ackKey,
  type Airspace, type Ack,
} from '../core/airspace';
import {
  RULES, simpleTask, freshProgress, advance, freshAat, advanceAat,
  type Task, type TaskProgress, type Waypoint, type AatProgress, type RulesVersion,
} from '../core/task';
import { taskStats } from '../core/taskstats';
import { taskRibbonHtml, taskEditorHtml } from './task-ui';
import { editWaypoints, withWaypoints, taskWaypoints, type Edit } from '../core/taskedit';
import { reachable, type ReachRay } from '../core/reach';
import { parsePeaks, parseShapes } from '../core/landmarks';
import { parsePoiFile, isLandable, LANDABLE_CATS, type Poi, type PoiCat } from '../core/cup';
import { alternates, landablesWithin, DEFAULT_RADIUS_M, type Alternate } from '../core/landables';
import { alternatesHtml, styleFilterHtml } from './landables-ui';
import { varioTone, stfTone } from '../core/vartone';
import { chooseVoice } from '../core/alarmtone';
import { circlingTracker } from '../core/circling';
import { nextPhase, PHASE_BOXES, PHASE_TITLE, type Phase } from '../core/phase';
import { recogniser, type Gesture } from '../core/gesture';
import { heroHtml, glideBarHtml } from './flyframe-ui';
import { circleRose } from '../core/circleassist';
import {
  terrainAhead, terrainAlarm, DEFAULT_HORIZON_S, type TerrainVerdict,
} from '../core/terrainalarm';
import { alertsHtml, trafficPanelHtml } from './alerts-ui';
import { translator } from '../core/i18n';
import { boxHtml, boxesHtml, pageTabsHtml } from './infobox-ui';
import { settingsHtml, commits } from './settings-ui';
import { editPages, type BoxSource, type PageEdit } from '../core/infobox';
import { GLIDER_LIBRARY } from '../core/polarlib';
import { PRESETS, formatText, type Quantity, type UnitSystem } from '../core/units';
import { isLang } from '../core/i18n';
import { roseSvg } from './rose-ui';
import { barograph, effectiveGlide, climbs } from '../core/analysis';
import { freeDistance, faiTriangle } from '../core/optimise';
import { openAudio, type AudioOut } from './audio';
import { xsectionSvg } from './xsection-ui';
import { paintMap as paintMovingMap, type MapPaint2D } from './map-ui';
import type { View as MapView } from './liftmap-ui';
import { completeness, specFor, type Completeness, type PackSpec, type Held } from '../core/pack';
import { normalizeSettings, activePolar, fieldNumber, massKgFromField, type Settings } from '../core/config';
import { upsertPack, touchPack, setPinned, removePack, sortedShelf, updateOffers, type Shelf } from '../core/shelf';
import type { EvictionPlan } from '../core/cachebudget';
import { briefingAt, sandboxWx, type Provenance } from '../core/briefing';
import { computeLiftMap, calibrateFromTrack, type LiftMap } from '../core/liftmap';
import { offerableLinks, missingLinks, type Platform } from '../core/links';
import type { Driver } from '../core/nmea';
import { tcpDevice, udpDevice, replaySource, closeLinks } from './tauri-source';
import { terrainStore, Z } from './terrain';
import { openStore, isPersistent, getJson, putJson } from './store';
import { downloadPack, heldFor, loadWeather } from './provision';
import {
  loadShelf, saveShelf, heldForShelf, tileInventory, enforceBudget,
  saveFlightFile, loadFlightFile, loadSettings, saveSettings,
} from './packstore';
import { shelfHtml, cacheHtml, BYTES_PER_MB } from './shelf-ui';
import { repositoryHtml } from './repository-ui';
import { parseCatalogue, versionOf, freshness, type CatalogueEntry, type Held as HeldFile } from '../core/catalogue';
import { completenessHtml, offlineBadgeHtml, briefingHtml, emagramSvg } from './briefing-ui';
import { paintLiftMap, mixerSvg, mixerHit, legendHtml, type Paint2D, type View } from './liftmap-ui';
import { elevAtFromTiles, mPerLng, M_PER_LAT, distM, bearingDeg } from 'soaring-core/geo';
import { DEFAULT_POLAR, type Polar } from 'soaring-core/polar';
import { parseIGC } from 'soaring-core/igc';
import { MIN_RATIOS } from 'soaring-core/lift/calib';
import { LIFT_COMPS } from 'soaring-core/lift/mix';
import type { Wx, WxKnobs } from 'soaring-core/weather';
import type { TrackPoint } from 'soaring-core/types';
import peaksCsv from 'soaring-data/datasets/landmarks/peaks.csv' with { type: 'text' };
import catalogueCsv from 'soaring-data/catalogue/catalogue.csv' with { type: 'text' };
import coastlineGeo from 'soaring-data/datasets/landmarks/coastline.geojson' with { type: 'json' };
import bordersGeo from 'soaring-data/datasets/landmarks/borders.geojson' with { type: 'json' };
import lakesGeo from 'soaring-data/datasets/landmarks/lakes.geojson' with { type: 'json' };

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

// IHM-006: the ONE translator, derived from the ONE setting, re-derived the instant that setting
// changes (applySettings, below) and handed to every renderer as its last argument. A renderer
// that reached for a language of its own would be a renderer no test could pin to a catalogue —
// and a second binding here would be a second language, on the same screen, at the same time.
let t = translator(settings.lang);

// The DEM, read disk-first and network-second (OFF-004): over ground this machine has visited
// — or been provisioned for — the radio is never consulted, so the Fly screen survives a
// network cut over known terrain. Until a tile lands, the ground is NULL: UNKNOWN, which the
// whole chain is built to carry honestly.
// TER-001: the one fact the map's shade cache needs. The sampler is a closure over a store
// that mutates underneath it, so its identity never changes when a tile lands — the epoch is
// how the ground SAYS it changed. Bumped here and nowhere else; the painter memoises on it and
// so recomputes the hillshade exactly when there is new ground to shade, and never at 1 Hz
// over ground that did not move.
let tileEpoch = 0;
const terrain = terrainStore(() => {
  tileEpoch++;
  // A tile arrived: the ground under the unmoved glider may just have become known. Repricing
  // costs a lookup; waiting for the next fix would show UNKNOWN over terrain we now hold.
  state = reground(state, elev);
  // …and the SCREEN has to be told, whether or not that reground changed anything. reground is
  // identity-preserving when there is no fix at all, and when the ground under the glider's own
  // pixel is unchanged — so gating the repaint on `s !== state` meant the commonest case of all
  // (Fly screen open, no GPS attached, DEM provisioning) painted full hatch and "100% of the
  // visible ground is NOT loaded" over terrain that was by then entirely on disk. The epoch had
  // moved; nothing had asked the canvas to look at it. The glider's own pixel is not the map.
  onFlyTiles();
  // The briefing has the same stake in a tile as the Fly screen: the lift map's ground and
  // the sounding's surface reference both just changed under it. Debounced — a provisioning
  // burst lands hundreds of tiles, and one re-brief at the end says all of it.
  onTilesChanged();
}, undefined, Date.now, kv);
const elev = (lon: number, lat: number) => elevAtFromTiles(lon, lat, terrain.lookup, Z, 8);

// Assigned once the briefing exists below; the terrain store is built before the screens are.
let onTilesChanged: () => void = () => {};

/** The Fly screen's own tile debounce, and it is a debounce for the same reason the briefing's
 *  is: a provisioning burst lands hundreds of tiles, and repainting per tile would mean a full
 *  render plus a hillshade recompute per tile — which is exactly what the epoch memoisation
 *  exists to prevent. One repaint at the end says all of it. Hidden screen, no repaint: showTab
 *  renders on entry, so nothing is owed. */
let flyTileTimer: ReturnType<typeof setTimeout> | undefined;
function onFlyTiles(): void {
  clearTimeout(flyTileTimer);
  flyTileTimer = setTimeout(() => {
    if (!app.hidden) render(state, link);
  }, 500);
}

// ---- the window: two tabs over the one #app ----

const root = document.getElementById('app')!;
root.innerHTML = `
  <nav class="tabs">
    <button id="tab-fly" class="active" type="button"></button>
    <button id="tab-nav" type="button"></button>
    <button id="tab-task" type="button"></button>
    <button id="tab-briefing" type="button"></button>
    <button id="tab-analysis" type="button"></button>
    <button id="tab-settings" type="button"></button>
  </nav>
  <div id="fly"></div>
  <div id="nav" hidden></div>
  <div id="taskedit" hidden></div>
  <div id="briefing" hidden></div>
  <div id="analysis" hidden></div>
  <div id="settings" hidden></div>
`;
const app = root.querySelector<HTMLElement>('#fly')!;
const setEl = root.querySelector<HTMLElement>('#settings')!;
const navEl = root.querySelector<HTMLElement>('#nav')!;

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

// IHM-006, and the hole it had. Every word below is a catalogue id, not an English string: the
// strip is emitted ONCE (a 1 Hz render would eat the caret mid-QNH) and its words are painted into
// it afterwards by renderFlyChrome(), which applySettings calls on every language change. Before
// this, 'record', 'audio off', 'no goal' and the landable filter's four category names were
// interpolated at module load and never touched again — a pilot who switched to French got a
// half-French screen, and the half that stayed English was the half he presses in flight.
//
// data-i18n on an EMPTY span, filled at paint time. A label spelt into the markup here would be a
// label the catalogue cannot reach, and the one thing worse than an untranslated label is one that
// looks translated because the tab above it is.
// ---- THE FLIGHT SCREEN IS AN INSTRUMENT, AND IT USED TO BE A DOCUMENT ----
//
// It was a vertical stack — tabs, nine infoboxes, the goal hint, the alerts, the traffic panel, the
// airspace list, the task panel, THE LIST OF LANDABLE FIELDS, the link status, then the controls —
// and the map came LAST and got whatever was left. Nine blocks of text between a pilot and the
// picture of where he is.
//
// The mature soaring computers all converge on the same shape, and none of them looks like that:
//
//   · the MAP takes 70–85 % of the pixels
//   · the numbers live in a FIXED FRAME the pilot never has to search, because he reads an
//     instrument by knowing WHERE a number is, not by reading its label
//   · the ARRIVAL HEIGHT AT THE GOAL is the hero — the most-read number in the sport — and it is a
//     BAR, a SIGN and a COLOUR before it is digits
//   · everything else is allowed to be one tap away, and IS: see the NAV screen
//
// The order below is the order the pilot's eye takes: the question at the top, the answer down the
// left edge, the world in the middle, the six numbers on the right, and the three things he actually
// touches at the bottom, at a size one hand can hit in turbulence while the other flies the glider.
app.innerHTML = `
  <div id="hero-strip"></div>
  <div class="instrument">
    <div id="glidebar-slot"></div>
    <div class="map-frame">
      <canvas id="map"></canvas>
      <div id="fly-alerts"></div>
      <div class="map-zoom">
        <button id="zoom-in" type="button">+</button>
        <button id="zoom-out" type="button">−</button>
      </div>
      <button id="manual-view" type="button" hidden></button>
      <div id="fly-aside">
        <div id="xsection" class="xsection-frame"></div>
        <div id="rose" class="rose-frame"></div>
      </div>
    </div>
    <div id="fly-view"></div>
  </div>
  <form id="fly-controls" class="fly-controls">
    <label><span data-i18n="fly.mc"></span> <input id="set-mc" size="3" value="1.0" inputmode="decimal" /> m/s</label>
    <button id="set-goal" type="button" data-i18n="fly.goalHere" data-i18n-title="fly.goalHere.title"></button>
    <span id="goal-label" class="goal-label"></span>
    <button id="rec" type="button" data-i18n-title="fly.record.title"></button>
    <button id="audio-on" type="button" data-i18n-title="fly.audio.title"></button>
    <label><input id="audio-stf" type="checkbox" /> <span data-i18n="fly.stfMode"></span></label>
  </form>
`;

// ---- the SETUP, which is not flying ----
//
// Everything below used to sit on the Fly screen, between the pilot and his map: the QNH, the
// reserve, the terrain horizon, four file pickers, the alert classes, and the CONNECT form. Opening
// the app and looking at it — the thing 556 tests could never do — showed the flight screen was
// 1922 pixels tall in an 865-pixel window, the map was a 480×480 square in a 1651-pixel-wide window,
// and Connect was BELOW THE FOLD. To connect a flight computer, you scrolled.
//
// None of it is touched in the air. A QNH is set once. A polar is chosen once. A cable is plugged in
// once, on the ground, before the canopy closes. What a pilot touches IN FLIGHT is the MacCready
// setting, the page, the zoom, the audio, and the goal — and that is what is left above.
//
// The elements keep their ids and their listeners: they moved house, they did not change.
setEl.innerHTML = `
  <div id="settings-panel"></div>
  <section class="settings-section">
    <h3 data-i18n="settings.setup"></h3>
    <form id="setup" class="fly-set">
      <label><span data-i18n="fly.qnh"></span> <input id="set-qnh" size="5" value="1013.25" inputmode="decimal" /> hPa</label>
      <label><span data-i18n="fly.reserve"></span> <input id="set-reserve" size="4" value="200" inputmode="numeric" /> m</label>
      <label data-i18n-title="fly.horizon.title"><span data-i18n="fly.horizon"></span>
        <input id="set-horizon" size="3" value="60" inputmode="numeric" /> s</label>
      <label class="replay"><span data-i18n="fly.airspaceFile"></span> <input id="oa" type="file" accept=".txt,.openair" /></label>
      <span id="oa-label" class="goal-label"></span>
      <label class="replay" data-i18n-title="fly.taskFile.title"><span data-i18n="fly.taskFile"></span>
        <input id="tsk" type="file" accept=".csv,.txt" /></label>
      <span id="tsk-label" class="goal-label"></span>
      <label class="replay" data-i18n-title="fly.taskTime.title"><span data-i18n="fly.taskTime"></span>
        <input id="set-mintime" size="4" value="" inputmode="numeric" /> min</label>
      <label class="replay" data-i18n-title="fly.polarFile.title"><span data-i18n="fly.polarFile"></span>
        <input id="plr" type="file" accept=".plr,.txt" /></label>
      <span id="plr-label" class="polar-label"></span>
      <button id="plr-default" type="button" data-i18n="fly.polarDefaultBtn" data-i18n-title="fly.polarDefaultBtn.title"></button>
      <label class="replay" data-i18n-title="fly.landablesFile.title"><span data-i18n="fly.landablesFile"></span>
        <input id="cup" type="file" accept=".cup,.txt" /></label>
      <span id="cup-label" class="goal-label"></span>
      <div id="lnd-filter-slot"></div>
      <label class="replay" data-i18n-title="fly.alertClasses.title"><span data-i18n="fly.alertClasses"></span>
        <input id="set-classes" size="10" placeholder="all" /></label>
    </form>
  </section>
  <section class="settings-section">
    <h3 data-i18n="settings.source"></h3>
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
  </section>
`;

const panelEl = root.querySelector<HTMLElement>('#settings-panel')!;
const flyView = root.querySelector<HTMLElement>('#fly-view')!;
const heroEl = root.querySelector<HTMLElement>('#hero-strip')!;
const glidebarEl = root.querySelector<HTMLElement>('#glidebar-slot')!;
const alertsEl = root.querySelector<HTMLElement>('#fly-alerts')!;
const manualEl = root.querySelector<HTMLButtonElement>('#manual-view')!;

/** The phase of the flight, carried between renders because it has HYSTERESIS: an arrival height
 *  hovering around the reserve would otherwise flip the whole screen back and forth at 1 Hz, and a
 *  pilot cannot read an instrument that is changing its mind. */
let phase: Phase = 'cruise';
const roseEl = root.querySelector<HTMLElement>('#rose')!;
const linkSel = root.querySelector<HTMLSelectElement>('#linksel')!;
const hostIn = root.querySelector<HTMLInputElement>('#host')!;
// UDP listens; it has no host to ask for. The field follows the selected link.
linkSel.onchange = () => { hostIn.hidden = linkSel.value === 'udp'; };


// ---- the flight computer's own state (Phase 2) ----

// PLA-010: the polar that flies is a SETTING, and activePolar is the one spelling of which
// one that is — every glide call below reads this binding, so importing a .plr swaps the
// whole computer's polar in one assignment.
let polar: Polar = activePolar(settings);

/** THE one write path for every setting on this screen (CFG-005, OFF-002). Nothing else assigns
 *  to `settings`, and that is the whole discipline: the normalizer is the gatekeeper, the disk
 *  only ever holds a shape it has blessed, and everything DERIVED from a setting is re-derived
 *  here — the translator (a language change must reach the very sentence that announced it), the
 *  polar (a glider change must reach the final glide before the next fix does), and every screen
 *  that shows either. A patch that skipped one of them would leave the app half-changed, which is
 *  worse than not changing at all: the pilot would have to guess which half he is flying. */
function applySettings(patch: Partial<Settings>): void {
  settings = normalizeSettings({ ...settings, ...patch });
  void saveSettings(kv, settings);
  t = translator(settings.lang);
  polar = activePolar(settings);
  renderChrome();
  renderSettings();
  render(state, link);
}
// Everything below is PER-FLIGHT memory, and it is `let` for one reason: a new source is a new
// flight, and these must be thrown away with the old one (see resetFlight). They used to be
// const — created once at module load and never cleared — which meant that after replaying an
// afternoon log the accumulators held sods around 50000, and every live fix of the next morning's
// flight (sods around 32000) failed their own "the clock must advance" guard and was silently
// dropped. The screen went on showing the replayed flight's last thermal, in plain measured
// styling, as the current one.
let estimator = windEstimator();                   // VEN-001: OUR wind, never merged with theirs
let avgVario = rollingVario(30);                   // POS-006
let circles = circlingTracker();                   // VAR-006: the last thermal, the last circle
let rose = circleRose();                           // THE-001/002: where the lift was, around the turn
let goal: { lon: number; lat: number; elev: number } | null = null;

// TER-008. The alarm is JUDGED ONCE, on the fix, and SHOWN twice — the banner reads it and so
// does the speaker — exactly as `alts`/`altScope` are judged once and drawn twice. Recomputing
// the march inside render() would be a second opinion about the same rock, and two opinions
// about a rock is how a screen and a speaker come to disagree about whether to turn.
let terrAlarm = terrainAlarm();
let verdict: TerrainVerdict = { kind: 'clear' };

// ---- Phase 4: traffic, the logger, the airspace ----
let traffic = trafficStore();                      // FLM: the picture, aged on read
let flarm: FlarmStatus | null = null;              // FLM: the instrument's own judgement, aged on read
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
  if (!confirm(t('orphan.confirm', { fixes: orphanFixes }))) return false;
  await clearJournal(kv);
  orphanBanner.remove();
  orphanBanner = null;
  return true;
}
let spaces: Airspace[] = [];                       // ESP: what the loaded file holds
let acks: Ack[] = [];                              // ESP-004: what the pilot silenced, and until when
let task: Task | null = null;                      // TSK: the declared task, if any
/** TSK-002: what the pilot is BUILDING. The task above is DERIVED from it — see core/taskedit, which
 *  knows nothing about sectors on purpose. Kept beside the task rather than inside it because a list
 *  of two points is a list a pilot is halfway through typing, and it is not a task yet. */
let taskWps: Waypoint[] = [];
let taskRules: RulesVersion = 'fai-2024';
let taskQuery = '';
let taskProgress: TaskProgress | null = null;
let aat: AatProgress | null = null;                // TSK: best scoring fixes per assigned area
const trail: [number, number][] = [];              // CAR: the recent track
const DEFAULT_WIDTH_M = 20_000;
let mapWidthM = DEFAULT_WIDTH_M;                   // CAR: zoom, metres across the canvas

/** WHERE THE MAP IS LOOKING, when it is not looking at the glider.
 *
 *  Null is the normal state and the safe one: the map follows the aircraft. A pan sets this, and from
 *  that moment THE MAP IS NO LONGER ABOUT HIM — it is about a piece of ground he chose to look at,
 *  and the glider will fly off the edge of it while he watches something else.
 *
 *  That is a real and useful thing to do (where is that ridge? what is under the next cloud street?)
 *  and it is also the single most dangerous state this screen can be in, because it is INVISIBLE. A
 *  pilot who panned and forgot is flying with an instrument that quietly stopped being an instrument.
 *
 *  So it is never silent: manualCentre !== null puts a banner across the map, and the banner IS the
 *  way back. Other computers use a timeout, and a timeout is a machine deciding he has finished
 *  looking. A banner is him deciding. */
let manualCentre: { lon: number; lat: number } | null = null;

/** Where the map looks when there is no fix and nobody has panned. Somewhere in the Alps, and it is
 *  a placeholder, not a position — but it is a place the pilot may want to look AROUND before the
 *  GPS has locked, which is why panBy starts from it too rather than refusing. Refusing was the first
 *  version, and it meant the map could not be moved at all on the ground: the one time a pilot is
 *  actually free to look at it. */
const NOWHERE = { lon: 8, lat: 47 };

// The world, minimally — parsed ONCE, at startup, from the Frictionless package bundled into the
// build. It costs 220 KB and no network at all: a pilot who has never had a connection still
// knows where on the planet he is (OFF-001). It is a frame for the eye, NOT a database of places
// to go — soaring-data ships it precisely because a coastline does not move and an aerodrome does.
const landmarks = {
  coastline: parseShapes(coastlineGeo),
  borders: parseShapes(bordersGeo),
  lakes: parseShapes(lakesGeo),
  peaks: parsePeaks(peaksCsv),
};
let audio: AudioOut | null = null;                 // VAR-004/005: null = silent, and it SAYS so
// LND: the fields the pilot loaded, the ones he wants to see, and core's verdict on them for
// THIS fix. `cup` is the file; `styleFilter` is a view filter — null means every landable
// style, and it is deliberately NOT persisted: it is what the pilot is looking at right now,
// not a setting he flies by. `alts` is recomputed per render and never remembered: an
// alternate is a claim about one position and one height, and yesterday's is a lie.
let cup: Poi[] = [];
let cupLandables = 0;                              // of those, the ones a glider may put a wheel on
let styleFilter: PoiCat[] | null = null;
let alts: Alternate[] = [];
// What core was ASKED, so the panel and the map can both say it: how many landables lay inside
// the judging radius, and how many of them the cost cap actually marched. Null when there is no
// file or no fix — then no question was put, and there is nothing to disclose about it.
let altScope: { radiusM: number; judged: number; inRadius: number } | null = null;
const flightTrack: TrackPoint[] = [];              // ANA/CNC: the flight, for the analysis tab

/** A new source is a NEW FLIGHT, and every memory of the old one goes with it.
 *
 *  Nothing here is a preference: the wind estimate, the 30-second average, the last thermal, the
 *  rose, the terrain hold, the traffic, the trail, the analysis track are all claims about ONE
 *  flight, and there is no honest way to carry any of them across a Connect or a replay. Left
 *  standing they do not merely go stale — they go stale INVISIBLY: the boxes wear no `est` badge
 *  and dim only with the link, so the previous flight's last thermal reads exactly like this
 *  one's, and (because every accumulator refuses a fix that does not advance its clock) a replay
 *  of a later flight than the live one would freeze them there for good.
 *
 *  The files the pilot loaded — task, airspace, landables, polar, goal — are NOT flight memory
 *  and stay: he chose them, and choosing a source is not unchoosing them. */
function resetFlight(): void {
  estimator = windEstimator();
  avgVario = rollingVario(30);
  circles = circlingTracker();
  rose = circleRose();
  terrAlarm = terrainAlarm();
  traffic = trafficStore();
  verdict = { kind: 'clear' };
  flarm = null;
  trail.length = 0;
  flightTrack.length = 0;
  state = EMPTY;
}

/** What the pilot typed, or the field's documented default. The parse is core's (fieldNumber),
 *  and it is core's because it is not the one-liner it looks like: an EMPTY box reads as 0 in
 *  every browser, `Number.isFinite(0)` is true, and this function used to hand that 0 on as if
 *  the pilot had chosen it. A backspaced terrain horizon then disabled the terrain alarm for the
 *  rest of the flight with nothing on screen saying so.
 *
 *  `min` names the fields where zero is not a value the pilot can have meant: a horizon of 0 s is
 *  not a short horizon, it is no alarm; a QNH of 0 hPa is not a low pressure, it is no altimeter
 *  setting. The reserve and MC keep no minimum — a pilot may legitimately fly MC 0, and a reserve
 *  of 0 m is a choice, if a bold one, that he has to type on purpose. */
const setting = (id: string, fallback: number, min?: number): number =>
  fieldNumber((root.querySelector(id) as HTMLInputElement).value, fallback, min);

/** The organisers' task time, in seconds — and the one setting on this screen that has no
 *  fallback, because there is nothing to fall back TO. Every other field here has a defensible
 *  default (a reserve of 200 m, a horizon of 60 s); a task time does not, it is a number
 *  the organisers set and nobody else knows. An empty field is therefore UNKNOWN, and unknown is
 *  null — never 0, which would be a minimum time already expired and would price a required
 *  speed against it. The AAT figures dash out instead, which is the app admitting it was not
 *  told (POT-007). */
function minTaskTimeS(): number | null {
  const raw = (root.querySelector('#set-mintime') as HTMLInputElement).value.trim();
  if (raw === '') return null;
  const min = Number(raw);
  return Number.isFinite(min) && min > 0 ? min * 60 : null;
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

/** TSK-007: the declared task's live state, and now the other half of it — not only what the
 *  flight has scored but what the task still OWES. The figures are core's (taskstats), the words
 *  are task-ui's; this function's whole job is to hand one the other's answer.
 *
 *  Every figure is priced from THIS fix, and without a fix there is nothing to price from: the
 *  stats are null and the ribbon dashes out rather than remembering yesterday's ETA. */
function taskHtml(s: NavState): string {
  const stats = task && taskProgress && aat
    ? taskStats(task, taskProgress, aat,
                s.fix ? { lon: s.fix.lon, lat: s.fix.lat, sod: s.fix.sod } : null,
                { minTaskTimeS: minTaskTimeS() })
    : null;
  return taskRibbonHtml(task, taskProgress, aat, stats, settings.units, t);
}

/** CAR + TER-005: repaint the canvas from the current state. Called from render, cheap at
 *  1 Hz — the reach march is 72 bearings over a cached tile lookup. */
function repaintMap(s: NavState, stale: boolean): void {
  const canvasEl = root.querySelector<HTMLCanvasElement>('#map');
  if (!canvasEl) return;

  // THE CANVAS FOLLOWS ITS FRAME. It used to be `<canvas width=480 height=480>` — a fixed square, in
  // a window that is whatever the pilot's screen is. CSS could stretch the PICTURE, but a canvas's
  // backing store is its `width`/`height` attributes, so stretching it only blurs it. The size has to
  // be set here, in pixels, from the box the layout actually gave it.
  //
  // devicePixelRatio is not a nicety: on a Retina display, a 1:1 canvas is drawn at half resolution
  // and every line the pilot reads in sunlight is soft. And the ratio is CLAMPED at 2 — beyond that
  // the gain is invisible and the cost is real, and this repaint runs at 1 Hz with a 72-bearing
  // terrain march behind it.
  const box = canvasEl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(box.width * dpr));
  const h = Math.max(1, Math.round(box.height * dpr));
  if (canvasEl.width !== w || canvasEl.height !== h) {
    canvasEl.width = w;
    canvasEl.height = h;
  }

  const ctx = canvasEl.getContext('2d') as unknown as MapPaint2D;
  const centre = manualCentre ?? (s.fix ? { lon: s.fix.lon, lat: s.fix.lat } : NOWHERE);
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
    goal: goal ? { lon: goal.lon, lat: goal.lat } : null, rangeM, reach, landmarks,
    // TER-001: the ground goes UNDER everything, and it goes under it measured — the painter
    // memoises on the epoch, so this costs a lookup per moved view, not a DEM sweep per second.
    terrain: { elev, epoch: tileEpoch },
    // LND-002/003: core judged them in render(); the painter only colours what it was handed.
    // The same list, on the map and in the panel — two pictures of one verdict, never two
    // verdicts of one field.
    landables: visibleAlts(alts),
    // …and the same disclosure. The rings are only the fields core was ASKED about; the scope
    // says so, and says how many it was not asked about, so that a bare corner of a zoomed-out
    // map cannot pass for a corner with no fields in it.
    landableScope: altScope,
    // CAR-005: the task the pilot is FLYING, and which leg he is on. It has been parsed, validated
    // and ribboned at the top of the screen since Phase 4 — and it was never on the map. `next` is
    // the point he has yet to reach, and it is what makes one leg bright and the rest dim: a map
    // that shouts every leg at once says nothing about where he is.
    task: task ? { task, nextIndex: taskProgress?.next ?? null } : null,
    // SYS-002: the rings age with the link, exactly as the boxes do.
    stale,
    // CFG-003: the two numbers this canvas prints — the judging radius and a named peak — are read
    // in the pilot's units, like every other number on this screen.
    units: settings.units,
  }, t);

  // ANA-002: the slice straight ahead — the dimension the plan view flattens away.
  const xs = root.querySelector<HTMLElement>('#xsection');
  if (xs && s.fix?.alt != null && s.track != null) {
    xs.innerHTML = xsectionSvg({
      lon: s.fix.lon, lat: s.fix.lat, bearing: s.track, altM: s.fix.alt,
      rangeM: Math.min(mapWidthM, 30_000), glideRatio: ld, elev, spaces,
    }, t);
  } else if (xs) {
    xs.innerHTML = '';                      // no track, no slice: nothing to draw ahead of
  }
}

/** LND-002…006: the alternates for THIS fix. Height is the whole question — without an
 *  altitude there is no glide slope to march, so there is no list, and an empty list is what
 *  the panel and the map both get. Not a list of fields with unknown margins: a field we could
 *  not judge is a question we did not ask, and the honest picture of an unasked question is
 *  nothing at all.
 *
 *  The wind is the wind IN USE — ours by preference, the instrument's when we have none —
 *  chosen exactly as the reach march above chooses it, because a panel priced against one wind
 *  beside a polygon priced against another is two computers arguing on one screen. And the
 *  reserve is the SAME #set-reserve the reach polygon and the final glide keep: one reserve,
 *  one spelling, and a pilot who lowers it lowers it everywhere at once. */
function computeAlternates(s: NavState): Alternate[] {
  if (!cup.length || !s.fix || s.fix.alt == null) return [];
  const w = estimator.estimate() ?? s.reportedWind ?? null;
  // NO type filter goes down into core, and the reason is a confirmed review finding: a field
  // excluded from the JUDGING is a field the "NO landable field within reach" banner would then
  // speak for without ever having asked about it — which is how "I unticked outlanding fields"
  // silently becomes "nothing is reachable" with a vachable strip six kilometres away. Core
  // judges every landable, always. The filter below hides ROWS, never verdicts.
  return alternates(elev, s.fix.lon, s.fix.lat, s.fix.alt, cup, polar, {
    wind: w, safetyM: setting('#set-reserve', 200),
  });
}

/** IHM-001, the whole point of the registry: everything a box may read, gathered ONCE per render
 *  out of what render() has already computed, in SI, with a null wherever nobody measured
 *  anything (POT-007). No getter downstream computes; they project. This is the only place the
 *  Fly screen's numbers and the pilot's chosen boxes meet, and it is a plain record — which is
 *  why moving a box is a click and no longer an edit to this file. */
function boxSource(
  s: NavState, d: ReturnType<typeof derive>, mc: number, stf: number,
  estWind: { direction: number; speed: number } | null,
  arr: ReturnType<typeof arrival>,
): BoxSource {
  return {
    latDeg: s.fix?.lat ?? null,
    lonDeg: s.fix?.lon ?? null,
    altM: s.fix?.alt ?? null,
    qnhAltM: d.qnhAlt,
    groundElevM: s.groundElev,
    aglM: s.agl,
    varioMs: s.vario ?? null,
    avg30Ms: avgVario.average(),
    lastThermalMs: circles.lastThermal()?.avgMs ?? null,
    lastCircleMs: circles.lastCircle()?.avgMs ?? null,
    nettoMs: d.netto,
    superNettoMs: d.superNetto,
    tasMs: d.tas,
    groundSpeedMs: s.groundSpeed ?? null,
    stfMs: stf,
    windDirDeg: estWind?.direction ?? null,
    windSpeedMs: estWind?.speed ?? null,
    instWindDirDeg: s.reportedWind?.direction ?? null,
    instWindSpeedMs: s.reportedWind?.speed ?? null,
    arrivalM: arr?.height ?? null,
    mcMs: mc,
  };
}

function render(s: NavState, link: LinkState): void {
  const mc = setting('#set-mc', 1);
  const qnh = setting('#set-qnh', 1013.25, 1);
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
    windUsed = w === estWind && estWind ? t('fly.windEstimated') : w ? t('fly.windInstrument') : t('fly.windNone');
    const head = w ? w.speed * Math.cos((w.direction - brg) * Math.PI / 180) : 0;
    arr = arrival(polar, mc, s.fix.alt, dist, goal.elev, head, reserve);
  }

  // SYS-002: a silent or closed source degrades the DISPLAY, not the application. The last
  // known values stay — a pilot mid-turn must not lose his numbers — but they visibly age:
  // dimmed, and captioned with what happened. A screen that keeps showing a dead
  // instrument's last position as current is the failure mode this class exists to prevent.
  const stale = link.state === 'silent' || link.state === 'closed';
  // Judged BEFORE the screen is written, so the panel and the map (repaintMap, below) are two
  // views of one computation rather than two computations that happen to agree today. The SCOPE
  // is computed here too, and it travels with them: core marches only the nearest fields inside
  // its radius, and the number it did not march is not a footnote — it is the difference between
  // "nothing is reachable" and "nothing I looked at is reachable".
  alts = computeAlternates(s);
  // FLM: the instrument's judgement, AGED on read — the same law, and the same clock, as the
  // traffic picture two lines below it. A FLARM that has stopped speaking has stopped judging,
  // and its last word must not stay on the screen as a live one.
  const fl = freshStatus(flarm, s.fix?.sod ?? 0);
  const inRadius = s.fix ? landablesWithin(cup, s.fix.lon, s.fix.lat).length : 0;
  altScope = cup.length && s.fix
    ? { radiusM: DEFAULT_RADIUS_M, judged: alts.length, inRadius }
    : null;
  // IHM-001/002: seventeen hard-coded boxes became a PAGE — the pilot's page, in the pilot's
  // order, in the pilot's units, out of the registry. The goal's arrival box is no longer a
  // conditional line of markup: it is a box like any other, and it dashes out when there is no
  // goal, because an arrival height without a goal is not a zero, it is a question nobody asked.
  const src = boxSource(s, d, mc, stf, estWind, arr);

  // ---- THE PHASE, which this app has always known and never used ----
  //
  // `circling.ts` answers `circling()` on every fix, and the flight screen already reads it — for the
  // wind rose, and for the terrain alarm, which must not march a straight ray out of a turning
  // glider. It never once used it for the SCREEN. So the pilot had three pages named `cruise`,
  // `climb` and `finalGlide`, and to move between them he tapped a tab eight-tenths of a rem tall,
  // IN A THERMAL. The data was under his hand the whole time.
  //
  // The phase changes WHAT stands in the six boxes. It never changes WHERE. A pilot reads an
  // instrument by knowing where a number lives; a layout that reflows under him has taken away the
  // only thing that made it glanceable.
  phase = nextPhase(phase, { circling: circles.circling(), arrivalM: arr?.height ?? null });
  const page = settings.autoPhase
    ? { id: phase, titleId: PHASE_TITLE[phase], boxIds: [...PHASE_BOXES[phase]] }
    : (settings.pages.find(p => p.id === settings.activePageId) ?? settings.pages[0]!);

  heroEl.innerHTML = heroHtml({
    goalName: goal === null ? null : t('hero.goal'),
    distM: goal && s.fix ? distM(s.fix.lon, s.fix.lat, goal.lon, goal.lat) : null,
    arrivalM: arr?.height ?? null,
    phase,
    stale,
  }, settings.units, t);
  glidebarEl.innerHTML = glideBarHtml(arr?.height ?? null, t);

  // The alerts ride ON the map, not above it. They are TRANSIENT — a terrain warning, a converging
  // glider — and a transient thing that permanently reserves a row of the layout has stolen that row
  // from the map for the 99 % of the flight when there is nothing to say.
  alertsEl.innerHTML = alertsHtml({ flarm: fl, terrain: verdict }, settings.units, t);

  // ---- THE MAP HAS STOPPED FOLLOWING HIM, AND IT SAYS SO ----
  //
  // Panning is a real and useful thing to do — where is that ridge, what is under the next street —
  // and it is also the single most dangerous state this screen can be in, because it is INVISIBLE.
  // The glider flies off the edge of a picture the pilot is still reading as if it were about him.
  //
  // So the banner is never silent, and THE BANNER IS THE WAY BACK: it is the button. Other computers
  // use a timeout, and a timeout is a machine deciding he has finished looking. This is him deciding.
  manualEl.hidden = manualCentre === null;
  manualEl.textContent = t('map.manual');

  // Six boxes, six slots, and NOTHING ELSE between the pilot and his map.
  //
  // The page tabs come back ONLY when the pilot has turned the phase off. That is the whole point of
  // the setting: he has said he would rather choose, so he must be given something to choose with. A
  // tab strip that stayed on screen while the phase drove the boxes would be a control that does
  // nothing — the worst kind, because it looks like it does something.
  flyView.innerHTML = (settings.autoPhase ? '' : pageTabsHtml(settings.pages, settings.activePageId, t))
    + boxesHtml(page, src, settings.units, t, { stale });

  // ---- and everything that LEFT ----
  //
  // The traffic panel, the airspace list, the task panel, the list of landable fields and the link
  // status are all real, and none of them belongs between a pilot and his map. They are the fields
  // pilots themselves turn off first. They live on the NAV screen now: one tap, and it stays there.
  if (!navEl.hidden) {
    navEl.innerHTML = `
      <h2>${t('nav.title')}</h2>
      <p class="note">${t('nav.note')}</p>
      ${trafficPanelHtml(fl, traffic.picture(s.fix?.sod ?? 0), settings.units, t)}
      ${airspaceHtml(s)}
      ${taskHtml(s)}
      <div id="alternates">${alternatesHtml({
        loaded: cup.length > 0,
        landableCount: cupLandables,
        haveAlt: s.fix?.alt != null,
        inRadius,
        radiusM: DEFAULT_RADIUS_M,
        judged: alts,                 // the banner speaks for THIS, never for the filtered rows
        rows: visibleAlts(alts),
        stale,
      }, settings.units, t)}</div>
      <div class="link ${link.state}">${t('fly.link', { state: link.state })}${
        link.state === 'closed' && link.error ? ` — ${link.error}` : ''
      }${stale ? ` — ${t('link.stale')}` : ''}${
        journal?.lastError ? ` — ${t('fly.journalFailing', { error: journal.lastError })}` : ''}</div>
    `;
  }
  // THE-001/002: the rose lives OUTSIDE #fly-view, beside the cross-section, because it is a
  // picture of the air and not a row of numbers. No branch here on "is he circling": a null rose
  // draws its own refusal ("not circling — no rose"), which is the honest thing to say and the
  // only thing this shell would have said anyway.
  roseEl.innerHTML = roseSvg(rose.rose(s.fix?.sod ?? 0), t);
  repaintMap(s, stale);
}

(root.querySelector('#connect') as HTMLFormElement).onsubmit = e => {
  e.preventDefault();
  const port = Number((root.querySelector('#port') as HTMLInputElement).value);
  driver = (root.querySelector('#driver') as HTMLSelectElement).value as Driver;
  void run(linkSel.value === 'udp' ? udpDevice(port) : tcpDevice(hostIn.value, port));
};
(root.querySelector('#igc') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  // ACQ-010, through the front door: the file becomes sentences, and from here on the
  // computer cannot tell it from Condor. 100 ms per fix ≈ a flight at 10× real time —
  // fast enough to sweep a whole flight, slow enough to watch the numbers move.
  const sentences = igcToSentences(await f.text());
  void run({ id: `replay:${f.name}`, label: f.name, link: 'replay', open: replaySource(sentences, 100) });
};
(root.querySelector('#set-goal') as HTMLButtonElement).onclick = () => {
  // The goal is where the glider IS, at the ground the DEM knows there. No fix or no ground
  // means no goal — a final glide to an invented elevation is exactly the number PLA-004
  // must never show.
  if (!state.fix || state.groundElev == null) {
    (root.querySelector('#goal-label') as HTMLElement).textContent = t('fly.noGoalNeedFix');
    return;
  }
  goal = { lon: state.fix.lon, lat: state.fix.lat, elev: state.groundElev };
  // renderFlyChrome derives the label from `goal` itself, in the pilot's language and his altitude
  // unit — one sentence, one place, and a language change repaints it.
  renderFlyChrome();
  render(state, link);
};
/** CFG-007 / LND-001: adopt a SeeYou .cup — the pilot's own list of fields, which is the only
 *  thing in this app that knows where one may land. Rows the parser cannot read are COUNTED in
 *  the label, never guessed at: a waypoint silently dropped is a field the pilot believes is in
 *  the list, and he believes it hardest on the day he needs it. Returns the label to show, or
 *  null when the text amounts to no points at all.
 *
 *  The ONE parse path, exactly as adoptTask is for tasks: the file input and the restart
 *  restore (OFF-002) both come through here, so a restored .cup cannot behave differently from
 *  one just chosen. */
function adoptCup(text: string): string | null {
  const f = parsePoiFile(text);
  if (f.pois.length === 0) return null;
  cup = f.pois;
  // Counted once, here, and remembered: the panel needs it to tell "this file has no landable in
  // it" (a turnpoint file, which this app happily accepts) apart from "this file's landables are
  // all out of reach". Rendering the second sentence for the first case would be its own lie.
  cupLandables = f.pois.filter(p => isLandable(p.cat)).length;
  return `${f.pois.length} points, ${cupLandables} landable${
    f.refused ? `, ${f.refused} rows refused` : ''}`;
}
(root.querySelector('#cup') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const text = await f.text();
  const label = adoptCup(text);
  (root.querySelector('#cup-label') as HTMLElement).textContent = label ?? t('fly.cupRefused');
  // OFF-002, and the same refusal discipline as the task: a file that yielded nothing is not a
  // database of fields, and it must not come back next launch posing as one.
  if (label) void saveFlightFile(kv, 'landables', { name: f.name, text });
  render(state, link);
};
/** LND-008, applied where it belongs: a VIEW over verdicts core already reached. */
const visibleAlts = (all: readonly Alternate[]): Alternate[] =>
  styleFilter == null ? [...all] : all.filter(a => styleFilter!.includes(a.point.cat));

/** LND-008: which styles the pilot wants to SEE. All four ticked is the same as no filter, and
 *  it is spelt as no filter — null — so the default state has one representation, not two.
 *  This is a view filter and nothing more: it never persists, and it never changes what core
 *  judges, only which fields core is asked about. */
function readStyleFilter(): PoiCat[] | null {
  const on = LANDABLE_CATS.filter(
    c => root.querySelector<HTMLInputElement>(`#lnd-style-${c}`)?.checked);
  return on.length === LANDABLE_CATS.length ? null : on;
}
// The landable-style checkboxes moved to Settings with the rest of the setup, and this listener
// hung on the form that used to hold everything. It hangs on BOTH now — the one the pilot flies with
// and the one he sets up with — because the numbers it reads are spread across the two, and a
// listener that misses one of them is a control that silently does nothing.
for (const id of ['#fly-controls', '#setup']) {
  const form = root.querySelector<HTMLFormElement>(id);
  if (form === null) continue;
  form.oninput = () => {
    styleFilter = readStyleFilter();
    render(state, link);
  };
}
// ESP-004: the ack rides the shelfEl pattern — ONE delegated listener on the container that
// is built once, because the alert rows under it repaint every second. The ack is keyed, not
// indexed: between the paint and the tap the row order may have changed, but the key still
// names the volume the pilot read.
flyView.onclick = e => {
  const el = e.target as HTMLElement;
  // IHM-002: the page tabs repaint at 1 Hz under this listener, exactly as the alert rows do —
  // which is precisely why the listener is on the container and not on the buttons. The chosen
  // page is a SETTING (CFG-005): it goes through the normalizer and onto the disk, so the pilot
  // who was on 'final glide' when the battery died comes back to 'final glide'.
  const tab = el.closest('button[data-page]') as HTMLButtonElement | null;
  if (tab?.dataset.page) {
    applySettings({ activePageId: tab.dataset.page });
    return;
  }
  const btn = el.closest('button[data-ack]') as HTMLButtonElement | null;
  if (!btn || !state.fix) return;
  const space = spaces.find(sp => ackKey(sp) === btn.dataset.ack);
  if (!space) return;                     // a click racing a file reload: nothing left to ack
  acks = acknowledge(acks, space, state.fix.sod);
  render(state, link);
};
(root.querySelector('#rec') as HTMLButtonElement).onclick = async e => {
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
    btn.textContent = t('fly.stopSave');
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
  btn.textContent = t('fly.record');
  if (j) await j.flush();
  const igc = lg.file();
  const n = lg.count();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([igc], { type: 'application/octet-stream' }));
  a.download = `volplane-${new Date().toISOString().slice(0, 10)}.igc`;
  a.click();
  URL.revokeObjectURL(a.href);
  if (j) await j.discard();
  (root.querySelector('#oa-label') as HTMLElement).textContent = t('fly.savedFixes', { n });
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
  // TSK-008: an IMPORTED task must be editable, or the import is a dead end. The pilot who lands the
  // day's task off a CSV and then finds the second turnpoint under cloud must be able to take it out
  // — at 1500 metres, on the tab, without a text editor and a re-import.
  taskWps = taskWaypoints(task);
  taskRules = task.rules;
  const areas = task.points.filter(p => p.sector.kind === 'aatArea').length;
  return `${wps.length} points, ${task.rules}${areas ? `, ${areas} assigned area${areas > 1 ? 's' : ''}` : ''}${
    refused ? `, ${refused} lines refused` : ''}`;
}
(root.querySelector('#tsk') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const text = await f.text();
  const label = adoptTask(text);
  (root.querySelector('#tsk-label') as HTMLElement).textContent = label ?? t('fly.taskRefused');
  // OFF-002: the task survives the restart — saved as the RAW text, and only once adopted:
  // a file refused above is not a task, and must not come back next launch as one.
  if (label) void saveFlightFile(kv, 'task', { name: f.name, text });
  render(state, link);
};
// PLA-010: the name of the polar that FLIES, as words the pilot can check against his
// glider. The default is named as the default — an imported polar and the built-in one must
// never be mistaken for each other.
const polarName = (): string => {
  if (settings.polar) return settings.polar.name;
  const lib = settings.glider ? GLIDER_LIBRARY.find(g => g.id === settings.glider!.libId) : undefined;
  if (lib) return lib.name;
  return t('fly.polarDefault', { name: DEFAULT_POLAR.name });
};
const plrLabel = root.querySelector('#plr-label') as HTMLElement;
(root.querySelector('#plr') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  // The normalizer IS the gatekeeper: repairPolar runs the file through parsePlr and nulls
  // what the parser refuses — a second parse opinion here could only ever disagree with it.
  const next = normalizeSettings({ ...settings, polar: { name: f.name, plr: await f.text() } });
  if (next.polar === null) {
    plrLabel.textContent = t('fly.plrRefused', { name: polarName() });
    return;
  }
  // CFG-007 outranks CFG-002, and the panel must not be able to say otherwise: the pilot handed
  // us the file for HIS glider, so the library pick is CLEARED rather than left standing under an
  // import that already outranks it (activePolar's priority). A Discus showing as selected while
  // an imported ASK 21 .plr quietly flies the final glide is the exact lie this clears.
  applySettings({ polar: next.polar, glider: null });
  plrLabel.textContent = polarName();
};
(root.querySelector('#plr-default') as HTMLButtonElement).onclick = () => {
  applySettings({ polar: null });
  plrLabel.textContent = polarName();
};
// ESP-004: which classes ALERT. Committed onchange, not per keystroke — a half-typed list
// must not mute anything — and echoed back normalized (trimmed, uppercase, deduped), so the
// input always shows exactly the filter that rules. Empty means all: silence is chosen per
// class, never defaulted into.
(root.querySelector('#set-classes') as HTMLInputElement).onchange = e => {
  const el = e.target as HTMLInputElement;
  const raw = el.value.trim();
  applySettings({ monitoredClasses: raw === '' ? null : raw.split(',') });
  el.value = settings.monitoredClasses?.join(', ') ?? '';
};
// VAR-004: the browser refuses sound before a gesture, and that refusal is not a bug to work
// around — this button IS the gesture. A platform with no audio out says so (the spec's own
// "LÀ OÙ une sortie audio est disponible") rather than pretending to sing.
(root.querySelector('#audio-on') as HTMLButtonElement).onclick = e => {
  const btn = e.target as HTMLButtonElement;
  if (audio?.running) {
    audio.stop();
    audio = null;
    btn.textContent = t('fly.audioOff');
    return;
  }
  audio = openAudio();
  btn.textContent = audio ? t('fly.audioOn') : t('fly.audioNone');
};
// ---- the view, and the three things a pilot does to it ----

const MIN_WIDTH_M = 2_000, MAX_WIDTH_M = 200_000;
const zoomBy = (factor: number): void => {
  mapWidthM = Math.max(MIN_WIDTH_M, Math.min(MAX_WIDTH_M, mapWidthM * factor));
  render(state, link);
};

/** PUT IT BACK. Follow the glider again, at the range the screen opens on.
 *
 *  It restores BOTH — the centre and the zoom — because a pilot reaching for this has stopped
 *  understanding what he is looking at, and half a reset would leave him still not understanding it. */
const resetView = (): void => {
  manualCentre = null;
  mapWidthM = DEFAULT_WIDTH_M;
  render(state, link);
};

/** Drag the ground under the finger.
 *
 *  Screen y grows downward and north is up: pulling the finger DOWN drags the picture down and
 *  uncovers ground to the NORTH, so the centre goes north. Pulling it RIGHT uncovers ground to the
 *  WEST. Getting this backwards produces a map that fights the hand, which every pilot will describe
 *  as "broken" and none will describe correctly. */
const M_PER_DEG_LAT = 111_320;
const panBy = (dxPx: number, dyPx: number): void => {
  const canvasEl = root.querySelector<HTMLCanvasElement>('#map');
  if (canvasEl === null || canvasEl.width === 0) return;
  const base = manualCentre ?? (state.fix ? { lon: state.fix.lon, lat: state.fix.lat } : NOWHERE);
  const mPerPx = mapWidthM / canvasEl.width;
  const lat = base.lat + (dyPx * mPerPx) / M_PER_DEG_LAT;
  const cos = Math.max(0.01, Math.cos(base.lat * Math.PI / 180));
  const lon = base.lon - (dxPx * mPerPx) / (M_PER_DEG_LAT * cos);
  manualCentre = { lon, lat };
  render(state, link);
};

(root.querySelector('#zoom-in') as HTMLButtonElement).onclick = () => zoomBy(1 / 1.5);
(root.querySelector('#zoom-out') as HTMLButtonElement).onclick = () => zoomBy(1.5);

// ---- THE GESTURES ----
//
// A button has a size. A gesture does not, and that is the whole argument for using one in a moving
// aircraft: the pilot is being thrown about, one hand is on the stick, and the screen gets a glance.
// The recogniser is pure and lives in core/gesture.ts, with the guard that matters — a drag under
// MIN_PAN_PX is A TAP THAT SLID, not a pan, and that is the accident pilots name themselves.
const gestures = recogniser();
const mapEl = root.querySelector<HTMLCanvasElement>('#map')!;

const apply = (g: Gesture): void => {
  switch (g.kind) {
    case 'pan': panBy(g.dxPx, g.dyPx); break;
    case 'zoom': zoomBy(g.factor); break;
    case 'reset': resetView(); break;
    case 'none': break;
  }
};

mapEl.style.touchAction = 'none';      // or the browser pans the PAGE and the map never sees it
mapEl.addEventListener('pointerdown', e => {
  mapEl.setPointerCapture(e.pointerId);
  apply(gestures.down({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }));
});
mapEl.addEventListener('pointermove', e => {
  apply(gestures.move({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }));
});
mapEl.addEventListener('pointerup', e => {
  apply(gestures.up({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }));
});
// A gesture the browser took away is FORGOTTEN, not half-remembered. One completed by the NEXT touch
// is how a map ends up somewhere nobody asked for.
//
// AND IT IS `pointercancel`, NOT `lostpointercapture`. The first draft listened to both, on the
// reasoning that losing the capture is losing the gesture. IT IS NOT: lostpointercapture fires on
// EVERY NORMAL RELEASE, because releasing the finger implicitly releases the capture. So every tap
// ended in a cancel(), the first tap was wiped before the second arrived, and THE DOUBLE TAP COULD
// NEVER FIRE — a feature that passed its unit tests and did nothing in a browser, because the tests
// call the recogniser and the browser calls the DOM.
mapEl.addEventListener('pointercancel', () => gestures.cancel());

// The wheel, for the desk. It is not a flying gesture and it is not pretending to be one — but a
// developer who cannot zoom the map with a mouse will not look at the map.
manualEl.onclick = resetView;

mapEl.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15);
}, { passive: false });
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
    return { adopted: false, label: t('fly.airspaceRefused', { refused }) };
  }
  spaces = loaded;
  return {
    adopted: true,
    label: t('fly.airspaceLoaded', { n: loaded.length })
      + (refused ? t('fly.airspaceRefusedSome', { n: refused }) : ''),
  };
}
(root.querySelector('#oa') as HTMLInputElement).onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const text = await f.text();
  const r = adoptAirspace(text);
  (root.querySelector('#oa-label') as HTMLElement).textContent = r.label;
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
  // …and retire the old FLIGHT with it. The gen bump stops the loop; it does not empty the
  // memories that loop filled, and a memory of another flight is not a stale number, it is a
  // wrong one wearing no badge at all.
  resetFlight();
  const watched = withHealth(dev.open(), s => {
    if (gen !== runGen) return;                  // a dead loop's link chip is nobody's news
    link = s;
    // SYS-002, and the one place it does NOT mean "keep the last value". The boxes may age in
    // place — a pilot mid-turn must not lose his numbers, and a dimmed altitude still says which
    // altitude it was. An ALARM cannot be dimmed. It is a claim about the next thirty seconds,
    // and the moment the instrument stops talking there is no evidence for it: the verdict and
    // the voice are both computed per fix, so a link that dies mid-alarm would otherwise leave
    // the banner lit and the speaker warbling for as long as the app is open, about a ridge the
    // glider may have turned away from a minute ago. An alarm nobody can retract is an alarm the
    // pilot learns to ignore. So the judgement is withdrawn with the fix that justified it.
    //
    // BOTH judgements. The FLARM status is the same kind of claim as the terrain verdict — "there
    // is something in front of you, right now" — and withdrawing one while leaving the other lit
    // was the same bug with a different banner: a full-intensity, undimmed "FLARM — ALARM 3" over
    // a traffic list that had already aged to empty, with a silent speaker underneath it. Screen
    // and speaker disagreeing about whether to turn is precisely what this branch exists to
    // prevent. (freshStatus ages it out anyway once the clock moves on; this makes the retraction
    // immediate, and survives a link that dies with the clock.)
    if (s.state === 'silent' || s.state === 'closed') {
      verdict = { kind: 'clear' };
      flarm = null;
      audio?.setVoice(null);
    }
    render(state, link);
  });
  // The whole flight computer, in one expression: a stream of sentences, a terrain sampler,
  // a driver. It does not know that Tauri, or a TCP socket, or Condor exist.
  // The FLARM tap: PFLAU/PFLAA ride the same NMEA stream but are not navigation — nmea.ts
  // rightly ignores them. This tee reads them BEFORE navigate, so one stream feeds both the
  // position and the picture, and a replay with FLARM lines replays the traffic too.
  async function* tee(src: AsyncIterable<string>): AsyncIterable<string> {
    for await (const line of src) {
      if (line.startsWith('$PFLAU')) {
        // Stamped with the fix's own clock, exactly as the traffic is, so that a FLARM which
        // stops speaking can be aged out instead of standing forever (freshStatus, below).
        const st = parsePflau(line, state.fix?.sod ?? 0);
        if (st) flarm = st;
      } else if (line.startsWith('$PFLAA')) {
        const tr = parsePflaa(line, state.fix?.sod ?? 0);
        if (tr) traffic.add(tr);
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
      // The estimator eats every fix with a height; so do the two new memories beside it, and
      // for the same reason the averager is clocked by the fix's own seconds — a replay must
      // remember exactly what the live flight remembered. VAR-006 needs the height (a climb is
      // a height over a time); THE-001 needs it too, and takes the vario as it comes: a fix with
      // no vario reading contributes NOTHING to the rose, and specifically not a zero.
      if (state.fix.alt != null) {
        estimator.add(state.fix.lon, state.fix.lat, state.fix.alt, state.fix.sod);
        circles.add(state.fix.sod, state.fix.lon, state.fix.lat, state.fix.alt);
        rose.add(state.fix.sod, state.fix.lon, state.fix.lat, state.fix.alt, state.vario ?? null);
      }
      if (state.vario != null) avgVario.add(state.fix.sod, state.vario);
      // TER-008: judged HERE, on the fix, and kept — the banner and the speaker below both read
      // this one verdict. The wind is the wind IN USE, chosen exactly as the reach polygon and
      // the alternates choose it, because an alarm priced against one wind beside a glide
      // polygon priced against another is two computers arguing about the same ridge.
      //
      // What is NOT passed is `#set-reserve`. The pilot's final-glide reserve is a height he
      // wants in hand at a field; handing it to a collision march made every metre within 200 m
      // of the flight path a "ridge in the way", which over flat ground at circuit height is a
      // permanent level-3 siren. The alarm keeps its own clearance (TERRAIN_CLEARANCE_M) and
      // there is deliberately no knob here to feed the reserve back into.
      //
      // And it is told when the glider is CIRCLING, because then the straight ray this march
      // flies is not the path the glider is on: thermalling beside a ridge, the track sweeps onto
      // the rock once a turn, and chooseVoice would take the vario away for the whole climb.
      verdict = terrAlarm.add(state.fix.sod, terrainAhead(elev, state, polar, {
        horizonS: setting('#set-horizon', DEFAULT_HORIZON_S, 1),
        circling: circles.circling(),
        wind: estimator.estimate() ?? state.reportedWind ?? null,
      }));
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
      // VAR-004/005 and FLM-002: the air, out loud — and the alarms over the top of it. In
      // speed-to-fly mode the tone says how to fly rather than how the air moves; either way it
      // is the CRUISE voice, and an alarm supersedes it outright. One speaker, one voice, and
      // the priority law is core/alarmtone's chooseVoice — not this loop. A shell that decided
      // for itself whether the collision outranked the climb would be a second, untested alarm
      // sitting on top of the tested one.
      if (audio?.running) {
        const d = derive(state, polar, setting('#set-qnh', 1013.25, 1));
        const stfMode = (root.querySelector('#audio-stf') as HTMLInputElement).checked;
        const cruise = stfMode && d.tas != null
          ? stfTone(d.tas - speedToFly(polar, setting('#set-mc', 1), d.netto ?? 0))
          : varioTone(state.vario);
        // The FLARM level is read THROUGH freshStatus, never off the last-seen object: a FLARM
        // that stops sending PFLAU mid-alarm would otherwise hold the top of the priority law
        // forever, warbling over a threat that has passed and masking both the vario and a real
        // TERRAIN alarm underneath it — an alarm nobody can retract.
        audio.setVoice(chooseVoice({
          flarm: freshStatus(flarm, state.fix.sod)?.alarm ?? 0,
          terrain: verdict.kind === 'alarm' ? verdict.level : null,
          cruise,
        }));
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
  <h2>Repository</h2>
  <div id="bf-repo"></div>
  <span id="bf-repo-status" class="progress"></span>
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
const repoEl = q('#bf-repo');
const repoStatusEl = q('#bf-repo-status');
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
  legendEl.innerHTML = legendHtml(bfOn, t, bfMap);
}

/** Re-brief the hour from the weather already in hand: panel, emagram, lift map. The hour
 *  slider lands here — computeLiftMap is milliseconds at briefing grid sizes, so the map
 *  follows the slider live. */
function renderDay(): void {
  const b = briefingAt(bfWx, bfHour, bfSource);
  briefingEl.innerHTML = briefingHtml(b, settings.units, t);
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
    navigator.onLine, isPersistent(kv), bfHeld?.weather?.fetchedAt ?? null, Date.now(), t);
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
    cacheEl.innerHTML = `<div class="cache"><div class="over-budget">${
      t('cache.saveFailed', { error: String(e) })}</div></div>`;
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
    shelfEl.innerHTML = shelfHtml(sortedShelf(snap), completenessById, offers, t);
    cacheEl.innerHTML = cacheHtml(inv.reduce((sum, e) => sum + e.bytes, 0), budgetMB(), lastPlan, t);
  } catch (e) {
    if (epoch !== shelfEpoch) return;
    // A failed re-measurement must not leave yesterday's panel posing as fresh (OFF-010's
    // promise is the MEASUREMENT, not the pixels): say the measurement failed, in place.
    shelfEl.innerHTML = `<div class="shelf"><div class="shelf-empty">${
      t('shelf.remeasureFailed', { error: String(e) })}</div></div>`;
    cacheEl.innerHTML = '';
  }
}

// The catalogue is BUNDLED (soaring-data, Frictionless): the list of what exists is available with
// the radio dead. Only the FILES need a network, which is the honest split — a pilot offline can
// still see what he is missing.
const catalogue: CatalogueEntry[] = parseCatalogue(catalogueCsv);

/** What we hold, per catalogue entry. Persisted with the flight files (OFF-002) — the raw bytes go
 *  through the SAME store, so a downloaded airspace survives a restart exactly as a hand-picked one
 *  does, and the two are indistinguishable downstream. */
let repoHeld: Record<string, HeldFile> = {};

const REPO_HELD_KEY = 'repo/held';

function renderRepo(): void {
  repoEl.innerHTML = repositoryHtml(
    catalogue,
    new Map(Object.entries(repoHeld)),
    e => freshness(repoHeld[e.id] ?? null, Date.now()),
    navigator.onLine,
    t,
  );
}

/** Download one entry, adopt it, and remember how old the file said it was. The fetch is plain:
 *  these sources serve CORS, and a Rust round-trip would buy nothing but a layer to debug. */
async function fetchEntry(e: CatalogueEntry): Promise<void> {
  repoStatusEl.textContent = t('repo.fetching', { name: e.name });
  try {
    const r = await boundFetch(e.uri);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (!text.trim()) throw new Error('the server answered with an empty file');

    // The file's OWN date, when it states one — better than anything the catalogue could carry,
    // because it describes THIS copy rather than what upstream published at some point.
    repoHeld[e.id] = {
      entryId: e.id, fetchedAt: Date.now(), fileDate: versionOf(text), bytes: text.length,
    };
    await saveFlightFile(kv, 'airspace', { name: `${e.id} (${e.name})`, text });
    await putJson(kv, REPO_HELD_KEY, repoHeld);
    const r2 = adoptAirspace(text);
    (root.querySelector('#oa-label') as HTMLElement).textContent =
      t('fly.fromRepository', { label: r2.label });
    repoStatusEl.textContent = `${e.name}: ${r2.label}`;
    renderRepo();
    render(state, link);
  } catch (err) {
    // A failed download changes NOTHING: the airspace already loaded stays loaded, and the pilot
    // is told which file he is still flying with rather than being left to wonder.
    repoStatusEl.textContent = t('repo.downloadFailed', {
      name: e.name, error: err instanceof Error ? err.message : String(err),
    });
  }
}

repoEl.onclick = e => {
  const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
  const id = btn?.dataset.id;
  if (!btn || !id) return;
  const entry = catalogue.find(c => c.id === id);
  if (!entry) return;
  if (btn.dataset.act === 'get') void fetchEntry(entry);
  else if (btn.dataset.act === 'use') void (async () => {
    // 'use' re-adopts what is already on disk — no network, so it works in the air.
    const f = await loadFlightFile(kv, 'airspace');
    if (!f) { repoStatusEl.textContent = t('repo.nothingStored'); return; }
    const r = adoptAirspace(f.text);
    repoStatusEl.textContent = `${entry.name}: ${r.label}`;
    render(state, link);
  })();
};

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
    calEl.textContent = t('bf.calibration');
  }
  if (!bfSpec) {
    bfHeld = null;
    completenessEl.innerHTML = `<div class="pack-status unknown">${t('pack.none')}</div>`;
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
  completenessEl.innerHTML = completenessHtml(completeness(bfSpec, held, Z, Date.now()), t);
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
  progressEl.textContent = t('bf.starting');
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
    progressEl.textContent = failed === 0 ? t('bf.done', { ok }) : t('bf.partial', { ok, failed });
  } catch {
    // downloadPack counts item failures instead of throwing; only the store itself dying can
    // land here. What was written IS written — re-measure and let completeness say the rest.
    progressEl.textContent = t('bf.interrupted');
  }
  // The bookkeeping is NOT inside the try (a confirmed finding): a failed shelf-save must
  // not print 'download interrupted' over a download that completed. Each failure gets its
  // own words, in its own place.
  try {
    lastPlan = await enforceBudget(kv, shelf, budgetMB() * BYTES_PER_MB);
  } catch (e) {
    progressEl.textContent += t('bf.enforceFailed', { error: String(e) });
  }
  void refreshShelf();
  void refreshBriefing();
}

q<HTMLFormElement>('#bf-form').onsubmit = e => {
  e.preventDefault();
  const spec = readSpec();
  if (!spec) {
    progressEl.textContent = t('bf.provisionFirst');
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
  applySettings({ cacheBudgetMB: Number(budgetIn.value) });
  budgetIn.value = String(settings.cacheBudgetMB);   // show the value that will actually rule
  try {
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
  calEl.textContent = t('bf.calibration');
  void refreshBriefing();
};

compsEl.onchange = e => {
  const el = e.target as HTMLInputElement;
  const i = Number(el.dataset.i);
  if (Number.isInteger(i) && i >= 0 && i < bfOn.length) {
    bfOn[i] = el.checked;
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
    calEl.textContent = t('bf.calibrationNeedsArea');
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
    ? t('bf.calibrationOf', { factor: bfCal.toFixed(2) })
      + ` <span class="badge modelled" title="${t('badge.modelled.title')}">${t('badge.modelled')}</span> `
      + t('bf.calibrationFrom', { n: usable })
    : t('bf.calibrationRefused', { n: MIN_RATIOS });
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
    completenessEl.innerHTML = completenessHtml(completeness(bfSpec, bfHeld, Z, Date.now()), t);
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
const tabNav = root.querySelector<HTMLButtonElement>('#tab-nav')!;
const tabTask = root.querySelector<HTMLButtonElement>('#tab-task')!;
const tabBf = root.querySelector<HTMLButtonElement>('#tab-briefing')!;
const tabAna = root.querySelector<HTMLButtonElement>('#tab-analysis')!;
const tabSet = root.querySelector<HTMLButtonElement>('#tab-settings')!;

/** The chrome the pilot reads before he reads anything else: the four tab names. Repainted on
 *  every settings write, because a language change that left the tabs in the old language would
 *  be a language change the pilot could not finish reading. textContent, not innerHTML — these
 *  are words, not markup, and the catalogue is not a template engine. */
function renderChrome(): void {
  tabFly.textContent = t('tab.fly');
  tabNav.textContent = t('tab.nav');
  tabTask.textContent = t('tab.task');
  tabBf.textContent = t('tab.briefing');
  tabAna.textContent = t('tab.analysis');
  tabSet.textContent = t('tab.settings');
  renderFlyChrome();
}

/** The Fly screen's control strip, in the pilot's language — the half of IHM-006 that used to get
 *  away.
 *
 *  render() repaints #fly-view and nothing else, deliberately: the strip is a form, and a form
 *  rebuilt at 1 Hz eats the caret the pilot is typing a QNH into. But that left its words frozen in
 *  whatever language the app booted in. A pilot switching to French got French tabs, French boxes,
 *  French alerts — and an English record button, an English audio button, an English 'no goal' and
 *  an English list of landable categories, which are precisely the controls he touches in the air.
 *
 *  So the strip is repainted here, and ONLY the words: every [data-i18n] span, every title, and the
 *  four controls whose text is a function of STATE rather than of markup. The inputs themselves are
 *  never touched — what he typed stays typed, and the file he picked stays picked. */
function renderFlyChrome(): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]'))
    el.textContent = t(el.dataset.i18n!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]'))
    el.title = t(el.dataset.i18nTitle!);

  // State, not markup: these four say what the app is DOING, and the sentence must be re-derived
  // rather than remembered — a remembered sentence is the old language's sentence.
  const goalLabel = root.querySelector<HTMLElement>('#goal-label')!;
  goalLabel.textContent = goal === null
    ? t('fly.noGoal')
    : t('fly.goalAt', {
        lat: goal.lat.toFixed(3), lon: goal.lon.toFixed(3),
        elev: formatText(goal.elev, 'altitude', settings.units.altitude),
      });
  root.querySelector<HTMLElement>('#rec')!.textContent =
    logger === null ? t('fly.record') : t('fly.stopSave');
  root.querySelector<HTMLElement>('#audio-on')!.textContent =
    audio?.running ? t('fly.audioOn') : t('fly.audioOff');
  // LND-008's four boxes carry the category names, which are catalogue words too. The filter STATE
  // is passed back in, so repainting the words cannot silently untick a box the pilot ticked.
  root.querySelector<HTMLElement>('#lnd-filter-slot')!.innerHTML = styleFilterHtml(styleFilter, t);
}

function showTab(which: 'fly' | 'nav' | 'task' | 'briefing' | 'analysis' | 'settings'): void {
  app.hidden = which !== 'fly';
  navEl.hidden = which !== 'nav';
  taskEl.hidden = which !== 'task';
  bf.hidden = which !== 'briefing';
  ana.hidden = which !== 'analysis';
  setEl.hidden = which !== 'settings';
  tabFly.classList.toggle('active', which === 'fly');
  tabNav.classList.toggle('active', which === 'nav');
  tabTask.classList.toggle('active', which === 'task');
  tabBf.classList.toggle('active', which === 'briefing');
  tabAna.classList.toggle('active', which === 'analysis');
  tabSet.classList.toggle('active', which === 'settings');
  if (which === 'analysis') renderAnalysis();
  if (which === 'settings') renderSettings();
  if (which === 'task') renderTaskEditor();
  // The NAV screen is painted by render(), and only while it is VISIBLE — the panels it holds are the
  // expensive ones (a traffic picture, an airspace sweep, a landables judgement), and paying for them
  // at 1 Hz behind a hidden div is how a flight computer runs a battery down for nothing.
  if (which === 'nav') render(state, link);
  // Screen entry re-measures here too, and for the same reason the briefing does (OFF-010): tiles
  // land while this screen is hidden — a whole pack's worth, if the pilot went to the Briefing tab
  // to provision one — and onFlyTiles deliberately does not repaint a hidden canvas. Coming back
  // to a map still hatched over ground now on disk would be the epoch mechanism defeated at the
  // last step.
  if (which === 'fly') render(state, link);
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
    renderRepo();                 // the ages move with the clock, so they are re-rendered on entry
  }
}
tabFly.onclick = () => showTab('fly');
tabNav.onclick = () => showTab('nav');
tabTask.onclick = () => showTab('task');
tabBf.onclick = () => showTab('briefing');
tabAna.onclick = () => showTab('analysis');
tabSet.onclick = () => showTab('settings');

// ============ the Analysis screen — Phase 6 (ANA-001/003, CNC-001/002/003) ============
// Everything here is ABOUT a flight, and every number on it is either a measurement of what
// happened or a score under a NAMED barème. The distinction ANA-003 turns on is the one the
// whole app turns on: the achieved glide ratio is a fact, the polar's is a claim about the
// glider, and they are shown side by side rather than fused into a single flattering number.

const ana = root.querySelector<HTMLElement>('#analysis')!;
const taskEl = root.querySelector<HTMLElement>('#taskedit')!;

// ============ TSK-002/008/009: the task the pilot BUILDS ============
//
// The whole screen repaints after every edit, and that is why ONE delegated listener on the container
// is the only listener there is: the buttons under it are replaced on every keystroke, and a listener
// bound to a button would be bound to a button that no longer exists. It is the shelf-ui contract,
// and it is what makes a screen that rebuilds itself still work under a thumb.
//
// The REDUCER is core's (taskedit.editWaypoints) — pure, tested, and ignorant of what a sector is.
// The sectors come from simpleTask, where they are defined and where inSector judges them. A builder
// with its own idea of a sector would be a second rule book, and the map would draw one while the
// scorer judged by the other.
function renderTaskEditor(): void {
  taskEl.innerHTML = taskEditorHtml(
    { wps: taskWps, rules: taskRules, pois: cup, query: taskQuery, units: settings.units }, t,
  );
}

/** One edit: apply it, DERIVE the task, and repaint. The task is null until two points exist — one
 *  point is not a shorter task, it is not a task, and a half-built list must not quietly become the
 *  thing the map draws and the scorer judges. */
function editTask(act: Edit, index: number, wp?: Waypoint): void {
  taskWps = editWaypoints(taskWps, act, index, wp);
  task = withWaypoints(taskWps, taskRules);
  taskProgress = null;                 // a task that changed is a task he has not flown yet
  renderTaskEditor();
  render(state, link);                 // the map draws it the moment he places the point
}

taskEl.oninput = e => {
  const el = e.target as HTMLElement;
  if (el.id === 'task-q') { taskQuery = (el as HTMLInputElement).value; renderTaskEditor(); }
};

taskEl.onchange = e => {
  const el = e.target as HTMLSelectElement;
  if (el.dataset.act === 'rules') {
    taskRules = el.value as RulesVersion;
    task = withWaypoints(taskWps, taskRules);
    taskProgress = null;
    renderTaskEditor();
    render(state, link);
  }
};

taskEl.onclick = e => {
  const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
  if (btn === null) return;
  const act = btn.dataset.act;

  if (act === 'clear') {
    taskWps = [];
    task = null;
    taskProgress = null;
    taskQuery = '';
    renderTaskEditor();
    render(state, link);
    return;
  }

  if (act === 'add') {
    // The point is found by NAME, in the file he loaded, at the moment he taps — not captured into
    // the button when the list was painted. Between the paint and the tap he may have typed another
    // letter and the list may have moved under his finger.
    const wanted = btn.dataset.name;
    const poi = cup.find(p => p.name === wanted);
    if (poi) editTask('add', 0, { name: poi.name, lon: poi.lon, lat: poi.lat });
    return;
  }

  const i = Number(btn.dataset.i);
  if (Number.isFinite(i) && (act === 'up' || act === 'down' || act === 'remove')) editTask(act, i);
};

/** The barograph, as an SVG. Altitude against time, and the climbs the kernel found marked
 *  under it — the day's real work, where it came from. */
function barographSvg(track: TrackPoint[], wPx = 640, hPx = 200): string {
  const b = barograph(track);
  if (!b) return `<div class="link">${t('ana.noFlight')}</div>`;
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

/** The Analysis screen's boxes go through infobox-ui's `boxHtml` — the SAME primitive the Fly
 *  screen's registry renders through, because two box renderers would be two answers to "what
 *  does an unknown look like" and only one of them would be the tested one.
 *
 *  A quantity is named where there is one (altitudes are altitudes, kilometres are distances), so
 *  the pilot's unit choice reaches this screen too; the pure RATIOS — a glide ratio, a percentage,
 *  a count of climbs — are not quantities in units.ts's sense and carry a fixed unit instead. */
const anaBox = (
  labelId: string, v: number | null, q: Quantity | null,
  opts?: { fixedUnit?: string; digits?: number; badge?: string },
): string => boxHtml(t(labelId), v, q, settings.units, opts);

const badgeHtml = (cls: string, textId: string, titleId: string): string =>
  ` <span class="badge ${cls}" title="${t(titleId)}">${t(textId)}</span>`;

function renderAnalysis(): void {
  const track = flightTrack;
  if (track.length < 2) {
    ana.innerHTML = `<h1>${t('ana.title')}</h1><div class="link">${t('ana.noFlight')}</div>`;
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

  ana.innerHTML = `
    <h1>${t('ana.title')}</h1>
    <div class="boxes">
      ${anaBox('ana.maxAlt', b.maxAltM, 'altitude')}
      ${anaBox('ana.gain', b.gainM, 'altitude')}
      ${anaBox('ana.climbs', climbs(track).length, null, { digits: 0 })}
      ${anaBox('ana.achievedLD', eg.achievedLD, null, {
        digits: 1,
        badge: eg.windCorrected ? '' : badgeHtml('estimated', 'ana.uncorrected', 'ana.uncorrected.title'),
      })}
      ${anaBox('ana.polarLD', eg.theoreticalLD, null, {
        digits: 1, badge: badgeHtml('modelled', 'badge.modelled', 'ana.polarLD.title'),
      })}
      ${anaBox('ana.ratio', eg.ratio, null, { digits: 2 })}
    </div>
    <h2>${t('ana.scoring', { rules: free?.rules ?? fai?.rules ?? 'olc-2024' })}</h2>
    <div class="boxes">
      ${anaBox('ana.freeDistance', free?.distanceM ?? null, 'distance')}
      ${anaBox('ana.freePoints', free?.points ?? null, null, { digits: 1 })}
      ${anaBox('ana.faiDistance', fai?.distanceM ?? null, 'distance')}
      ${anaBox('ana.faiPoints', fai?.points ?? null, null, { digits: 1 })}
      ${anaBox('ana.shortestLeg', fai ? fai.minLegFraction * 100 : null, null, {
        digits: 1, fixedUnit: '%',
        badge: fai ? badgeHtml('ready', 'ana.faiOk', 'ana.faiOk.title') : '',
      })}
    </div>
    <div class="link">${t('ana.disclaimer')}</div>
    <h2>${t('ana.barograph')}</h2>
    ${barographSvg(track)}
    <div class="link">${t('ana.barographNote')}</div>
  `;
}

// ============ the Settings screen — Block 3 (CFG-002/003/005, IHM-001/002/006) ============
// The screen the pilot makes his own. settings-ui renders it as a pure string from the settings
// VALUE; this is the twenty lines that turn a tap on it back into a value.
//
// One delegated listener, on a container built once — the shelf's contract, and for the shelf's
// reason: the panel repaints WHOLE after every change (that is how a preset filling eight rows
// shows up in eight rows), so a handler bound to a <select> would die with the first choice the
// pilot made. data-act says what he did, data-id says to what, and applySettings does the rest:
// normalize, persist, re-derive the translator and the polar, repaint everything. There is no
// submit button anywhere on this screen, and there must not be: a submit is a moment where the
// screen and the settings disagree, and CFG-005's promise ("what he chooses is what he flies with
// tomorrow") has no room for such a moment.


/** ONLY the panel. The setup form and the connect form live in #settings too, and they are STATIC:
 *  their listeners were bound once, at start-up, and a repaint that replaced them would leave a
 *  screen full of dead controls — the exact bug the review found in the settings panel itself. */
function renderSettings(): void {
  panelEl.innerHTML = settingsHtml(settings, t);
}

/** Move a box within a page, or take it off. The REDUCER is core's (infobox.editPages) — pure,
 *  tested, and the keeper of the one rule that cost a page: a page never loses its last box. This
 *  shell function is what is left of the old one, which is the writing of the result down. */
function editPage(pageId: string, act: PageEdit, boxId: string): void {
  applySettings({ pages: editPages(settings.pages, pageId, act, boxId) });
}

/** One handler for every control on the panel. `change` and `click` both land here because a
 *  <select> commits on change and a <button> on click, and splitting them across two listeners
 *  would be two places to forget an act.
 *
 *  Which is why the EVENT is now part of the question. Both listeners used to reach the switch
 *  below with no notion of which had fired, and every control on the panel carries a data-act — so
 *  a plain CLICK on a <select> or an <input> was handled as a commit of its current value. Tapping
 *  the mass box to type into it committed the empty box, applySettings repainted the whole panel
 *  through innerHTML, and the input under the pilot's finger was destroyed before a digit landed:
 *  the mass was not merely awkward to enter, it could not be entered at all. Tapping the glider
 *  list to browse it re-ran the 'glider' case, which unconditionally clears `polar` and `massKg` —
 *  a click that chose nothing silently erased an imported .plr and reset a ballasted glider to its
 *  reference mass, and repainted the panel out from under the dropdown he had just opened.
 *
 *  settings-ui.commits() is the table: a <select>/<input> speaks on change, a <button> on click. It
 *  lives beside the markup that emits the acts, and a test walks the rendered panel to keep the two
 *  honest. A click is not a choice. */
function onSettingsEvent(e: Event): void {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  const act = el?.dataset.act;
  if (!el || !act) return;
  if (!commits(act, e.type)) return;
  const id = el.dataset.id ?? '';
  const page = el.dataset.page ?? '';
  const value = (el as HTMLInputElement | HTMLSelectElement).value ?? '';

  switch (act) {
    case 'auto-phase':
      // The pilot may take the phase away from the machine. Turning it off brings the page tabs back
      // on the flight screen: he said he would rather choose, so he is given something to choose with.
      applySettings({ autoPhase: (el as HTMLInputElement).checked });
      break;
    case 'lang':
      // isLang, not a cast: the <select> is ours today, but a stored or injected value that is
      // not a language we speak must not become the language we try to speak.
      if (isLang(value)) applySettings({ lang: value });
      break;
    case 'preset':
      // The preset FILLS the rows; it is not itself the setting (CFG-003). The rows are the
      // truth, and the pilot edits them afterwards — the mixed panel (feet, knots, m/s) is the
      // normal European case and no single preset can name it.
      if (id in PRESETS) applySettings({ units: { ...PRESETS[id as UnitSystem] } });
      break;
    case 'unit':
      applySettings({ units: { ...settings.units, [id as Quantity]: value as UnitSystem } });
      break;
    case 'glider': {
      // CFG-002 and CFG-007, kept mutually exclusive at the source rather than reconciled at the
      // render: picking a library glider CLEARS the imported .plr, because activePolar would
      // otherwise go on flying the import while this picker showed the pick. One glider flies,
      // and the screen names it.
      const entry = value === '' ? null : GLIDER_LIBRARY.find(g => g.id === value) ?? null;
      applySettings({
        glider: entry === null ? null : { libId: entry.id, massKg: null },
        polar: null,
      });
      plrLabel.textContent = polarName();
      break;
    }
    case 'mass': {
      if (settings.glider === null) break;         // no reference mass to adjust: nothing to set
      // The box speaks the pilot's MASS unit, and core's massKgFromField is what turns it back into
      // kilograms — through the same table that printed the placeholder he typed over. It also owns
      // the two refusals: an empty box is the entry's own reference mass and not a mass of zero
      // (POT-007: we do not invent his ballast), and a mass outside the plausible band around that
      // reference is a typo, not a ballast state. '45' for '450' used to be accepted, persisted,
      // and flown: a polar ten times too steep driving every glide on the screen.
      const entry = GLIDER_LIBRARY.find(g => g.id === settings.glider!.libId);
      const massKg = entry === undefined
        ? null
        : massKgFromField(value, entry.refMassKg, settings.units.mass);
      applySettings({ glider: { libId: settings.glider.libId, massKg } });
      break;
    }
    case 'box-add':
      if (value !== '') editPage(page, act, value);
      break;
    case 'box-up':
    case 'box-down':
    case 'box-remove':
      editPage(page, act, id);
      break;
  }
}
setEl.onchange = onSettingsEvent;
setEl.onclick = onSettingsEvent;

// ---- what came back from disk (OFF-002) ----

// The airspace and task the pilot loaded last session, fed through the SAME adopt paths the
// file inputs use — a restored file that parsed differently from a chosen one would be two
// truths about one file. The label names the file so the pilot knows what is armed without
// re-picking it, and says "(restored)" so it cannot be mistaken for a choice made today.
async function restoreFlightFiles(): Promise<void> {
  const oa = await loadFlightFile(kv, 'airspace');
  if (oa) {
    (root.querySelector('#oa-label') as HTMLElement).textContent =
      `${adoptAirspace(oa.text).label} (restored: ${oa.name})`;
  }
  const tk = await loadFlightFile(kv, 'task');
  if (tk) {
    const label = adoptTask(tk.text);
    if (label) {
      (root.querySelector('#tsk-label') as HTMLElement).textContent =
        `${label} (restored: ${tk.name})`;
    }
  }
  const cf = await loadFlightFile(kv, 'landables');
  if (cf) {
    const label = adoptCup(cf.text);
    if (label) {
      (root.querySelector('#cup-label') as HTMLElement).textContent =
        `${label} (restored: ${cf.name})`;
    }
  }
  if (oa || tk || cf) render(state, link);
}

// The settings, back into the forms they rule from (OFF-002: configuration persists). The
// inputs' built-in values are only the defaults of a first launch; `settings` itself came
// back with the shelf, before any screen rendered.
function restoreSettings(): void {
  budgetIn.value = String(settings.cacheBudgetMB);
  (root.querySelector('#set-classes') as HTMLInputElement).value =
    settings.monitoredClasses?.join(', ') ?? '';
  plrLabel.textContent = polarName();
  // The language, the units, the pages and the glider came back with the record; the chrome and
  // the panel are the two places that SHOW them, and neither has been painted yet.
  renderChrome();
  renderSettings();
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

// IHM-006 at the FIRST paint, not only at the next change. The settings came back from disk before
// any screen rendered (OFF-002), so the language the pilot chose last season is already in hand —
// and the chrome is where it lands: the four tabs, and every word of the Fly strip. Without this
// call the app booted in whatever language the markup happened to be written in, and only started
// speaking his the first time he touched a setting.
renderChrome();
