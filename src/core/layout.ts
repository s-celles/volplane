// ============ the layout: a file the pilot owns ============
//
// ---- and it started as a discovery, not a design ----
//
// The three default PAGES of this app were called `cruise`, `climb` and `finalGlide`. The three
// flight PHASES are circling, cruise and final glide. They were the same three things, and the pilot
// was made to drive one of them by hand — tapping a tab, in a thermal — while the app silently knew
// the other. There was never a `pages` concept. There was a phase concept, being operated manually.
//
// So a LAYOUT is exactly this: what stands in the boxes, in each of the three phases. Nothing more.
// `autoPhase` decides who picks the row — the machine, or the pilot. The rows themselves are the
// same rows either way.
//
// ---- who may edit it, and WHERE — AND NOTHING IS LOCKED IN FLIGHT ----
//
// The first draft of this comment said composing a layout is a ground task and "a pilot doing that in
// the air is not flying". THAT IS WRONG, AND IT IS WRONG IN A WAY THAT WOULD HAVE BUILT A LOCK.
//
// GLIDERS HAVE TWO SEATS. In a two-seater the person editing is NOT the person flying: the back seat
// has two free hands, an instructor reconfigures the front pilot's screen mid-flight as a matter of
// course, and a solo pilot in a stable cruise is perfectly able to move a box. Workload is a reason
// to DESIGN THE EDITOR WELL. It is not a reason to take it away, and an app that decides for the
// pilot when he is allowed to touch his own instrument has substituted its judgement for his.
//
// So: nothing here is gated on being airborne. The editor is reachable at every moment of the flight,
// and it is built to be usable with one hand — which is what it should have been built like anyway.
//
// What the FILE buys, on top of the editor, is everything an editor cannot: a layout you can read,
// diff, keep in version control, hand to a club-mate, or edit in whatever you already use. ONE
// FORMAT, TWO DOORS. It is the same bargain this project already made with the .cup and the .plr —
// the file is the truth, and the app consumes it.
//
// ---- and a parser that refuses must SAY WHY ----
//
// The other loader in this codebase (sanitizePages) SILENTLY DROPS what it does not recognise, and
// for a file the app itself wrote that is the right call. It is the wrong call for a file a HUMAN
// typed. A pilot who mistyped `arival` and got a screen with five boxes and no explanation will
// conclude the feature is broken — and he will be right, because a program that discards your work
// without telling you IS broken.
//
// parseLayout NAMES every refusal. It still refuses.

import { BOX_BY_ID, type BoxId } from './infobox';
import type { Phase } from './phase';

/** The version of the format, in the file, first. A file that does not say what it is is a file that
 *  will one day be read by a program that has changed its mind about what it is. */
export const FORMAT = 'volplane/layout/1';

/** How many boxes a phase row holds.
 *
 *  Eight is the number the mature computers recommend a pilot START at, and their users say the
 *  appetite only ever shrinks: "the longer I use the program, the less information I want to see".
 *  Four is the floor because a screen with three numbers on it is not an instrument, it is a clock. */
export const MIN_SLOTS = 4;
export const MAX_SLOTS = 8;

export const PHASES: readonly Phase[] = ['circling', 'cruise', 'finalGlide'];

export interface Layout {
  /** The pilot's own name for it. Shown when he chooses; never interpreted. */
  name: string;
  /** What stands in the boxes, in each phase. Always the same COUNT in every phase — a row that
   *  changed length between climb and cruise would move every box below it, and the whole point of
   *  the frame is that a number does not move. */
  phases: Record<Phase, BoxId[]>;
}

/** The layout a fresh install flies with — and the one the app falls back to when a file will not
 *  parse, because a flight computer that boots to a blank screen because of a typo is not a flight
 *  computer.
 *
 *  Chosen from what the pilot ACTUALLY reads:
 *   · CIRCLING — the thermal's worth: the 30 s average, the last complete circle, the thermal's own.
 *   · CRUISE — netto is the AIR, stripped of the glider, and it is the only number that says whether
 *     what you flew through was lift. Speed to fly is what to do about it.
 *   · FINAL GLIDE — the arrival height is NOT here: it is the hero of the top strip, a bar with a
 *     sign and a colour, because a pilot on a marginal glide should not have to READ. What is here is
 *     what he CHANGES: MacCready, and the speed it asks for.
 *
 *  The wind is in all three. It is the one thing true of the whole flight. */
export const DEFAULT_LAYOUT: Layout = {
  name: 'default',
  phases: {
    circling: ['avg30', 'lastCircle', 'lastThermal', 'alt', 'agl', 'windSpeed'],
    cruise: ['netto', 'stf', 'groundSpeed', 'alt', 'agl', 'windSpeed'],
    finalGlide: ['ldReq', 'ldAch', 'mc', 'stf', 'alt', 'agl'],
  },
};

const clone = (l: Layout): Layout => ({
  name: l.name,
  phases: {
    circling: [...l.phases.circling],
    cruise: [...l.phases.cruise],
    finalGlide: [...l.phases.finalGlide],
  },
});

export const defaultLayout = (): Layout => clone(DEFAULT_LAYOUT);

// ---- reading one a human typed ----

/** What a refusal is: a catalogue id and the values to fill it with. Never an English sentence — the
 *  pilot who mistypes his layout is the same pilot who set the app to French. */
export interface LayoutProblem { id: string; params?: Record<string, string | number> }

export type ParseResult =
  | { layout: Layout; problems: LayoutProblem[] }
  | { layout: null; problems: LayoutProblem[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read a layout file. Every refusal is NAMED.
 *
 *  It returns `layout: null` only when nothing usable survives. A file with one bad box id in one
 *  phase is a file with a typo in it, not a file to throw away — so the box is refused, the refusal
 *  is reported, and the rest of the pilot's work stands. He fixes one line, not the file. */
export function parseLayout(text: string): ParseResult {
  const problems: LayoutProblem[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { layout: null, problems: [{ id: 'layout.notJson' }] };
  }
  if (!isRecord(raw)) return { layout: null, problems: [{ id: 'layout.notJson' }] };

  // The format tag. A file that does not claim to be one of ours is not one of ours, and guessing
  // would be how a .cup or somebody's tsconfig ends up half-loaded as a screen.
  if (raw.volplane !== FORMAT) {
    return { layout: null, problems: [{ id: 'layout.wrongFormat', params: { want: FORMAT, got: String(raw.volplane ?? '') } }] };
  }

  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : 'layout';
  const phasesRaw = raw.phases;
  if (!isRecord(phasesRaw)) return { layout: null, problems: [{ id: 'layout.noPhases' }] };

  const phases = {} as Record<Phase, BoxId[]>;
  for (const phase of PHASES) {
    const row = phasesRaw[phase];
    if (!Array.isArray(row)) {
      problems.push({ id: 'layout.phaseMissing', params: { phase } });
      phases[phase] = [...DEFAULT_LAYOUT.phases[phase]];
      continue;
    }
    const ids: BoxId[] = [];
    for (const v of row) {
      // AN UNKNOWN BOX IS NAMED, NOT SWALLOWED. `arival` is a typo, and a pilot who gets a screen
      // with five boxes and no explanation will conclude the feature is broken. He would be right.
      if (typeof v !== 'string' || !BOX_BY_ID.has(v as BoxId)) {
        problems.push({ id: 'layout.unknownBox', params: { phase, box: String(v) } });
        continue;
      }
      if (ids.includes(v as BoxId)) {
        problems.push({ id: 'layout.duplicateBox', params: { phase, box: v } });
        continue;
      }
      ids.push(v as BoxId);
    }
    if (ids.length < MIN_SLOTS) {
      problems.push({ id: 'layout.tooFew', params: { phase, have: ids.length, min: MIN_SLOTS } });
      phases[phase] = [...DEFAULT_LAYOUT.phases[phase]];
      continue;
    }
    if (ids.length > MAX_SLOTS) {
      problems.push({ id: 'layout.tooMany', params: { phase, have: ids.length, max: MAX_SLOTS } });
      ids.length = MAX_SLOTS;
    }
    phases[phase] = ids;
  }

  // EVERY PHASE THE SAME LENGTH, and this is not tidiness. A row that grew between climb and cruise
  // would move every box below it, and the whole point of the frame is that a number does not move.
  const lens = new Set(PHASES.map(p => phases[p].length));
  if (lens.size > 1) {
    const n = Math.min(...lens);
    problems.push({ id: 'layout.ragged', params: { lengths: [...lens].sort().join(', '), used: n } });
    for (const p of PHASES) phases[p].length = n;
  }

  return { layout: { name, phases }, problems };
}

/** Write one out, for the pilot to keep, diff, share, or open in whatever he already uses. */
// CFG-006: this is the app's ONLY export door — the layout leaves as a JSON file the pilot can keep,
// diff and load back; the rest of the config, and the points, airspaces and tasks, are import-only.
export function serializeLayout(l: Layout): string {
  return JSON.stringify({ volplane: FORMAT, name: l.name, phases: l.phases }, null, 2) + '\n';
}

// ---- editing one, in the app ----

export type LayoutEdit = 'add' | 'remove' | 'up' | 'down';

/** One edit to one phase's row. Pure, fresh objects, and it holds the two rules the file format also
 *  holds: a row never falls below MIN_SLOTS, and it never grows past MAX_SLOTS.
 *
 *  A row that could be emptied is a row a pilot can empty, and he will do it on the ground, on a
 *  Tuesday, and find out in a thermal. */
export function editLayout(l: Layout, phase: Phase, act: LayoutEdit, boxId: BoxId): Layout {
  const out = clone(l);
  const row = out.phases[phase];
  const i = row.indexOf(boxId);

  switch (act) {
    case 'add':
      if (row.length >= MAX_SLOTS || i >= 0) return l;
      row.push(boxId);
      break;
    case 'remove':
      if (i < 0 || row.length <= MIN_SLOTS) return l;
      row.splice(i, 1);
      break;
    case 'up':
      if (i <= 0) return l;
      [row[i - 1], row[i]] = [row[i], row[i - 1]];
      break;
    case 'down':
      if (i < 0 || i >= row.length - 1) return l;
      [row[i], row[i + 1]] = [row[i + 1], row[i]];
      break;
  }
  return out;
}

/** Repair whatever came off disk. The app's OWN store may be stale (a release renamed a box) and
 *  there the silent repair is right — this is not a human's file, it is our own cache of one. */
export function sanitizeLayout(v: unknown): Layout {
  if (!isRecord(v) || !isRecord(v.phases)) return defaultLayout();
  const phases = {} as Record<Phase, BoxId[]>;
  for (const p of PHASES) {
    const row = Array.isArray(v.phases[p]) ? (v.phases[p] as unknown[]) : [];
    const ids = row.filter((x): x is BoxId => typeof x === 'string' && BOX_BY_ID.has(x as BoxId));
    const uniq = [...new Set(ids)];
    phases[p] = uniq.length >= MIN_SLOTS
      ? uniq.slice(0, MAX_SLOTS)
      : [...DEFAULT_LAYOUT.phases[p]];
  }
  const n = Math.min(...PHASES.map(p => phases[p].length));
  for (const p of PHASES) phases[p].length = n;
  return { name: typeof v.name === 'string' && v.name.trim() !== '' ? v.name.trim() : 'layout', phases };
}
