// ============ Phase 0's screen ============
// Six numbers and a link state. That is all Phase 0 claims, and claiming less is the point:
// the value of this screen is that every number on it can be checked against Condor.
//
// One rule, and it is IHM's and POT-007's rule both: a value we do not know is shown as
// UNKNOWN, never as zero. A flight computer that shows "0 m AGL" over an unloaded mountain is
// worse than one that shows nothing, because the pilot believes it.
import { navigate, EMPTY, type NavState } from '../core/nav';
import { lines, withHealth, type LinkState } from '../core/device';
import { tcpDevice } from './tauri-source';
import { elevAtFromTiles, type ElevTile } from 'soaring-core/geo';

// A DEM that has nothing in it yet. It answers NULL — which is the honest answer, and the one
// the whole chain is built to carry (Phase 1 fills it from an offline pack, OFF-002/004).
const tiles = new Map<string, ElevTile>();
const elev = (lon: number, lat: number) =>
  elevAtFromTiles(lon, lat, (z, x, y) => tiles.get(`${z}/${x}/${y}`) ?? null, 12, 8);

const app = document.getElementById('app')!;
const fmt = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? null : v.toFixed(digits);

function box(k: string, v: string | null, u = ''): string {
  return `<div class="box${v == null ? ' unknown' : ''}">
    <div class="k">${k}</div>
    <div class="v">${v ?? '—'}<span class="u">${v == null ? '' : u}</span></div>
  </div>`;
}

function render(s: NavState, link: LinkState): void {
  app.innerHTML = `
    <h1>VOLPLANE — phase 0</h1>
    <div class="boxes">
      ${box('Latitude', fmt(s.fix?.lat, 5), '°')}
      ${box('Longitude', fmt(s.fix?.lon, 5), '°')}
      ${box('Altitude', fmt(s.fix?.alt), 'm')}
      ${box('Ground', fmt(s.groundElev), 'm')}
      ${box('Height AGL', fmt(s.agl), 'm')}
      ${box('Vario', fmt(s.vario, 1), 'm/s')}
      ${box('Ground speed', fmt(s.groundSpeed && s.groundSpeed * 3.6), 'km/h')}
      ${box('Wind (instrument)', s.reportedWind ? `${s.reportedWind.direction.toFixed(0)}°` : null,
            s.reportedWind ? `/ ${(s.reportedWind.speed * 3.6).toFixed(0)} km/h` : '')}
    </div>
    <div class="link ${link.state}">Link: ${link.state}${
      link.state === 'closed' && link.error ? ` — ${link.error}` : ''
    }</div>
    <form id="connect">
      <input id="host" value="127.0.0.1" size="12" />
      <input id="port" value="4353" size="5" />
      <button type="submit">Connect (Condor / TCP)</button>
    </form>
    <div class="link">Condor: Setup → Options → NMEA output → TCP, port 4353.</div>
  `;
  (app.querySelector('#connect') as HTMLFormElement).onsubmit = e => {
    e.preventDefault();
    const host = (app.querySelector('#host') as HTMLInputElement).value;
    const port = Number((app.querySelector('#port') as HTMLInputElement).value);
    void run(host, port);
  };
}

let state: NavState = EMPTY;
let link: LinkState = { state: 'idle' };

async function run(host: string, port: number): Promise<void> {
  const dev = tcpDevice(host, port);
  const watched = withHealth(dev.open(), s => { link = s; render(state, link); });
  // The whole flight computer, in one expression: a stream of sentences, a terrain sampler,
  // a driver. It does not know that Tauri, or a TCP socket, or Condor exist.
  for await (const s of navigate(lines(watched), elev, 'condor2')) {
    state = s;
    render(state, link);
  }
}

render(state, link);
