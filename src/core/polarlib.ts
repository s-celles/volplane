// ============ CFG-002: the glider library ============
// The pilot should not have to hunt for a `.plr` file before his first flight. He picks his glider
// from a list, types the mass he flies at today, and the computer knows how he sinks.
//
// This file used to BE the list — thirteen gliders typed out by hand. It is now a READER, and that
// is the whole change (C4bis). The list itself lives in `soaring-data`, as a Frictionless tabular
// package of 155 wings with their provenance recorded, and it belongs there for one reason: a polar
// is a fact about gliding, not a fact about this application. The next flight computer written on
// this kernel deserves the same table, not a copy of it — and the day two copies disagree about the
// LS 4, BOTH are worthless, because nothing tells the pilot which one his final glide came from.
//
// Two disciplines hold the reader honest:
//
//  · C4 — every entry is reconstructed into `.plr` TEXT and goes through soaring-core's parsePlr,
//    the very same door the pilot's own imported file comes through (CFG-007). A library glider and
//    an imported one are then the same kind of object, fitted by the same least squares, and cannot
//    behave differently. The alternative — trusting the CSV's numbers straight into a Polar — would
//    give us two ways of turning three points into a curve, and two ways is one too many.
//
//  · A row that cannot make a polar is DROPPED, not patched. `unusableRows` counts them and the
//    test below pins it at zero for the shipped package, so the day the data grows a broken row the
//    build says so instead of shipping a glider that sinks like nothing on earth.
import { parsePlr, atMass, type Polar } from 'soaring-core/polar';
import polarsCsv from 'soaring-data/datasets/polars/polars.csv' with { type: 'text' };

/** One glider in the library: the `.plr` text it is made of, plus the two figures the pilot needs
 *  to adjust it — the mass that polar was published at, and the wing area.
 *
 *  `wingAreaM2` is `number | null` and not `number`, for twelve of the 155 wings. A wing area we do
 *  not have is not 0 m², and a wing loading computed from 0 m² is an infinity displayed to a pilot
 *  (POT-007). Twelve dashes are the correct output. */
export interface GliderPolar {
  id: string;
  name: string;
  /** The group this glider is offered under — its FAI class where the data establishes one, and its
   *  wing class otherwise. NOT a class we inferred: soaring-data leaves `fai_class` empty for 109
   *  of these wings on purpose, because a 15 m span is Standard class without flaps and 15-Metre
   *  with them, and the polar files record the flaps of ten wings out of 155. So those gliders are
   *  offered under `glider`, which is true, rather than under a class nobody established. */
  cls: string;
  plr: string;
  refMassKg: number;
  wingAreaM2: number | null;
}

/** The order the groups are offered in. A group the data grows and this list does not name still
 *  appears — at the end — rather than vanishing from the picker: a glider the pilot cannot reach is
 *  worse than one in an unexpected place. */
const GROUP_ORDER = ['13.5m', '18m', 'open', 'glider', 'paraglider', 'hang_glider'];

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
  if (s === undefined || s.trim() === '') return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

/** A stable id from the glider's own name. Lowercase, and everything that is not a letter or a
 *  digit becomes a hyphen — the id is what gets written into the pilot's settings and read back
 *  next season, so it must not move when the display name gains an accent. */
export function slug(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** How many rows of the last parsed package could not make a polar. Zero for the shipped data, and
 *  the test says so; a non-zero here is the data telling us something broke. */
export let unusableRows = 0;

/** Build the library from a `soaring-data` polars package (the CSV text).
 *
 *  Columns are read from the file's OWN HEADER, never by position. That is not defensiveness — it
 *  is a bug we have already had once, in the `.cup` parser, where a format revision inserted a
 *  column and the runway WIDTH started being displayed as the radio frequency. A file with columns
 *  is a file that will one day have a new one. */
export function parseGliderLibrary(csv: string): GliderPolar[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = cells(lines[0]);
  const at = (r: string[], name: string): string | undefined => {
    const i = head.indexOf(name);
    return i < 0 ? undefined : r[i];
  };

  const out: GliderPolar[] = [];
  const seen = new Set<string>();
  unusableRows = 0;

  for (const line of lines.slice(1)) {
    const r = cells(line);
    const name = (at(r, 'name') ?? '').replace(/^"|"$/g, '').trim();
    const mass = num(at(r, 'mass_dry_gross_kg'));
    const water = num(at(r, 'max_water_ballast_l')) ?? 0;
    const pts = [1, 2, 3].map(i => [num(at(r, `speed${i}_kmh`)), num(at(r, `sink${i}_ms`))]);

    // A glider with no name, no reference mass, or fewer than three points on its curve is not a
    // glider we can fly. It is dropped and counted — never given a default mass, and never fitted
    // through two points as though the third had been measured.
    if (name === '' || mass === null || mass <= 0 || pts.some(([v, w]) => v === null || w === null)) {
      unusableRows++;
      continue;
    }

    // C4: rebuilt into the pilot's own file format, and parsed by the pilot's own parser.
    const plr =
      `* ${name} — three-point polar, from the soaring-data polars package.\n`
      + `* MassDryGross[kg], MaxWaterBallast[l], V1[km/h], w1[m/s], V2, w2, V3, w3, WingArea[m2]\n`
      + `${mass}, ${water}, ${pts.map(([v, w]) => `${v}, ${w}`).join(', ')}, ${num(at(r, 'wing_area_m2')) ?? 0}\n`;

    if (parsePlr(plr, name) === null) { unusableRows++; continue; }

    // Two wings under one id would make the pilot's saved setting ambiguous — he would come back
    // next season to a glider that is not the one he picked. The second one is suffixed rather than
    // dropped: it is a real glider, and it is entitled to a place in the list.
    let id = slug(name);
    if (seen.has(id)) { let n = 2; while (seen.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    seen.add(id);

    const fai = (at(r, 'fai_class') ?? '').trim();
    const wing = (at(r, 'wing_class') ?? '').trim();
    out.push({
      id,
      name,
      cls: fai !== '' ? fai : (wing !== '' ? wing : 'glider'),
      plr,
      refMassKg: mass,
      wingAreaM2: num(at(r, 'wing_area_m2')),
    });
  }

  return out;
}

/** The groups, in GROUP_ORDER, each holding its gliders in the package's own order. A group the
 *  order does not name goes last rather than disappearing. */
export function groupLibrary(lib: readonly GliderPolar[]): { cls: string; entries: GliderPolar[] }[] {
  const groups: { cls: string; entries: GliderPolar[] }[] = [];
  for (const g of lib) {
    const found = groups.find(x => x.cls === g.cls);
    if (found === undefined) groups.push({ cls: g.cls, entries: [g] });
    else found.entries.push(g);
  }
  const rank = (c: string): number => {
    const i = GROUP_ORDER.indexOf(c);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  return groups.sort((a, b) => rank(a.cls) - rank(b.cls));
}

/** The shipped library: the soaring-data polars package, read once at load.
 *
 *  This is a build-time constant in the same sense the hand-typed table it replaces was — the text
 *  is baked in by the bundler, there is no file read at runtime, and the app still starts with no
 *  network and no filesystem (POT: it flies in a glider). What changed is only WHERE the numbers
 *  come from, and that is the entire point of the change. */
export const GLIDER_LIBRARY: readonly GliderPolar[] = parseGliderLibrary(polarsCsv);

/** The glider with this id, or null if there is none. Never a silent fallback to some other glider:
 *  a picker that quietly flies an ASK 21 when the pilot chose a Ventus is worse than one that
 *  refuses, because it is wrong in the one place he is not looking. */
export function gliderById(id: string): GliderPolar | null {
  return GLIDER_LIBRARY.find(g => g.id === id) ?? null;
}

/** The polar to fly this library glider with, at an all-up mass — or at its reference mass when the
 *  pilot has not told us one (POT-007: we do not invent his ballast).
 *
 *  parsePlr cannot fail here: parseGliderLibrary already refused every row it would have refused,
 *  which is why the entry exists at all. The `null` branch is unreachable and is written as a throw
 *  rather than as a fallback polar, because a fallback would put SOME glider's sink rate in front of
 *  the pilot without telling him it was not his. */
export function polarOf(entry: GliderPolar, massKg: number | null): Polar {
  const base = parsePlr(entry.plr, entry.name);
  if (base === null) throw new Error(`library entry ${entry.id} holds unparsable .plr text`);
  if (massKg === null || !Number.isFinite(massKg) || massKg <= 0) return base;
  return atMass(base, entry.refMassKg, massKg);
}
