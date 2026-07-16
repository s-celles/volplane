// ============ settings: what the pilot configured, as a value (OFF-002) ============
// OFF-002 lists configuration among what MUST survive a restart. This module is the shape of
// that promise: a plain value the shell serializes verbatim, and a normalizer that rebuilds
// it from untrusted disk bytes — the same division of labour as shelf.ts's normalizeShelf
// (core owns the shape and the repair; the shell owns the bytes). It started with one field,
// the cache ceiling (OFF-006), which used to live in a DOM input alone and silently reset to
// its built-in default at every launch — a setting that forgets is a setting the pilot cannot
// trust with a small disk. The polar (PLA-010) and the monitored airspace classes (ESP-004)
// joined it for the same reason. New settings land HERE first, so the persisted shape and the
// defaults can never be two files' opinions.

import { parsePlr, DEFAULT_POLAR, type Polar } from 'soaring-core/polar';
import { LANGS, isLang, type Lang } from './i18n';
import { DEFAULT_UNITS, QUANTITIES, toSI, type UnitPrefs, type UnitSystem } from './units';
import { defaultLayout, sanitizeLayout, PHASES, type Layout } from './layout';
import type { Phase } from './phase';
import { gliderById, polarOf } from './polarlib';

/** Everything the pilot can configure that must come back at the next launch. */
export interface Settings {
  /** The tile-cache ceiling, in MB (OFF-006). Always positive: a zero or negative ceiling
   *  read off a typo would evict everything the pilot provisioned, so the normalizer refuses
   *  such a value in favour of the default rather than obeying it. */
  cacheBudgetMB: number;
  /** The pilot's polar (PLA-010): the RAW `.plr` text plus the name it arrived under, null
   *  meaning the built-in default flies. Raw text rather than parse results, for the same
   *  reason packstore keeps flight files raw: parsing belongs to the reader, and raw bytes
   *  cannot rot when the parser improves. */
  polar: { name: string; plr: string } | null;
  /** Which airspace classes alert (ESP-004), stored trimmed and UPPERCASE — one spelling, so
   *  the airspace module's case-insensitive compare and the stored value can never disagree.
   *  Null means ALL classes are monitored: the unknown filter filters nothing (POT-007's null
   *  discipline applied to configuration). Never an empty list — that would silently mute
   *  every alert, which is a choice the pilot must make explicitly, not inherit from a
   *  corrupted record. */
  monitoredClasses: string[] | null;
  /** The language the interface speaks (IHM-006). A value, not a detection: the shell may READ the
   *  OS locale, but what the pilot chose outranks it and lands here. */
  lang: Lang;
  /** One unit system PER QUANTITY (CFG-003). Stored whole rather than as a preset name, because
   *  the mixed panel — feet, knots, m/s — is the normal case and no preset can name it. */
  units: UnitPrefs;
  /** WHAT STANDS IN THE BOXES, in each of the three flight phases (IHM-001, IHM-002).
   *
   *  This replaces `pages`, and the replacement was a DISCOVERY rather than a design: the three
   *  default pages were called `cruise`, `climb` and `finalGlide`, and the three flight phases are
   *  circling, cruise and final glide. They were the same three things. The pilot was driving one of
   *  them by hand — tapping a tab, in a thermal — while the app silently knew the other.
   *
   *  Ids only, never the box DEFINITIONS: a persisted definition is a definition that cannot be
   *  improved by a release. */
  layout: Layout;
  /** Which phase row he is looking at when `autoPhase` is off and he picks for himself. */
  manualPhase: Phase;
  /** Let the SIX BOXES follow the flight — climb, cruise, final glide — instead of making the pilot
   *  tap a tab in a thermal.
   *
   *  Their POSITIONS never move: only what stands in them. On by default, because a pilot who has to
   *  reconfigure his screen mid-turn is a pilot who will not, and will read the wrong numbers.
   *
   *  And OFFABLE, because the dissent is a good argument and it comes from people who fly: a field
   *  that changes its IDENTITY in silence, under your eyes, is worse than a deliberate swipe — you
   *  read the number before you read the label, and the number now means something else. The phase is
   *  written on the screen for exactly this reason, and a pilot who still dislikes it can have his
   *  choice of phase row back — the same three rows, picked by hand. */
  autoPhase: boolean;
  /** The library glider he picked (CFG-002), with the mass he flies it at — that massKg IS the
   *  "adjustable" of "polaires prédéfinies et ajustables". Null massKg means the entry's own
   *  reference mass: we do not invent his ballast (POT-007). Null altogether means he picked no
   *  library glider — either he imported his own .plr, or the built-in default flies. */
  glider: { libId: string; massKg: number | null } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  cacheBudgetMB: 200,
  polar: null,
  monitoredClasses: null,
  lang: 'en',
  units: DEFAULT_UNITS,
  layout: defaultLayout(),
  manualPhase: 'cruise',
  autoPhase: true,
  glider: null,
};

// Each field repairs itself, so the whole-record normalizer below stays a plain roll call
// and a mangled field can never take a healthy neighbour down with it.

function repairBudget(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? v
    : DEFAULT_SETTINGS.cacheBudgetMB;
}

// A stored polar is only worth keeping if the reader can actually fly it: the text must
// survive parsePlr today, or activePolar would fall back to the default at every launch
// while the settings screen keeps promising the pilot his own glider. A .plr the parser
// refuses is normalized to null rather than persisted as a promise the reader cannot keep.
function repairPolar(v: unknown): Settings['polar'] {
  if (typeof v !== 'object' || v === null) return null;
  const { name, plr } = v as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '' || typeof plr !== 'string') return null;
  return parsePlr(plr, name) !== null ? { name, plr } : null;
}

// The safe failure direction for an alert filter is "alert on everything", never "alert on
// nothing": a corrupted record must not mute classes the pilot never chose to mute. So any
// non-string entry condemns the whole list to null (all monitored) rather than letting a
// half-readable record narrow the watch, and a list that cleans down to empty becomes null
// for the same reason.
function repairClasses(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.some((c) => typeof c !== 'string')) return null;
  const cleaned = [...new Set((v as string[]).map((c) => c.trim().toUpperCase()))].filter(
    (c) => c !== '',
  );
  return cleaned.length > 0 ? cleaned : null;
}

function repairLang(v: unknown): Lang {
  return typeof v === 'string' && isLang(v) ? v : 'en';
}

// Row by row, exactly as the settings screen edits it: a mangled SPEED unit costs the speed unit
// and nothing else. Falling back to DEFAULT_UNITS wholesale would let one bad string quietly move
// the pilot's altitude from feet back to metres — a display he never touched, changed by a field
// he never touched, which is how a pilot stops trusting his settings screen.
const SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial', 'aviation'];

function repairUnits(v: unknown): UnitPrefs {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const out = {} as UnitPrefs;
  for (const q of QUANTITIES) {
    const sys = r[q];
    out[q] = typeof sys === 'string' && (SYSTEMS as readonly string[]).includes(sys)
      ? (sys as UnitSystem)
      : DEFAULT_UNITS[q];
  }
  return out;
}


// A library id that no longer exists is not a glider, and pretending otherwise would fly the
// pilot's final glide on somebody else's polar. It normalizes to null, and the default flies —
// visibly, under its own name, which he can see.
//
// And the mass is repaired against the ENTRY, not merely against zero. A stored 45 kg for an
// ASK 21 is arithmetically fine and aeronautically impossible, and the polar it produces — ten
// times too steep, clamped at 19 m/s — would fly the pilot's final glide. Out of the plausible
// band it normalizes to null, which means the polar as published: a glider we can defend, under a
// mass the panel names.
function repairGlider(v: unknown): Settings['glider'] {
  if (typeof v !== 'object' || v === null) return null;
  const { libId, massKg } = v as Record<string, unknown>;
  const entry = typeof libId === 'string' ? gliderById(libId) : null;
  if (typeof libId !== 'string' || entry === null) return null;
  const { minKg, maxKg } = massBandKg(entry.refMassKg);
  const mass = typeof massKg === 'number' && Number.isFinite(massKg)
    && massKg >= minKg && massKg <= maxKg
    ? massKg
    : null;
  return { libId, massKg: mass };
}

/** Rebuild settings from untrusted JSON — garbage in, defaults out, never a throw (the
 *  contract normalizeShelf keeps, for the same reason: a corrupted record costs the pilot
 *  his preferences, never his startup). Field by field: a mangled polar costs the polar
 *  alone, never the budget or the classes. Always a fresh object: handing out
 *  DEFAULT_SETTINGS itself would let one caller's edit rewrite everyone's default. */
// CFG-001: the glider's characteristics the pilot may enter — his polar (an imported .plr, or a library pick)
// and the all-up mass he flies it at — are held HERE and rebuilt from untrusted disk bytes, so they survive a restart.
export function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  return {
    cacheBudgetMB: repairBudget(r.cacheBudgetMB),
    polar: repairPolar(r.polar),
    monitoredClasses: repairClasses(r.monitoredClasses),
    lang: repairLang(r.lang),
    units: repairUnits(r.units),
    layout: sanitizeLayout(r.layout),
    manualPhase: PHASES.includes(r.manualPhase as Phase) ? r.manualPhase as Phase : 'cruise',
    // A stored value that is not a boolean is not a preference — it is corruption, and the honest
    // repair is the default, not `false`. A pilot upgrading into this release has never seen the
    // setting and should get the behaviour it exists to give him.
    autoPhase: typeof r.autoPhase === 'boolean' ? r.autoPhase : DEFAULT_SETTINGS.autoPhase,
    glider: repairGlider(r.glider),
  };
}

/** A number the pilot typed into a field, or the default when he typed nothing usable.
 *
 *  It is here, in core, and it is tested, because the obvious one-liner is WRONG in exactly the
 *  case that matters. `Number.isFinite(Number(v)) ? v : fallback` looks like it guards the field,
 *  and it does guard the garbage — but `Number('') === 0`, and 0 is perfectly finite. So an
 *  EMPTY box, which is what every field passes through the instant the pilot selects it and hits
 *  backspace to retype, yields not the default but ZERO. That zero then goes wherever the field
 *  goes: a terrain horizon of 0 s disabled the alarm outright, silently, for the rest of the
 *  flight; a reserve of 0 m took the clearance out of the final glide; a QNH of 0 hPa is not an
 *  altimeter setting at all. The guard missed the very case it existed for.
 *
 *  `min` is for the fields where the smallest meaningful value is not zero — a horizon, a QNH.
 *  Below it we take the default, because a threshold the pilot cannot have meant is a threshold
 *  he did not set. */
export function fieldNumber(raw: string, fallback: number, min?: number): number {
  const t = raw.trim();
  if (t === '') return fallback;
  const v = Number(t);
  if (!Number.isFinite(v)) return fallback;
  return min != null && v < min ? fallback : v;
}

// ---- CFG-002's "ajustables": the mass, and the two ways it used to go wrong ----

/** The band an all-up mass may plausibly lie in, as a fraction of the polar's reference mass.
 *
 *  The low end is a light pilot in a two-seater flown solo; the high end is the same glider with
 *  its water tanks full (a Discus 2 is published at 350 kg and takes 200 litres — 1.57×). Outside
 *  that band the number is not a ballast state, it is a typo, and the polar it would produce is
 *  not the pilot's glider. */
export const MASS_BAND = { lo: 0.7, hi: 1.6 } as const;

export function massBandKg(refMassKg: number): { minKg: number; maxKg: number } {
  return { minKg: refMassKg * MASS_BAND.lo, maxKg: refMassKg * MASS_BAND.hi };
}

/** The mass the pilot typed, in the unit HE reads, as kilograms — or null, meaning "the polar as
 *  published" (POT-007: we do not invent his ballast).
 *
 *  Two separate holes are closed here, and both of them ended in the same place — a polar nobody
 *  flew driving the speed-to-fly, the arrival height and the reachability of every field on the
 *  divert list.
 *
 *  The UNIT. The settings screen offers a mass row that can say lb, and the mass box beside it was
 *  read as kilograms whatever that row said. A pilot on the imperial preset typing his 1058 lb
 *  all-up mass had it stored as 1058 KG: k = √(1058/361) = 1.71, every speed and every sink on his
 *  polar scaled by that, and nothing on the screen naming the unit he was supposed to have used.
 *  The value therefore arrives here WITH the system it was typed in, and goes through units.toSI —
 *  the same table that printed the placeholder he was typing over.
 *
 *  The BAND. fieldNumber's floor was 1 kg and it had no ceiling, so '45' for '450' — one dropped
 *  zero — was accepted, persisted, and scaled the ASK 21's polar by √0.1: a curve ten times too
 *  steep with a maximum usable airspeed of 19 m/s, silently clamping every sink the computer priced
 *  for the rest of the flight. A mass outside the plausible band is REFUSED, not clamped: clamping
 *  would invent a ballast state he never typed, and the refusal is visible — the box repaints empty
 *  over its placeholder, which is the reference mass, and the panel prints the band it accepts. */
export function massKgFromField(raw: string, refMassKg: number, sys: UnitSystem): number | null {
  const s = raw.trim();
  if (s === '') return null;                    // an empty box is the reference mass, not zero
  const typed = Number(s);
  if (!Number.isFinite(typed)) return null;
  const kg = toSI(typed, 'mass', sys);
  const { minKg, maxKg } = massBandKg(refMassKg);
  return kg >= minKg && kg <= maxKg ? kg : null;
}

/** The one spelling of "which polar flies", so main.ts and any future screen cannot hold two
 *  opinions. Never null: the normalizer vetted the stored text, and if a raced edit slips
 *  through anyway the default flies — a glide computer with no polar is not a state this app
 *  has.
 *
 *  The priority is explicit, and it is an argument, not an accident:
 *
 *   1. an IMPORTED `.plr` (settings.polar) — the pilot handed us the file for HIS glider, tail
 *      number and all, and that outranks any library approximation of the type;
 *   2. else a chosen LIBRARY glider (CFG-002), at the mass he flies it at today;
 *   3. else the built-in default.
 *
 *  The shell keeps 1 and 2 mutually exclusive — picking a library glider clears the imported
 *  polar, importing a .plr clears the library pick — but the ORDER is defined here anyway, so
 *  that a raced write which somehow leaves both set still has one, knowable answer instead of
 *  two screens each showing a different glide. */
export function activePolar(s: Settings): Polar {
  if (s.polar !== null) {
    const imported = parsePlr(s.polar.plr, s.polar.name);
    if (imported !== null) return imported;
  }
  if (s.glider !== null) {
    const entry = gliderById(s.glider.libId);
    if (entry !== null) return polarOf(entry, s.glider.massKg);
  }
  return DEFAULT_POLAR;
}
