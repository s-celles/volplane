// ============ provisioning: fill the pack while there IS a network ============
// core/pack.ts is the promise — an area, a day, a tile list. This file keeps it: while the
// pilot is still connected it pulls every tile the pack owes plus one Open-Meteo snapshot
// into the KV (OFF-003, WX-001), and it measures afterwards what actually landed so the
// pre-flight screen can say so (OFF-010, via core/pack.completeness). The flight-side read
// (loadWeather) lives here too, and it NEVER touches the network — a dead radio in flight is
// the normal case this whole module exists for (OFF-001, OFF-004).
//
// Failures during download are counted, not thrown. A pack with a hole is a pack with a
// hole: completeness will SAY which tiles are missing before takeoff, and the pilot decides.
// An exception at tile 312 of 400 that throws away tiles 1..311 would be strictly worse.

import { tileKey, tilesForArea, type Held, type PackSpec } from '../core/pack';
import { OPEN_METEO_HOURLY } from '../core/briefing';
import { getJson, putJson, type KV } from './store';
import { parseOpenMeteo, type Wx } from 'soaring-core/weather';
import { URL_TPL, Z } from './terrain';

/** Four tiles in the air at once. This is a briefing download the evening before, not a
 *  stress test: enough parallelism to hide latency, little enough to stay a polite guest on
 *  a free public tile bucket. */
const CONCURRENCY = 4;

const wxKey = (spec: PackSpec) => `wx/${spec.id}`;
const wxMetaKey = (spec: PackSpec) => `wxmeta/${spec.id}`;

/** What one wxmeta record holds: enough for OFF-005's validity display and for
 *  core/pack.completeness to judge day-match and age. */
export interface WxMeta { fetchedAt: number; day: string }

/** Download everything `spec` owes into `kv`: the terrain tiles at the zoom the flight
 *  store reads (Z), then one Open-Meteo snapshot for the area's centre and the flight day.
 *
 *  Resumable by construction: tiles already in the KV are skipped, so a download cut at
 *  tile 200 restarts as a download of the remaining 200 — OFF-003's "par avance" survives a
 *  flaky evening connection. Progress counts pack items (tiles + the one snapshot), and a
 *  skipped tile IS progress: it is held, which is all the bar is claiming.
 *
 *  Returns counts, never throws for a bad item: `ok` items are held when this resolves,
 *  `failed` items are not — and completeness, not this function, is where failures become
 *  words on a screen (OFF-010). */
export async function downloadPack(
  spec: PackSpec,
  kv: KV,
  fetchFn: typeof fetch,
  onProgress: (done: number, total: number) => void,
  now: () => number,
): Promise<{ ok: number; failed: number }> {
  const need = tilesForArea(spec.area, Z);
  const total = need.length + 1;   // + the weather snapshot: one more item the pack owes
  let ok = 0, failed = 0, done = 0;

  // One keys() sweep instead of a get() per tile: the skip test must be cheap, or resuming
  // a 400-tile pack would spend longer asking the store than fetching the remainder.
  const stored = new Set(await kv.keys('tile/'));
  const pending = need.filter(t => {
    if (stored.has(`tile/${tileKey(t)}`)) { ok++; done++; return false; }
    return true;
  });
  onProgress(done, total);

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < pending.length) {
      const t = pending[next++];
      try {
        const url = URL_TPL
          .replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
        const r = await fetchFn(url);
        if (!r.ok) throw new Error(`http ${r.status}`);
        await kv.put(`tile/${tileKey(t)}`, new Uint8Array(await r.arrayBuffer()));
        ok++;
      } catch {
        failed++;
      }
      onProgress(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

  // The weather snapshot: the area's centre stands for the area — one sounding column is
  // what a briefing wants (WX-001), and the variable list is core/briefing's contract, so
  // the fetch and soaring-core's parser cannot drift apart. Stored as the RAW payload:
  // parsing belongs to the reader, and raw bytes cannot rot when the parser improves.
  // Always refetched, even when a snapshot is already held — a forecast ages (OFF-011),
  // a tile does not.
  try {
    const lat = (spec.area.south + spec.area.north) / 2;
    const lon = (spec.area.west + spec.area.east) / 2;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&hourly=${OPEN_METEO_HOURLY.join(',')}&start_date=${spec.day}&end_date=${spec.day}`;
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`http ${r.status}`);
    await kv.put(wxKey(spec), new Uint8Array(await r.arrayBuffer()));
    // fetchedAt/day beside the payload, not inside it: OFF-005's validity question must be
    // answerable without parsing a forecast, and the payload stays exactly what the API sent.
    await putJson(kv, wxMetaKey(spec), { fetchedAt: now(), day: spec.day } satisfies WxMeta);
    ok++;
  } catch {
    // Weather is enrichment (OFF-008): its absence is a warning on the completeness screen,
    // never a reason this download "failed" as a whole.
    failed++;
  }
  onProgress(++done, total);

  return { ok, failed };
}

/** What the KV actually holds of `spec` — the `Held` that core/pack.completeness measures
 *  against the promise. The tile set is the intersection of what is stored with what is
 *  owed: a tile from some other pack is not coverage of THIS one. */
export async function heldFor(spec: PackSpec, kv: KV): Promise<Held> {
  const stored = new Set(await kv.keys('tile/'));
  const tiles = new Set(
    tilesForArea(spec.area, Z).map(tileKey).filter(k => stored.has(`tile/${k}`)),
  );
  const weather = await getJson<WxMeta>(kv, wxMetaKey(spec));
  return { tiles, weather };
}

/** The flight-side read of the snapshot: KV → parseOpenMeteo → Wx. NO network in here,
 *  ever — this is the path OFF-004 guarantees, and it must work identically with the radio
 *  dead. null when no snapshot is held or the payload parses to nothing: the briefing
 *  renders "—" (WX-004), it does not invent an atmosphere. */
export async function loadWeather(spec: PackSpec, kv: KV, fallbackElev: number): Promise<Wx | null> {
  const payload = await getJson<unknown>(kv, wxKey(spec));
  if (payload === null) return null;
  return parseOpenMeteo(payload, fallbackElev);
}
