// ============ profiles: several gliders, several sites, one device (CFG-004) ============
//
// A pilot does not have A configuration. He has several, and he switches between them on the
// ground, in the five minutes before he is rigged: the club Discus on Saturday, his own LS4 on
// Sunday, the two-seater with an instructor in the back. The polar changes, the mass changes, the
// units the instructor reads change, the boxes he wants on the screen change. Today (config.ts)
// there is exactly ONE Settings record, so those five minutes are spent re-typing a mass, a
// glider and a language — every time — and the pilot who is in a hurry does not re-type them. He
// flies Saturday's polar on Sunday's glider and finds out on final glide.
//
// A profile is therefore nothing more than a NAMED Settings, and this module is nothing more than
// the collection of them plus a pointer to the one that flies. Everything clever stays in
// config.ts: a profile does not know what a polar is, and this file must never learn.
//
// ---- THE INVARIANT THIS FILE EXISTS TO HOLD ----
//
// There is ALWAYS at least one profile, and the active id ALWAYS names one that exists.
//
// A pilot who taps `delete` twice and ends up with no settings has lost his glider — not a
// preference, his glider: the polar, the mass, the monitored airspace classes, the layout. The
// app would boot to built-in defaults with no way to tell him what happened. So the last profile
// cannot be deleted (a named refusal, not a silent no-op), and deleting the ACTIVE one moves the
// pointer to a neighbour that exists, deterministically, before the record ever reaches disk.
//
// The same invariant is re-imposed on the way IN, by normalizeProfiles: an `activeId` naming a
// profile that is not in the list is not "no active profile", it is a corrupted record, and it is
// repaired to the first profile rather than left to make activeSettings() return nothing.
//
// ---- refusals are SAID, never swallowed ----
//
// The two doors of layout.ts, again, and for the same reason. What the app itself wrote it
// REPAIRS in silence (normalizeProfiles — our own cache, not a human's file). What the PILOT
// asks for and cannot have it REFUSES BY NAME (create/rename/select/delete return a catalogue id
// he can be shown in his own language). An edit that quietly returns the set unchanged is how a
// pilot taps `rename`, sees nothing move, and concludes the app is broken. He would be right.
//
// So a refused edit returns `set: null` — never the old set dressed up as a success. Null is the
// project's word for "I do not have an answer for you", and a refusal is exactly that.

import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './config';

/** One named set of settings. */
export interface Profile {
  /** Identity, and NEVER shown. It is separate from the name because a rename must not orphan
   *  anything that points here — the active pointer above all. A profile keyed by its name is a
   *  profile that changes identity when the pilot fixes a typo in it. */
  id: string;
  /** The pilot's own name for it: `LS4 F-CGXY`, `club Discus`, `Saint-Auban`. Never interpreted. */
  name: string;
  settings: Settings;
}

/** The profiles, and which one flies. Both fields are load-bearing and neither is optional:
 *  a list with no active pointer, or a pointer into an empty list, are the two states this file
 *  exists to make unrepresentable-after-normalization. */
export interface ProfileSet {
  /** Never empty. In the pilot's own order: creation order, so the list he sees does not
   *  reshuffle itself between two glances at it. */
  profiles: Profile[];
  /** Always the id of one of `profiles`. */
  activeId: string;
}

/** A refusal, as a catalogue id and its parameters — never an English sentence. The pilot who
 *  names his profile twice is the same pilot who set the app to French (the shape layout.ts's
 *  LayoutProblem already uses; the shell renders both through the same message table). */
export interface ProfileProblem { id: string; params?: Record<string, string | number> }

/** The result of an edit the pilot asked for: the new set, or a refusal that can be shown to him.
 *  Never both, and never a silently-unchanged set. */
export type ProfileEdit =
  | { set: ProfileSet; problem: null }
  | { set: null; problem: ProfileProblem };

/** A name longer than this is not a name, it is a paste accident, and it will be truncated by
 *  whatever renders the picker — where the pilot then cannot tell two profiles apart. */
export const MAX_NAME_LEN = 40;

/** How many profiles a pilot may keep.
 *
 *  A cap is a judgement and it deserves a reason: this list is picked from on the ground, with a
 *  thumb, and a picker you have to SCROLL to find your glider in is a picker that will hand you
 *  the wrong glider. Twelve is far past any real hangar (a club member flies three or four types)
 *  and still fits a screen. Hitting it is refused by name, not silently ignored. */
export const MAX_PROFILES = 12;

// ---- reading the set ----

/** The profile that flies. NEVER null, and that is the whole contract of this module: every path
 *  that could have emptied the list or dangled the pointer was closed before the value got here.
 *
 *  The fallback to profiles[0] is not a "just in case" — it is the last line of the invariant, and
 *  it exists so that a caller can never be handed `undefined` and print `NaN` on a screen. */
export function activeProfile(set: ProfileSet): Profile {
  return set.profiles.find(p => p.id === set.activeId) ?? set.profiles[0];
}

/** The settings that fly. This is the one line main.ts will change: everywhere it reads its single
 *  Settings today, it reads activeSettings(set) tomorrow. */
export function activeSettings(set: ProfileSet): Settings {
  return activeProfile(set).settings;
}

// ---- ids: derived, deterministic, never a clock and never a random ----

/** Ids are slugs of the name at CREATION time, disambiguated by a counter. Deterministic on
 *  purpose: a module that reaches for Date.now() or Math.random() to make an id is a module whose
 *  output cannot be asserted, and the whole reason this file is pure is so the invariant above can
 *  be TESTED rather than hoped for.
 *
 *  The slug can come out empty — a name in Cyrillic, in Chinese, or made only of punctuation is a
 *  perfectly good name and a terrible slug — so it falls back to `profile`, and the counter does
 *  the rest. The id is never shown, so an ugly one costs nothing; a COLLIDING one would cost the
 *  pilot the wrong glider. */
function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s === '' ? 'profile' : s.slice(0, MAX_NAME_LEN);
}

function freshId(name: string, taken: ReadonlySet<string>): string {
  const base = slug(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---- names: what the pilot may call one ----

/** Two profiles the pilot cannot tell apart are worse than one profile fewer.
 *
 *  Compared case- and space-insensitively, because `Discus` and `discus ` are the same word to the
 *  human doing the picking, and the picker is the only place these names are ever read. */
const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Vet a name the pilot typed, against the names already taken. Returns the trimmed name, or the
 *  refusal to show him. `exceptId` is the profile being renamed — a profile is not a duplicate of
 *  itself, or re-confirming its own name would be refused. */
function vetName(set: ProfileSet, raw: string, exceptId: string | null): { name: string; problem: null } | { name: null; problem: ProfileProblem } {
  const name = raw.trim();
  if (name === '') return { name: null, problem: { id: 'profiles.emptyName' } };
  if (name.length > MAX_NAME_LEN) {
    return { name: null, problem: { id: 'profiles.nameTooLong', params: { max: MAX_NAME_LEN, have: name.length } } };
  }
  const clash = set.profiles.some(p => p.id !== exceptId && sameName(p.name, name));
  if (clash) return { name: null, problem: { id: 'profiles.duplicateName', params: { name } } };
  return { name, problem: null };
}

// ---- the set a fresh install flies with ----

/** Wrap one Settings record as the only profile. This is also the MIGRATION for every pilot who
 *  already has settings on disk from before profiles existed: his configuration becomes his first
 *  profile, under a name, and nothing he set is lost. A migration that starts him at
 *  DEFAULT_SETTINGS would be this file's own version of the failure it exists to prevent. */
export function profileSetOf(settings: Settings, name = 'default'): ProfileSet {
  const id = slug(name);
  return { profiles: [{ id, name: name.trim() === '' ? 'default' : name.trim(), settings }], activeId: id };
}

export const defaultProfileSet = (): ProfileSet => profileSetOf(DEFAULT_SETTINGS);

// ---- the four edits ----

/** Create one. The CALLER supplies the settings, and that is deliberate: the shell will hand it
 *  activeSettings(set) when the pilot says "duplicate this one" (the common case — the club Discus
 *  differs from his LS4 by a polar and a mass, not by twenty fields) and DEFAULT_SETTINGS when he
 *  says "start clean". Which of the two he meant is not a decision core can make for him.
 *
 *  The new profile does NOT become active. Creating is not selecting: a pilot who taps `new` while
 *  looking at his configured glider, and finds the app silently now flying built-in defaults, has
 *  been robbed of his settings by a button that said `new`. He selects it when he means to. */
export function createProfile(set: ProfileSet, rawName: string, settings: Settings): ProfileEdit {
  if (set.profiles.length >= MAX_PROFILES) {
    return { set: null, problem: { id: 'profiles.full', params: { max: MAX_PROFILES } } };
  }
  const vetted = vetName(set, rawName, null);
  if (vetted.name === null) return { set: null, problem: vetted.problem };

  const id = freshId(vetted.name, new Set(set.profiles.map(p => p.id)));
  return {
    set: { profiles: [...set.profiles, { id, name: vetted.name, settings }], activeId: set.activeId },
    problem: null,
  };
}

/** Make one fly. An unknown id is REFUSED, not quietly ignored: it means the list the pilot tapped
 *  and the list that exists have diverged (a stale screen, a profile deleted in another window),
 *  and silently leaving the old profile active would let him believe he had switched gliders when
 *  he had not. That belief is exactly what CFG-004 is here to prevent. */
export function selectProfile(set: ProfileSet, id: string): ProfileEdit {
  if (!set.profiles.some(p => p.id === id)) {
    return { set: null, problem: { id: 'profiles.unknown', params: { id } } };
  }
  return { set: { profiles: set.profiles, activeId: id }, problem: null };
}

/** Rename one. The id does not move — see Profile.id: that is the point of having one. */
export function renameProfile(set: ProfileSet, id: string, rawName: string): ProfileEdit {
  if (!set.profiles.some(p => p.id === id)) {
    return { set: null, problem: { id: 'profiles.unknown', params: { id } } };
  }
  const vetted = vetName(set, rawName, id);
  if (vetted.name === null) return { set: null, problem: vetted.problem };
  return {
    set: {
      profiles: set.profiles.map(p => p.id === id ? { ...p, name: vetted.name } : p),
      activeId: set.activeId,
    },
    problem: null,
  };
}

/** Delete one — and this is the function the whole file was written around.
 *
 *  THE LAST PROFILE CANNOT GO. Not clamped, not recreated from defaults behind his back: refused,
 *  by name, so the pilot is told why the button did nothing. A device with no settings on it is a
 *  device that has forgotten the glider, and the pilot who discovers that discovers it at the
 *  launch point.
 *
 *  DELETING THE ACTIVE ONE LEAVES A VALID ACTIVE ONE. The pointer moves to the NEIGHBOUR — the
 *  profile that was above it in the list, or the one below it if it was the first. Above rather
 *  than "the first in the list", because the pilot is looking at the list while he deletes and the
 *  selection landing next to his finger is the only movement he will not have to hunt for. Either
 *  way the choice is deterministic: an active profile picked at random from a Set iteration order
 *  is a glider picked at random. */
export function deleteProfile(set: ProfileSet, id: string): ProfileEdit {
  const i = set.profiles.findIndex(p => p.id === id);
  if (i < 0) return { set: null, problem: { id: 'profiles.unknown', params: { id } } };
  if (set.profiles.length <= 1) {
    return { set: null, problem: { id: 'profiles.lastOne', params: { name: set.profiles[i].name } } };
  }

  const profiles = set.profiles.filter(p => p.id !== id);
  // The neighbour above, or — when the deleted one was the first — the neighbour below. One of the
  // two always exists, because the length > 1 check above already ran.
  const neighbour = i > 0 ? set.profiles[i - 1] : set.profiles[i + 1];
  const activeId = set.activeId === id ? neighbour.id : set.activeId;
  return { set: { profiles, activeId }, problem: null };
}

// ---- editing the settings INSIDE the active profile ----

/** The pilot moved a switch on the settings screen. It lands in the profile that flies, and in no
 *  other — a change that leaked into a sibling profile would silently rewrite the glider he flies
 *  next weekend.
 *
 *  This one cannot be refused, so it returns the set itself rather than a ProfileEdit: there is no
 *  question here for the pilot to answer. */
export function setActiveSettings(set: ProfileSet, settings: Settings): ProfileSet {
  return {
    profiles: set.profiles.map(p => p.id === set.activeId ? { ...p, settings } : p),
    activeId: set.activeId,
  };
}

// ---- reading the set back off disk ----

/** Rebuild the profiles from untrusted JSON. Never throws, and never returns a set that breaks the
 *  invariant — that is this function's entire job, and it is the reason the four edits above can
 *  assume a healthy set.
 *
 *  It is the SILENT door (sanitizeLayout's side, not parseLayout's): this is the app's own store,
 *  not a file a human typed, so damage is repaired rather than reported. Field by field, exactly as
 *  normalizeSettings does it — a mangled entry costs that entry, never the pilot's other gliders:
 *
 *   · an entry that is not an object, or has no usable id or name, is DROPPED (a profile we cannot
 *     name is not something we can offer him to pick);
 *   · its settings go through normalizeSettings, which already knows how to repair a Settings
 *     record and never throws;
 *   · a DUPLICATE id is dropped — two profiles answering to one id means selectProfile would hand
 *     him whichever came first, which is a glider chosen by a sort order;
 *   · duplicate NAMES are kept but disambiguated by a visible suffix rather than dropped: the
 *     settings behind them are real work, and `Discus (2)` is something the pilot can see and
 *     rename, whereas two identical rows in the picker are two coin flips;
 *   · an `activeId` that names nothing falls back to the FIRST profile — never to "none";
 *   · and if nothing at all survives, the default set flies. A pilot whose store was corrupted
 *     gets a working computer with visible built-in defaults, which he can see and fix, rather
 *     than a screen with no settings on it at all. */
export function normalizeProfiles(raw: unknown): ProfileSet {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.profiles) ? r.profiles : [];

  const profiles: Profile[] = [];
  const ids = new Set<string>();
  for (const item of list) {
    if (profiles.length >= MAX_PROFILES) break;   // the cap holds on the way in too, or a hand-edited store outruns the picker
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id.trim() === '') continue;
    if (typeof e.name !== 'string' || e.name.trim() === '') continue;
    const id = e.id.trim();
    if (ids.has(id)) continue;

    let name = e.name.trim().slice(0, MAX_NAME_LEN);
    if (profiles.some(p => sameName(p.name, name))) {
      // A suffix, not a drop: behind that duplicate name sits a real polar and a real mass.
      let n = 2;
      while (profiles.some(p => sameName(p.name, `${name} (${n})`))) n++;
      name = `${name} (${n})`;
    }

    ids.add(id);
    profiles.push({ id, name, settings: normalizeSettings(e.settings) });
  }

  if (profiles.length === 0) return defaultProfileSet();

  const activeId = typeof r.activeId === 'string' && ids.has(r.activeId)
    ? r.activeId
    : profiles[0].id;
  return { profiles, activeId };
}
