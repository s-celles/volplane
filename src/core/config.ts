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
}

export const DEFAULT_SETTINGS: Settings = {
  cacheBudgetMB: 200,
  polar: null,
  monitoredClasses: null,
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

/** Rebuild settings from untrusted JSON — garbage in, defaults out, never a throw (the
 *  contract normalizeShelf keeps, for the same reason: a corrupted record costs the pilot
 *  his preferences, never his startup). Field by field: a mangled polar costs the polar
 *  alone, never the budget or the classes. Always a fresh object: handing out
 *  DEFAULT_SETTINGS itself would let one caller's edit rewrite everyone's default. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    cacheBudgetMB: repairBudget(r.cacheBudgetMB),
    polar: repairPolar(r.polar),
    monitoredClasses: repairClasses(r.monitoredClasses),
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

/** The one spelling of "which polar flies", so main.ts and any future screen cannot hold two
 *  opinions. Never null: the normalizer vetted the stored text, and if a raced edit slips
 *  through anyway the default flies — a glide computer with no polar is not a state this app
 *  has. */
export function activePolar(s: Settings): Polar {
  if (s.polar === null) return DEFAULT_POLAR;
  return parsePlr(s.polar.plr, s.polar.name) ?? DEFAULT_POLAR;
}
