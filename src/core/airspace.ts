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

import { mPerLng, M_PER_LAT, bearingDeg, distM } from 'soaring-core/geo';

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

/** The separator between a latitude and the longitude that follows it is OPTIONAL, and that is
 *  not laxity — it is a real national file. France writes `DP 45:39:57 N00:47:20 W`, gluing the
 *  hemisphere letter to the longitude, and a parser demanding a space there refuses the volume
 *  whole. The one it refused was WHISKEY 1 VV, a RESTRICTED area: an airspace the pilot would
 *  simply not have seen. A stricter regex is not a safer one.
 *
 *  "DD:MM:SS N" or "DD:MM.mmm N" → decimal degrees. */
function coordOf(s: string): number | undefined {
  const m = /^(\d+):(\d+)(?::(\d+(?:\.\d+)?))?\s*([NSEW])$/.exec(s.trim());
  if (!m) return undefined;
  const d = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3]) / 3600 : 0);
  return m[4] === 'S' || m[4] === 'W' ? -d : d;
}

const NM = 1852;

/** Tessellate an arc about a centre into polygon vertices, both endpoints included, on the
 *  same local flat earth `insideHorizontal` walks — so the ray casting and the arc agree on
 *  where the boundary is. OpenAir angles are degrees true FROM the centre; the sweep is
 *  normalised so a clockwise arc always advances and a counter-clockwise one always
 *  retreats (an end "behind" the start means the arc wraps through north). 5° steps keep
 *  the chord error under ~0.4% of the radius — invisible at CTR scale, cheap to test. */
function arcPoints(
  c: { lon: number; lat: number }, radiusM: number,
  startDeg: number, endDeg: number, dir: '+' | '-',
): [number, number][] {
  let end = endDeg;
  if (dir === '+' && end <= startDeg) end += 360;
  if (dir === '-' && end >= startDeg) end -= 360;
  const n = Math.max(1, Math.ceil(Math.abs(end - startDeg) / 5));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const th = (startDeg + (end - startDeg) * i / n) * Math.PI / 180;
    pts.push([
      c.lon + radiusM * Math.sin(th) / mPerLng(c.lat),
      c.lat + radiusM * Math.cos(th) / M_PER_LAT,
    ]);
  }
  return pts;
}

/** Parse an OpenAir file. Volumes that fail to parse are DROPPED and counted — the caller
 *  can tell the pilot "212 loaded, 3 refused", which is OFF-010's honesty for airspace. */
export function parseOpenAir(text: string): { spaces: Airspace[]; refused: number } {
  const spaces: Airspace[] = [];
  let refused = 0;
  let cur: Partial<Airspace> & { points?: [number, number][] } = {};
  let centre: { lon: number; lat: number } | null = null;
  // Arc direction is per-block state exactly like `centre`: a `V D=-` speaks for the volume
  // it sits in, never for the next one — a stale direction would silently mirror every arc
  // that follows, so each AC starts clockwise again (OpenAir's default).
  let dir: '+' | '-' = '+';

  const flush = (): void => {
    if (!cur.class) { cur = {}; centre = null; dir = '+'; return; }
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
    cur = {}; centre = null; dir = '+';
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
        const m = /^(.+?[NS])\s*(.+?[EW])$/.exec(arg);
        const lat = m && coordOf(m[1]), lon = m && coordOf(m[2]);
        if (lat != null && lon != null) (cur.points ??= []).push([lon, lat]);
        else cur.floor = undefined;                     // poison the volume: refuse it whole
        break;
      }
      case 'V': {
        // One assignment per V line, and X= / D= may arrive in either order within a block.
        const x = /^X\s*=\s*(.+?[NS])\s*(.+?[EW])$/.exec(arg);
        if (x) {
          const lat = coordOf(x[1]), lon = coordOf(x[2]);
          centre = lat != null && lon != null ? { lon, lat } : null;
        }
        const d = /^D\s*=\s*([+-])$/.exec(arg);
        if (d) dir = d[1] as '+' | '-';
        break;
      }
      case 'DC': {
        const r = Number(arg);
        if (centre && Number.isFinite(r)) cur.circle = { ...centre, radiusM: r * NM };
        else cur.floor = undefined;
        break;
      }
      case 'DA': {
        const parts = arg.split(',').map((s) => Number(s.trim()));
        if (centre && parts.length === 3 && parts.every(Number.isFinite)) {
          const [r, a1, a2] = parts;
          (cur.points ??= []).push(...arcPoints(centre, r * NM, a1, a2, dir));
        } else cur.floor = undefined;                   // no centre / bad numbers: refuse whole
        break;
      }
      case 'DB': {
        const halves = arg.split(',');
        const ends = halves.map((h) => {
          const m = /^(.+?[NS])\s*(.+?[EW])$/.exec(h.trim());
          const lat = m && coordOf(m[1]), lon = m && coordOf(m[2]);
          return lat != null && lon != null ? { lon, lat } : null;
        });
        const [p1, p2] = ends;
        if (centre && halves.length === 2 && p1 && p2) {
          const arc = arcPoints(centre,
            distM(centre.lon, centre.lat, p1.lon, p1.lat),
            bearingDeg(centre.lon, centre.lat, p1.lon, p1.lat),
            bearingDeg(centre.lon, centre.lat, p2.lon, p2.lat), dir);
          // The interior is drawn at the FIRST point's radius, but the arc must END on the
          // file's own second coordinate — the next DP continues from there, and a
          // re-projected endpoint would leave a sliver gap in the ring.
          arc[arc.length - 1] = [p2.lon, p2.lat];
          (cur.points ??= []).push(...arc);
        } else cur.floor = undefined;                   // no centre / bad coords: refuse whole
        break;
      }
      default: break;                                   // SP/SB styling: presentation, not shape
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

// ---- ESP-004: filter and acknowledge ----
// `incursions()` above stays pure and total: it judges every loaded volume, always. What
// the pilot chose not to hear is a VIEW over those verdicts, never a change to them — a
// filtered-out incursion still exists, it is just not shouted. That separation is what
// keeps the verdict logic testable and the silencing auditable.

/** A pilot's acknowledgement of one volume, keyed by `ackKey`, expiring at `untilSod`. */
export interface Ack { key: string; untilSod: number }

/** How long an acknowledgement holds (s). Five minutes: a temporary silence while the
 *  pilot deals with the airspace deliberately, NOT a permanent mute — the volume alerts
 *  again when the time is up, because "I know" ages badly in a moving glider. */
export const ACK_S = 300;

/** One spelling for "this volume": class + name, so an ack survives the same space being
 *  re-parsed into a fresh object. */
export const ackKey = (a: Airspace): string =>
  `${a.class.trim().toUpperCase()}/${a.name.trim().toUpperCase()}`;

/** Acknowledge a volume until `sod + durationS`. Pure: returns a new list, and an existing
 *  ack for the same key is REPLACED, not stacked — re-acknowledging extends the silence. */
export function acknowledge(
  acks: readonly Ack[], space: Airspace, sod: number, durationS = ACK_S,
): Ack[] {
  const key = ackKey(space);
  return [...acks.filter((a) => a.key !== key), { key, untilSod: sod + durationS }];
}

/** The one gate between `incursions()` and the screen: drop unmonitored classes, drop
 *  acked volumes still inside their silence. `classes === null` means the filter is
 *  UNKNOWN, and an unknown filter filters NOTHING — silence must be chosen, never
 *  defaulted into (the null-is-unknown discipline pointed at safety). An ack silences
 *  both verdicts alike: a pilot who acknowledged being inside does not want the same
 *  volume re-announced as predicted a breath later. */
export function activeIncursions(
  incs: readonly Incursion[], classes: readonly string[] | null,
  acks: readonly Ack[], sod: number,
): Incursion[] {
  return incs.filter((inc) => {
    if (classes !== null) {
      const c = inc.space.class.trim().toUpperCase();
      if (!classes.some((w) => w.trim().toUpperCase() === c)) return false;
    }
    const key = ackKey(inc.space);
    return !acks.some((a) => a.key === key && sod < a.untilSod);
  });
}
