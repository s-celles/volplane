// ============ translation catalogues (IHM-006) ============
// 'Le système DOIT être disponible en plusieurs langues via des catalogues de traduction.'
//
// This module holds the catalogues and one lookup function. It does NOT decide which language
// the pilot speaks: DETECTION belongs to the shell, which is the only layer allowed to know
// there is a navigator, an OS locale or a stored preference. Here a Lang is just a value that
// arrives from outside — which is also what makes the whole thing testable without a browser.
//
// Three properties matter more than any feature:
//  · a missing FRENCH key is a COMPILE error (FR is typed Record<MsgId, string>),
//  · a message id used in the code but absent from a catalogue is a RED BUILD (i18n.test.ts
//    scans the sources for t('…') calls),
//  · and if both guards were somehow bypassed at runtime, t() returns the ID ITSELF — never an
//    empty string, never 'undefined'. A cockpit label reading 'lnd.noneReachable' is ugly; a
//    cockpit label reading nothing at all is dangerous.

import { EN } from './messages.en';
import { FR } from './messages.fr';

/** Every id the code may ask for. English is the reference catalogue; the others are typed
 *  against it, so the set of ids is defined in exactly one place. */
export type MsgId = keyof typeof EN;

export const LANGS = ['en', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

export const CATALOGUES: Record<Lang, Record<MsgId, string>> = { en: EN, fr: FR };

/** Placeholders are `{name}`. A param that was NOT supplied leaves its `{name}` standing rather
 *  than printing 'undefined' — a visible hole is a bug someone reports; 'undefined' next to an
 *  altitude is a bug someone believes. */
const fill = (s: string, params?: Record<string, string | number>): string =>
  params ? s.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole)) : s;

/** Look `id` up in `lang`'s catalogue; fall back to English; failing that, return the id itself.
 *  The id is accepted as a plain string, not MsgId, so a renderer built from configuration data
 *  can still call it — the tests, not the type system, are what keep those ids honest. */
export function t(lang: Lang, id: string, params?: Record<string, string | number>): string {
  const local = (CATALOGUES[lang] as Record<string, string | undefined>)[id];
  if (local !== undefined) return fill(local, params);
  const english = (CATALOGUES.en as Record<string, string | undefined>)[id];
  if (english !== undefined) return fill(english, params);
  return id;
}

/** What every renderer actually receives. Passing a bound translator as the last argument keeps
 *  the renderers themselves free of any notion of language — they are handed a way to speak. */
export const translator =
  (lang: Lang) =>
  (id: string, params?: Record<string, string | number>): string =>
    t(lang, id, params);

export type Translator = ReturnType<typeof translator>;

/** Narrow an arbitrary string (a stored preference, a CLI flag) to a Lang. The shell detects;
 *  this only says whether what it detected is something we can actually speak. */
export const isLang = (s: string): s is Lang => (LANGS as readonly string[]).includes(s);
