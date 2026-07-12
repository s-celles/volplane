// ============ terrain tiles over HTTP, with an optional disk under them ============
// The DEM the flight computer samples, filled from the network as the glider moves. This is
// deliberately a SHELL file: the core asks "how high is the ground here?" through a
// TileLookup and neither knows nor cares that the answer came off a CDN. Phase 1 adds the
// offline pack (OFF-003) behind the very same lookup — pass a KV and a miss tries the disk
// before the network, so a provisioned flight never needs the network at all (OFF-004). The
// core does not notice, which is the point.
//
// Tiles are decoded with UPNG (pure JS), not createImageBitmap: a canvas is allowed to
// color-manage the pixels, and on a terrarium tile the RGB channels ARE the elevation —
// ogn-3d-viewer hit exactly that (random spikes), and a corrupted byte here is a wrong AGL.
import UPNG from 'upng-js';
import { lonLatToTile, type BBox, type ElevTile, type TileLookup } from 'soaring-core/geo';
import { tilesForArea } from '../core/pack';
import type { KV } from './store';

/** AWS Open Data terrarium tiles (Mapzen heritage). Public, no key. Exported because the
 *  provisioner (provision.ts) must download the SAME tiles this store reads back. */
export const URL_TPL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** The zoom we fetch — the `zMax` the sampler walks down from. z12 ≈ 20 m/px at 47°N:
 *  far finer than a glider needs to know whether the ridge ahead is above or below it.
 *  Exported for the provisioner: a pack downloaded at any other zoom would be invisible. */
export const Z = 12;

/** A failed tile is retried, but not hammered: the link may be down for an hour (OFF-001
 *  says the app must live through that), and a retry storm would not bring it back sooner. */
const RETRY_MS = 30_000;

// TS spells Uint8Array.buffer as ArrayBufferLike; a KV never hands out a SharedArrayBuffer,
// and UPNG wants a plain ArrayBuffer of exactly the PNG's bytes — so copy and assert once.
const pngBuffer = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Decoded tiles are RGBA in memory (~256 KB each); an area request must not be allowed to
 *  turn a fat radius into gigabytes. 256 tiles ≈ 64 MB ≈ a 45 km-radius pack at z12 — beyond
 *  that the map's own readiness figure says what fraction of the ground is known, which is
 *  the honest display of a cap (POT-007), not a silent one. */
export const AREA_TILE_CAP = 256;

export interface TerrainStore {
  lookup: TileLookup;
  /** Make sure the tiles around this position are held or on their way. Fire-and-forget:
   *  the caller is a 1 Hz fix loop and must never wait on the network. */
  ensure(lon: number, lat: number): void;
  /** Make sure a whole area's tiles are held or on their way — the briefing's demand, where
   *  the lift fields sample the full pack radius and a 3×3 ring around the centre would
   *  leave the map computed over mostly-unknown ground. Same disk-first path as ensure. */
  ensureArea(area: BBox): void;
}

export function terrainStore(
  onTile: () => void,
  urlTpl: string = URL_TPL,
  now: () => number = Date.now,
  kv?: KV,
): TerrainStore {
  const tiles = new Map<string, ElevTile>();
  const inflight = new Set<string>();
  const failedAt = new Map<string, number>();

  function decodeInto(key: string, png: ArrayBuffer): void {
    const img = UPNG.decode(png);
    tiles.set(key, { rgba: new Uint8Array(UPNG.toRGBA8(img)[0]), w: img.width, h: img.height });
    failedAt.delete(key);
    onTile();
  }

  async function fetch1(z: number, x: number, y: number, key: string): Promise<void> {
    inflight.add(key);
    try {
      // Disk before network, when there is a disk: a provisioned tile must come back with
      // the radio dead (OFF-004), and even online it is the faster, cheaper answer. A store
      // that fails to read is treated like a store that holds nothing — the network below
      // is the same fallback either way.
      if (kv) {
        const stored = await kv.get(`tile/${key}`).catch(() => null);
        if (stored) {
          decodeInto(key, pngBuffer(stored));
          return;
        }
      }
      const url = urlTpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      const r = await fetch(url);
      if (!r.ok) throw new Error(`http ${r.status}`);
      const png = await r.arrayBuffer();
      decodeInto(key, png);
      // What came off the network goes onto the disk, so the NEXT flight over this ground
      // needs no network at all. The encoded PNG is stored, not the RGBA: ~50 KB against
      // 256 KB, and the decode above already guards the pixels on the way back out. A
      // write failure is not a flight problem — the tile is in memory and the screen has it.
      if (kv) void kv.put(`tile/${key}`, new Uint8Array(png)).catch(() => {});
    } catch {
      // The ground stays UNKNOWN — null, never zero — and the screen says "—". That is the
      // honest display (POT-007's principle), and it is what the retry clock is for.
      failedAt.set(key, now());
    } finally {
      inflight.delete(key);
    }
  }

  // One request path for both ensure flavours: skip what is held, in flight, or cooling down
  // after a failure; fetch (disk-first) the rest.
  function request(z: number, x: number, y: number): void {
    const key = `${z}/${x}/${y}`;
    if (tiles.has(key) || inflight.has(key)) return;
    const failed = failedAt.get(key);
    if (failed != null && now() - failed < RETRY_MS) return;
    void fetch1(z, x, y, key);
  }

  return {
    lookup: (z, x, y) => tiles.get(`${z}/${x}/${y}`) ?? null,

    ensureArea(area: BBox): void {
      for (const t of tilesForArea(area, Z).slice(0, AREA_TILE_CAP)) request(t.z, t.x, t.y);
    },

    ensure(lon: number, lat: number): void {
      const { xf, yf } = lonLatToTile(lon, lat, Z);
      const cx = Math.floor(xf), cy = Math.floor(yf), max = 2 ** Z - 1;
      // The 3×3 neighbourhood: the tile under the glider and the ring around it, so the
      // ground is already held when the glider crosses a tile edge — an AGL that blinks to
      // UNKNOWN at every tile boundary would teach the pilot to ignore UNKNOWN.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && x <= max && y >= 0 && y <= max) request(Z, x, y);
        }
      }
    },
  };
}
