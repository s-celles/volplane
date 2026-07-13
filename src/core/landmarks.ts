// ============ the visual reference (the world, minimally) ============
// Coastlines, borders, lakes, named peaks. Not a database of places to GO — a frame for the eye,
// so a pilot knows where on the planet he is. `soaring-data` ships it because it is the only
// waypoint-shaped thing that may honestly be shipped: a summit does not move, a coastline does
// not close, and a border does not change its radio frequency. An aerodrome does all three, which
// is why none is here.
//
// Read from the Frictionless package's own resources — a CSV and three GeoJSONs — so nothing in
// this app is the only thing that can read them.
//
// The honesty rule survives the trip: a peak whose elevation the source did not give arrives with
// `elevM: null`, never 0. A summit at sea level is a lie a chart would happily draw.

export interface Peak {
  name: string;
  /** Natural Earth's own feature class: 'mountain', 'range/mtn', 'depression'… kept verbatim. */
  kind: string;
  /** Metres, or NULL when the source gave none. Never zero. */
  elevM: number | null;
  lon: number;
  lat: number;
}

/** A GeoJSON line or polygon, reduced to what a map painter needs. */
export interface Shape {
  /** Rings of [lon, lat]. A LineString has one; a Polygon has its outer ring first. */
  rings: [number, number][][];
  /** Lakes carry a name; coastlines and borders do not. */
  name: string | null;
}

const cells = (line: string): string[] => {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};

const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/** Read `peaks.csv` (name,kind,elev_m,lon,lat). A row without a position is not a landmark and is
 *  dropped — a dot nobody can point at is not a reference. */
export function parsePeaks(csv: string): Peak[] {
  const out: Peak[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {          // row 0 is the header the package declares
    if (!lines[i].trim()) continue;
    const f = cells(lines[i]);
    const lon = num(f[3]), lat = num(f[4]);
    const name = (f[0] ?? '').replace(/^"|"$/g, '').trim();
    if (!name || lon == null || lat == null) continue;
    out.push({
      name,
      kind: (f[1] ?? '').replace(/^"|"$/g, ''),
      elevM: num(f[2]),                              // empty stays NULL — never a sea-level summit
      lon, lat,
    });
  }
  return out;
}

interface GeoFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: { name?: unknown };
}

/** Read one of the package's GeoJSON resources into paintable rings. LineString, MultiLineString,
 *  Polygon and MultiPolygon are the four Natural Earth actually uses; anything else is skipped
 *  rather than guessed at. */
export function parseShapes(geojson: unknown): Shape[] {
  const fc = geojson as { features?: GeoFeature[] } | null;
  if (!fc?.features) return [];
  const out: Shape[] = [];
  for (const f of fc.features) {
    const t = f.geometry?.type;
    const c = f.geometry?.coordinates;
    const name = typeof f.properties?.name === 'string' ? f.properties.name : null;
    let rings: [number, number][][] = [];
    if (t === 'LineString') rings = [c as [number, number][]];
    else if (t === 'MultiLineString' || t === 'Polygon') rings = c as [number, number][][];
    else if (t === 'MultiPolygon') rings = (c as [number, number][][][]).flat();
    else continue;
    rings = rings.filter(r => Array.isArray(r) && r.length > 1);
    if (rings.length) out.push({ rings, name });
  }
  return out;
}

export interface BBox { west: number; south: number; east: number; north: number }

/** Only what is on screen. The world's shapes are cheap to hold and expensive to draw, and a
 *  1 Hz map that walks every coastline on earth is a map that stutters. */
export function shapesIn(shapes: readonly Shape[], b: BBox): Shape[] {
  return shapes.filter(s => s.rings.some(r => r.some(
    ([lon, lat]) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north)));
}

export const peaksIn = (peaks: readonly Peak[], b: BBox): Peak[] =>
  peaks.filter(p => p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north);
