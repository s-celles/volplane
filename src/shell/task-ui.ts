// ============ the task ribbon (TSK-007, TSK-006) ============
// One line across the top of the flight screen, and until now it only ever spoke about the
// PAST: which points are signed off, how much distance the scorer credits. A pilot on task
// spends the whole flight asking the other question — how far still, how long still, am I fast
// enough — and the ribbon had no answer for any of it.
//
// Pure, like xsection-ui and landables-ui: values in, an HTML string out, no DOM and no fetch.
// Which means it computes NOTHING. Every figure below arrives from core/taskstats.ts already
// decided, including the decision to be absent. This file's only freedom — and its only real
// job — is what to print when a value is missing, and the answer is always the same one:
//
//   "—". Never 0.0 km, never 0 km/h, never "00:00". An unstarted task has no speed on task; a
//   glider at a standstill has no ETA; an AAT whose minimum time has expired has no required
//   speed. A zero in any of those boxes is a measurement that was never taken, wearing the
//   clothes of one that was (POT-007). The pilot who glances at "0 km/h on task" and reads it
//   as bad news is being lied to by a rounding of null.

import { scoredDistanceM, type Task, type TaskProgress, type AatProgress } from '../core/task';
import { isAat, type TaskStats } from '../core/taskstats';

/** Waypoint names come from the pilot's own file and we did not write it. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The rule of the file, once, in one place. */
export const DASH = '—';
const shown = (v: string | null): string => v ?? DASH;

const kmText = (m: number | null): string | null =>
  m == null ? null : `${(m / 1000).toFixed(1)} km`;

/** Speed on task in km/h, because that is the unit the pilot's task sheet, his club and his
 *  competition all speak — core keeps m/s and the conversion happens here, at the glass. */
const kmhText = (ms: number | null): string | null =>
  ms == null ? null : `${(ms * 3.6).toFixed(0)} km/h`;

/** h:mm:ss, so an ETA and an elapsed time read as clock time rather than as a pile of seconds.
 *  Under an hour it drops to m:ss — a two-hour ETA and a two-minute one must not look alike. */
function durText(s: number | null): string | null {
  if (s == null) return null;
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, sec = total % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** TSK-006's whole message is the SIGN, so the sign is never dropped: + means the task, flown
 *  on as it has been flown, runs LONG against the minimum time (there is room to extend into
 *  the areas); − means it comes home early, which on an AAT is distance thrown away. A true
 *  minus (U+2212), not a hyphen, so the two are told apart at a glance. */
function overUnderText(s: number | null): string | null {
  if (s == null) return null;
  const t = durText(Math.abs(s));
  return `${s < 0 ? '−' : '+'}${t}`;
}

const fig = (label: string, value: string | null): string =>
  `<span class="tsk-fig"><span class="tsk-label">${label}</span> `
  + `<span class="tsk-val${value == null ? ' tsk-unknown' : ''}">${shown(value)}</span></span>`;

/** The ribbon: the point chain as it always was, then what the task still owes.
 *
 *  `s` may be null (no fix yet, no stats computed) and every figure then dashes out — which is
 *  exactly right, and is why the panel is still DRAWN: a ribbon that vanished when it had
 *  nothing to say would teach the eye to stop looking at that strip of screen, and the eye keeps
 *  not-looking on the day the strip finally matters. */
export function taskRibbonHtml(
  t: Task | null, p: TaskProgress | null, a: AatProgress | null, s: TaskStats | null,
): string {
  if (!t || !p) return '';

  const chain = t.points.map((pt, i) => {
    const done = p.validatedAt[i] != null;
    const current = i === p.next;
    return `<span class="tsk-pt${done ? ' done' : ''}${current ? ' current' : ''}">${esc(pt.wp.name)}</span>`;
  }).join(' → ');

  // The scorer's number, asked of the scorer. The ribbon does not keep a second opinion about
  // distance flown, and a missing AAT progress is a missing answer, not a zero.
  const scored = a ? scoredDistanceM(t, p, a) : null;

  const figs = [
    fig('scored', kmText(scored)),
    fig('left', kmText(s?.remainingM ?? null)),
    fig('ETA', durText(s?.etaS ?? null)),
    fig('elapsed', durText(s?.elapsedS ?? null)),
    fig('on task', kmhText(s?.achievedMs ?? null)),
    // TSK-007 asks for the speed achieved AND the speed required, on every task and permanently.
    // It used to appear only on an AAT, so a pilot on an ordinary racing task — the commonest
    // task there is — was shown no answer at all to "am I fast enough to get home in time", not
    // even a dash. It is present here always: dashed until a task time is entered, which is the
    // app admitting it was not told the number rather than quietly dropping the question.
    fig('required', kmhText(s?.requiredMs ?? null)),
  ];
  // The over/under stays AAT-only, because only on an AAT is coming home early a mistake with a
  // remedy: the pilot spends the spare time by flying deeper into the areas. On a racing task
  // there is nowhere to spend it, and the figure would be an instruction with no action.
  if (isAat(t)) figs.push(fig('vs min time', overUnderText(s?.overUnderS ?? null)));

  const complete = p.next >= t.points.length ? ' <span class="tsk-done">COMPLETE</span>' : '';
  return `<div class="tsk">Task (${esc(t.rules)}): ${chain}${complete} ${figs.join(' ')}</div>`;
}
