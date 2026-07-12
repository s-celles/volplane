# VOLPLANE

A free soaring flight computer. **Phase 0** — a skeleton that walks.

- Requirements: [`spec-volplane.md`](../spec-volplane.md) (v0.3, French)
- Plan: [`ROADMAP.md`](ROADMAP.md)
- Kernel: [`soaring-core`](https://github.com/s-celles/soaring-core)

## What works today

A stream of NMEA sentences comes in over TCP or UDP; a position, an altitude, a **height above
ground**, a vario and the instrument's wind come out. Nothing more — and claiming less is the
point: every number on the screen can be checked against the simulator.

```
  #    lat       lon       alt      ground    AGL     vario   wind
   1  47.0000  8.0002    1502m      502m    1000m     —       —
   2  47.0000  8.0004    1503m      504m     999m    1.5    270°
   3  47.0000  8.0006    1505m      506m     999m    1.5    270°
   4  47.0000  8.0008    1506m      508m     998m    1.5    270°
```

The glider is **climbing** — and its height above ground is **falling**, because the terrain is
rising faster than it is. That is the number this phase exists to get right, and it is the one
that keeps a glider out of a hillside.

## Try it

The flight computer needs nothing — no shell, no window, no hardware. That is C5, and it is
why this works on any machine:

```bash
bun install
bun test          # 27 tests
bun run typecheck
```

To run the **app**, you also need Rust and a platform toolchain:

```bash
# macOS (once)
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Linux (once) — Debian/Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
                 libgtk-3-dev libxdo-dev librsvg2-dev build-essential
```

Then, in two terminals:

```bash
bun run scripts/nmea-sim.ts     # 1. a Condor stand-in on tcp://127.0.0.1:4353
bun run tauri dev               # 2. the app — click Connect
```

The simulator flies east, climbing, over rising ground. Watch the **altitude go up** while the
**height above ground goes down**: the terrain is rising faster than the glider. That is the
number Phase 0 exists to get right.

With the real thing: **Condor → Setup → Options → NMEA output → TCP, port 4353.** Same app,
same screen — the flight computer cannot tell the difference, and that is the point.

> `bun run dev` both builds and serves on `:1420` (Tauri's `devUrl`). `bun build --watch`
> compiles but does not serve, so without a server `tauri dev` opens a window on a port nobody
> is listening on and shows a blank page with no useful error.

## The shape of it

```
src/core/     the flight computer. Knows nothing about Tauri, sockets or windows.
              device.ts  the DeviceSource port (C5)
              nmea.ts    sentences -> facts. Rejects, never guesses.
              nav.ts     facts + soaring-core -> where we are and how high above the ground
src/shell/    the only place that knows Tauri exists
src-tauri/    the native shell: TCP and UDP today; serial and Bluetooth later
```

**`C5` is the load-bearing idea**, and `src/core/purity.test.ts` enforces it: the flight
computer consumes a stream of sentences and does not know where they came from. A socket, a
serial port, a BLE characteristic, a replayed IGC — all the same to it.

Three things fall out of that, and they are why the constraint exists:

- the app shell is **replaceable** (Tauri today; if that turns out to be the wrong bet on
  mobile, the computer does not notice);
- the platform differences of spec §3bis — and Apple's ban on Bluetooth Classic — are confined
  to one directory;
- **`ACQ-010` (replay) is free**: a replayed file is a source like any other, which is why the
  whole computer is testable with no hardware and no window.

## Icons

`assets/icon.png` is the **single source**. Everything under `src-tauri/icons/` is generated
from it — the Windows `.ico` (six sizes in one file), the macOS `.icns`, the Android mipmaps,
the iOS assets:

```bash
bun run tauri icon assets/icon.png --output src-tauri/icons
```

Do not hand-write the `.ico`. It was, briefly, and the two icons were then *drawn separately*
— so replacing the PNG would have left Windows showing the old one, silently. One source, one
command.

## Condor is the test bench, not just a use case

The simulator **knows the answer** — the real wind, the real vertical motion of the air. Several
of a flight computer's central numbers are estimates that *no real flight can check*, because a
real flight offers nothing to compare them against. Condor does. See
[`ROADMAP.md`](ROADMAP.md#the-test-bench-condor-soaring).

One trap, named up front: **Condor 2 and Condor 3 disagree about which way the wind blows** in
`$LXWP0`. One driver for both reverses it — silently, plausibly. They are two drivers here, and
a test pins it.

## Licence

AGPL-3.0, inherited from `soaring-core` and transitive.

_Assisted by AI._
