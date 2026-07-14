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

//
// And it prints the pilot's units (CFG-003), not this file's. The distances used to be kilometres
// and the speeds km/h whatever he had chosen — the ribbon sits directly above InfoBoxes that DID
// honour his choice, so a pilot on the aviation preset read knots in the box and km/h in the
// ribbon, a metre apart. The figures are still core's; only the last centimetre is here.
import { scoredDistanceM, type Task, type TaskProgress, type AatProgress } from '../core/task';
import { isAat, type TaskStats } from '../core/taskstats';
import { formatText, type UnitPrefs } from '../core/units';
import type { T } from './infobox-ui';

/** Waypoint names come from the pilot's own file and we did not write it. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The rule of the file, once, in one place. */
export const DASH = '—';
const shown = (v: string | null): string => v ?? DASH;

const distText = (m: number | null, u: UnitPrefs): string | null =>
  m == null ? null : formatText(m, 'distance', u.distance);

/** Speed on task, in the unit the pilot chose to read speed in — core keeps m/s and the conversion
 *  happens here, at the glass, through the one table. His task sheet may well say km/h; that is a
 *  reason for km/h to be the DEFAULT, not a reason for the ribbon to overrule him. */
const speedText = (ms: number | null, u: UnitPrefs): string | null =>
  ms == null ? null : formatText(ms, 'speed', u.speed);

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
  task: Task | null, p: TaskProgress | null, a: AatProgress | null, s: TaskStats | null,
  u: UnitPrefs, t: T,
): string {
  if (!task || !p) return '';

  const chain = task.points.map((pt, i) => {
    const done = p.validatedAt[i] != null;
    const current = i === p.next;
    return `<span class="tsk-pt${done ? ' done' : ''}${current ? ' current' : ''}">${esc(pt.wp.name)}</span>`;
  }).join(' → ');

  // The scorer's number, asked of the scorer. The ribbon does not keep a second opinion about
  // distance flown, and a missing AAT progress is a missing answer, not a zero.
  const scored = a ? scoredDistanceM(task, p, a) : null;

  const figs = [
    fig(t('task.scored'), distText(scored, u)),
    fig(t('task.left'), distText(s?.remainingM ?? null, u)),
    fig(t('task.eta'), durText(s?.etaS ?? null)),
    fig(t('task.elapsed'), durText(s?.elapsedS ?? null)),
    fig(t('task.onTask'), speedText(s?.achievedMs ?? null, u)),
    // TSK-007 asks for the speed achieved AND the speed required, on every task and permanently.
    // It used to appear only on an AAT, so a pilot on an ordinary racing task — the commonest
    // task there is — was shown no answer at all to "am I fast enough to get home in time", not
    // even a dash. It is present here always: dashed until a task time is entered, which is the
    // app admitting it was not told the number rather than quietly dropping the question.
    fig(t('task.required'), speedText(s?.requiredMs ?? null, u)),
  ];
  // The over/under stays AAT-only, because only on an AAT is coming home early a mistake with a
  // remedy: the pilot spends the spare time by flying deeper into the areas. On a racing task
  // there is nowhere to spend it, and the figure would be an instruction with no action.
  if (isAat(task)) figs.push(fig(t('task.vsMinTime'), overUnderText(s?.overUnderS ?? null)));

  const complete = p.next >= task.points.length
    ? ` <span class="tsk-done">${esc(t('task.complete'))}</span>` : '';
  return `<div class="tsk">${esc(t('task.title'))} (${esc(task.rules)}): ${chain}${complete} ${figs.join(' ')}</div>`;
}

// ============ TSK-002/008/009: the task the pilot BUILDS ============
// Pure, like every renderer here: waypoints and a translator in, an HTML string out. No document, no
// listeners, no persistence. main.ts hangs ONE delegated listener on the container and reads
// data-act and data-i — the shelf-ui contract — which is why the whole screen can repaint after
// every edit without a single dead control.
//
// It is a TAB, not a settings section, and that is TSK-008: a task is edited IN FLIGHT. The day
// starts differently from the briefing, the second turnpoint is under cloud, and the pilot rebuilds
// his task at 1500 metres. A builder he can only reach on the ground is a builder he cannot use.

import { taskProblems, taskLengthM, RULE_VERSIONS } from '../core/taskedit';
import type { Waypoint, RulesVersion } from '../core/task';
import type { Poi } from 'soaring-core/poi';
import { format } from '../core/units';

function escT(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface TaskEditor {
  wps: readonly Waypoint[];
  rules: RulesVersion;
  /** The waypoint database the pilot picks from — his own `.cup`. Empty when he has loaded none, and
   *  the screen SAYS so rather than showing an empty picker that looks broken. */
  pois: readonly Poi[];
  /** What he has typed into the search box. The list is filtered, not paginated: a pilot looking for
   *  ROMORANTIN types four letters and sees it, and a "next page" button in a cockpit is a button
   *  nobody presses. */
  query: string;
  units: UnitPrefs;
}

/** TSK-002: the ordered task, the picker, and TSK-009's verdict — which names what is wrong rather
 *  than merely saying that something is. */
export function taskEditorHtml(e: TaskEditor, t: T): string {
  const problems = taskProblems(e.wps);
  const lengthM = taskLengthM(e.wps);

  const rows = e.wps.map((wp, i) => {
    // The role each point plays is the KERNEL's decision (simpleTask): first is the start, last is
    // the finish, the rest are turnpoints. It is shown, not chosen — a pilot who could label a point
    // 'start' independently of its position would have two answers to one question.
    const role = i === 0 ? t('task.role.start')
      : i === e.wps.length - 1 ? t('task.role.finish')
      : t('task.role.turn');
    const broken = problems.some(p => p.index === i);
    return `<div class="task-row${broken ? ' broken' : ''}">
      <span class="task-role">${escT(role)}</span>
      <span class="task-name">${escT(wp.name)}</span>
      <button type="button" data-act="up" data-i="${i}">${escT(t('task.up'))}</button>
      <button type="button" data-act="down" data-i="${i}">${escT(t('task.down'))}</button>
      <button type="button" data-act="remove" data-i="${i}">${escT(t('task.remove'))}</button>
    </div>`;
  }).join('');

  // The picker. A `.cup` holds thousands of points and a cockpit holds one thumb, so the list is
  // filtered by what he typed and capped — and the cap is SAID, because a list that silently stops
  // at twenty reads as a database with twenty points in it.
  const q = e.query.trim().toLowerCase();
  const hits = q === '' ? [] : e.pois.filter(p => p.name.toLowerCase().includes(q));
  const CAP = 20;
  const shown = hits.slice(0, CAP);
  const picker = e.pois.length === 0
    ? `<p class="task-empty">${escT(t('task.noPoints'))}</p>`
    : `<input id="task-q" class="task-q" value="${escT(e.query)}" placeholder="${escT(t('task.search'))}" />
       ${shown.map(p =>
         `<button type="button" class="task-hit" data-act="add" data-name="${escT(p.name)}">${escT(p.name)}</button>`,
       ).join('')}
       ${hits.length > CAP
         ? `<p class="task-more">${escT(t('task.more', { n: hits.length - CAP }))}</p>`
         : ''}`;

  const trouble = problems.map(p =>
    `<li class="task-problem">${escT(t(p.id, p.params))}</li>`).join('');

  const rulesPicker = RULE_VERSIONS.map(v =>
    `<option value="${escT(v)}"${v === e.rules ? ' selected' : ''}>${escT(v)}</option>`).join('');

  const len = lengthM === null ? null : format(lengthM, 'distance', e.units.distance);

  return `<h2>${escT(t('task.editor.title'))}</h2>
    <div class="task-head">
      <label>${escT(t('task.rules'))} <select data-act="rules">${rulesPicker}</select></label>
      <span class="task-length">${len === null
        ? `<span class="task-none">${escT(t('task.none'))}</span>`
        : `${escT(t('task.length'))} <strong>${escT(len.text)}</strong> ${escT(len.unit)}`}</span>
      ${e.wps.length > 0 ? `<button type="button" data-act="clear">${escT(t('task.clear'))}</button>` : ''}
    </div>
    ${trouble ? `<ul class="task-problems">${trouble}</ul>` : ''}
    <div class="task-rows">${rows}</div>
    <div class="task-picker">${picker}</div>`;
}
