import { test, expect } from 'bun:test';
import {
  activeProfile,
  activeSettings,
  createProfile,
  defaultProfileSet,
  deleteProfile,
  normalizeProfiles,
  profileSetOf,
  renameProfile,
  selectProfile,
  setActiveSettings,
  MAX_NAME_LEN,
  MAX_PROFILES,
  type ProfileSet,
} from './profiles';
import { DEFAULT_SETTINGS, type Settings } from './config';

/** A settings record distinguishable from any other at a glance. The cache budget stands in for
 *  "everything the pilot configured": if it travels correctly, so does the polar. */
const s = (cacheBudgetMB: number): Settings => ({ ...DEFAULT_SETTINGS, cacheBudgetMB });

/** Two profiles, LS4 active — the shape of the pilot who has a glider and borrows the club's. */
const two = (): ProfileSet => {
  const built = createProfile(profileSetOf(s(111), 'LS4'), 'club Discus', s(222));
  return built.set!;
};

const ok = (e: { set: ProfileSet | null }): ProfileSet => {
  expect(e.set).not.toBeNull();
  return e.set!;
};

// ---- THE RULE THIS FILE EXISTS FOR ----

test('THE LAST PROFILE CANNOT BE DELETED — a pilot with no settings has lost his glider', () => {
  // Not the polar, not the mass, not the monitored classes: all of it, and no way to be told what
  // happened. The refusal is NAMED, so the button that did nothing says why it did nothing.
  const one = profileSetOf(s(111), 'LS4');
  const e = deleteProfile(one, 'ls4');
  expect(e.set).toBeNull();
  expect(e.problem?.id).toBe('profiles.lastOne');
});

test('deleting the ACTIVE profile leaves a valid active one — never a dangling pointer', () => {
  // The failure this prevents: activeSettings() finds nothing, and the app flies built-in defaults
  // while the screen still names the glider the pilot chose.
  const set = ok(selectProfile(two(), 'club-discus'));
  const after = ok(deleteProfile(set, 'club-discus'));
  expect(after.profiles.map(p => p.id)).toEqual(['ls4']);
  expect(after.activeId).toBe('ls4');
  expect(activeProfile(after).id).toBe('ls4');           // the pointer names something that exists
  expect(activeSettings(after).cacheBudgetMB).toBe(111);
});

test('deleting the FIRST profile while it is active falls to the one BELOW, not into nothing', () => {
  // The neighbour above does not exist here. A `profiles[i - 1]` written without this case in mind
  // reads index -1 and hands the shell an undefined profile.
  const set = two();                                     // LS4 active, and LS4 is first
  const after = ok(deleteProfile(set, 'ls4'));
  expect(after.activeId).toBe('club-discus');
  expect(activeSettings(after).cacheBudgetMB).toBe(222);
});

test('deleting a profile that is NOT active does not move the pilot to another glider', () => {
  const set = two();                                     // LS4 active
  const after = ok(deleteProfile(set, 'club-discus'));
  expect(after.activeId).toBe('ls4');
});

// ---- what the module REFUSES ----

test('selecting an id that does not exist is REFUSED, not silently ignored', () => {
  // A stale picker (a profile deleted in another window) must not leave the pilot believing he has
  // switched gliders when he has not. That belief is the whole failure CFG-004 is here to prevent.
  const e = selectProfile(two(), 'ventus');
  expect(e.set).toBeNull();
  expect(e.problem).toEqual({ id: 'profiles.unknown', params: { id: 'ventus' } });
});

test('an empty name is refused — a nameless profile is a row the pilot cannot pick', () => {
  const e = createProfile(two(), '   ', s(333));
  expect(e.set).toBeNull();
  expect(e.problem?.id).toBe('profiles.emptyName');
});

test('a DUPLICATE name is refused — two identical rows in the picker are two coin flips', () => {
  // And case and stray spaces do not make them different: `discus ` and `Discus` are one word to
  // the human doing the picking, and the picker is the only place these names are read.
  const e = createProfile(two(), '  DISCUS  club ', s(333));
  expect(e.problem).toBeNull();                          // different word: allowed
  const dup = createProfile(two(), '  club discus ', s(333));
  expect(dup.set).toBeNull();
  expect(dup.problem?.id).toBe('profiles.duplicateName');
});

test('renaming a profile to its OWN name is not a duplicate of itself', () => {
  // Otherwise re-confirming an unchanged name is refused, and the pilot cannot get out of the box.
  const after = ok(renameProfile(two(), 'ls4', 'LS4'));
  expect(after.profiles[0].name).toBe('LS4');
});

test('a name longer than MAX_NAME_LEN is refused rather than truncated behind his back', () => {
  const e = createProfile(two(), 'x'.repeat(MAX_NAME_LEN + 1), s(333));
  expect(e.set).toBeNull();
  expect(e.problem?.id).toBe('profiles.nameTooLong');
});

test('the picker cannot be filled past MAX_PROFILES, and the refusal is named', () => {
  let set = profileSetOf(s(1), 'p1');
  for (let i = 2; i <= MAX_PROFILES; i++) set = ok(createProfile(set, `p${i}`, s(i)));
  expect(set.profiles.length).toBe(MAX_PROFILES);
  const e = createProfile(set, 'one too many', s(99));
  expect(e.set).toBeNull();
  expect(e.problem?.id).toBe('profiles.full');
});

test('renaming or deleting an unknown id is refused, not applied to somebody else', () => {
  expect(renameProfile(two(), 'ventus', 'x').problem?.id).toBe('profiles.unknown');
  expect(deleteProfile(two(), 'ventus').problem?.id).toBe('profiles.unknown');
});

// ---- creating, renaming, and the identity that must not move ----

test('CREATING does not SELECT — a button called `new` must not change the glider that flies', () => {
  // A pilot who taps `new` while looking at his configured LS4, and finds the app now flying
  // built-in defaults, has been robbed of his settings by a button that promised him a blank one.
  const set = ok(createProfile(profileSetOf(s(111), 'LS4'), 'club Discus', DEFAULT_SETTINGS));
  expect(set.activeId).toBe('ls4');
  expect(activeSettings(set).cacheBudgetMB).toBe(111);
});

test('a RENAME does not move the id — the active pointer survives the pilot fixing a typo', () => {
  // A profile keyed by its name changes identity when it is renamed, and the active pointer (and
  // any other reference) is orphaned by a spelling correction.
  const set = ok(renameProfile(two(), 'ls4', 'LS4 F-CGXY'));
  expect(set.profiles[0].id).toBe('ls4');
  expect(set.activeId).toBe('ls4');
  expect(activeProfile(set).name).toBe('LS4 F-CGXY');
});

test('two profiles whose names slug the same still get DIFFERENT ids', () => {
  // `LS4!` and `ls4` slug to the same thing. One id for two profiles means selectProfile hands the
  // pilot whichever came first: a glider chosen by a sort order.
  const set = ok(createProfile(profileSetOf(s(111), 'LS4'), 'ls-4', s(222)));
  expect(set.profiles.map(p => p.id)).toEqual(['ls4', 'ls-4']);
});

test('a name that slugs to NOTHING still gets a usable id', () => {
  // Chinese, Cyrillic, or pure punctuation are perfectly good names and terrible slugs. The id is
  // never shown, so an ugly one costs nothing — an EMPTY one would collide with the next.
  const set = ok(createProfile(profileSetOf(s(111), 'LS4'), '滑翔机', s(222)));
  const set2 = ok(createProfile(set, '飛行機', s(333)));
  expect(set2.profiles.map(p => p.id)).toEqual(['ls4', 'profile', 'profile-2']);
});

test('an edit is a NEW set — the caller can still diff against what it had', () => {
  // The shell decides whether to write to disk by comparing old with new (shelf.ts's rule). A
  // mutating op makes that diff lie, and the pilot's rename never reaches the disk.
  const before = two();
  const after = ok(renameProfile(before, 'ls4', 'LS4 F-CGXY'));
  expect(before.profiles[0].name).toBe('LS4');
  expect(after).not.toBe(before);
});

// ---- editing the settings inside the active profile ----

test('a setting the pilot changes lands in the ACTIVE profile and in NO OTHER', () => {
  // A change leaking into a sibling silently rewrites the glider he flies next weekend.
  const set = setActiveSettings(two(), s(999));           // LS4 is active
  expect(activeSettings(set).cacheBudgetMB).toBe(999);
  expect(set.profiles[1].settings.cacheBudgetMB).toBe(222);
});

test('switching profile switches ALL the settings at once, and back again unchanged', () => {
  // This is the promise: the club Discus on Saturday, the LS4 on Sunday, and nothing re-typed.
  const set = two();
  const onDiscus = ok(selectProfile(set, 'club-discus'));
  expect(activeSettings(onDiscus).cacheBudgetMB).toBe(222);
  const backOnLs4 = ok(selectProfile(onDiscus, 'ls4'));
  expect(activeSettings(backOnLs4).cacheBudgetMB).toBe(111);
});

// ---- what comes off the disk ----

test('an activeId naming nothing is REPAIRED to the first profile, never left dangling', () => {
  // The invariant is re-imposed on the way IN, or every reader downstream has to check for it —
  // and one of them will forget, and print NaN on a screen in flight.
  const set = normalizeProfiles({
    profiles: [{ id: 'ls4', name: 'LS4', settings: s(111) }],
    activeId: 'a-profile-deleted-two-releases-ago',
  });
  expect(set.activeId).toBe('ls4');
  expect(activeProfile(set).name).toBe('LS4');
});

test('a corrupted store gives a WORKING computer with visible defaults, never an empty one', () => {
  for (const junk of [null, undefined, 42, 'nope', [], {}, { profiles: [] }, { profiles: 'x' }]) {
    const set = normalizeProfiles(junk);
    expect(set.profiles.length).toBe(1);
    expect(set.activeId).toBe(set.profiles[0].id);
    expect(activeSettings(set)).toEqual(DEFAULT_SETTINGS);
  }
});

test('a mangled entry costs THAT entry, never the pilot`s other gliders', () => {
  const set = normalizeProfiles({
    profiles: [
      { id: 'ls4', name: 'LS4', settings: s(111) },
      null,                                       // not an object
      { name: 'no id', settings: s(1) },          // unnameable by identity
      { id: 'blank', name: '   ', settings: s(1) },  // a profile we cannot show him a name for
      { id: 'discus', name: 'club Discus', settings: s(222) },
    ],
    activeId: 'discus',
  });
  expect(set.profiles.map(p => p.id)).toEqual(['ls4', 'discus']);
  expect(set.activeId).toBe('discus');
});

test('a broken SETTINGS record inside a profile is repaired, not fatal to the profile', () => {
  // normalizeSettings already knows how to do this field by field. A profile is not thrown away
  // because one of its fields rotted — the pilot's polar and layout are still in there.
  const set = normalizeProfiles({
    profiles: [{ id: 'ls4', name: 'LS4', settings: { cacheBudgetMB: -5, lang: 'klingon' } }],
    activeId: 'ls4',
  });
  expect(set.profiles[0].settings.cacheBudgetMB).toBe(DEFAULT_SETTINGS.cacheBudgetMB);
  expect(set.profiles[0].settings.lang).toBe('en');
});

test('a DUPLICATE id off disk is dropped — one id must never name two gliders', () => {
  const set = normalizeProfiles({
    profiles: [
      { id: 'ls4', name: 'LS4', settings: s(111) },
      { id: 'ls4', name: 'LS4 again', settings: s(222) },
    ],
    activeId: 'ls4',
  });
  expect(set.profiles.length).toBe(1);
  expect(activeSettings(set).cacheBudgetMB).toBe(111);
});

test('duplicate NAMES off disk are made TELLABLE APART, not dropped — real work sits behind them', () => {
  const set = normalizeProfiles({
    profiles: [
      { id: 'a', name: 'Discus', settings: s(111) },
      { id: 'b', name: 'discus', settings: s(222) },
    ],
    activeId: 'b',
  });
  expect(set.profiles.map(p => p.name)).toEqual(['Discus', 'discus (2)']);
  expect(activeSettings(set).cacheBudgetMB).toBe(222);   // his settings survived the rename
});

test('a hand-edited store cannot outrun the picker either', () => {
  const raw = { profiles: Array.from({ length: MAX_PROFILES + 5 }, (_, i) => ({ id: `p${i}`, name: `p${i}`, settings: s(i) })), activeId: 'p0' };
  expect(normalizeProfiles(raw).profiles.length).toBe(MAX_PROFILES);
});

test('MIGRATION: the settings a pilot already has become his first profile, not defaults', () => {
  // Every existing install has one Settings record on disk from before profiles existed. Starting
  // him at DEFAULT_SETTINGS would be this file committing the very failure it was written against.
  const set = profileSetOf(s(777));
  expect(set.profiles.length).toBe(1);
  expect(activeSettings(set).cacheBudgetMB).toBe(777);
  expect(set.activeId).toBe(set.profiles[0].id);
});

test('a normalized set round-trips through JSON unchanged — this is what gets persisted', () => {
  const set = ok(createProfile(defaultProfileSet(), 'club Discus', s(222)));
  expect(normalizeProfiles(JSON.parse(JSON.stringify(set)))).toEqual(set);
});
