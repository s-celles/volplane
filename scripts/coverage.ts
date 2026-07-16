// ============ what is built, what is not, and a table that cannot lie about it ============
//
// ---- why this exists ----
//
// ROADMAP.md opens with the sentence "This document was lying". It announced sixty-six of sixty-nine
// requirements built. Three of them were not, and nobody had looked. A HAND-MAINTAINED TABLE OF WHAT
// IS DONE IS A TABLE THAT DRIFTS, and it drifts in the flattering direction, because nobody deletes a
// row that says they finished something.
//
// So this table is CHECKED, and the check is the same bargain soaring-data made with aliases.csv: a
// human declares, WITH EVIDENCE, and a script verifies that the evidence is alive.
//
// ---- what the evidence IS, and what it is worth ----
//
// This codebase already has a convention: the code NAMES the requirement it implements. `PLA-004` is
// written in glide.ts, `IHM-006` in the catalogue, `TER-001` in the terrain painter. So the evidence
// for "built" is that at least one source file CITES the id.
//
// Be exact about what that proves, because it is easy to overclaim:
//
//   · it does NOT prove the requirement is met. The code says it implements PLA-004; this script
//     cannot read the code and agree. A citation is a CLAIM.
//   · it DOES prove that nothing in the repository even claims to. And that is the half that catches
//     the lie that actually happens — a row saying `built` with no line of code behind it.
//
// The first run of this table got that backwards and marked CAR-001 absent — "display a moving map" —
// while the app was drawing one. The absence of a citation is not evidence of absence. It is evidence
// that NOBODY HAS SAID, which is a different fact and a smaller one.
//
// ---- so there are three states, and `unverified` is the useful one ----
//
//   built       — some file cites the id. Machine-checked.
//   absent      — NO file cites it, AND a human has read the code and confirmed it is not there.
//                 The note says what he looked for.
//   unverified  — nobody cites it and nobody has looked. THIS SCRIPT FAILS ON IT.
//
// A requirement nobody has looked at is not a requirement that is done, and it is not one that is
// missing either. It is a question, and a build that goes green over an open question is a build that
// has learned to lie.
//
// Run:  bun run scripts/coverage.ts

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CSV = new URL('../spec-coverage.csv', import.meta.url).pathname;
const SRC = new URL('../src', import.meta.url).pathname;

const RE = /\b(ACQ|VAR|PLA|CAR|TER|ESP|LND|TSK|IHM|CFG|SYS|THE|VEN|POT|OFF|ANA|SEC|AUD)-\d{3}\b/g;

const cells = (line: string): string[] => {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.ts') || e.name.endsWith('.css')) yield p;
  }
}

/** Every requirement id the source claims, and where it claims it. */
export async function citations(root: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for await (const f of walk(root)) {
    const text = await readFile(f, 'utf8');
    for (const m of text.matchAll(RE)) {
      const rel = f.slice(root.length + 1);
      const at = out.get(m[0]) ?? [];
      if (!at.includes(rel)) at.push(rel);
      out.set(m[0], at);
    }
  }
  return out;
}

export interface Row { id: string; level: string; status: string; evidence: string; note: string; title: string }

/** What is wrong with this table. Empty is the only passing answer. */
export function audit(rows: readonly Row[], cited: Map<string, string[]>): string[] {
  const bad: string[] = [];
  for (const r of rows) {
    const at = cited.get(r.id) ?? [];

    if (r.status === 'built' && at.length === 0) {
      // The lie that actually happens: a row that says finished, with nothing behind it.
      bad.push(`${r.id}: says BUILT and NO SOURCE FILE CITES IT. Either it is not built, or the code that builds it does not say so — and a requirement nothing names is a requirement nobody can find again.`);
    }
    if (r.status === 'absent' && at.length > 0) {
      bad.push(`${r.id}: says ABSENT and ${at.join(', ')} cites it. One of the two is out of date.`);
    }
    if (r.status === 'absent' && r.note.trim() === '') {
      // An `absent` with no reason is an `unverified` wearing a confident face.
      bad.push(`${r.id}: says ABSENT with no note. What did you look for, and where? An absence with no reason is a guess.`);
    }
    if (r.status === 'unverified') {
      bad.push(`${r.id} (${r.level}) — NOBODY HAS LOOKED. ${r.title}`);
    }
    if (!['built', 'absent', 'partial', 'unverified'].includes(r.status)) {
      bad.push(`${r.id}: '${r.status}' is not a status.`);
    }
  }
  return bad;
}

export async function readTable(path: string): Promise<Row[]> {
  const lines = (await readFile(path, 'utf8')).trim().split(/\r?\n/);
  return lines.slice(1).map(l => {
    const c = cells(l);
    return { id: c[0]!, level: c[1]!, status: c[2]!, evidence: c[3] ?? '', note: c[4] ?? '', title: c[5] ?? '' };
  });
}

if (import.meta.main) {
  const rows = await readTable(CSV);
  const cited = await citations(SRC);
  const problems = audit(rows, cited);

  const by = (lvl: string, st: string) => rows.filter(r => r.level === lvl && r.status === st).length;
  console.log(`
                built   partial   absent   UNVERIFIED
  Must  (M)      ${String(by('M', 'built')).padStart(3)}      ${String(by('M', 'partial')).padStart(3)}      ${String(by('M', 'absent')).padStart(3)}       ${String(by('M', 'unverified')).padStart(3)}
  Should (S)     ${String(by('S', 'built')).padStart(3)}      ${String(by('S', 'partial')).padStart(3)}      ${String(by('S', 'absent')).padStart(3)}       ${String(by('S', 'unverified')).padStart(3)}
  Could  (C)     ${String(by('C', 'built')).padStart(3)}      ${String(by('C', 'partial')).padStart(3)}      ${String(by('C', 'absent')).padStart(3)}       ${String(by('C', 'unverified')).padStart(3)}
`);

  const missing = rows.filter(r => r.status === 'absent');
  if (missing.length > 0) {
    console.log('NOT BUILT — read, confirmed, and written down:\n');
    for (const r of missing) console.log(`  ${r.id}  (${r.level})  ${r.note}`);
    console.log('');
  }

  if (problems.length > 0) {
    console.error(`${problems.length} problem(s) with the TABLE ITSELF:\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(`
A requirement nobody has looked at is not done and is not missing. It is a QUESTION, and a build that
goes green over an open question is a build that has learned to lie. ROADMAP.md opened with "This
document was lying" for exactly this reason, and it was hand-maintained.
`);
    process.exit(1);
  }
  console.log('✓ the table and the code agree');
}
