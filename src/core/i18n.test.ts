// ============ the catalogue guard (IHM-006) ============
// The interesting test in this file is the first one: it reads the source of the whole app,
// pulls out every message id the code actually asks for, and fails if any catalogue is missing
// one. That turns a missing translation into a red build instead of a blank label above an
// altitude, discovered at 1 500 m by somebody who had other things to do.
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, LANGS, t, translator, isLang, type MsgId } from './i18n';
import { SEE_AND_AVOID } from './flarm';
import { NONE_REACHABLE } from './landables';

// The shell directory is assembled from fragments on purpose: purity.test.ts fails any file in
// src/core whose IMPORT specifier mentions the shell, and it is right to. We only read the
// files as text — we never import them — but the guard cannot tell the difference, so we do not
// hand it a string that looks like one.
const dirs = [join(import.meta.dir), join(import.meta.dir, '..', 'shell')];

const sources = dirs.flatMap(dir =>
  readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map(f => ({ file: join(dir, f), text: readFileSync(join(dir, f), 'utf8') })),
);

/** Comments are stripped first: a comment that MENTIONS a t('…') call is prose, not a lookup. */
const stripComments = (text: string): string =>
  text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const usedIds = (text: string): string[] =>
  [...stripComments(text).matchAll(/\bt\(\s*'([^']+)'/g)].map(m => m[1]!);

test('every message id the code asks for exists in EVERY catalogue', () => {
  expect(sources.length).toBeGreaterThan(2);
  const missing: string[] = [];
  for (const { file, text } of sources)
    for (const id of usedIds(text))
      for (const lang of LANGS)
        if (!(id in CATALOGUES[lang])) missing.push(`${lang}: ${id} (${file})`);
  expect(missing).toEqual([]);
});

test('the catalogues hold exactly the same ids', () => {
  const reference = Object.keys(CATALOGUES.en).sort();
  for (const lang of LANGS) expect(Object.keys(CATALOGUES[lang]).sort()).toEqual(reference);
});

test('no message is blank', () => {
  // A whitespace-only translation renders as nothing at all, which is indistinguishable from a
  // bug and worse than English.
  for (const lang of LANGS)
    for (const [id, value] of Object.entries(CATALOGUES[lang])) expect(`${lang}.${id}: "${value.trim()}"`).not.toBe(`${lang}.${id}: ""`);
});

test('the safety sentences are the kernel\'s own words, verbatim', () => {
  // The kernel promises these sentences (FLM-005, LND-006). If the catalogue may paraphrase
  // them, then the sentence the pilot reads is no longer the sentence the spec pinned.
  expect(CATALOGUES.en['flarm.seeAndAvoid']).toBe(SEE_AND_AVOID);
  expect(CATALOGUES.en['lnd.noneReachable']).toBe(NONE_REACHABLE);
});

test('the safety sentences are actually translated, not copy-pasted', () => {
  for (const id of ['flarm.seeAndAvoid', 'lnd.noneReachable', 'badge.modelled.title', 'data.ageUnknown'] as MsgId[]) {
    expect(CATALOGUES.fr[id].trim().length).toBeGreaterThan(0);
    expect(CATALOGUES.fr[id]).not.toBe(CATALOGUES.en[id]);
  }
});

test('an unknown id comes back as itself — never blank, never "undefined"', () => {
  // Held in a variable so the source scan above does not mistake it for a real lookup.
  const orphan = 'no.such.message';
  expect(t('en', orphan)).toBe(orphan);
  expect(t('fr', orphan)).toBe(orphan);
});

test('a catalogue miss falls back to English rather than to nothing', () => {
  // Deleting an id from the French catalogue is exactly the accident the type system prevents at
  // compile time; t() still has to behave sanely if it ever happens at runtime.
  const fr = CATALOGUES.fr as Record<string, string | undefined>;
  const saved = fr['box.mc'];
  try {
    delete fr['box.mc'];
    expect(t('fr', 'box.mc')).toBe(CATALOGUES.en['box.mc']);
  } finally {
    fr['box.mc'] = saved;
  }
});

test('placeholders are filled, and an unsupplied one stays visible', () => {
  // The catalogue floor of this phase carries no placeholder yet, so the substitution is
  // exercised through a temporary id — the CLAIM is about t(), not about a particular message.
  const en = CATALOGUES.en as Record<string, string | undefined>;
  const id = 'tmp.params';
  const say = (s: string, p?: Record<string, string | number>) => ((en[id] = s), t('en', id, p));
  try {
    expect(say('{n} circles', { n: 3 })).toBe('3 circles');
    expect(say('{n} circles')).toBe('{n} circles');
    expect(say('{n} of {m}', { n: 1 })).toBe('1 of {m}');
    expect(say('{a} {a}', { a: 'x' })).toBe('x x');
  } finally {
    delete en[id];
  }
});

test('a translator speaks one language and nothing else needs to know which', () => {
  const tr = translator('fr');
  expect(tr('lnd.noneReachable')).toBe(CATALOGUES.fr['lnd.noneReachable']);
  expect(isLang('fr')).toBe(true);
  expect(isLang('de')).toBe(false);
});
