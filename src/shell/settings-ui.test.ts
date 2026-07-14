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
import {
  settingsHtml, unitsHtml, gliderHtml, pagesHtml, languageHtml, commits, COMMIT_ON,
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

// ---- IHM-001 / IHM-002 ----

test('IHM-001: every box in the registry is reachable — a row, or the add list of that page', () => {
  const s = settings();
  const html = pagesHtml(s, t);
  for (const page of s.pages) {
    const open = html.indexOf(`data-page="${page.id}"`);
    const end = html.indexOf('</section>', open);
    const block = html.slice(open, end);
    for (const def of BOXES) {
      const onPage = count(block, `data-act="box-remove" data-page="${page.id}" data-id="${def.id}"`);
      const addable = count(block, `<option value="${def.id}" data-id="${def.id}">`);
      // Exactly one of the two, never both, never neither: a box the registry defines but that this
      // screen cannot reach is a feature the pilot does not have.
      expect(`${def.id}: ${onPage + addable}`).toBe(`${def.id}: 1`);
    }
  }
});

test('IHM-002: pages render in order, boxes in order, and one page is marked active', () => {
  const s = settings();
  const html = pagesHtml(s, t);
  const pageOrder = [...html.matchAll(/<section class="settings-page[^"]*" data-page="([^"]+)"/g)].map(m => m[1]);
  expect(pageOrder).toEqual(s.pages.map(p => p.id));

  for (const page of s.pages) {
    const open = html.indexOf(`data-page="${page.id}"`);
    const end = html.indexOf('</select>', open);
    const block = html.slice(open, end);
    const rows = [...block.matchAll(/data-act="box-remove" data-page="[^"]+" data-id="([^"]+)"/g)].map(m => m[1]);
    expect(rows).toEqual(page.boxIds);
    // Every row carries the whole triple — a box that can be removed but not moved is half a
    // configuration.
    for (const id of page.boxIds) {
      expect(block).toContain(`data-act="box-up" data-page="${page.id}" data-id="${id}"`);
      expect(block).toContain(`data-act="box-down" data-page="${page.id}" data-id="${id}"`);
    }
  }
  expect(count(html, 'aria-current="true"')).toBe(1);
  expect(html).toContain(`data-page="${s.activePageId}" aria-current="true"`);
});

test('IHM-002: the marker follows the active page, wherever it is', () => {
  const s = settings({ activePageId: DEFAULT_SETTINGS.pages[2]!.id });
  const html = pagesHtml(s, t);
  expect(count(html, 'aria-current="true"')).toBe(1);
  expect(html).toContain(`data-page="${s.pages[2]!.id}" aria-current="true"`);
});

test('IHM-002: a page whose boxes were reordered renders in HIS order', () => {
  const s = settings();
  const page = { ...s.pages[0]!, boxIds: [...s.pages[0]!.boxIds].reverse() };
  const html = pagesHtml(settings({ pages: [page], activePageId: page.id }), t);
  const rows = [...html.matchAll(/data-act="box-remove" data-page="[^"]+" data-id="([^"]+)"/g)].map(m => m[1]);
  expect(rows).toEqual(page.boxIds);
});

// ---- IHM-006 ----

test('IHM-006: every id this panel asks for exists in BOTH catalogues', () => {
  // The global scan in core/i18n.test.ts catches the literal t('…') calls; the unit rows and the
  // preset buttons build their ids from a QUANTITY and a UnitSystem, which the scan's regex cannot
  // see. So they are checked here, where the loop that builds them lives.
  const ids = [
    ...QUANTITIES.map(q => `quantity.${q}`),
    ...(['metric', 'imperial', 'aviation'] as const).map(sys => `settings.preset.${sys}`),
  ];
  for (const id of ids)
    for (const lang of ['en', 'fr'] as const)
      expect(`${lang}: ${id} ${id in CATALOGUES[lang]}`).toBe(`${lang}: ${id} true`);
});

test('IHM-006: in French the panel speaks French, and no English catalogue value survives', () => {
  const html = settingsHtml(settings(), fr);
  expect(html).toContain(CATALOGUES.fr['settings.title']);
  expect(html).toContain(CATALOGUES.fr['settings.units']);
  expect(html).toContain(CATALOGUES.fr['settings.glider']);
  expect(html).toContain(CATALOGUES.fr['settings.language']);
  for (const q of QUANTITIES) expect(html).toContain(CATALOGUES.fr[`quantity.${q}`]);

  // The English wording of anything the French catalogue spells differently must be GONE — a half
  // translated panel is how a pilot learns not to trust the language switch.
  const differing = (['settings.title', 'settings.units', 'settings.glider', 'settings.language',
    'settings.preset.aviation', 'settings.remove', 'settings.add'] as const)
    .filter(id => CATALOGUES.en[id] !== CATALOGUES.fr[id]);
  expect(differing.length).toBeGreaterThan(4);
  for (const id of differing) expect(html).not.toContain(`>${CATALOGUES.en[id]}<`);
});

test('IHM-006: the language list is NOT translated — it is the way out', () => {
  const html = languageHtml(settings({ lang: 'fr' }), fr);
  // A pilot who landed on a language he cannot read finds his own spelled the way he spells it.
  expect(html).toContain('English');
  expect(html).toContain('Français');
  expect(html).toContain('<option value="fr" selected>');
  expect(languageHtml(settings({ lang: 'en' }), t)).toContain('<option value="en" selected>');
});

// ---- the contract ----

test('the panel is a pure function — same value, same string, every time', () => {
  const s = settings({ glider: { libId: 'ls-4a', massKg: 420 }, units: { ...PRESETS.aviation } });
  expect(settingsHtml(s, t)).toBe(settingsHtml(s, t));
  // No clock, no counter, no random id: the second render of an unchanged settings value is
  // byte-for-byte the first, which is what lets main.ts repaint the panel after every act.
  expect(settingsHtml(s, fr)).not.toBe(settingsHtml(s, t));
});

test('every control carries a data-act, and no form wraps them', () => {
  const html = settingsHtml(settings({ glider: { libId: 'ls-4a', massKg: null } }), t);
  // The event contract, whole: main.ts hangs ONE delegated listener and reads data-act/data-id.
  for (const act of ['lang', 'unit', 'preset', 'glider', 'mass', 'box-add', 'box-up', 'box-down', 'box-remove'])
    expect(html).toContain(`data-act="${act}"`);
  // No <form>: this panel commits per control, so there is no submit to forget and no staged state
  // to lose (CFG-005).
  expect(html).not.toContain('<form');
});

test('free text cannot break the markup around it', () => {
  const html = gliderHtml(settings({ polar: { name: '<img src=x onerror=1>"', plr: '' } }), t);
  expect(html).not.toContain('<img');
});

// ---- CFG-003 reaches the mass box, in both directions ----

test('the mass box names its unit, and speaks the unit the pilot chose', () => {
  // The failure this pins: the panel above this row offered the pilot a MASS unit that could say
  // lb, while the box itself was kilograms-only and said so nowhere. A pound typed into a kilogram
  // field rescales the polar that flies the final glide, and nothing on the screen contradicts it.
  const ls4 = GLIDER_LIBRARY.find(g => g.id === 'ls-4a')!;   // published at 361 kg
  const metric = gliderHtml(settings({ glider: { libId: 'ls-4a', massKg: 480 } }), t);
  expect(metric).toContain('>kg<');
  expect(metric).toContain('value="480"');
  expect(metric).toContain(`placeholder="${ls4.refMassKg}"`);

  const imperial = gliderHtml(
    settings({ glider: { libId: 'ls-4a', massKg: 480 }, units: { ...PRESETS.imperial } }), t);
  expect(imperial).toContain('>lb<');
  expect(imperial).toContain('value="1058"');               // 480 kg, in the unit he reads
  expect(imperial).toContain('placeholder="796"');          // and so is the reference mass
  expect(imperial).not.toContain('value="480"');
  // The unit code comes from the units table, never from a word typed here.
  expect(imperial).toContain(unitFor('mass', 'imperial'));
});

test('the mass box PRINTS the band it will accept — a refusal the pilot can see coming', () => {
  // A refused mass repaints the box empty over its placeholder. A pilot who cannot see WHY reads
  // that as the app losing his input, so the panel says, before he types, what it accepts and what
  // flies if he types nothing: the polar as published, at its own reference mass.
  const html = gliderHtml(settings({ glider: { libId: 'ls-4a', massKg: null } }), t);
  expect(html).toContain('min="253"');                      // 0.7 × 361, per config.massBandKg
  expect(html).toContain('max="578"');                      // 1.6 × 361
  expect(html).toContain(CATALOGUES.en['settings.glider.massBand']
    .replace('{ref}', '361').replace(/\{unit\}/g, 'kg').replace('{min}', '253').replace('{max}', '578'));
});

// ---- a click is not a choice ----

test('every act commits on the event its CONTROL actually speaks — a click is not a choice', () => {
  // The failure this pins: main.ts bound the same handler to `change` AND `click`, and the handler
  // never asked which had fired. So tapping the mass box to type into it committed the empty box
  // and repainted the panel through innerHTML — the input was destroyed under the pilot's finger,
  // and a mass could not be typed at all. Tapping the glider list to browse it re-ran the 'glider'
  // case, which clears `polar` and `massKg`: an imported .plr erased by a click that chose nothing.
  const html = settingsHtml(settings({ glider: { libId: 'ls-4a', massKg: null } }), t);

  // Walk the RENDERED panel — every control, whatever tag it wears — rather than a list retyped
  // here. A control that grows an act this table does not know commits on nothing, and fails here.
  const controls = [...html.matchAll(/<(select|input|button)\b[^>]*data-act="([^"]+)"/g)];
  expect(controls.length).toBeGreaterThan(5);
  for (const [, tag, act] of controls) {
    const expected = tag === 'button' ? 'click' : 'change';
    expect(`${act} commits on ${COMMIT_ON[act!]}`).toBe(`${act} commits on ${expected}`);
    expect(commits(act!, expected)).toBe(true);
    expect(commits(act!, expected === 'click' ? 'change' : 'click')).toBe(false);
  }
  // And an act nobody rendered commits on nothing: an injected control cannot write settings.
  expect(commits('nonsense', 'click')).toBe(false);
  expect(commits('nonsense', 'change')).toBe(false);
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
