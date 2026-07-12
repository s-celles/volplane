// ============ airspace (ESP-001 … ESP-005) ============
// OpenAir in, verdicts out. Two verdicts, and ESP-003 demands they never blur: INSIDE is a
// fact about now; PREDICTED is a claim about the next couple of minutes at the current
// track and speed. The screen may colour them differently; this file keeps them apart in
// the type.
//
// ESP-005 is the sharpest rule here: when the glider's altitude is UNKNOWN, the vertical
// test does not shrug — it assumes the WORST case, which for an alert is "inside the band".
// A flight computer that stays quiet under a TMA because the baro dropped out has failed
// exactly when it was needed. (This is an alert built on measured position and a MISSING
// measurement — C3 forbids alerts on modelled fields, not on honest worst-casing.)

import { mPerLng, M_PER_LAT } from 'soaring-core/geo';

export interface Airspace {
  name: string;
  class: string;
  /** Metres AMSL. null floor = surface; null ceiling = unlimited. */
  floor: number | null;
  ceiling: number | null;
  /** The horizontal shape: a polygon (lon/lat ring) or a circle (centre + radius m). */
  polygon?: [number, number][];
  circle?: { lon: number; lat: number; radiusM: number };
}

const FT = 0.3048;

/** OpenAir altitude: "3500ft AMSL", "FL95", "SFC", "GND", "UNL", "1500m". null = the open
 *  end it names (SFC → floor null, UNL → ceiling null); undefined = unparsable, which
 *  refuses the whole volume (a TMA with a made-up floor is worse than none — ACQ-005's
 *  discipline applied to a file). */
function altOf(s: string): number | null | undefined {
  const t = s.trim().toUpperCase();
  if (t === 'SFC' || t === 'GND') return null;
  if (t === 'UNL' || t === 'UNLIM' || t === 'UNLIMITED') return null;
  const fl = /^FL\s*(\d+)$/.exec(t);
  if (fl) return Number(fl[1]) * 100 * FT;
  const m = /^(\d+(?:\.\d+)?)\s*(FT|F|M)?\b/.exec(t);
  if (!m) return undefined;
  const v = Number(m[1]);
  return m[2] === 'M' ? v : v * FT;                    // OpenAir's default unit is feet
}

/** "DD:MM:SS N" or "DD:MM.mmm N" → decimal degrees. */
function coordOf(s: string): number | undefined {
  const m = /^(\d+):(\d+)(?::(\d+(?:\.\d+)?))?\s*([NSEW])$/.exec(s.trim());
  if (!m) return undefined;
  const d = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3]) / 3600 : 0);
  return m[4] === 'S' || m[4] === 'W' ? -d : d;
}

const NM = 1852;

/** Parse an OpenAir file. Volumes that fail to parse are DROPPED and counted — the caller
 *  can tell the pilot "212 loaded, 3 refused", which is OFF-010's honesty for airspace. */
export function parseOpenAir(text: string): { spaces: Airspace[]; refused: number } {
  const spaces: Airspace[] = [];
  let refused = 0;
  let cur: Partial<Airspace> & { points?: [number, number][] } = {};
  let centre: { lon: number; lat: number } | null = null;

  const flush = (): void => {
    if (!cur.class) { cur = {}; centre = null; return; }
    const ok = (cur.points && cur.points.length >= 3) || cur.circle;
    // floor/ceiling: undefined means an alt line REFUSED to parse; absent lines mean the
    // file simply did not say, which OpenAir reads as surface-to-unlimited.
    if (ok && cur.floor !== undefined && cur.ceiling !== undefined) {
      spaces.push({
        name: cur.name ?? '(unnamed)', class: cur.class,
        floor: cur.floor ?? null, ceiling: cur.ceiling ?? null,
        polygon: cur.points && cur.points.length >= 3 ? cur.points : undefined,
        circle: cur.circle,
      });
    } else refused++;
    cur = {}; centre = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*.*$/, '').trim();
    if (!line) continue;
    const [tag, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    switch (tag.toUpperCase()) {
      case 'AC': flush(); cur.class = arg; cur.floor = null; cur.ceiling = null; break;
      case 'AN': cur.name = arg; break;
      case 'AL': cur.floor = altOf(arg); break;
      case 'AH': cur.ceiling = altOf(arg); break;
      case 'DP': {
        const m = /^(.+?[NS])\s+(.+?[EW])$/.exec(arg);
        const lat = m && coordOf(m[1]), lon = m && coordOf(m[2]);
        if (lat != null && lon != null) (cur.points ??= []).push([lon, lat]);
        else cur.floor = undefined;                     // poison the volume: refuse it whole
        break;
      }
      case 'V': {
        const m = /^X\s*=\s*(.+?[NS])\s+(.+?[EW])$/.exec(arg);
        if (m) {
          const lat = coordOf(m[1]), lon = coordOf(m[2]);
          centre = lat != null && lon != null ? { lon, lat } : null;
        }
        break;
      }
      case 'DC': {
        const r = Number(arg);
        if (centre && Number.isFinite(r)) cur.circle = { ...centre, radiusM: r * NM };
        else cur.floor = undefined;
        break;
      }
      default: break;                                   // SP/SB styling, DA arcs: not held yet
    }
  }
  flush();
  return { spaces, refused };
}

// ---- the verdicts ----

function insideHorizontal(a: Airspace, lon: number, lat: number): boolean {
  if (a.circle) {
    const dx = (lon - a.circle.lon) * mPerLng(a.circle.lat);
    const dy = (lat - a.circle.lat) * M_PER_LAT;
    return Math.hypot(dx, dy) <= a.circle.radiusM;
  }
  if (!a.polygon) return false;
  let inside = false;                                   // ray casting, the classic
  const p = a.polygon;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** ESP-005: the vertical test under an UNKNOWN altitude assumes the worst — inside. */
function insideVertical(a: Airspace, alt: number | null): boolean {
  if (alt == null) return true;
  if (a.floor != null && alt < a.floor) return false;
  if (a.ceiling != null && alt > a.ceiling) return false;
  return true;
}

export interface Incursion {
  space: Airspace;
  /** ESP-003's line: 'inside' is a fact about now; 'predicted' a claim about lookaheadS. */
  kind: 'inside' | 'predicted';
  /** True when the vertical part rests on ESP-005's worst case, so the alert can SAY it is
   *  cautious rather than measured. */
  worstCase: boolean;
}

/** How far ahead the predictive alert looks (s) — about a minute of glide, the scale at
 *  which a pilot can still turn without drama. */
export const LOOKAHEAD_S = 60;

/** The verdicts for one position against every loaded volume. `track`/`groundSpeed` feed
 *  the straight-line prediction; without them only 'inside' can be judged. */
export function incursions(
  spaces: readonly Airspace[], lon: number, lat: number, alt: number | null,
  track?: number, groundSpeed?: number, lookaheadS = LOOKAHEAD_S,
): Incursion[] {
  const out: Incursion[] = [];
  const worstCase = alt == null;
  let pLon: number | null = null, pLat: number | null = null;
  if (track != null && groundSpeed != null && groundSpeed > 0) {
    const d = groundSpeed * lookaheadS;
    const rad = track * Math.PI / 180;
    pLon = lon + d * Math.sin(rad) / mPerLng(lat);
    pLat = lat + d * Math.cos(rad) / M_PER_LAT;
  }
  for (const a of spaces) {
    if (!insideVertical(a, alt)) continue;
    if (insideHorizontal(a, lon, lat)) out.push({ space: a, kind: 'inside', worstCase });
    else if (pLon != null && pLat != null && insideHorizontal(a, pLon, pLat))
      out.push({ space: a, kind: 'predicted', worstCase });
  }
  return out;
}
