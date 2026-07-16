// Every test below is a file a human could type, and most of them are files a human WILL type.

import { test, expect } from 'bun:test';
import {
  parseLayout, serializeLayout, editLayout, sanitizeLayout, defaultLayout,
  FORMAT, MIN_SLOTS, MAX_SLOTS, PHASES, DEFAULT_LAYOUT,
} from './layout';

const file = (o: unknown) => JSON.stringify(o);
const good = {
  volplane: FORMAT,
  name: 'mine',
  phases: {
    circling: ['vario', 'avg30', 'alt', 'agl'],
    cruise: ['netto', 'stf', 'alt', 'agl'],
    finalGlide: ['mc', 'stf', 'alt', 'agl'],
  },
};

test('a layout the pilot typed, read back exactly', () => {
  const r = parseLayout(file(good));
  expect(r.problems).toEqual([]);
  expect(r.layout!.name).toBe('mine');
  expect(r.layout!.phases.cruise).toEqual(['netto', 'stf', 'alt', 'agl']);
});

test('it round-trips through the file it writes', () => {
  const r = parseLayout(serializeLayout(defaultLayout()));
  expect(r.problems).toEqual([]);
  expect(r.layout).toEqual(defaultLayout());
});

test('A FILE THAT DOES NOT SAY WHAT IT IS IS NOT ONE OF OURS', () => {
  // Guessing is how a .cup, or somebody's tsconfig, ends up half-loaded as a screen.
  expect(parseLayout(file({ ...good, volplane: undefined })).layout).toBeNull();
  expect(parseLayout(file({ ...good, volplane: 'volplane/layout/9' })).problems[0]!.id)
    .toBe('layout.wrongFormat');
  expect(parseLayout('not json at all').problems[0]!.id).toBe('layout.notJson');
});

test('AN UNKNOWN BOX IS NAMED, NOT SWALLOWED — this is the whole difference from the other loader', () => {
  // The app's own store may silently drop what a release renamed: that is our cache, and the repair
  // is right. A file a HUMAN typed is not our cache. A pilot who wrote `arival` and got a screen with
  // three boxes and no explanation would conclude the feature is broken — and he would be right,
  // because a program that discards your work without telling you IS broken.
  const r = parseLayout(file({
    ...good,
    phases: { ...good.phases, cruise: ['netto', 'arival', 'stf', 'alt', 'agl'] },
  }));
  expect(r.problems).toEqual([{ id: 'layout.unknownBox', params: { phase: 'cruise', box: 'arival' } }]);
  expect(r.layout!.phases.cruise).toEqual(['netto', 'stf', 'alt', 'agl']);   // and the rest STANDS
});

test('one typo does not throw the file away', () => {
  // He fixes one line, not the file.
  const r = parseLayout(file({ ...good, phases: { ...good.phases, cruise: ['netto', 'nope', 'stf', 'alt', 'agl'] } }));
  expect(r.layout).not.toBeNull();
  expect(r.layout!.phases.circling).toEqual(['vario', 'avg30', 'alt', 'agl']);
});

test('a row too SHORT falls back to the default row, and says so', () => {
  const r = parseLayout(file({ ...good, phases: { ...good.phases, cruise: ['alt', 'agl'] } }));
  expect(r.problems[0]!.id).toBe('layout.tooFew');
  expect(r.layout!.phases.cruise.length).toBeGreaterThanOrEqual(MIN_SLOTS);
});

test('a row too LONG is cut to the ceiling, and says so', () => {
  const eight = ['alt', 'agl', 'vario', 'avg30', 'netto', 'stf', 'tas', 'groundSpeed'];
  const nine = [...eight, 'mc'];
  const r = parseLayout(file({
    volplane: FORMAT, name: 'long',
    phases: { circling: eight, cruise: nine, finalGlide: eight },
  }));
  expect(r.problems.some(p => p.id === 'layout.tooMany')).toBe(true);
  expect(r.layout!.phases.cruise.length).toBe(MAX_SLOTS);
});

test('AND THE RAGGED RULE OUTRANKS THE CEILING — the shortest row wins, whatever caused it', () => {
  // A nine-box cruise beside a four-box climb is cut to eight by the ceiling and then to FOUR by the
  // ragged rule, because a row that changes length between phases moves every box below it. The
  // ceiling is a limit; equal length is a PROMISE, and the promise is the one the pilot's eye relies
  // on. Both refusals are reported, so he can see exactly what happened to his file.
  const nine = ['alt', 'agl', 'vario', 'avg30', 'netto', 'stf', 'tas', 'groundSpeed', 'mc'];
  const r = parseLayout(file({ ...good, phases: { ...good.phases, cruise: nine } }));
  expect(r.problems.map(p => p.id)).toEqual(['layout.tooMany', 'layout.ragged']);
  expect(r.layout!.phases.cruise.length).toBe(4);
});

test('EVERY PHASE THE SAME LENGTH, and that is not tidiness', () => {
  // A row that grew between climb and cruise would move every box below it — and the whole point of
  // the frame is that a number does not move. The pilot reads an instrument by knowing WHERE a value
  // lives; a layout that reflows under him has taken away the only thing that made it glanceable.
  const r = parseLayout(file({
    ...good,
    phases: { ...good.phases, cruise: ['netto', 'stf', 'alt', 'agl', 'vario'] },
  }));
  expect(r.problems.some(p => p.id === 'layout.ragged')).toBe(true);
  const lens = new Set(PHASES.map(p => r.layout!.phases[p].length));
  expect(lens.size).toBe(1);
});

test('a duplicate box is refused — the same number twice is a slot wasted', () => {
  const r = parseLayout(file({
    ...good,
    phases: { ...good.phases, cruise: ['netto', 'netto', 'stf', 'alt', 'agl'] },
  }));
  expect(r.problems.some(p => p.id === 'layout.duplicateBox')).toBe(true);
  expect(r.layout!.phases.cruise).toEqual(['netto', 'stf', 'alt', 'agl']);
});

// ---- editing it, and the two rules that hold in the air ----

test('A ROW NEVER FALLS BELOW ITS FLOOR', () => {
  // A row that can be emptied is a row a pilot WILL empty, on the ground, on a Tuesday — and find out
  // in a thermal. Nothing here is locked in flight, so nothing here may be destroyable in flight.
  let l = defaultLayout();
  for (const b of [...l.phases.cruise]) l = editLayout(l, 'cruise', 'remove', b);
  expect(l.phases.cruise.length).toBe(MIN_SLOTS);
});

test('and it never grows past its ceiling', () => {
  let l = defaultLayout();
  for (const b of ['vario', 'tas', 'lat', 'lon', 'ground', 'superNetto'] as const) {
    l = editLayout(l, 'cruise', 'add', b);
  }
  expect(l.phases.cruise.length).toBe(MAX_SLOTS);
});

test('up, down, and an edit that cannot be made changes NOTHING', () => {
  const l = defaultLayout();
  expect(editLayout(l, 'cruise', 'up', 'stf').phases.cruise[0]).toBe('stf');
  expect(editLayout(l, 'cruise', 'up', 'netto')).toBe(l);          // already first: the same object
  expect(editLayout(l, 'cruise', 'add', 'netto')).toBe(l);         // already there
  expect(editLayout(l, 'cruise', 'remove', 'vario')).toBe(l);      // not there
});

test('an edit never mutates the layout it was given', () => {
  const l = defaultLayout();
  const before = [...l.phases.cruise];
  editLayout(l, 'cruise', 'add', 'vario');
  expect(l.phases.cruise).toEqual(before);
});

// ---- and what came off OUR OWN disk ----

test('a stale store is repaired SILENTLY, because it is our cache and not his file', () => {
  // A release renamed a box. Our own store is now stale — but it is OUR file, not his, and repairing
  // it without a word is right. A row left too short to be an instrument goes back to the default
  // rather than limping: three boxes is not a screen with a box missing, it is a broken screen.
  const l = sanitizeLayout({
    name: '  ',
    phases: {
      circling: ['alt', 'agl', 'vario', 'wasRenamed'],   // 3 survive: below the floor
      cruise: 'nonsense',
      finalGlide: ['mc', 'stf', 'alt', 'agl', 'netto', 'vario'],
    },
  });
  expect(l.phases.circling).toEqual(defaultLayout().phases.circling);
  expect(l.phases.cruise).toEqual(defaultLayout().phases.cruise);
  expect(new Set(PHASES.map(p => l.phases[p].length)).size).toBe(1);
  expect(l.name).toBe('layout');
});

test('garbage off disk boots the DEFAULT, not a blank screen', () => {
  // A flight computer that boots to nothing because of a corrupt preference is not a flight computer.
  expect(sanitizeLayout(null)).toEqual(defaultLayout());
  expect(sanitizeLayout('nope')).toEqual(defaultLayout());
});

test('every phase row is the FULL six slots, and none carries the arrival — that is the hero', () => {
  // These were once asserted against phase.ts's PHASE_BOXES, a constant that has since died: the
  // layout is the single source of the default rows now. The arrival height is NOT a box — it is the
  // top strip's bar-and-sign, because a pilot on a marginal glide should not have to read a number.
  for (const p of PHASES) {
    expect(DEFAULT_LAYOUT.phases[p].length).toBe(6);
    expect(DEFAULT_LAYOUT.phases[p]).not.toContain('arrival');
  }
});

test('final glide carries the finesse PAIR, because that is the question in a final glide', () => {
  // required vs achieved (PLA-006). The wind left this row to make space, and that is a deliberate
  // trade: the arrival height in the hero already prices the headwind, so a wind box here would be
  // saying twice what the bar already says once.
  expect(DEFAULT_LAYOUT.phases.finalGlide).toContain('ldReq');
  expect(DEFAULT_LAYOUT.phases.finalGlide).toContain('ldAch');
});
