// ============ the InfoBox registry (IHM-001, IHM-002) ============
// "Le système DOIT permettre de configurer les InfoBoxes" — which is impossible for as long as a
// box is CODE. Before this module the dashboard was seventeen hard-coded calls, each fusing a
// label, a unit and a getter into one line the pilot could never reach: to move a box you edited
// a source file, and to add one you edited two. A box the pilot can configure has to be a VALUE
// first — an id, a label id, a quantity, and a getter — and that is all this file is.
//
// The registry is the ONLY place a box is defined. The renderers read BOXES; the settings screen
// reads BOXES; the persisted pages store nothing but ids. So a new box appears everywhere at
// once, or nowhere — never on the dashboard but not in the picker.
//
// Three disciplines hold it together:
//
//  · A getter is a PROJECTION, never a computation. `s => s.aglM`, one line, no arithmetic. The
//    instant a getter starts subtracting altitudes it has become a second flight computer, one
//    that nobody tests and that disagrees with the first at the worst possible moment. Everything
//    is computed once, upstream, by the modules that own the maths, and arrives here already made.
//
//  · Everything in BoxSource is SI (units.ts's canonical table), and the conversion happens at the
//    last centimetre, in the renderer, through units.format. A registry that stored feet would be
//    a registry the pilot's unit choice could not reach.
//
//  · A null is UNKNOWN and it stays null all the way to the pixel, where it renders as a dash
//    (POT-007). No box substitutes a zero for a missing fix — "0 m/s" is a claim about the air,
//    and we have no right to make it when nobody measured anything.
import type { MsgId } from './i18n';
import type { Quantity } from './units';

/** Everything a box may read, filled ONCE per render by the shell from what it already computes
 *  (NavState, derive(), the rolling vario, the circling tracker, the wind estimator, speed-to-fly,
 *  the arrival calculation). One flat record of SI numbers, so the registry needs to import
 *  nothing from the shell — the dependency points inwards, always.
 *
 *  Every field is `number | null` because every one of them can genuinely be unknown: no fix yet,
 *  no terrain tile under us, not enough circles for a wind, no TE probe. That null is data. */
export interface BoxSource {
  latDeg: number | null;
  lonDeg: number | null;
  altM: number | null;
  qnhAltM: number | null;
  groundElevM: number | null;
  aglM: number | null;
  varioMs: number | null;
  avg30Ms: number | null;
  lastThermalMs: number | null;
  lastCircleMs: number | null;
  nettoMs: number | null;
  superNettoMs: number | null;
  tasMs: number | null;
  groundSpeedMs: number | null;
  stfMs: number | null;
  windDirDeg: number | null;
  windSpeedMs: number | null;
  instWindDirDeg: number | null;
  instWindSpeedMs: number | null;
  arrivalM: number | null;
  mcMs: number | null;
}

export type BoxId =
  | 'lat' | 'lon' | 'alt' | 'altQnh' | 'ground' | 'agl'
  | 'vario' | 'avg30' | 'lastThermal' | 'lastCircle' | 'netto' | 'superNetto'
  | 'tas' | 'groundSpeed' | 'stf'
  | 'windDir' | 'windSpeed' | 'instWindDir' | 'instWindSpeed'
  | 'arrival' | 'mc';

/** One box, as a value.
 *
 *  `quantity: null` is for the four boxes that are NOT a quantity in the units sense: a latitude,
 *  a longitude and a wind DIRECTION are degrees on every panel on earth, and offering the pilot a
 *  choice of units for them would be offering him a choice he does not have. Those carry a
 *  fixedUnit instead. Everything else names its Quantity and lets units.format do the arithmetic —
 *  one spelling of a unit per box, never two.
 *
 *  `badgeId` is the honesty marker: a value we INFERRED must not wear the same face as a value an
 *  instrument MEASURED (VEN-001, C3). */
export interface BoxDef {
  id: BoxId;
  labelId: MsgId;
  quantity: Quantity | null;
  fixedUnit?: string;
  digits?: number;
  badgeId?: MsgId | null;
  badgeTitleId?: MsgId | null;
  get(s: BoxSource): number | null;
}

/** The table. Read it as a list of promises to the pilot: this label, this unit, this number —
 *  and nothing else happens on the way. */
export const BOXES: readonly BoxDef[] = [
  { id: 'lat', labelId: 'box.lat', quantity: null, fixedUnit: '°', digits: 5, get: s => s.latDeg },
  { id: 'lon', labelId: 'box.lon', quantity: null, fixedUnit: '°', digits: 5, get: s => s.lonDeg },

  { id: 'alt', labelId: 'box.alt', quantity: 'altitude', get: s => s.altM },
  { id: 'altQnh', labelId: 'box.altQnh', quantity: 'altitude', get: s => s.qnhAltM },
  { id: 'ground', labelId: 'box.ground', quantity: 'altitude', get: s => s.groundElevM },
  { id: 'agl', labelId: 'box.agl', quantity: 'altitude', get: s => s.aglM },

  { id: 'vario', labelId: 'box.vario', quantity: 'vario', get: s => s.varioMs },
  { id: 'avg30', labelId: 'box.avg30', quantity: 'vario', get: s => s.avg30Ms },
  { id: 'lastThermal', labelId: 'box.lastThermal', quantity: 'vario', get: s => s.lastThermalMs },
  { id: 'lastCircle', labelId: 'box.lastCircle', quantity: 'vario', get: s => s.lastCircleMs },
  { id: 'netto', labelId: 'box.netto', quantity: 'vario', get: s => s.nettoMs },
  { id: 'superNetto', labelId: 'box.superNetto', quantity: 'vario', get: s => s.superNettoMs },

  { id: 'tas', labelId: 'box.tas', quantity: 'speed', get: s => s.tasMs },
  { id: 'groundSpeed', labelId: 'box.groundSpeed', quantity: 'speed', get: s => s.groundSpeedMs },
  { id: 'stf', labelId: 'box.stf', quantity: 'speed', get: s => s.stfMs },

  // The wind we ESTIMATE from circle drift is our inference, not the instrument's measurement, and
  // the two must never wear the same label (VEN-001). The badge is what tells them apart, and it
  // rides with the box definition so no renderer can forget it.
  {
    id: 'windDir', labelId: 'box.windDir', quantity: null, fixedUnit: '°', digits: 0,
    badgeId: 'badge.estimated', badgeTitleId: 'badge.estimated.title', get: s => s.windDirDeg,
  },
  {
    id: 'windSpeed', labelId: 'box.windSpeed', quantity: 'speed',
    badgeId: 'badge.estimated', badgeTitleId: 'badge.estimated.title', get: s => s.windSpeedMs,
  },
  {
    id: 'instWindDir', labelId: 'box.instWindDir', quantity: null, fixedUnit: '°', digits: 0,
    get: s => s.instWindDirDeg,
  },
  { id: 'instWindSpeed', labelId: 'box.instWindSpeed', quantity: 'speed', get: s => s.instWindSpeedMs },

  { id: 'arrival', labelId: 'box.arrival', quantity: 'altitude', get: s => s.arrivalM },
  { id: 'mc', labelId: 'box.mc', quantity: 'vario', get: s => s.mcMs },
];

export const BOX_BY_ID: ReadonlyMap<BoxId, BoxDef> = new Map(BOXES.map(b => [b.id, b]));

/** A page is a named set of boxes the pilot flips to (IHM-002). Nothing more: the layout is the
 *  renderer's business, the ORDER of the ids is the pilot's. */
export interface Page {
  id: string;
  titleId: MsgId;
  boxIds: BoxId[];
}

/** Three pages, because a fresh install must be useful on the FIRST flight — a configurable
 *  dashboard that starts empty is a configuration screen, not a flight computer. They follow the
 *  phases of a soaring flight: what you read between thermals, what you read inside one, and what
 *  you read on the way home. */
export const DEFAULT_PAGES: readonly Page[] = [
  {
    id: 'cruise',
    titleId: 'page.cruise',
    boxIds: ['alt', 'agl', 'vario', 'avg30', 'netto', 'groundSpeed', 'stf', 'windDir', 'windSpeed'],
  },
  {
    id: 'climb',
    titleId: 'page.climb',
    boxIds: ['vario', 'avg30', 'lastThermal', 'lastCircle', 'alt', 'agl', 'windDir', 'windSpeed'],
  },
  {
    id: 'finalGlide',
    titleId: 'page.finalGlide',
    boxIds: ['arrival', 'agl', 'alt', 'groundSpeed', 'stf', 'mc', 'windDir', 'windSpeed'],
  },
];

const isBoxId = (v: unknown): v is BoxId => typeof v === 'string' && BOX_BY_ID.has(v as BoxId);

const freshDefaults = (): Page[] =>
  DEFAULT_PAGES.map(p => ({ id: p.id, titleId: p.titleId, boxIds: [...p.boxIds] }));

/** What the settings panel can do to a page's boxes. Named as a type so the shell's delegated
 *  listener and this reducer cannot hold two spellings of the same four acts. */
export type PageEdit = 'box-add' | 'box-remove' | 'box-up' | 'box-down';

/** The pilot's edit, as a reducer over the pages — pure, fresh objects, never a mutation of the
 *  value normalizeSettings blessed.
 *
 *  It lives in core, and it is tested here, because of the one rule it enforces: A PAGE NEVER LOSES
 *  ITS LAST BOX. The shell used to splice the id out and hand the result to normalizeSettings, and
 *  normalizeSettings is the DISK reader — sanitizePages drops an empty page, correctly, because a
 *  titled rectangle with no numbers in it is corruption when it comes off disk. But a page the
 *  pilot has just emptied on his way to rebuilding it is not corruption, and the two were
 *  indistinguishable by the time they met: the ninth 'remove' tap on a nine-box page DELETED the
 *  page, wrote the deletion to disk, and left no control anywhere on the settings screen to make
 *  another one. A configuration destroyed as the side effect of an act that never mentioned it.
 *
 *  So the refusal is stated HERE, before the normalizer ever sees the value, and the disk reader
 *  stays as strict as it should be. The last box stays put; the pilot who wants a different box
 *  adds it first and then removes this one, which is the same page in two taps rather than no page
 *  in one. Unknown page id, unknown box id, a tap racing a repaint: the pages come back unchanged,
 *  because a reducer that cannot find what it was asked about has nothing to do. */
export function editPages(
  pages: readonly Page[], pageId: string, act: PageEdit, boxId: string,
): Page[] {
  return pages.map(p => {
    if (p.id !== pageId) return { ...p, boxIds: [...p.boxIds] };
    const ids = [...p.boxIds];
    const i = ids.indexOf(boxId as BoxId);
    if (act === 'box-add') {
      // sanitizePages drops duplicates anyway; refusing here keeps the picker honest about it.
      if (i >= 0 || !isBoxId(boxId)) return { ...p, boxIds: ids };
      ids.push(boxId);
    } else if (i < 0) {
      return { ...p, boxIds: ids };              // a tap racing a repaint: nothing left to move
    } else if (act === 'box-remove') {
      if (ids.length === 1) return { ...p, boxIds: ids };   // the last box is not removable
      ids.splice(i, 1);
    } else if (act === 'box-up' && i > 0) {
      [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
    } else if (act === 'box-down' && i < ids.length - 1) {
      [ids[i], ids[i + 1]] = [ids[i + 1]!, ids[i]!];
    }
    return { ...p, boxIds: ids };
  });
}

/** Rebuild the pages from untrusted disk bytes — the same contract normalizeShelf and
 *  normalizeSettings keep: garbage in, defaults out, never a throw.
 *
 *  Field by field, and id by id. A box id the app no longer ships is DROPPED, not kept as a hole:
 *  an id that rotted between two releases must cost its box, never the page. A page that empties
 *  out is dropped for the same reason — a titled rectangle with no numbers in it is worse than no
 *  page, and off DISK an empty page is corruption (editPages above is what keeps the pilot's own
 *  edits from ever producing one). And if nothing at all survives, the pilot boots on the DEFAULT
 *  pages: a screen with no numbers on it, because one string went stale on disk, is not a failure
 *  mode a flight computer is allowed to have.
 *
 *  Always fresh objects — never DEFAULT_PAGES itself, or the first caller to reorder a page
 *  rewrites everyone's default for the rest of the process. */
export function sanitizePages(raw: unknown): Page[] {
  if (!Array.isArray(raw)) return freshDefaults();
  const pages: Page[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, titleId, boxIds } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id.trim() === '') continue;
    if (typeof titleId !== 'string' || titleId.trim() === '') continue;
    if (!Array.isArray(boxIds)) continue;
    // A duplicate id is not a second box, it is the same box twice: it would read the same number
    // in two rectangles and steal the room from a box that has something else to say.
    const kept = [...new Set(boxIds.filter(isBoxId))];
    if (kept.length === 0) continue;
    pages.push({ id, titleId: titleId as MsgId, boxIds: kept });
  }
  return pages.length > 0 ? pages : freshDefaults();
}
