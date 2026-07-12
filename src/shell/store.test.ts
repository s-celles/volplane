// ============ the storage contract, pinned ============
// bun has no indexedDB — which makes this suite the degraded environment OFF-004 talks
// about, not a simulation of it. Everything pinned here is a claim about the interface
// (absence is null, prefixes filter, fallback never throws), never about which engine
// happens to hold the bytes.
import { expect, test } from 'bun:test';
import { getJson, isPersistent, memKV, openStore, putJson } from './store';

test('memKV round-trips bytes exactly', async () => {
  const kv = memKV();
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  await kv.put('tile/7/64/44', bytes);
  expect(await kv.get('tile/7/64/44')).toEqual(bytes);
});

test('a key never stored reads as null — not as empty bytes', async () => {
  const kv = memKV();
  expect(await kv.get('tile/nowhere')).toBeNull();

  // The other half of the same claim: an empty file that WAS stored is a value, not an
  // absence. Collapse the two and 'no tile cached' becomes indistinguishable from 'cached
  // a zero-byte tile' — the cache would be lying about its own coverage.
  await kv.put('tile/empty', new Uint8Array(0));
  expect(await kv.get('tile/empty')).toEqual(new Uint8Array(0));
});

test('keys(prefix) returns only that prefix', async () => {
  const kv = memKV();
  await kv.put('tile/7/64/44', new Uint8Array([1]));
  await kv.put('tile/7/64/45', new Uint8Array([2]));
  await kv.put('pack/alps-2026', new Uint8Array([3]));

  const tiles = await kv.keys('tile/');
  expect(tiles.sort()).toEqual(['tile/7/64/44', 'tile/7/64/45']);
});

test('openStore without indexedDB falls back instead of throwing (OFF-004)', async () => {
  expect(typeof indexedDB).toBe('undefined');   // the premise this whole test rests on

  const kv = await openStore();
  await kv.put('config/pilot', new Uint8Array([42]));
  expect(await kv.get('config/pilot')).toEqual(new Uint8Array([42]));

  // Degraded, and SAYING so: OFF-005 needs the UI to warn that this cache dies with the
  // process, and this flag is the only way it can know.
  expect(isPersistent(kv)).toBe(false);
});

test('putJson/getJson round-trip an object with null members intact', async () => {
  const kv = memKV();
  // null members matter more than the happy path: an unknown value IS null in this app
  // (POT-007), and a store that drops or coerces them would invent measurements at rest.
  const meta = { fetched: '2026-07-12T08:00:00Z', coverage: 'alps', expires: null };
  await putJson(kv, 'pack/alps/meta', meta);
  expect(await getJson<typeof meta>(kv, 'pack/alps/meta')).toEqual(meta);
});

test('getJson of an absent key is null', async () => {
  const kv = memKV();
  expect(await getJson(kv, 'pack/never-provisioned')).toBeNull();
});

test('put then del then get is null again', async () => {
  // The plumbing a future eviction policy (OFF-006) will stand on: a deleted key must read
  // as never-stored, not as some tombstone the caller has to know about.
  const kv = memKV();
  await kv.put('tile/8/128/90', new Uint8Array([9, 9]));
  await kv.del('tile/8/128/90');
  expect(await kv.get('tile/8/128/90')).toBeNull();
});
