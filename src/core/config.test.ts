// ============ what these tests pin ============
// The settings CLAIMS (OFF-002, OFF-006): what the pilot configured comes back, garbage
// comes back as the defaults and never as a throw, and a ceiling that would evict everything
// (zero, negative, NaN) is refused in favour of the default — the same refusal the budget
// input applies to a typo, kept in ONE place so the form and the disk cannot disagree.
import { test, expect } from 'bun:test';
import { DEFAULT_SETTINGS, normalizeSettings } from './config';

test('a valid ceiling survives normalization and a JSON round-trip', () => {
  expect(normalizeSettings({ cacheBudgetMB: 50 })).toEqual({ cacheBudgetMB: 50 });
  const persisted = JSON.parse(JSON.stringify({ cacheBudgetMB: 50 }));
  expect(normalizeSettings(persisted)).toEqual({ cacheBudgetMB: 50 });
});

test('garbage in, defaults out — never a throw', () => {
  const garbage: unknown[] = [
    null, undefined, 42, 'many', [], {},
    { cacheBudgetMB: 'many' }, { cacheBudgetMB: NaN }, { cacheBudgetMB: Infinity },
  ];
  for (const raw of garbage) expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
});

test('a ceiling that would evict everything is refused, not obeyed', () => {
  expect(normalizeSettings({ cacheBudgetMB: 0 })).toEqual(DEFAULT_SETTINGS);
  expect(normalizeSettings({ cacheBudgetMB: -5 })).toEqual(DEFAULT_SETTINGS);
});

test('the normalizer answers a fresh object, so no caller can edit the defaults', () => {
  const a = normalizeSettings(null);
  a.cacheBudgetMB = 1;
  expect(DEFAULT_SETTINGS.cacheBudgetMB).toBe(200);
});
