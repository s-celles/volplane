// What the task ribbon promises the pilot (TSK-007, TSK-006).
//
// The renderer is the last centimetre before the eye, and it is the last place an honest null
// can still turn into a lie. Six figures on this line, five of them undefined before the start
// gate — and every one of them has a natural-looking zero waiting to be printed instead. So
// these tests pin the CLAIMS: the dash, the sign, the absence of a fabricated "0.0 km", the
// fact that the AAT figures do not appear on a task that has no assigned area.
import { test, expect } from 'bun:test';
import { simpleTask, aatTask, freshProgress, freshAat, type Waypoint } from '../core/task';
import { taskStats, type TaskStats } from '../core/taskstats';
import { taskRibbonHtml as taskRibbonHtmlT, DASH } from './task-ui';
import { translator } from '../core/i18n';
import { PRESETS } from '../core/units';

const en = translator('en');
// Metric unless a test says otherwise — km and km/h are what these claims were written in, and
// they are now a CHOICE (CFG-003) rather than this file's assumption. The choice is pinned below.
const METRIC = PRESETS.metric;
const taskRibbonHtml = (
  a: Parameters<typeof taskRibbonHtmlT>[0], b: Parameters<typeof taskRibbonHtmlT>[1],
  c: Parameters<typeof taskRibbonHtmlT>[2], d: Parameters<typeof taskRibbonHtmlT>[3],
): string => taskRibbonHtmlT(a, b, c, d, METRIC, en);

const S: Waypoint = { name: 'START', lon: 6.0, lat: 46.0 };
const T1: Waypoint = { name: 'TP1', lon: 6.0, lat: 46.4 };
const F: Waypoint = { name: 'FINISH', lon: 6.0, lat: 46.8 };

const NOTHING: TaskStats = {
  remainingM: null, achievedMs: null, etaS: null, elapsedS: null,
  overUnderS: null, requiredMs: null,
};

test('with no task there is no ribbon', () => {
  expect(taskRibbonHtml(null, null, null, null)).toBe('');
});

test('an unstarted task prints dashes, and not one fabricated zero', () => {
  const t = simpleTask([S, T1, F]);
  const html = taskRibbonHtml(t, freshProgress(t), freshAat(t), NOTHING);
  // The chain is there, and the first point is the one to fly.
  expect(html).toContain('START');
  expect(html).toContain('class="tsk-pt current"');
  // Nothing scored, nothing owed, nothing flown — said as absence, five times over.
  expect(html.split(DASH).length - 1).toBeGreaterThanOrEqual(5);
  // The lie this whole file exists to prevent: a null distance rounding to a plausible zero.
  expect(html).not.toContain('0.0 km');
  expect(html).not.toContain('0 km/h');
  expect(html).not.toContain('0:00');
});

test('a task in progress prints what it owes, in the pilot\'s units', () => {
  const t = simpleTask([S, T1, F]);
  const p = { next: 2, validatedAt: [36000, 37800, null] };
  const s = taskStats(t, p, freshAat(t), { lon: T1.lon, lat: T1.lat, sod: 37800 });
  const html = taskRibbonHtml(t, p, freshAat(t), s);
  expect(html).toContain('30:00');                 // 1800 s elapsed, as clock time
  expect(html).toContain('km/h');                  // speed on task, converted at the glass
  expect(html).toContain('class="tsk-pt done"');   // the start is signed off
  // TSK-007's "required" is drawn on EVERY task, permanently — dashed here, because no task time
  // was given, which is the app admitting it was not told rather than dropping the question.
  expect(html).toContain('required');
  expect(html).toContain(DASH);
});

test('TSK-007: a racing task with a task time shows the REQUIRED speed, not a dash', () => {
  // The Must names both halves — achieved AND required — and does not qualify them by task type.
  // A racing pilot with the organisers' task time in the box gets his answer.
  const t = simpleTask([S, T1, F]);
  const p = { next: 2, validatedAt: [36000, 37800, null] };
  const s = taskStats(t, p, freshAat(t), { lon: T1.lon, lat: T1.lat, sod: 37800 },
                      { minTaskTimeS: 10800 });
  const html = taskRibbonHtml(t, p, freshAat(t), s);
  expect(html).toContain('required');
  expect(html).toMatch(/required<\/span> <span class="tsk-val">\d+ km\/h/);
});

test('the AAT pair appears on an AAT and nowhere else, and its sign is the message', () => {
  const aat = aatTask([S, T1, F]);
  const p = { next: 2, validatedAt: [36000, 41400, null] };
  const a = [null, { lon: T1.lon, lat: T1.lat }, null];
  const early = taskStats(aat, p, a, { lon: T1.lon, lat: T1.lat, sod: 41400 }, { minTaskTimeS: 14400 });
  const html = taskRibbonHtml(aat, p, a, early);
  expect(html).toContain('required');
  // Home before the minimum time: a true minus sign, so it cannot be misread as a separator.
  expect(early.overUnderS!).toBeLessThan(0);
  expect(html).toContain('−');

  // The over/under is the AAT-only half, and it is not drawn on an assigned task: there, coming
  // home early is not a mistake with a remedy. The required speed, by contrast, IS drawn there —
  // TSK-007 asks for it on every task (see the racing-task test above).
  const assigned = simpleTask([S, T1, F]);
  const plain = taskRibbonHtml(assigned, freshProgress(assigned), freshAat(assigned), NOTHING);
  expect(plain).not.toContain('vs min time');
  expect(plain).toContain('required');
});

test('a waypoint name from the pilot\'s own file cannot become markup', () => {
  const t = simpleTask([{ name: '<b>Étoile</b>', lon: 6, lat: 46 }, T1, F]);
  const html = taskRibbonHtml(t, freshProgress(t), freshAat(t), NOTHING);
  expect(html).toContain('&lt;b&gt;Étoile&lt;/b&gt;');
  expect(html).not.toContain('<b>');
});

// ---- CFG-003: the ribbon reads in the units the pilot chose ----

test('the ribbon honours the pilot\'s units — it sits above boxes that already did', () => {
  // The failure this pins: the InfoBoxes a centimetre below the ribbon printed knots while the
  // ribbon printed km/h, because the ribbon's km and km/h were baked into it. His task sheet may
  // well say km/h — that is a reason for km/h to be the default, not a reason to overrule him.
  const p = freshProgress(simpleTask([S, T1, F]));
  const s: TaskStats = { ...NOTHING, remainingM: 48_000, achievedMs: 26.4 };
  const aviation = taskRibbonHtmlT(simpleTask([S, T1, F]), p, null, s, PRESETS.aviation, en);
  expect(aviation).toContain('25.9 NM');
  expect(aviation).toContain('51 kt');
  expect(aviation).not.toContain('48.0 km');
  expect(aviation).not.toContain('95 km/h');
  // Metric is still metric: the default did not move, it merely stopped being the only option.
  const metric = taskRibbonHtmlT(simpleTask([S, T1, F]), p, null, s, PRESETS.metric, en);
  expect(metric).toContain('48.0 km');
  expect(metric).toContain('95 km/h');
  // An unknown is still a dash, in every unit — a null does not become '0 kt' on the way through.
  expect(taskRibbonHtmlT(simpleTask([S, T1, F]), p, null, NOTHING, PRESETS.aviation, en))
    .toContain(DASH);
});
