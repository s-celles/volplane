# VOLPLANE — roadmap

A free soaring flight computer. Requirements: [`spec-volplane.md`](../spec-volplane.md) (**v0.4**, in French).

---

## This document was lying, and here is what it said

Until today it opened with: *"NMEA acquisition, a MacCready glide solver, airspace, FAI tasks, FLARM,
IGC logging — **none of it exists here**."* Every one of those has been built. It also listed as
missing the terrain shading, the InfoBoxes, the units, the translation catalogue, the polar library
and the circling assistant. All six are in the tree.

A roadmap that flatters its author is worth nothing — and a roadmap that is merely *out of date* is
worse than one that is wrong, because a wrong plan gets argued with while a stale one gets believed.
So the numbers below come from an audit of the code against the spec's 126 requirements, not from
memory.

---

## Where we actually stand

**Sixty-six of the spec's sixty-nine `Must` requirements are built.** Three are not, and they are
named below. The `soaring-core` kernel holds the soaring domain (C4); this repository holds the
application.

| | in `soaring-core` | in `volplane` |
|---|---|---|
| **the air** | polars, MacCready, netto, wind from circle drift, the four lift fields | the screens that show them |
| **the ground** | terrain sampling, hillshade, the reach march | `map-ui` paints it |
| **the sound** | the vario law, the alarm voice (a warble no vario can imitate) | the oscillator |
| **the data** | `.cup` / WinPilot parsing, `.plr` polars | 154 wings from `soaring-data` |

Built and under test: NMEA and FLARM acquisition, the glide computer, airspace (a real national file,
1608 volumes), FAI tasks with sector validation, IGC logging, the reach polygon that walls off a
mountain, landable fields sorted by arrival margin, terrain shading, the cross-section, the circling
assistant, configurable InfoBoxes on pages the pilot builds, units per quantity, English and French,
and a glider library of 154 wings — 107 of them carrying their Wikidata item and 55 the wingspan
their EASA type certificate states.

**551 tests pass.**

---

## And the thing 551 tests cannot tell us

> **Nobody has looked at it.**

Since the blank-screen bug of the first day, every screen — the map, the InfoBoxes, the settings
panel, the glider picker, the French interface, the vario sound — has been verified by tests written
by the same process that wrote the code. That is a circle. No human eye has been on the display.

A flight computer that passes 551 tests and is unreadable in a cockpit is worth nothing, and no test
will ever say so. Two things are already visible from the code without running it:

- the glider picker offers a group of **106 entries** in one list — in flight, with gloves;
- nothing has ever been checked for legibility in sunlight, or for reach with a thumb.

**This is the largest risk in the project.** It is larger than every gap listed below.

---

## The test bench: Condor Soaring

**Condor Soaring** streams live NMEA (TCP port 4353, or a virtual serial port on the same PC). It is first a **real use case** — pilots train with their flight computer wired to the simulator, to learn the instrument before trusting it in the air.

But it is also the only source that gives us a **ground truth**. The simulator *knows* the real wind, the real vertical motion of the air, the real position. Several of the computer's central numbers are **estimates that no real flight can check**, because a real flight offers nothing to compare them against:

| Estimated quantity | Checkable in a real flight? | Checkable in Condor? |
|---|:-:|:-:|
| Wind from circle drift (`VEN-001`) | ❌ *nothing to compare against* | ✅ the sim gives the real wind |
| Netto — the air's vertical motion (`VAR-002`) | ❌ | ✅ |
| Final glide (`PLA-004`, `PLA-005`) | partly *(you arrive, or you don't)* | ✅ and repeatably |

This is the strongest acceptance test the project has, and it is **better than "compare against XCSoar"**: comparing against XCSoar compares us to another program. Comparing against Condor compares us to **the answer**.

Two consequences for the plan:

- **`ACQ-011` (NMEA over UDP/TCP) moves into Phase 0.** It is not an iOS workaround — it is the main road: the simulator, WiFi instruments, development and testing all travel it.
- **Condor 2 and Condor 3 are two drivers, not one.** Condor 3 changed the wind-direction convention in `$LXWP0`; conflating them **inverts the wind silently**. XCSoar had to ship a separate driver. That is `ACQ-003`'s whole warning, in one concrete example.

> **⚠ The trap.** It is tempting to validate the **lift potential** (`POT`) against Condor too. **It is a mirage.** Condor's thermals are generated procedurally; they do not derive from terrain, sun and weather the way the `POT` model does. Validating a model against another model proves **nothing** about reality — it only manufactures unearned confidence, which is precisely what `POT-007` exists to prevent. `POT` is validated only against **real observed climbs** (`POT-006`), and stays indicative (`C3`).

---

## Decisions left open

They do not block Phase 0, but they must fall before Phase 3.

| | Question | Status |
|---|---|---|
| **D1** | **App shell** | ✅ **Decided: Tauri v2.** See below. |
| **D2** | **Platform ambition** | ✅ **Decided: desktop + Android first.** iOS deferred. |
| **D3** | **Which iOS?** | ⏸ **Deferred with iOS.** Two products exist — SeeYou Navigator's (instruments over **BLE**) and XCSoar's (**no Bluetooth at all**: internal GPS + network) — and the choice is made when iOS is taken up, not before. |

### D2 — Desktop and Android first

Not a retreat: **every link works on those two** (§3bis), so the flight computer can be *complete* there. iOS is the one platform where the installed base of instruments is out of reach by Apple's decision, and where the product is therefore a **different** product — that is precisely why it deserves its own decision (D3) rather than being carried along.

It also matches where the work is. Condor runs on **Windows**. `OFF-003` (data packs) and `OFF-010` (pre-flight completeness) are **desktop** tasks. Phases 0, 1 and 2 happen on the desktop; Android arrives with the instruments in Phase 3.

And it steps back from an ambition the roadmap itself flagged as unreasonable: shipping Android + iOS + desktop from day one would have been **more than the entire existing ecosystem does**, commercial software included.

### D1 — Tauri v2, and what it actually buys us

A Rust shell with a web frontend, on six platforms: Windows, macOS, Linux, Android, iOS. The frontend is plain TypeScript, so **`soaring-core` is imported directly** — no bridge, no rewrite. That criterion, though, does **not** discriminate: Capacitor would reuse it just as fully. The real reasons are elsewhere.

**Desktop is first-class, and desktop is where the early work lives.** Condor, `OFF-003` (data packs) and `OFF-010` (pre-flight completeness) are all desktop tasks — Phases 0, 1 and 2 happen there. Capacitor treats desktop as an afterthought (a PWA, or an Electron side-shell).

**One honest correction, because it undercuts the argument usually made for Tauri:** the device layer is **Rust on desktop only**. Tauri's *mobile* plugins are written in **Kotlin (Android) and Swift (iOS)**; Rust is only the bridge. So "the device layer is in Rust" is half true, and the half that is false is the mobile half.

| | Desktop | Android | iOS |
|---|---|---|---|
| Serial / USB | **Rust** (`serialport`) | Kotlin | ❌ *(not permitted)* |
| **TCP / UDP — Condor** | **Rust** (`tokio`) | **Rust** | **Rust** |
| BLE | **Rust** (`btleplug`) | Kotlin — *already exists* (`tauri-plugin-blec`) | Swift — *already exists* |
| Bluetooth Classic (SPP) — the installed base | **Rust** | **Kotlin — to be written** | ❌ *(not permitted)* |

What that table says, and it is the reason the decision still stands:

- **Everything in Phases 0–2 runs over TCP/UDP** — Condor, the ground-truth bench, the whole acquisition chain — and Rust does that natively on all three platforms. **Not one line of Kotlin or Swift** is needed to get there.
- **BLE is already solved** by an existing plugin. No native code to write.
- **The only genuinely native piece is Bluetooth Classic on Android**, and it is well bounded — one Kotlin plugin behind the `DeviceSource` port (`C5`).

And `C5` is what keeps this reversible: the computer consumes a stream of sentences. If Tauri turns out to be the wrong bet on mobile, the shell is swapped and the flight computer does not notice.

---

## Where we stand, in fact

Phases **0, 1, 2, 3, 4 and 6 are flown**. Phase 5 (iOS) is deferred by **D2** — a product
decision, not a backlog item. What follows below is the plan as it was written; what follows
*after* the phases is what is left, and it is the honest part of this document.

| Phase | Status |
|---|---|
| 0 — the skeleton | ✅ NMEA over TCP/UDP, IGC replay, AGL on real terrain |
| 1 — ground briefing | ✅ packs, shelf, completeness, weather, the four lift fields |
| 2 — the glide computer | ✅ MacCready, STF, final glide, netto, wind from drift |
| 3 — instruments | ✅ capability matrix, drivers, controlled degradation |
| 4 — the MVP | ✅ airspace (arcs, filters, acks), FAI + AAT tasks, FLARM, IGC log + crash recovery, map |
| 5 — iOS | ⏸ deferred (D2/D3) |
| 6 — beyond the MVP | ✅ reachable terrain, OLC/FAI scoring, barograph, effective polar, audio vario |

**And yet the app is not finished** — which is exactly the kind of thing a roadmap is for
saying out loud. See [What is actually left](#what-is-actually-left).

---

## Phase 0 — A skeleton that walks

**Goal: prove the whole chain on a trivial case, before putting substance in it.**

- Repo, app shell (D1), CI on the target platforms.
- `soaring-core` as a dependency, pinned to a tag.
- The **`DeviceSource`** port (`C5`): the computer consumes a stream of sentences and does not know where they come from.
- **Two sources, no hardware**: **IGC replay** (`ACQ-010`) and **live NMEA over TCP/UDP** (`ACQ-011`) — which is already the **Condor** link (`ACQ-013`).
- Navigation state (`POS-001`, `POS-002`), terrain elevation and height above ground (`TER-002`, `TER-003`) — `soaring-core` already does this.

**Verifiable:** **fly in Condor, and the position and height above ground are right, live.** Not a replay — a real-time stream, with the simulator as the truth.
**What it proves:** the port holds, `soaring-core` really is reusable, the shell works, the acquisition chain works end to end, CI passes. If any of that is a lie, we learn it now and not in six months.
**Why this and not IGC replay:** replay proves the maths. Condor proves the *chain* — sockets, parsing, timing, a source that can stall or drop. And it does so with a truth to check against.

---

## Phase 1 — Ground briefing *(the half that ships first)*

**Goal: a genuinely usable preparation tool, with no instrument at all.**

- **`OFF-003`** — data packs: download and cache terrain, imagery, weather and waypoints in advance, for a chosen area and period.
- **`OFF-002`, `OFF-004`, `OFF-005`, `OFF-008`** — persistent storage, fall back to the local copy, offline state made visible, "flight data" separated from "enrichment".
- **`OFF-010`, `OFF-011`** — **pre-flight completeness**: show the pilot what is missing *before* he takes off. The highest pilot value in the whole spec, and not a line of it exists anywhere.
- **`WX-001`, `WX-003`, `WX-005`** — weather snapshot, cloudbase, the synthetic "sandbox" atmosphere.
- **`POT-001…006`** — the four lift fields. **Already in `soaring-core`**; what is left is showing them.
- **`POT-007`** — tell the **modelled** apart from the **measured**. Not negotiable, and to be designed into the *first* screen, not bolted on later.
- **`ANA-004`** — the convective day's structure (a simplified emagram).

**Verifiable:** pull the network, and the day's briefing still stands — with the pilot told what is missing.
**Why first:** `soaring-core` already does most of the computing. This is the best value per unit of new work, and it attacks the module the spec calls its priority.

---

## Phase 2 — The glide computer *(the foundation everyone has)*

**Goal: the numbers a glider pilot actually looks at.**

- **`PLA-001…005`, `PLA-009`** — polar, MacCready, speed to fly, final glide, arrival height, reserve. `soaring-core` has the **polar** (`PLA-010`) but **not the glide solver**: that is new code.
- **`VAR-001`, `VAR-002`, `VAR-003`** — TE vario, netto, super-netto. **Already in `soaring-core`.**
- **`VEN-001`, `VEN-003`, `VEN-004`** — wind from circle drift (the kernel has `thermalDrift`), wind profile by altitude.
- **`POS-003…006`** — altitudes (GPS, QNH, AGL), TAS, rolling vertical average.
- **`IHM-001`, `IHM-002`, `IHM-004`** — InfoBoxes, pages per flight phase, readable in sunlight.

**Verifiable — and this is the strongest test the project has:** fly in **Condor** and compare our **estimates** against the simulator's **truth** (`ACQ-014`). The estimated wind against the real wind. The netto against the air's real vertical motion. The final glide, by flying it.
Comparing against XCSoar is the *second* best test: it compares us to another program. Condor compares us to the answer.
**Risk:** the MacCready solver is new, subtle code, and it fails **silently** if it is not checked against a reference. This is the reference.

---

## Phase 3 — Instruments *(desktop + Android)*

**Goal: actually hear a FLARM and a vario.**

- **`ACQ-001a/b`, `ACQ-002`, `ACQ-003`, `ACQ-005`, `ACQ-006`, `ACQ-007`** — NMEA, vendor sentences, a malformed sentence rejected without corrupting the navigation state, a dropped link reported.
- **`ACQ-013`** — the **Condor** driver, in its two versions. Condor 2 and Condor 3 disagree on the wind direction in `$LXWP0`, and one driver for both inverts the wind without saying so.
- **`ACQ-012`** — never offer a link the OS does not allow.

*(`ACQ-011` — NMEA over UDP/TCP — is already done in Phase 0: it is how Condor connects.)*
- **`ACQ-009`** — internal sensors (GPS, barometer).
- **`SYS-002`** — a source disappears → controlled degradation, not a crash.

**Platforms: desktop and Android first** — every link works there (§3bis). iOS is Phase 5.
**What Phase 0 made free:** an instrument is just one more `DeviceSource`. The computer does not change.

---

## Phase 4 — The rest of the MVP

**Goal: complete the *Must* requirements the spec demands (§9).**

- **`ESP`** — airspace: display, predictive alert vs actual incursion, worst-case assumption when the altitude is unknown.
- **`TSK`** — waypoints, ordered task, sectors (cylinder, FAI, line, AAT), turnpoint validation.
- **`FLM`** — FLARM: traffic, collision alert, and the reminder that it does not replace looking out (`FLM-005`).
- **`LOG`** — IGC recording.
- **`CAR`** — moving map, orientations, zoom, reachable glide range.
- **`SYS-001`, `SYS-005`** — recover after a crash in flight.

**The most expensive piece, and the most underestimated:** `TSK` and `CNC` are driven by **FAI rules that change**. §7bis shows it — LK8000 and XCSoar diverge exactly there. Treat them as a versioned rule library, not as business logic.

---

## Phase 5 — iOS *(deferred — D2)*

Not before the flight computer is complete on desktop and Android. Depends on **D3**. Two possible products; choose explicitly:

- **The "SeeYou" iOS**: instruments over **BLE**. The installed base of SPP devices stays out of reach — that is Apple's limit, not ours (§3bis).
- **The "XCSoar" iOS**: internal GPS + network (UDP/TCP), **no Bluetooth**. Less ambitious, still useful, and deliverable far sooner.

Either way, `ACQ-012` must tell the pilot, in the UI, what he **will not** be able to plug in.

---

## Phase 6 — Beyond the MVP ✅ *(flown, except TER-006 and OFF-012)*

`CNC` (OLC/FAI optimisation) · `ANA-001…003` (barograph, effective polar, cross-section) · `TER-005` (unreachable terrain) · `PLA-007` (final glide around terrain) · `VAR-004/005` (audio) — **all done**.

The headline was a **deletion**: the range circle is gone. Every flight computer draws one — height in hand × glide ratio — and it is wrong in exactly the direction that kills, because a glider does not glide into a mountain. The terrain is marched instead, 72 bearings against the polar and the wind, and the edge is coloured by *why* it ends there. Over the Napf from 1200 m, **twenty of thirty-six bearings are walled off** where the circle promised 9 km.

Still open here: **`TER-006`** (3D synthetic vision) and **`OFF-012`** (standalone app).

---

## What is actually left

Three `Must` requirements, and they are not obscure.

### The three `Must`

| | Requirement | What is missing |
|---|---|---|
| **M** | `CAR-005` | **the task and the waypoints are not drawn on the map.** `map-ui.ts` has no notion of either. It paints terrain, airspace, landables, landmarks, the trail, the glider, traffic and the reach polygon — and not one turnpoint. The task EXISTS (`core/task.ts`), it is validated, its ribbon is rendered at the top of the screen — and the pilot cannot **see** it. This is the widest gap between what the app does and what it looks like it does. |
| **M** | `TSK-002` | **a task cannot be composed in the app.** `task-ui.ts` renders a ribbon and nothing else; a task arrives by import or not at all. With `TSK-008` (edit in flight), `TSK-009` (geometry validity) and `TSK-011` (goto). |
| **M** | `CAR-002` | **map orientations** — track-up, heading-up, north-up. The map is north-up and has no idea there is a choice. |

### The `Should` list, ranked by what a pilot would miss

1. **`TRK-001…005` — OGN live tracking.** The whole family. Being *seen* by the ground and by rescue, and seeing traffic with no FLARM aboard. The pipeline is already in this monorepo: **`ogn-3d-viewer` speaks OGN today.**
2. **`CAR-006`** — the trail coloured by climb rate. Cheap, and it is how a pilot reads the day.
3. **`PLA-008`** — automatic MacCready from the climb history. **`PLA-006`** — required versus achieved glide ratio.
4. **`POS-007/008`** — takeoff and landing detection; **`LOG-006`** — a logbook; **`LOG-007`** — ENL, which decides IGC validity for a large slice of the fleet.
5. **`CFG-008`** — ballast and bugs adjusted **in flight**. `CFG-001` names the masses; nothing lets the pilot turn the knob.
6. **`VEN-002`** (manual wind), **`CFG-004`** (profiles), **`CFG-006`** (config import/export), **`SYS-003`** (battery), **`LOG-005`** (replay at a chosen speed — fixed at 10× today), **`CAR-003/004`** (zoom, auto-zoom while circling), **`IHM-003/005`** (gestures, no keyboard), **`FLM-003`** (buddy names), **`POS-004`** (QNH estimated), **`TER-004`** (topographic density by scale), **`THE-003`** (the thermal band).

### `Could`

`TER-006` (3D synthetic vision), `OFF-012` (standalone install), `ACQ-008/009` (send MC/QNH *to* the device; internal sensors), `LOG-004` (the IGC G-record), `LND-009` (divert mode).

### The order I would take them

0. **Fly it.** See above. Before anything.
1. **`CAR-005`** — put the task on the map. The pieces are all in hand and it closes the widest gap.
2. **`TSK-002`** — compose a task in the app. It is the last `Must` a pilot would notice.
3. **`CAR-002`** — orientations.
4. **OGN (`TRK`)** — the highest-value `Should`, and the code exists next door.

---

## What we will not do

- **No certification.** This is an uncertified aid (`NFR-008`), and that will not change.
- **No upstream weather forecasting.** We ingest a snapshot; we do not model tomorrow's atmosphere (§1.3).
- **No safety alert built on a modelled field** (`C3`). The lift potential triggers nothing.
- **No rewriting of `soaring-core`** (`C4`). What is missing from it gets added *there*; what is specific to this app stays *here*.

---

## How we will know it works

The spec (§9) asks for **quantified acceptance criteria**. The principle:

> **Every phase ends in a claim that can be checked, not a list of ticked boxes.**

| The claim | |
|---|---|
| Fly in Condor, live, and the height above ground is right. | ✅ 1502 m alt over 944 m of Napf: 558 m AGL, falling as the ground rises |
| Cut the network: the day's briefing holds, and the pilot knows what is missing. | ✅ provisioned, `fetch` killed, briefing intact off the disk |
| In Condor, our estimated wind matches the wind the simulator actually applied. | ✅ truth 270°/20 km/h → estimate 270.3°/19.9; netto to 0.004 m/s |
| A FLARM in the cockpit feeds the computer, and unplugging it does not kill it. | ✅ a dead source ages the values, visibly; the app lives |
| An FAI task validates under the rules actually in force. | ✅ START → TP1 → FINISH, in order, under `fai-2024` |
| The reach is not a circle, and the difference is a mountain. | ✅ from 1200 m, 20 of 36 bearings walled off where the circle promised 9 km |
| The app names the field it can still reach, and the one it cannot. | ✅ alternates sorted by arrival margin; an indeterminate field is never shown as reachable |

Every one of those was checked **by a test**. Not one was checked **by a pilot**.

> **The claim the next phase owes, and it is not a computation:**
> *a human opens the app, flies a Condor task with it, and can read it.*
>
> Every claim above is a number that a machine verified against another number. This one cannot be
> automated, has never been attempted, and is the only one that decides whether any of the others
> matter. Until it is met, this project has 551 passing tests and no evidence that it is a flight
> computer.

And the check that matters most, at every phase: **the forced-offline test** (§9). Pull the network
and fly. It is the only way to find out whether `OFF-001` is true.

---

_A roadmap is a plan, not a promise. Parts of it will be wrong; the point is that they be wrong
**visibly** — and that it never again be merely **stale**, which is how a plan lies without anyone
noticing._
