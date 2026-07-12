// ============ Tauri events -> a DeviceSource ============
// The ONLY file in the app that imports Tauri. Everything else — the parser, the navigation
// state, soaring-core — is shell-agnostic, and that is C5 in one line of imports.
//
// Swap this file and the flight computer runs under Capacitor, or in a browser, or in a test,
// without noticing. That is not a hypothetical: `replaySource` below is exactly that swap, and
// it is what makes ACQ-010 (replay) free.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Device, DeviceSource } from '../core/device';

/** Turn the shell's `nmea` events into an async stream. Backpressure is deliberate: if the
 *  computer falls behind, sentences queue rather than being dropped — a dropped fix is a
 *  glider that jumps. */
function eventStream(): AsyncIterable<string> {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let done = false;

  const un = listen<string>('nmea', e => {
    queue.push(e.payload);
    wake?.();
  });
  const unLink = listen<{ state: string }>('link', e => {
    if (e.payload.state === 'closed') { done = true; wake?.(); }
  });

  return {
    async *[Symbol.asyncIterator]() {
      try {
        while (!done || queue.length) {
          if (!queue.length) await new Promise<void>(r => { wake = r; });
          wake = null;
          while (queue.length) yield queue.shift()!;
        }
      } finally {
        (await un)();
        (await unLink)();
        await invoke('close_all');
      }
    },
  };
}

/** Condor, or any instrument speaking NMEA over TCP. Condor's default is port 4353 — on the
 *  same PC (127.0.0.1) or on the PC's LAN address from a tablet. */
export const tcpDevice = (host: string, port = 4353): Device => ({
  id: `tcp:${host}:${port}`,
  label: `TCP ${host}:${port}`,
  link: 'tcp',
  open: () => {
    void invoke('open_tcp', { host, port });
    return eventStream();
  },
});

/** An instrument broadcasting NMEA over WiFi. With BLE, the only link iOS permits (§3bis). */
export const udpDevice = (port: number): Device => ({
  id: `udp:${port}`,
  label: `UDP :${port}`,
  link: 'udp',
  open: () => {
    void invoke('open_udp', { port });
    return eventStream();
  },
});

/** ACQ-010, and it costs nothing: a replay is a DeviceSource like any other. No Tauri, no
 *  socket, no hardware — which is why the whole flight computer is testable without any. */
export function replaySource(sentences: readonly string[], intervalMs = 0): DeviceSource {
  return async function* () {
    for (const s of sentences) {
      if (intervalMs) await new Promise(r => setTimeout(r, intervalMs));
      yield s;
    }
  };
}
