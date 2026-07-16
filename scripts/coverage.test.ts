// The table is checked because the last one was not. ROADMAP.md opens with "This document was lying".

import { test, expect } from 'bun:test';
import { audit, type Row } from './coverage';

const row = (o: Partial<Row>): Row =>
  ({ id: 'CAR-002', level: 'M', status: 'built', evidence: '', note: '', title: '', ...o });

test('BUILT WITH NOTHING BEHIND IT — the lie that actually happens', () => {
  // Nobody deletes a row that says they finished something. So the row that says `built` while not one
  // line of code names the requirement is the row this whole script exists to catch.
  const bad = audit([row({ status: 'built' })], new Map());
  expect(bad.length).toBe(1);
  expect(bad[0]).toContain('NO SOURCE FILE CITES IT');
});

test('and a citation makes it pass — but a citation is a CLAIM, not a proof', () => {
  // This script cannot read glide.ts and agree that it implements PLA-004. It can only prove that
  // something says it does. That is the smaller half of the truth, and it is the half that catches
  // the failure that actually occurs.
  expect(audit([row({ status: 'built' })], new Map([['CAR-002', ['shell/map-ui.ts']]]))).toEqual([]);
});

test('AN ABSENCE WITH NO REASON IS A GUESS', () => {
  // `absent` with an empty note is `unverified` wearing a confident face.
  const bad = audit([row({ status: 'absent', note: '' })], new Map());
  expect(bad[0]).toContain('no note');
  expect(audit([row({ status: 'absent', note: 'la carte ne tourne jamais' })], new Map())).toEqual([]);
});

test('and an `absent` the code cites is a table out of date', () => {
  const bad = audit([row({ status: 'absent', note: 'rien' })], new Map([['CAR-002', ['core/orient.ts']]]));
  expect(bad[0]).toContain('cites it');
});

test('UNVERIFIED FAILS THE BUILD, and that is the point', () => {
  // A requirement nobody has looked at is not done and is not missing. It is a QUESTION — and the
  // first version of this very table marked CAR-001 ("display a moving map") absent while the app was
  // drawing one, because nothing cited the id. The absence of a citation is not evidence of absence.
  const bad = audit([row({ status: 'unverified' })], new Map());
  expect(bad[0]).toContain('NOBODY HAS LOOKED');
});

test('a status the table does not know is not a status', () => {
  expect(audit([row({ status: 'probably fine' })], new Map())[0]).toContain('is not a status');
});
