// ============ settings: what the pilot configured, as a value (OFF-002) ============
// OFF-002 lists configuration among what MUST survive a restart. This module is the shape of
// that promise: a plain value the shell serializes verbatim, and a normalizer that rebuilds
// it from untrusted disk bytes — the same division of labour as shelf.ts's normalizeShelf
// (core owns the shape and the repair; the shell owns the bytes). One field today: the cache
// ceiling (OFF-006), which used to live in a DOM input alone and silently reset to its
// built-in default at every launch — a setting that forgets is a setting the pilot cannot
// trust with a small disk. New settings land HERE first, so the persisted shape and the
// defaults can never be two files' opinions.

/** Everything the pilot can configure that must come back at the next launch. */
export interface Settings {
  /** The tile-cache ceiling, in MB (OFF-006). Always positive: a zero or negative ceiling
   *  read off a typo would evict everything the pilot provisioned, so the normalizer refuses
   *  such a value in favour of the default rather than obeying it. */
  cacheBudgetMB: number;
}

export const DEFAULT_SETTINGS: Settings = { cacheBudgetMB: 200 };

/** Rebuild settings from untrusted JSON — garbage in, defaults out, never a throw (the
 *  contract normalizeShelf keeps, for the same reason: a corrupted record costs the pilot
 *  his preferences, never his startup). Field by field, so one mangled field costs that
 *  field alone once there is more than one. Always a fresh object: handing out
 *  DEFAULT_SETTINGS itself would let one caller's edit rewrite everyone's default. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const v = r.cacheBudgetMB;
  return {
    cacheBudgetMB:
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_SETTINGS.cacheBudgetMB,
  };
}
