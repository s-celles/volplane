// ACQ-012 as data: the form is built from this map, so what these tests pin is literally
// what the pilot will and will not be offered.
import { test, expect } from 'bun:test';
import { offerableLinks, missingLinks, type Platform } from './links';

const ALL: Platform[] = ['windows', 'macos', 'linux', 'android', 'ios'];

test('iOS is never offered Bluetooth Classic or serial — that absence is Apple\'s (§3bis)', () => {
  expect(missingLinks('ios')).not.toContain('bluetooth-classic');   // not even as "missing":
  expect(offerableLinks('ios')).not.toContain('bluetooth-classic'); // it does not EXIST there
  expect(offerableLinks('ios')).not.toContain('serial');
});

test('TCP, UDP and replay stand on every platform — Condor\'s road and ACQ-010\'s', () => {
  for (const p of ALL) {
    const links = offerableLinks(p);
    expect(links).toContain('tcp');
    expect(links).toContain('udp');
    expect(links).toContain('replay');
  }
});

test('what the OS allows but the build cannot drive is NAMED, not silently omitted', () => {
  // Desktop may speak serial and both Bluetooths; Phase 3 has not built them. The UI must
  // be able to say so — a gap the pilot learns from the screen, not from failure.
  const missing = missingLinks('macos');
  expect(missing).toContain('serial');
  expect(missing).toContain('bluetooth-classic');
  expect(missing).toContain('bluetooth-le');
  // And nothing offered is simultaneously missing.
  for (const p of ALL)
    for (const l of offerableLinks(p)) expect(missingLinks(p)).not.toContain(l);
});
