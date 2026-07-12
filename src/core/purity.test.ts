// ============ architecture guard: C5, enforced ============
// The flight computer must not know which shell it is running in. That is C5, and it is what
// makes the shell replaceable — Tauri today, something else the day Tauri is the wrong bet.
//
// A boundary written down in a roadmap erodes on the first hurried commit. This one fails the
// build.
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = join(import.meta.dir);
const files = readdirSync(CORE)
  .filter(f => f.endsWith('.ts'))
  .map(f => ({ file: f, text: readFileSync(join(CORE, f), 'utf8') }));

const imports = (text: string): string[] =>
  [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

test('there is something to guard', () => {
  expect(files.length).toBeGreaterThan(2);
});

test('the flight computer does not import the shell', () => {
  // Not Tauri, not Capacitor, not Electron. If any of these appears here, the computer has
  // been welded to a shell and C5 is a fiction.
  const banned = [/^@tauri-apps\//, /^@capacitor\//, /^electron$/];
  for (const { file, text } of files)
    for (const spec of imports(text))
      for (const re of banned)
        expect(`${file} imports ${spec}`).not.toMatch(new RegExp(`imports ${re.source.replace(/[$^]/g, '')}`));
});

test('the flight computer does not reach into src/shell/', () => {
  // The dependency points ONE way: shell -> core. A core that imports the shell has inverted
  // it, and the replay source, the tests and the CI all stop working without a window.
  for (const { file, text } of files)
    for (const spec of imports(text))
      expect(`${file} → ${spec}`).not.toMatch(/shell/);
});

test('the flight computer touches no browser global', () => {
  // It has to run headless: in bun test, in CI, in a worker. A `document.` here is a computer
  // that cannot be tested without a window.
  const banned = /\b(document|window|localStorage|navigator)\b\s*\./g;
  for (const { file, text } of files) {
    const code = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = [...code.matchAll(banned)].map(m => m[1]);
    expect(`${file}: ${hits.join(',')}`).toBe(`${file}: `);
  }
});
