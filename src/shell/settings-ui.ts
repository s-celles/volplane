// ============ the settings panel (CFG-002, CFG-003, CFG-005, IHM-001/002/006) ============
// The screen the pilot makes his own. infobox-ui renders what he flies with; this renders the
// choosing of it — and under the same contract: a value and a translator in, an HTML string out.
// No document, no listeners, no persistence. main.ts hangs ONE delegated listener on the
// container and reads data-act (what he did) and data-id (to what), the shelf-ui contract; that
// is why the whole panel can be repainted after every change without a single dead control, and
// why bun test can pin every claim below without a browser.
//
// There is no <form> here on purpose. A form has a submit, and a submit has a moment where the
// screen and the settings disagree. This panel commits PER CONTROL: he changes the altitude row,
// the altitude row is what he flies with tomorrow (CFG-005). Nothing is staged, so nothing can be
// lost by forgetting to press a button that does not exist.
//
// Two disciplines hold the panel to its registries:
//
//  · The quantities come from units.QUANTITIES and the boxes from infobox.BOXES. Not from a list
//    spelled again here. A quantity the core grows, or a box a release adds, appears on this
//    screen with no edit to this file — and the tests below fail if it ever stops being true.
//    A picker that does not offer what the registry defines is a feature the pilot cannot reach.
//
//  · Every word goes through the catalogue (IHM-006). Every word EXCEPT three kinds, deliberately:
//    the language names (a pilot who has landed on the wrong language must be able to read his way
//    back out, so 'Français' says Français in every catalogue), the glider names, and the class
//    designations — those last two are DATA, the library's own words, and translating a Ventus
//    would be inventing one.

import { massBandKg, type Settings } from '../core/config';
import { QUANTITIES, PRESETS, unitFor, convert, type Quantity, type UnitSystem } from '../core/units';
import { LANGS, type Lang } from '../core/i18n';
import { GLIDER_LIBRARY, byManufacturer, entryLabel, type GliderPolar } from '../core/polarlib';
import { BOXES, BOX_BY_ID, type Page } from '../core/infobox';
import type { T } from './infobox-ui';

// Glider names and imported file names are the only free text on this screen, and both come from
// outside — a library entry today, a file the pilot named himself. Everything is escaped anyway,
// on infobox-ui's reasoning: the discipline is cheaper to keep than to remember.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- IHM-006: the language ----

/** Each language under its OWN name, never translated. This is the one row on the panel that must
 *  be readable by a pilot who cannot read the panel: he tapped the wrong option, the interface is
 *  now in a language he does not speak, and the ONLY thing that can get him out is seeing his own
 *  language spelled the way he spells it. A translated list would put the exit behind the door it
 *  is the exit from. */
const LANG_NAMES: Record<Lang, string> = { en: 'English', fr: 'Français' };

export function languageHtml(s: Settings, t: T): string {
  const options = LANGS.map(l =>
    `<option value="${esc(l)}"${l === s.lang ? ' selected' : ''}>${esc(LANG_NAMES[l])}</option>`,
  ).join('');
  return `<section class="settings-section settings-language">
    <h3>${esc(t('settings.language'))}</h3>
    <select data-act="lang">${options}</select>
  </section>`;
}

// ---- CFG-003: units, one row per quantity ----

// The systems, taken from the PRESETS table rather than typed out again: the day the core learns a
// fourth one, the picker offers it. Object.keys of a Record<UnitSystem, …> is exactly the list.
const SYSTEMS = Object.keys(PRESETS) as UnitSystem[];

/** One row of the units table.
 *
 *  The option says the SYSTEM and the UNIT IT MEANS FOR THIS QUANTITY — 'aviation (kt)', not
 *  'aviation'. The word alone is a promise the pilot cannot check: 'aviation' means feet for his
 *  altitude, knots for his speed and metres per second for his vario, and no pilot should have to
 *  hold that table in his head to choose a row of it. unitFor is the ONLY place that table lives,
 *  so the label can never drift from what the value will actually do. */
function unitRowHtml(q: Quantity, chosen: UnitSystem, t: T): string {
  const options = SYSTEMS.map(sys =>
    `<option value="${esc(sys)}"${sys === chosen ? ' selected' : ''}>`
    + `${esc(t(`settings.preset.${sys}`))} (${esc(unitFor(q, sys))})</option>`,
  ).join('');
  return `<div class="settings-row settings-unit-row">
    <label>${esc(t(`quantity.${q}`))}</label>
    <select data-act="unit" data-id="${esc(q)}">${options}</select>
  </div>`;
}

/** The units section (CFG-003), iterated over QUANTITIES — never over a list this file keeps.
 *
 *  The presets are a convenience and NOT the setting: they fill every row at once, and then the
 *  pilot edits the rows he actually flies. The mixed panel — feet, knots, m/s — is the normal case
 *  in Europe, and it is precisely what no single preset can name, which is why the rows below are
 *  the truth and the buttons above them are only a shortcut to it. */
export function unitsHtml(s: Settings, t: T): string {
  const presets = SYSTEMS.map(sys =>
    `<button type="button" data-act="preset" data-id="${esc(sys)}">${esc(t(`settings.preset.${sys}`))}</button>`,
  ).join('');
  const rows = QUANTITIES.map(q => unitRowHtml(q, s.units[q], t)).join('');
  return `<section class="settings-section settings-units">
    <h3>${esc(t('settings.units'))}</h3>
    <div class="settings-presets"><span class="settings-presets-label">${esc(t('settings.preset'))}</span>${presets}</div>
    ${rows}
  </section>`;
}

// ---- CFG-002: the glider, and the truth about which polar flies ----

/** Grouped by WHO BUILT THEM, which is how a pilot looks for his own glider.
 *
 *  It used to group by FAI class, and that put 106 wings in a single list called `glider` — a pilot
 *  hunting for his ASW 20 in a scrolling native <select>, in flight, with gloves. He does not think
 *  "Standard class". He thinks "Schleicher". Nineteen gliders under one heading is a list a hand
 *  can land on; a hundred and six under `glider` is a haystack.
 *
 *  Nothing in this file decides the grouping — core/polarlib does, from soaring-data's `manufacturer`
 *  column, which is BORROWED from each aircraft's Wikidata item rather than derived. The day the
 *  commons names the PIK-20's maker, this picker regroups with no edit here. */
function groupedLibrary(): { maker: string; entries: GliderPolar[] }[] {
  return byManufacturer(GLIDER_LIBRARY);
}

/** The glider section (CFG-002): the library pick, the mass he flies it at, and — when there is
 *  one — the imported `.plr` that outranks both.
 *
 *  That last line is why this section is not just a picker. config.activePolar states the priority
 *  in code: an imported .plr beats the library pick beats the built-in default. A panel that showed
 *  a Discus selected in the picker while the pilot's ASK 21 `.plr` was quietly flying his final
 *  glide would be a lie of exactly the kind this screen exists to prevent — so when settings.polar
 *  is set, the panel SAYS so, by name, and says that the import is what wins.
 *
 *  The mass box is empty by default and its placeholder is the entry's REFERENCE mass. An empty box
 *  is not zero and it is not a guess at his ballast (POT-007): it is 'the mass this polar was
 *  published at', and the placeholder is where it says which. With no library glider picked there
 *  is no reference mass to name — the built-in default flies — so the box has nothing to offer and
 *  says so with a dash rather than with a number nobody measured. */
export function gliderHtml(s: Settings, t: T): string {
  const picked = s.glider === null
    ? null
    : GLIDER_LIBRARY.find(g => g.id === s.glider!.libId) ?? null;

  const groups = groupedLibrary().map(({ maker, entries }) => {
    // The MODEL, never the polar file's name. LK8000 wrote `Antares_18S`, `ASH-25 (PAS)` — PAS means
    // "with a passenger", which is how the glider is FLOWN, not what it IS — and, offered to a pilot
    // as an aircraft, `Discus B from Cumulus Soaring GN II`: the name of the website that
    // distributed the file. Twenty entries carried underscores. He now reads the aeroplane.
    const options = entries.map(g =>
      `<option value="${esc(g.id)}" data-id="${esc(g.id)}"${g.id === picked?.id ? ' selected' : ''}>`
      + `${esc(entryLabel(g, entries))}</option>`,
    ).join('');
    // A maker the commons does not name gets a heading that says so, not an empty one: a blank
    // optgroup label reads as a bug, and this is a fact.
    const label = maker !== '' ? maker : t('settings.glider.unknownMaker');
    return `<optgroup label="${esc(label)}">${options}</optgroup>`;
  }).join('');

  const defaultOption =
    `<option value="" data-id=""${picked === null ? ' selected' : ''}>${esc(t('settings.glider.default'))}</option>`;

  // CFG-003 reaches the mass box, in BOTH directions. The pilot reads his panel in one unit and
  // types into it in the same one: a box that printed the reference mass in pounds and then read
  // what he typed as kilograms would be the worst kind of wrong — converted-looking. So the
  // placeholder, the value and the accepted band are all rendered through the units table, the box
  // NAMES its unit beside itself (an unlabelled number is a unit the pilot has to guess), and
  // main.ts parses what comes back through the same table (config.massKgFromField).
  //
  // The band is printed rather than merely enforced. A refused mass repaints the box empty over its
  // placeholder, and a pilot who cannot see WHY would read that as the app losing his input; the
  // hint is the app saying, before he types, what it will accept and what it will fly if he types
  // nothing — the polar as published, at its own reference mass.
  const code = unitFor('mass', s.units.mass);
  const inUnit = (kg: number): string => convert(kg, 'mass', s.units.mass).toFixed(0);
  const unitTag = `<span class="settings-unit">${esc(code)}</span>`;

  let mass = `<input data-act="mass" inputmode="decimal" placeholder="—" disabled value="">${unitTag}`;
  let hint = esc(t('settings.glider.refMass'));

  if (picked !== null) {
    const { minKg, maxKg } = massBandKg(picked.refMassKg);
    mass = `<input data-act="mass" inputmode="decimal" placeholder="${esc(inUnit(picked.refMassKg))}" `
      + `min="${esc(inUnit(minKg))}" max="${esc(inUnit(maxKg))}" `
      + `value="${s.glider?.massKg == null ? '' : esc(inUnit(s.glider.massKg))}">${unitTag}`;
    hint = esc(t('settings.glider.massBand', {
      ref: inUnit(picked.refMassKg), min: inUnit(minKg), max: inUnit(maxKg), unit: code,
    }));
  }

  // The catalogue may or may not spell the file name into its sentence; the name must reach the
  // pilot either way, so it is appended when the message did not carry it. And the priority is
  // stated in the catalogue's own two words — imported OVER library — rather than in an English
  // sentence this renderer would be smuggling past the catalogue (IHM-006).
  let importedLine = '';
  if (s.polar !== null) {
    const name = s.polar.name;
    const said = t('settings.glider.imported', { name });
    const withName = said.includes(name) ? esc(said) : `${esc(said)} — ${esc(name)}`;
    importedLine = `<div class="settings-imported">${withName}
      <span class="settings-outranks">${esc(t('settings.glider.imported'))} &gt; ${esc(t('settings.glider.library'))}</span>
    </div>`;
  }

  return `<section class="settings-section settings-glider">
    <h3>${esc(t('settings.glider'))}</h3>
    ${importedLine}
    <div class="settings-row">
      <label>${esc(t('settings.glider.library'))}</label>
      <select data-act="glider">${defaultOption}${groups}</select>
    </div>
    <div class="settings-row">
      <label>${esc(t('settings.glider.mass'))}</label>
      ${mass}
      <span class="settings-hint">${hint}</span>
    </div>
  </section>`;
}

// ---- which EVENT commits which act ----

/** The event each act is a CHOICE on — and the reason it is a table rather than a habit.
 *
 *  main.ts hangs one delegated listener on the panel for `change` and one for `click`, and both
 *  used to reach the same switch with no notion of which had fired. So a plain CLICK on a control
 *  was handled as a commit of its current value: tapping the mass box to type into it re-committed
 *  the box (empty → null), applySettings repainted the whole panel through innerHTML, and the input
 *  the pilot had just focused was destroyed under his finger — the mass could not be typed at all.
 *  Tapping the glider list to browse it re-committed the CURRENT pick through a non-idempotent case
 *  that clears `polar` and `massKg`: an imported .plr silently erased, a ballasted glider silently
 *  back at its reference mass, on a click that chose nothing.
 *
 *  A click is not a choice. A <select> and an <input> speak on `change`, a <button> on `click`, and
 *  this table says so once, next to the markup that emits the acts — the test below walks the
 *  rendered panel and fails if a control ever grows an act this table does not agree with. */
export const COMMIT_ON: Record<string, 'change' | 'click'> = {
  lang: 'change',
  unit: 'change',
  glider: 'change',
  mass: 'change',
  'box-add': 'change',
  preset: 'click',
  'box-up': 'click',
  'box-down': 'click',
  'box-remove': 'click',
};

/** Whether THIS event, on THIS act, is the pilot committing something. Unknown acts commit on
 *  nothing: a control we do not know about must not be able to write settings. */
export function commits(act: string, eventType: string): boolean {
  return COMMIT_ON[act] === eventType;
}

// ---- IHM-001 / IHM-002: which boxes, in what order, on which page ----

// A row of the page's boxes: the box, and the three acts that can reach it. Up, down and remove
// carry BOTH the page and the box id, because the same box legitimately lives on several pages —
// 'vario' is on cruise and on climb — and a handler that knew only the box id would move it on
// whichever page it found first.
function boxRowHtml(page: Page, boxId: Page['boxIds'][number], t: T): string {
  // An id the registry no longer knows renders nothing at all: sanitizePages drops those on the way
  // off disk, so reaching here is a bug, and a bug that costs one row is survivable where a row
  // reading 'undefined' beside a remove button is not.
  const def = BOX_BY_ID.get(boxId);
  if (def === undefined) return '';
  const attrs = `data-page="${esc(page.id)}" data-id="${esc(boxId)}"`;
  return `<div class="settings-row settings-box-row">
    <span class="settings-box-label">${esc(t(def.labelId))}</span>
    <button type="button" data-act="box-up" ${attrs}>${esc(t('settings.moveUp'))}</button>
    <button type="button" data-act="box-down" ${attrs}>${esc(t('settings.moveDown'))}</button>
    <button type="button" data-act="box-remove" ${attrs}>${esc(t('settings.remove'))}</button>
  </div>`;
}

function pageHtml(page: Page, active: boolean, t: T): string {
  const rows = page.boxIds.map(id => boxRowHtml(page, id, t)).join('');
  // The registry is the only place a box is defined, and this select is the proof: it offers every
  // BoxDef the app ships that is not already on the page. A box added to core/infobox.ts appears
  // here without a line changing in this file — and a box that is on no page is never orphaned,
  // because it is always one tap away from being back.
  const addable = BOXES.filter(def => !page.boxIds.includes(def.id)).map(def =>
    `<option value="${esc(def.id)}" data-id="${esc(def.id)}">${esc(t(def.labelId))}</option>`,
  ).join('');
  return `<section class="settings-page${active ? ' active' : ''}" data-page="${esc(page.id)}"${
    active ? ' aria-current="true"' : ''}>
    <h4>${esc(t(page.titleId))}</h4>
    <div class="settings-boxes"><span class="settings-boxes-label">${esc(t('settings.pages.boxes'))}</span>${rows}</div>
    <select data-act="box-add" data-page="${esc(page.id)}">
      <option value="" selected>${esc(t('settings.add'))}</option>
      ${addable}
    </select>
  </section>`;
}

/** The pages, in the pilot's order, each with its boxes in the pilot's order (IHM-002).
 *
 *  The ORDER is the configuration. This file does not sort, does not group and has no opinion about
 *  which box belongs where — it renders the list it was handed, and the active page is marked
 *  because a pilot editing a page needs to know whether it is the one he is looking at in flight.
 *  Exactly one page is ever marked: config.normalizeSettings guarantees activePageId names a page
 *  that exists, so 'no page is active' is not a state this renderer has to have a story for. */
export function pagesHtml(s: Settings, t: T): string {
  const pages = s.pages.map(p => pageHtml(p, p.id === s.activePageId, t)).join('');
  return `<section class="settings-section settings-pages">
    <h3>${esc(t('settings.pages'))}</h3>
    ${pages}
  </section>`;
}

/** The whole panel. A pure function of the settings value and the language: the same value renders
 *  the same string, always — no clock, no random id, nothing the shell would have to diff around.
 *  What he chooses here is what he flies with tomorrow (CFG-005), and the writing of that down is
 *  main.ts's job: normalizeSettings, then saveSettings, on every data-act this panel emits. */
export function settingsHtml(s: Settings, t: T): string {
  return `<div class="settings">
    <h2>${esc(t('settings.title'))}</h2>
    ${languageHtml(s, t)}
    ${unitsHtml(s, t)}
    ${gliderHtml(s, t)}
    ${pagesHtml(s, t)}
  </div>`;
}
