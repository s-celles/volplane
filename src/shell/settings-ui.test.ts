// What these tests pin is what the pilot is ENTITLED to see when he opens the panel: every
// quantity he can choose a unit for, every glider the library ships, every box the registry
// defines — and the truth about which polar is actually flying. They assert against the
// registries, never against a list copied here: a test that spelled the eight quantities out
// again would pass on the day the ninth one silently failed to appear.
import { test, expect } from 'bun:test';
import { DEFAULT_SETTINGS, type Settings } from '../core/config';
import { QUANTITIES, PRESETS, unitFor } from '../core/units';
import { CATALOGUES, translator } from '../core/i18n';
import { GLIDER_LIBRARY } from '../core/polarlib';
import { BOXES } from '../core/infobox';
import { PHASES } from '../core/layout';
import {
  settingsHtml, unitsHtml, gliderHtml, layoutHtml, languageHtml, commits, COMMIT_ON,
} from './settings-ui';

const t = translator('en');
const fr = translator('fr');

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** The chunk of HTML from one `data-act="unit"` select to the end of that select — enough to ask
 *  what a single row offers and what it has selected, without a DOM. */
function unitSelect(html: string, quantity: string): string {
  const open = html.indexOf(`data-act="unit" data-id="${quantity}"`);
  expect(open).toBeGreaterThan(-1);
  const end = html.indexOf('</select>', open);
  return html.slice(open, end);
}

const selectedOf = (fragment: string): string => {
  const m = fragment.match(/<option value="([^"]+)" selected>/);
  return m === null ? '' : m[1]!;
};

// ---- CFG-003 ----

test('CFG-003: exactly one unit select per QUANTITY, and it names the quantity', () => {
  const html = unitsHtml(settings(), t);
  expect(count(html, 'data-act="unit"')).toBe(QUANTITIES.length);
  for (const q of QUANTITIES) expect(count(html, `data-act="unit" data-id="${q}"`)).toBe(1);
});

test('CFG-003: each row shows the SETTINGS value for that quantity, and moves alone', () => {
  const base = settings({ units: { ...PRESETS.metric } });
  for (const q of QUANTITIES) expect(selectedOf(unitSelect(unitsHtml(base, t), q))).toBe('metric');

  // One quantity changed in the value — one row changed on the screen. This is the whole point of
  // per-quantity units: choosing feet for the altitude must not move the vario the pilot never
  // touched (the mixed panel is the normal case, not an accident).
  const mixed = settings({ units: { ...PRESETS.metric, altitude: 'aviation' } });
  const html = unitsHtml(mixed, t);
  expect(selectedOf(unitSelect(html, 'altitude'))).toBe('aviation');
  for (const q of QUANTITIES) {
    if (q === 'altitude') continue;
    expect(selectedOf(unitSelect(html, q))).toBe('metric');
  }
});

test('CFG-003: every option NAMES the unit it means for that quantity', () => {
  const html = unitsHtml(settings(), t);
  // 'aviation' means nothing; 'aviation (ft)' means everything — and it means something DIFFERENT
  // on each row, which is exactly what the pilot cannot be expected to know by heart.
  expect(unitSelect(html, 'altitude')).toContain('(ft)');
  expect(unitSelect(html, 'speed')).toContain('(kt)');
  expect(unitSelect(html, 'vario')).toContain('(m/s)');
  // And it is the units table that says so, not this renderer's memory of it.
  for (const q of QUANTITIES) {
    const row = unitSelect(html, q);
    for (const sys of ['metric', 'imperial', 'aviation'] as const) {
      expect(row).toContain(`(${unitFor(q, sys)})`);
    }
  }
});

test('CFG-003: the presets fill every row at once, and each is one act', () => {
  const html = unitsHtml(settings(), t);
  for (const sys of ['metric', 'imperial', 'aviation'] as const) {
    expect(count(html, `data-act="preset" data-id="${sys}"`)).toBe(1);
  }
});

// ---- CFG-002 ----

test('CFG-002: every library glider appears exactly once, grouped by WHO BUILT IT', () => {
  // It used to group by FAI class, which put 106 wings in a single list called `glider`. A pilot
  // hunting for his ASW 20 in a scrolling native <select>, in flight, one-handed, was expected to
  // find it there. He does not think "Standard class". He thinks "Schleicher".
  const html = gliderHtml(settings(), t);
  for (const g of GLIDER_LIBRARY) expect(count(html, `data-id="${g.id}"`)).toBe(1);
  const makers = [...new Set(GLIDER_LIBRARY.map(g => g.manufacturer))];
  expect(count(html, '<optgroup')).toBe(makers.length);
  expect(html).toContain('<optgroup label="Alexander Schleicher GmbH &amp; Co">');
  // The biggest group is now a list a hand can land on, not a haystack.
  const biggest = Math.max(...makers.filter(m => m !== '')
    .map(m => GLIDER_LIBRARY.filter(g => g.manufacturer === m).length));
  expect(biggest).toBeLessThan(40);
});

test('the pilot reads the AIRCRAFT, never the polar file', () => {
  // LK8000 wrote `Antares_18S`, and `ASH-25 (PAS)` — PAS means "with a passenger", which is how the
  // glider is FLOWN, not what it IS. And, offered to a pilot as an aircraft: `Discus B from Cumulus
  // Soaring GN II`, the name of the WEBSITE that distributed the file. This was on the screen.
  const html = gliderHtml(settings(), t);
  expect(html).not.toContain('Cumulus Soaring');
  expect(html).not.toContain('_18S');
  expect(html).not.toContain('(PAS)');
  expect(html).toContain('>Antares 18S<');
  // The ASH-25 appears twice — one loaded with a passenger, one not — so it carries the loading that
  // tells them apart. The suffix that was stripped was ugly AND was carrying a fact.
  expect(html).toMatch(/>ASH-25 — \d+ kg</);
});

test('a maker the commons does not name says so — an empty heading reads as a bug', () => {
  const html = gliderHtml(settings(), t);
  expect(html).not.toContain('<optgroup label="">');
  expect(html).toContain(t('settings.glider.unknownMaker'));
});

test('CFG-002: the picked glider is selected, and its reference mass is the placeholder', () => {
  const ls4 = GLIDER_LIBRARY.find(g => g.id === 'ls-4a')!;
  const html = gliderHtml(settings({ glider: { libId: 'ls-4a', massKg: null } }), t);
  expect(html).toContain(`data-id="ls-4a" selected`);
  // An empty mass box is 'the reference mass', not zero — and the placeholder is where it says so
  // (POT-007: we never invent the pilot's ballast).
  expect(html).toContain(`placeholder="${ls4.refMassKg}"`);
  expect(count(html, ' selected')).toBe(1);
});

test('CFG-002: with no library pick the default entry is selected', () => {
  const html = gliderHtml(settings({ glider: null }), t);
  expect(html).toContain(`<option value="" data-id="" selected>`);
  expect(html).toContain(CATALOGUES.en['settings.glider.default']);
  expect(count(html, ' selected')).toBe(1);
});

test('CFG-002: the mass he flies at today is shown, not re-invented', () => {
  const html = gliderHtml(settings({ glider: { libId: 'ls-4a', massKg: 420 } }), t);
  expect(html).toContain('value="420"');
});

test('CFG-002: an imported .plr is NAMED, and the panel says it is what flies', () => {
  const s = settings({
    polar: { name: 'my-ls8.plr', plr: '350, 190, 100.0, -0.65, 120.0, -0.85, 150.0, -1.45, 11.45\n' },
    glider: { libId: 'discus-2a', massKg: null },
  });
  const html = gliderHtml(s, t);
  // The picker still shows the Discus — he chose it — but the screen must not let that stand as the
  // answer to 'what am I flying', because activePolar flies the imported file. The name and the
  // priority are both on the screen.
  expect(html).toContain('my-ls8.plr');
  expect(html).toContain(CATALOGUES.en['settings.glider.imported']);
  expect(html).toContain('settings-outranks');
  expect(html).toContain(CATALOGUES.en['settings.glider.library']);

  // And with no import, no such claim is made.
  expect(gliderHtml(settings({ glider: { libId: 'discus-2a', massKg: null } }), t))
    .not.toContain('settings-imported');
});

// ---- IHM-001 / IHM-002: the three phase rows ----
//
// There was never a `pages` concept in this app. The three default pages were called cruise, climb
// and finalGlide, and the three flight PHASES are circling, cruise and final glide. They were the
// same three things, and the pilot was driving one of them by hand while the app silently knew the
// other. A LAYOUT is exactly the three rows.

test('IHM-001: every box in the registry is reachable — in a row, or in that row\'s add list', () => {
  const s = settings();
  const html = layoutHtml(s, t);
  for (const phase of PHASES) {
    const open = html.indexOf(`data-page="${phase}"`);
    const end = html.indexOf('</section>', open);
    const block = html.slice(open, end);
    for (const def of BOXES) {
      const inRow = count(block, `data-act="box-remove" data-page="${phase}" data-id="${def.id}"`);
      const addable = count(block, `<option value="${def.id}" data-id="${def.id}">`);
      // Exactly one of the two, never both, never neither: a box the registry defines but that this
      // screen cannot reach is a feature the pilot does not have.
      expect(`${def.id}: ${inRow + addable}`).toBe(`${def.id}: 1`);
    }
  }
});

test('IHM-002: the rows render in phase order, the boxes in HIS order', () => {
  const s = settings();
  const html = layoutHtml(s, t);
  const order = [...html.matchAll(/<section class="settings-page[^"]*" data-page="([^"]+)"/g)].map(m => m[1]);
  expect(order).toEqual([...PHASES]);

  for (const phase of PHASES) {
    const open = html.indexOf(`data-page="${phase}"`);
    const end = html.indexOf('</select>', open);
    const block = html.slice(open, end);
    const rows = [...block.matchAll(/data-act="box-remove" data-page="[^"]+" data-id="([^"]+)"/g)].map(m => m[1]);
    expect(rows).toEqual(s.layout.phases[phase]);
    // Every row carries the whole triple — a box that can be removed but not moved is half a
    // configuration.
    for (const id of s.layout.phases[phase]) {
      expect(block).toContain(`data-act="box-up" data-page="${phase}" data-id="${id}"`);
      expect(block).toContain(`data-act="box-down" data-page="${phase}" data-id="${id}"`);
    }
  }
});

test('the ACTIVE row is marked only when the pilot is picking it himself', () => {
  // With autoPhase on, the machine picks the row and no row is "the one he is on" — marking one would
  // be a claim about a choice he did not make.
  expect(count(layoutHtml(settings({ autoPhase: true }), t), 'aria-current="true"')).toBe(0);
  const off = layoutHtml(settings({ autoPhase: false, manualPhase: 'finalGlide' }), t);
  expect(count(off, 'aria-current="true"')).toBe(1);
  expect(off).toContain('data-page="finalGlide" aria-current="true"');
});

test('AND THE EDITOR IS REACHABLE, ALWAYS — nothing here is gated on being airborne', () => {
  // Gliders have two seats. The person editing is often not the person flying: an instructor
  // reconfigures the front pilot's screen as a matter of course, and a solo pilot in a stable cruise
  // is perfectly able to move a box. An app that decides when a pilot may touch his own instrument
  // has substituted its judgement for his. Workload is a reason to design this WELL.
  const html = layoutHtml(settings(), t);
  expect(html).toContain('data-act="box-remove"');
  expect(html).toContain('data-act="box-add"');
  expect(html).not.toContain('disabled title');       // no in-flight lock, and none to add later
});

test('THE SECOND DOOR: the layout goes out to a file, and comes back from one', () => {
  // What the file buys, on top of the editor, is everything an editor cannot: a layout you can read,
  // diff, keep in version control, hand to a club-mate, or open in whatever you already use.
  const html = layoutHtml(settings(), t);
  expect(html).toContain('id="layout-file"');
  expect(html).toContain('data-act="layout-export"');
  expect(commits('layout-export', 'click')).toBe(true);
});

test('the phase toggle SPEAKS — a checkbox left out of COMMIT_ON would tick and do nothing', () => {
  // Unknown acts commit on nothing, which is the right default and the reason this table exists.
  // It is also how a control ends up rendering, being tickable, and silently writing no setting —
  // and a control that looks like it works is worse than one that is missing.
  expect(commits('auto-phase', 'change')).toBe(true);
  expect(commits('auto-phase', 'click')).toBe(false);
});

test('the pilot can take the phase away from the machine', () => {
  const on = settingsHtml({ ...DEFAULT_SETTINGS, autoPhase: true }, t);
  const off = settingsHtml({ ...DEFAULT_SETTINGS, autoPhase: false }, t);
  expect(on).toContain('data-act="auto-phase" checked');
  expect(off).toContain('data-act="auto-phase" />');
});
