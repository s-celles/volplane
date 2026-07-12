// ============ the shell's permissions, pinned ============
// In Tauri v2 the webview has NO rights by default. Without a capability granting
// `core:default` to the main window, `listen()` is denied — silently, as a rejected promise
// nobody awaits. The app then connects, the Rust reads and emits, and the screen never
// updates. That happened, and nothing in the core test suite could see it: the core is pure
// (purity.test.ts), so a shell that cannot deliver events is invisible to it.
//
// This test is the counterpart: it cannot prove the shell works, but it pins the one config
// file whose silent absence is known to blank the screen.
import { expect, test } from 'bun:test';
import caps from '../../src-tauri/capabilities/default.json';

test('the main window is allowed to listen for shell events', () => {
  expect(caps.windows).toContain('main');
  expect(caps.permissions).toContain('core:default');
});
