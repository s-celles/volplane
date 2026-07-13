# VOLPLANE

A free soaring flight computer. **Every phase of the roadmap but iOS now stands** — the
skeleton walks, briefs, glides, listens, scores and sings:

- **Phase 0** — the chain: NMEA over TCP/UDP or IGC replay in; position, altitude and a
  height above ground on real terrain out.
- **Phase 1** — the ground half: offline data packs on a persistent shelf (pinned, budgeted,
  updatable), pre-flight completeness, the weather snapshot, the four modelled lift fields
  (loudly badged as models).
- **Phase 2** — the glide computer: MacCready, speed to fly, final glide with reserve,
  netto/super-netto, the wind estimated from circle drift (badged `est`, never merged with
  the instrument's).
- **Phase 3** — instruments offered honestly (the connect form is built from the platform
  capability matrix), lost gracefully (a dead source's values visibly age, the app lives).
- **Phase 4** — FLARM traffic with FLM-005's reminder, IGC logging (journalled, so a crash
  costs ~10 s and the flight is offered back at the next launch), OpenAir airspace with
  arcs, class filters, acknowledgements and ESP-005's worst case, FAI **and AAT** tasks
  under versioned rules, a moving map, and the pilot's own `.plr` polar.
- **Phase 6** — the beyond-MVP half: **reachable terrain** (the range circle is gone — see
  below), the cross-section ahead, the OLC/FAI-triangle scorers under a named barème, the
  barograph and the effective polar, and an audio vario.

**Phase 5 (iOS) stays deferred by decision D2** — it is a product choice (BLE, like SeeYou
Navigator, or network-only, like XCSoar), not a backlog item.

- Requirements: [`spec-volplane.md`](../spec-volplane.md) (v0.3, French)
- Plan: [`ROADMAP.md`](ROADMAP.md)
- Kernel: [`soaring-core`](https://github.com/s-celles/soaring-core)

## The range circle was a lie, and we killed it

Every flight computer draws a circle of reachable ground around the glider: height in hand,
times the glide ratio. It is arithmetic, it is easy, and **it is wrong in exactly the
direction that kills** — a glider does not glide into a mountain.

VOLPLANE marches the terrain instead. 72 bearings, stepped out against the polar and the
wind actually blowing, each one stopping where the glide slope meets the ground. Over the
Napf (47°N 8°E), from 1200 m:

```
  from 1200 m:  glide=16  terrain=20   reach 0.4 – 9.0 km
  from 2500 m:  glide=36               reach 9.0 – 9.0 km
```

At 1200 m — 260 m above the hills — **twenty of the thirty-six bearings are walled off**,
and the reach collapses to 400 m in places. A range circle would have promised 9 km in every
one of those directions, straight into the rock. At 2500 m the terrain is irrelevant and the
circle would have been right; the reach agrees with it, and says so.

The edge is coloured by *why* it ends there, and the three reasons never share a colour:
**green** the glide simply ran out, **red** a ridge is in the way (`TER-005` — everything
behind it is unreachable however low it lies), **grey** nobody has loaded that ground. That
last one is the rule the whole project is built on: unmeasured terrain is not flat terrain.

## The three screens

**Fly** — the numbers, the map, the slice ahead. Position and height above ground on real
terrain; MacCready, speed to fly, netto, the arrival at a goal; the wind we estimate from
circle drift, badged `est` and never confused with the one the instrument reports; FLARM
traffic, airspace verdicts (`INSIDE` and `AHEAD 60 s` are different words in different
colours), the task; and the vario out loud, if you want it.

**Briefing** — the ground half, and it works with the network cut. The pack shelf (pin what
you will fly, the cache budget evicts the rest), pre-flight completeness naming what is
missing, the day's weather and emagram, and the four modelled lift fields — every one of them
badged **MODELLED**, because a lift field is a story about the day and a vario is a fact.

**Analysis** — what the flight actually did. The barograph with the climbs shaded under it;
the **achieved** glide ratio beside the polar's **modelled** one (`ANA-003` — they are two
different claims and are never fused into one flattering number); and the OLC free distance
and best FAI triangle, scored under a named barème, with the honest footnote that the IGC
file is the judge of record.

## What works today

A stream of NMEA sentences comes in over TCP or UDP — or out of a **replayed IGC file**
(`ACQ-010`); a position, an altitude, a **height above ground** on the real terrain, a vario
and the instrument's wind come out. Every number on the screen can be checked against the
simulator, and the ground against a map.

```
  #    lat       lon       alt      ground    AGL     vario   wind
   1  47.0000  8.0002    1502m      944m     558m     1.5    270°
   2  47.0000  8.0004    1503m      944m     559m     1.5    270°
   3  47.0000  8.0006    1505m      954m     551m     1.5    270°
   4  47.0000  8.0008    1506m      965m     541m     1.5    270°
```

The glider is **climbing** — and its height above ground is **falling**, because the terrain
is rising faster than it is (those are the real slopes of the Napf, east of 47°N 8°E). That
is the number this phase exists to get right, and it is the one that keeps a glider out of a
hillside.

The terrain is read from terrarium DEM tiles (AWS Open Data), off the **disk first** and the
network second — a provisioned pack means a flight that never needs the radio (`OFF-004`).
They are decoded with UPNG, not a canvas: a canvas may color-manage the pixels, and here the
RGB **is** the elevation. Until a tile is held the ground is **UNKNOWN**, shown as `—`, never
as zero.

That last sentence is the whole project in one rule. A flight computer that shows `0 m AGL`
over an unloaded mountain is worse than one that shows nothing, **because the pilot believes
it** — and every screen here is built to make the difference between *measured*, *modelled*
and *unknown* impossible to miss.

## Try it

The flight computer needs nothing — no shell, no window, no hardware. That is C5, and it is
why this works on any machine:

```bash
bun install
just check        # typecheck + 272 bun tests + the Rust shell's own
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

Then, in two terminals (`just sim` and `just dev` if you have [just](https://github.com/casey/just);
`just check` runs everything a commit should pass):

```bash
bun run scripts/nmea-sim.ts     # 1. a Condor stand-in on tcp://127.0.0.1:4353
bun run tauri dev               # 2. the app — click Connect
```

No simulator at hand? **Replay an IGC file** from the same screen — it becomes NMEA sentences
and enters through the same door as a live instrument, at 10× real time.

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
