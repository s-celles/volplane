// ============ persistent local storage (OFF-002/004/005) ============
// Everything the flight needs must survive a restart with no network and no error. This file
// is the ONLY one that knows how bytes persist; above it, the app sees four async verbs and
// nothing else. That interface is the point: swap this file and the cache lives somewhere
// else — the caller cannot tell, and C5 stays true.
//
// Why the webview's IndexedDB and not a Rust/Tauri fs store: IndexedDB exists on every
// target we ship to — Windows, Android, iOS, AND the plain browser dev server where there is
// no Rust at all. It needs no new Tauri capability, no new dependency, and no platform
// #ifdefs. The day it is not enough (OFF-006 size ceilings may be that day), only this file
// changes.
//
// The one honesty rule, and it runs through every function here: an absent value is null,
// never an empty array. A caller asking for a tile must be able to tell "never stored" from
// "stored, and the file happens to be empty" — collapsing the two is how a cache lies
// (POT-007 is the same rule wearing a different hat).

/** The whole storage contract. Values are bytes because the store must not care what a pack
 *  or a tile IS — that knowledge lives above. Keys are flat strings; hierarchy is spelled
 *  with prefixes ('tile/…', 'pack/…') and read back with keys(prefix). */
export interface KV {
  /** The stored bytes, or null when the key was never stored. Never an empty array for absence. */
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, val: Uint8Array): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

// A KV that survives restarts registers itself here. A WeakSet rather than a field on the
// interface, so the contract above stays exactly four verbs and no implementation can forget
// to answer — absence from the set IS the answer.
const persistent = new WeakSet<KV>();

/** OFF-005 needs this to be honest: when the store below is memory-only (private-mode
 *  browser, IndexedDB open refused, bun test), the UI must tell the pilot the cache will NOT
 *  survive a restart — not silently pretend it will. */
export const isPersistent = (kv: KV): boolean => persistent.has(kv);

/** Map-backed KV: the test double AND the honest degraded mode when IndexedDB is unavailable.
 *  One implementation for both on purpose — the degraded path in flight is then a path the
 *  test suite exercises constantly, not a branch nobody has ever run. */
export function memKV(): KV {
  const m = new Map<string, Uint8Array>();
  return {
    // Copies on both sides, because IndexedDB structured-clones and the two implementations
    // must be indistinguishable through the interface. Hand out the stored array itself and
    // a caller mutating its "own" buffer silently corrupts the cache — but only in memory
    // mode, the mode the tests would otherwise be the only ones to see.
    get: async k => { const v = m.get(k); return v ? v.slice() : null; },
    put: async (k, v) => { m.set(k, v.slice()); },
    del: async k => { m.delete(k); },
    keys: async prefix => [...m.keys()].filter(k => k.startsWith(prefix)),
  };
}

/** IDBRequest is a callback API from 2010; the rest of this file speaks promises. */
const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const STORE = 'kv';

/** IndexedDB-backed KV. Version 1, one object store, string keys, ArrayBuffer values — and
 *  deliberately nothing more. No schema means no migrations, and no migrations means no
 *  upgrade path that can eat a pilot's cache the morning of a flight. */
export async function idbKV(dbName: string): Promise<KV> {
  const open = indexedDB.open(dbName, 1);
  open.onupgradeneeded = () => { open.result.createObjectStore(STORE); };
  const db = await req(open as IDBRequest<IDBDatabase>);

  // One short-lived transaction per operation. Slower than batching, but a flight cache is
  // written during provisioning and read during flight — neither is a hot loop, and a
  // transaction that never spans an await is a transaction that cannot be found inactive.
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);

  const kv: KV = {
    get: async k => {
      const v = await req<unknown>(tx('readonly').get(k));
      // undefined is IndexedDB's word for absent; null is ours. An empty ArrayBuffer, by
      // contrast, round-trips as a real (empty) value — stored is stored.
      return v === undefined ? null : new Uint8Array(v as ArrayBuffer);
    },
    // slice() first: the caller may hand us a view into a larger buffer, and storing
    // val.buffer would persist the neighbours too. The copy also matches memKV's isolation.
    put: async (k, v) => { await req(tx('readwrite').put(v.slice().buffer, k)); },
    del: async k => { await req(tx('readwrite').delete(k)); },
    // getAllKeys + filter rather than an IDBKeyRange prefix trick: the range upper-bound
    // dance ('￿' suffixes) has edge cases, and a flight cache holds thousands of keys,
    // not millions. Correct and dull beats clever here.
    keys: async prefix =>
      (await req(tx('readonly').getAllKeys())).filter(
        (k): k is string => typeof k === 'string' && k.startsWith(prefix),
      ),
  };
  persistent.add(kv);
  return kv;
}

/** The store the app actually opens. IndexedDB when the platform has one and lets us in;
 *  otherwise memory — working, but honest about not surviving a restart (isPersistent).
 *
 *  This function must NOT throw. Private-mode browsers reject the open; bun has no indexedDB
 *  at all. Either way the pilot gets a flight computer that works NOW and a UI that can say
 *  the cache is volatile (OFF-005) — never a startup crash over a storage detail. */
export async function openStore(dbName = 'volplane'): Promise<KV> {
  if (typeof indexedDB === 'undefined') return memKV();
  try {
    return await idbKV(dbName);
  } catch {
    return memKV();
  }
}

// ---- JSON over KV ----
// Config, pack manifests, validity metadata (OFF-005 timestamps) are small JSON, not tiles.
// TextEncoder/TextDecoder rather than Buffer: both exist in bun AND in every webview, so the
// shipped code path and the tested code path are the same bytes.

export async function putJson(kv: KV, key: string, obj: unknown): Promise<void> {
  await kv.put(key, new TextEncoder().encode(JSON.stringify(obj)));
}

/** null when the key is absent — the same word the byte layer uses, for the same reason.
 *  A stored JSON `null` also comes back as null; a caller that must tell those apart should
 *  not be storing bare null in the first place. */
export async function getJson<T>(kv: KV, key: string): Promise<T | null> {
  const bytes = await kv.get(key);
  if (bytes === null) return null;
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
