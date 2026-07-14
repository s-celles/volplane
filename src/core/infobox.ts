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
