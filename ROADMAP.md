# VOLPLANE — roadmap

A free soaring flight computer. Requirements: [`spec-volplane.md`](../spec-volplane.md) (v0.3, in French).

---

## Where we actually stand

Two facts, from the state-of-the-art review in §7bis of the spec, decide everything below. They pull in opposite directions.

**1. The MVP is made of things everyone already has.** NMEA acquisition, a MacCready glide solver, airspace, FAI tasks, FLARM, IGC logging: XCSoar, LK8000, XCTrack and TopHat all have them. **None of it exists here** — not in this repo, not in `soaring-core`.

**2. `soaring-core` holds the exact opposite.** Terrain, atmosphere, ephemeris, polars, flight maths, air-mass detection from tracks, and the **four predicted lift fields** that *nobody else* has. In the spec those are *Should* and *Could*. So the kernel holds the **differentiator** and none of the **foundation**.

The tempting conclusion is that six months of rebuilding the foundation must come before anything is visible. **That is wrong, and it is the pivot of this roadmap:**

> **The GROUND half of VOLPLANE — provisioning, briefing, offline completeness — needs no instrument, no airspace and no task.** It rests almost entirely on what `soaring-core` already computes. It ships **first**, it is **verifiable**, and it is **useful** before a single NMEA sentence has been parsed.

It is also where `OFF-003` and `OFF-010` live — the module the spec calls its **priority**.

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

## Phase 6 — Beyond the MVP

`CNC` (OLC/FAI optimisation) · `ANA-001…003` (barograph, effective polar, cross-section) · `TER-005` (unreachable terrain) · `PLA-007` (final glide around terrain) · `TER-006` (3D synthetic vision) · `OFF-012` (standalone app) · `VAR-004/005` (audio).

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

| Phase | The claim |
|---|---|
| 0 | Fly in Condor, live, and the height above ground is right. |
| 1 | Cut the network: the day's briefing holds, and the pilot knows what is missing. |
| 2 | In Condor, our estimated wind matches the wind the simulator actually applied. |
| 3 | A FLARM in the cockpit feeds the computer, and unplugging it does not kill it. |
| 4 | An FAI task validates under the rules actually in force. |

And the check that matters most, at every phase: **the forced-offline test** (§9). Pull the network and fly. It is the only way to find out whether `OFF-001` is true.

---

_A roadmap is a plan, not a promise. Parts of it will be wrong; the point is that they be wrong **visibly**._
