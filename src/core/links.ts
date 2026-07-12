// ============ which links exist HERE (ACQ-012) ============
// Apple decides what iOS may touch, Android what a browser shell may, and a desktop OS
// almost nothing — the one thing a flight computer must never do is OFFER a link the OS will
// refuse, because a pilot rigging a glider does not debug menus. The capability map is DATA,
// spelled per platform from spec §3bis, and the UI builds its connect form from it — a link
// absent here is absent from the screen, not greyed out.
//
// This is the core's knowledge of the MATRIX, not of the platform: the shell says which row
// it is standing on; nothing here sniffs a user agent.

import type { DeviceInfo } from './device';

export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

/** Spec §3bis, one row per platform. TCP/UDP travel everywhere (they are how Condor and the
 *  WiFi instruments arrive, and the one road iOS leaves open beside BLE). Serial is a
 *  desktop affair. Bluetooth Classic — the installed base — exists on desktop and Android
 *  and is FORBIDDEN on iOS: that absence is Apple's, and the UI must show it as such. */
const MATRIX: Record<Platform, ReadonlyArray<DeviceInfo['link']>> = {
  windows: ['tcp', 'udp', 'serial', 'bluetooth-classic', 'bluetooth-le', 'replay'],
  macos: ['tcp', 'udp', 'serial', 'bluetooth-classic', 'bluetooth-le', 'replay'],
  linux: ['tcp', 'udp', 'serial', 'bluetooth-classic', 'bluetooth-le', 'replay'],
  android: ['tcp', 'udp', 'bluetooth-classic', 'bluetooth-le', 'internal', 'replay'],
  ios: ['tcp', 'udp', 'bluetooth-le', 'internal', 'replay'],
};

/** What Phase 3 has actually BUILT, of what the matrix allows. Offering an allowed link with
 *  no implementation behind it is the same lie as offering a forbidden one — the form shows
 *  the intersection, and this list grows as the shell does. */
const IMPLEMENTED: ReadonlyArray<DeviceInfo['link']> = ['tcp', 'udp', 'replay'];

/** The links the connect UI may offer on this platform: allowed by the OS AND standing in
 *  the shell. Order is the matrix's — stable for the UI. */
export function offerableLinks(platform: Platform): DeviceInfo['link'][] {
  return MATRIX[platform].filter(l => IMPLEMENTED.includes(l));
}

/** The links the OS allows but this build cannot drive yet — named so the UI can SAY "not
 *  yet" instead of silently omitting them (the pilot must learn the absence from the screen,
 *  not from failure — ACQ-012's spirit applied to our own gaps). */
export function missingLinks(platform: Platform): DeviceInfo['link'][] {
  return MATRIX[platform].filter(l => !IMPLEMENTED.includes(l) && l !== 'internal');
}
