// ============ the English catalogue (IHM-006) ============
// English is the reference language: every other catalogue is typed against THIS object's keys,
// so a key that exists here and nowhere else is a compile error, not a blank label in a cockpit.
//
// The safety sentences below are not decoration. FLM-005's see-and-avoid, POT-007's modelled
// badge, LND-003's indeterminate — a pilot who cannot read the warning does not heed it, so a
// warning gets the same care as a unit label. Two of them (flarm.seeAndAvoid, lnd.noneReachable)
// are copied VERBATIM from the kernel constants that promise them; i18n.test.ts asserts the
// equality so the catalogue can never quietly drift from what the kernel said it would say.

export const EN = {
  // ---- InfoBox labels (IHM-001) ----
  // Short, because they sit above a number on a small screen and the number is the message.
  'box.lat': 'lat',
  'box.lon': 'lon',
  'box.alt': 'alt',
  'box.altQnh': 'alt QNH',
  'box.ground': 'ground',
  'box.agl': 'AGL',
  'box.vario': 'vario',
  'box.avg30': 'avg 30 s',
  'box.lastThermal': 'last thermal',
  'box.lastCircle': 'last circle',
  'box.netto': 'netto',
  'box.superNetto': 'super netto',
  'box.tas': 'TAS',
  'box.groundSpeed': 'ground speed',
  'box.stf': 'STF',
  'box.windDir': 'wind dir',
  'box.windSpeed': 'wind speed',
  'box.instWindDir': 'inst wind dir',
  'box.instWindSpeed': 'inst wind speed',
  'box.arrival': 'arrival',
  'box.mc': 'MC',

  // ---- pages (IHM-002) ----
  'page.cruise': 'cruise',
  'page.climb': 'climb',
  'page.finalGlide': 'final glide',

  // ---- tabs ----
  'tab.fly': 'fly',
  'tab.briefing': 'briefing',
  'tab.analysis': 'analysis',
  'tab.settings': 'settings',

  // ---- settings (CFG-002 / CFG-003) ----
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.units': 'Units',
  'settings.preset': 'Preset',
  'settings.preset.metric': 'metric',
  'settings.preset.imperial': 'imperial',
  'settings.preset.aviation': 'aviation',
  'settings.glider': 'Glider',
  'settings.glider.library': 'Library',
  'settings.glider.mass': 'Mass in flight',
  'settings.glider.unknownMaker': 'maker not recorded',
  'settings.glider.refMass': 'Reference mass',
  // The polar as published flies at {ref}; {min}–{max} is the band the box will accept. Printed,
  // not merely enforced: a refused mass repaints the box empty, and a pilot who cannot see WHY
  // would read that as the app losing his input.
  'settings.glider.massBand': 'Published at {ref} {unit} — accepts {min}–{max} {unit}',
  'settings.glider.imported': 'imported',
  'settings.glider.default': 'default',
  'settings.pages': 'Pages',
  'settings.pages.boxes': 'Boxes',
  'settings.moveUp': 'move up',
  'settings.moveDown': 'move down',
  'settings.remove': 'remove',
  'settings.add': 'add',
  'quantity.altitude': 'altitude',
  'quantity.distance': 'distance',
  'quantity.speed': 'speed',
  'quantity.vario': 'vario',
  'quantity.mass': 'mass',
  'quantity.wingload': 'wing loading',
  'quantity.pressure': 'pressure',
  'quantity.temperature': 'temperature',

  // ---- badges: what a number IS, said next to the number (POT-007, C3) ----
  // A modelled value never drives a safety behaviour; the badge is how the screen says so.
  'badge.modelled': 'modelled',
  'badge.modelled.title': 'indicative, not validated — not a measurement',
  'badge.estimated': 'est',
  'badge.estimated.title': 'from circle drift — an estimate, not the instrument',

  // ---- the safety sentences ----
  // Verbatim from flarm.ts / landables.ts. Do not "improve" them here; change the kernel.
  'data.ageUnknown': 'the age of the data is unknown',
  'flarm.seeAndAvoid': 'FLARM sees only other FLARMs — traffic display does not replace looking out',
  'lnd.noneReachable': 'NO landable field within reach',
  'lnd.limit.glide': 'short on glide',
  'lnd.limit.terrain': 'ridge in the way',
  'lnd.limit.unknown': 'terrain not loaded',
  'lnd.indeterminate': 'UNKNOWN',
  'link.stale': 'values are the LAST RECEIVED, not current',

  // ---- the two banners that interrupt (FLM-002, FLM-005, TER-008) ----
  // These are the sentences a pilot reads while something is coming at him. They are short
  // because he has no time, and they name the LEVEL because a colour cannot be heard.
  'alert.flarm.head': 'FLARM — ALARM {level}',
  'alert.threat': 'Threat',
  'alert.clock': "{h} o'clock",
  'alert.relTrack': 'rel. track',
  'alert.terrain.head': 'TERRAIN — ALARM {level}',
  'alert.cause.glide': 'glide reaches the ground',
  'alert.toImpact': 'to impact',
  // TER-008's hard clause: unmeasured is NOT an alarm, and this sentence is what keeps it from
  // reading as one. It says what we do not know, not what is out there.
  // {dist} arrives PREFORMATTED, unit and all. It used to be '{km} km', which baked the kilometre
  // into the translation: a unit the pilot's unit setting could never reach, living in a catalogue.
  // A unit belongs in units.ts, and a sentence belongs here.
  'alert.groundAhead': 'the ground ahead is NOT loaded beyond {dist} — unmeasured, not clear',
  'flarm.heard': 'FLARM — {rx} heard',

  // ---- the divert panel's silences (LND-003/004/006/008) ----
  // Each of these exists because a BLANK panel means five different things, and the pilot reads
  // a blank as "nothing to report". Every silence gets its own sentence.
  'lnd.reachUnknown': 'terrain not loaded — reachability UNKNOWN, not refused',
  'lnd.noAltitude': 'no altitude — no glide slope, so nothing was judged',
  'lnd.noLandableInFile': 'the loaded file holds no landable field',
  'lnd.noFieldInRadius': 'no landable field within {dist} — this file does not cover the ground you are over',
  'lnd.noStyleSelected': 'every landable type is unticked — the list is FILTERED, not empty',
  'lnd.someNotJudged': '{judged} of {inRadius} fields within {dist} judged — the rest were not asked about',
  'lnd.noneOfJudgedReachable': 'NONE of the {judged} fields judged is within reach',
  'lnd.stale': 'these verdicts are from the LAST fix received, not from now',

  // ---- the .cup categories (LND-007) ----
  // The kernel's catLabel is the English spelling and stays the source; these translate it.
  'cup.cat.airfield-grass': 'grass airfield',
  'cup.cat.airfield-gliding': 'gliding airfield',
  'cup.cat.airfield-solid': 'solid-surface airfield',
  'cup.cat.outlanding': 'outlanding field',
  'cup.cat.summit': 'summit',
  'cup.cat.pass': 'mountain pass',
  'cup.cat.obstacle': 'obstacle',
  'cup.cat.landmark': 'landmark',
  'cup.cat.waypoint': 'waypoint',

  // ---- the task ribbon (TSK-006, TSK-007) ----
  'task.title': 'Task',
  'task.scored': 'scored',
  'task.left': 'left',
  'task.eta': 'ETA',
  'task.elapsed': 'elapsed',
  'task.onTask': 'on task',
  'task.required': 'required',
  'task.vsMinTime': 'vs min time',
  'task.complete': 'COMPLETE',

  // ---- the briefing (WX-003/005, OFF-005/010/011, ANA-004) ----
  'bf.title': 'Briefing — {hour}:00 UTC',
  'bf.sandboxBanner': 'SANDBOX — synthetic atmosphere',
  'bf.cloudbase': 'Cloudbase',
  'bf.ceiling': 'Ceiling',
  'bf.stability': 'Stability N',
  'bf.convection': 'Convection',
  'bf.cumulus': 'cumulus',
  'bf.blue': 'blue',
  'bf.openTop': 'open top',
  'bf.windProfile': 'Wind profile',
  // The unit is a PARAMETER, not part of the header: the column below it is formatted in whatever
  // the pilot chose, and a header that said km/h over a column of knots would be the worst of both.
  'bf.wind.alt': 'alt ({unit})',
  'bf.wind.speed': 'speed ({unit})',
  'bf.wind.from': 'from (°)',
  'pack.ready': 'Pack is flight-ready',
  'pack.notReady': 'Pack is NOT flight-ready — {gaps}',
  'pack.flight': 'Flight data — guaranteed offline',
  'pack.enrichment': 'Enrichment — optional',
  'pack.none': 'No pack — enter a centre, a radius and a day above.',
  'net.online': 'online',
  'net.offline': 'offline',
  'net.weather': 'weather',
  'net.volatile': 'cache is in memory only — it will not survive a restart',
  'age.min': '{n} min old',
  'age.hours': '{n} h old',

  // ---- the circling assistant (THE-001, THE-002) ----
  'rose.none': 'not circling — no rose',
  'rose.head': 'Circling assistant',
  'rose.notSampled': 'not sampled',
  'rose.shift': 'shift towards {bearing}° · {vz} m/s',
  // Two silences, two sentences. A flat rose is a FINDING; an unmapped one is an ABSENCE.
  'rose.underSampled': 'not enough of the circle sampled — no advice',
  'rose.evenLift': 'even lift — no shift',
  'badge.estimated.rose': 'binned vario around an inferred circle centre — an estimate, not the instrument',

  // ---- the moving map and the cross-section (CAR, TER-001/005, LND, SYS-002) ----
  'map.range': 'range: still air, no wind',
  'map.reach': 'reach: over terrain, wind included',
  'map.terrainUnloaded': '{pct}% of the visible ground is NOT loaded',
  'map.landableScope': 'fields: {judged} of {inRadius} judged within {dist} — none drawn beyond',
  'map.landablesStale': 'fields: judged at the LAST fix, not from now',
  'xs.groundUnloaded': '{pct}% of the ground ahead is NOT loaded',

  // ---- the lift-map legend (POT-002/007) ----
  'legend.inactive': 'inactive — nothing to model with',
  'legend.terrainKnown': 'terrain {pct}% known',

  // ---- the shelf, the offers and the cache line (OFF-006/007/009/010/011) ----
  'shelf.empty': 'No packs yet — provision one above and it will be remembered',
  'shelf.flightReady': 'flight-ready',
  'shelf.notFlightReady': 'NOT flight-ready',
  'shelf.pinned': 'pinned — protected from eviction',
  'shelf.pin': 'pin for flight',
  'shelf.remove': 'remove',
  'shelf.open': 'open',
  'shelf.updateNow': 'update now',
  'shelf.reason.tiles-missing': 'terrain: no tiles held — the pack cannot carry a flight',
  'shelf.reason.tiles-partial': 'terrain: tiles missing — the pack is not flight-ready',
  'shelf.reason.weather-missing': 'weather: no snapshot held',
  'shelf.reason.weather-stale': 'weather: snapshot fetched more than 48 h ago',
  'shelf.reason.weather-wrong-day': 'weather: snapshot is for another day',
  'cache.usage': '{used} of {budget} MB',
  'cache.evictedNothing': 'last enforcement evicted nothing',
  'cache.evicted': 'last enforcement evicted {n} tiles ({mb} MB)',
  'cache.overBudget': 'pinned packs alone exceed the ceiling ({mb} MB pinned) — pinned packs are never evicted, so the ceiling cannot be met',
  'cache.saveFailed': 'shelf could not be saved — {error} — pins and packs shown here will NOT survive a restart',
  'shelf.remeasureFailed': 'shelf could not be re-measured — {error}',

  // ---- the repository (OFF-009's other half) ----
  'repo.empty': 'The catalogue holds nothing yet.',
  'repo.note': 'These files are served by the people who maintain them. VOLPLANE does not host them and does not correct them — it downloads them and tells you how old yours is.',
  'repo.offline': 'offline — what is already downloaded still works; nothing new can be fetched',
  'repo.notDownloaded': 'not downloaded',
  'repo.dated': '{days} days old (file dated {date})',
  'repo.checkUpdate': ' — check for an update',
  // The dangerous one: we know when WE fetched it and nothing about when the DATA was made.
  'repo.undated': 'fetched {days} days ago — the file states no date, so the AGE OF THE DATA is unknown',
  'repo.licenceUnknown': 'licence unknown',
  'repo.licenceUnknown.title': 'Not established. Unknown is not permission — this app will not share the file.',
  'repo.notRedistributable': ' — not redistributable',
  'repo.maintainedBy': 'maintained by',
  'repo.download': 'download',
  'repo.update': 'update',
  'repo.use': 'use',
  'repo.fetching': 'fetching {name}…',
  'repo.downloadFailed': '{name}: download failed ({error}) — the airspace you already had is unchanged',
  'repo.nothingStored': 'nothing stored for that entry',

  // ---- the Fly screen's own sentences (main.ts) ----
  'fly.link': 'Link: {state}',
  'fly.journalFailing': 'journal writes failing ({error}): a crash now loses the whole flight',
  'fly.noGoal': 'no goal',
  'fly.noGoalNeedFix': 'no goal — need a fix over known ground',
  'fly.goalAt': 'goal {lat}, {lon} @ {elev}',
  'fly.goalBox': '▸ goal',
  'fly.windEstimated': 'estimated wind',
  'fly.windInstrument': 'instrument wind',
  'fly.windNone': 'no wind',
  // The Fly control strip (IHM-006). These used to be English strings baked into main.ts's markup,
  // which is to say: labels the catalogue could not reach and the pilot could not read. They are the
  // controls he touches in the air.
  'fly.mc': 'MC',
  'fly.qnh': 'QNH',
  'fly.reserve': 'reserve',
  'fly.horizon': 'terrain horizon',
  'fly.horizon.title': 'TER-008: how far AHEAD the terrain alarm looks, in seconds — time is what the pilot can act on, metres are not',
  'fly.goalHere': 'goal: here',
  'fly.goalHere.title': 'make the current position and ground the final-glide goal',
  'fly.record.title': 'record the flight as an IGC file (LOG)',
  'fly.airspaceFile': 'airspace (OpenAir)',
  'fly.taskFile': 'task (CSV)',
  'fly.taskFile.title': "TSK: waypoints as 'name,lon,lat[,aat]' lines — start first, finish last, fai-2024 sectors; 'aat' marks an assigned area",
  'fly.taskTime': 'task time',
  'fly.taskTime.title': 'TSK-007/TSK-006: the organisers\' task time — the minimum time on an AAT, the target time on a racing task. Left empty it is UNKNOWN, not zero, and those figures read as dashes.',
  'fly.polarFile': 'polar (.plr)',
  'fly.polarFile.title': "PLA-010: your glider's polar, as a WinPilot .plr file",
  'fly.polarDefaultBtn': 'default',
  'fly.polarDefaultBtn.title': 'forget the imported polar and fly the built-in default',
  'fly.landablesFile': 'landables (.cup)',
  'fly.landablesFile.title': 'CFG-007: SeeYou waypoints — the landable fields',
  'fly.alertClasses': 'alert classes',
  'fly.alertClasses.title': 'ESP-004: airspace classes that ALERT, comma-separated — empty means all; the map always draws everything',
  'fly.audio.title': 'VAR-004: the vario, out loud. Browsers only allow sound after a click — this is that click.',
  'fly.stfMode': 'speed-to-fly mode (VAR-005)',
  'fly.record': '● record',
  'fly.stopSave': '■ stop & save',
  'fly.savedFixes': 'saved {n} fixes',
  'fly.audioOff': '🔇 audio off',
  'fly.audioOn': '🔊 audio on',
  'fly.audioNone': 'no audio output on this platform',
  'fly.cupRefused': 'no waypoints the parser could read — keeping the current landables',
  'fly.taskRefused': 'a task needs at least a start and a finish',
  'fly.plrRefused': 'not a .plr the parser accepts — keeping {name}',
  'fly.polarDefault': '{name} (default)',
  'fly.restored': '{label} (restored: {name})',
  'fly.airspaceRefused': '0 volumes parsed ({refused} refused) — file rejected, keeping the current airspace',
  'fly.airspaceLoaded': '{n} volumes loaded',
  'fly.airspaceRefusedSome': ', {n} refused',
  'fly.fromRepository': '{label} (from the repository)',
  'orphan.recovered': 'recovered flight from a crash — {fixes} fixes',
  'orphan.download': 'download',
  'orphan.dismiss': 'dismiss',
  'orphan.confirm': 'Discard the recovered flight ({fixes} fixes)? It exists nowhere else.',

  // ---- the Briefing screen's own sentences (main.ts) ----
  'bf.provisionFirst': 'enter a centre, a radius and a day first',
  'bf.starting': 'starting…',
  'bf.done': 'done — {ok} items held',
  'bf.partial': '{ok} held, {failed} failed — see completeness below',
  'bf.interrupted': 'download interrupted — see completeness below',
  'bf.enforceFailed': ' — cache enforcement failed: {error}',
  'bf.calibration': 'calibration —',
  'bf.calibrationNeedsArea': 'calibration — (choose an area and day first)',
  'bf.calibrationOf': 'calibration ×{factor}',
  'bf.calibrationFrom': '(from {n} usable climbs)',
  'bf.calibrationRefused': 'calibration — (needs a forecast and ≥ {n} usable climbs)',

  // ---- the Analysis screen (ANA-001/003, CNC-001/002/003) ----
  'ana.title': 'VOLPLANE — analysis',
  'ana.noFlight': 'No flight yet — connect to Condor, or replay an IGC on the Fly screen, and this screen fills itself from the fixes as they arrive.',
  'ana.maxAlt': 'Max altitude',
  'ana.gain': 'Height gained',
  'ana.climbs': 'Climbs',
  'ana.achievedLD': 'Achieved L/D',
  'ana.polarLD': 'Polar L/D',
  'ana.ratio': 'Achieved / book',
  'ana.uncorrected': 'uncorr.',
  'ana.uncorrected.title': 'ground distance, no wind estimate yet — a downwind glide flatters it',
  'ana.polarLD.title': 'what the polar claims — a model of the glider, not a measurement of this flight',
  'ana.scoring': 'Scoring — {rules}',
  'ana.freeDistance': 'Free distance',
  'ana.freePoints': 'Free points',
  'ana.faiDistance': 'FAI triangle',
  'ana.faiPoints': 'FAI points',
  'ana.shortestLeg': 'Shortest leg',
  'ana.faiOk': 'FAI ok',
  'ana.faiOk.title': 'CNC-003: the 28% shape rule is satisfied — the search only ever returns legal triangles',
  'ana.disclaimer': 'A cockpit estimate on a decimated track (CNC). The IGC file, scored by the league’s own software, is the judge of record — this number is for flying by, not for claiming with.',
  'ana.barograph': 'Barograph',
  'ana.barographNote': 'Shaded: the climbs, as soaring-core’s detector found them.',
} as const satisfies Record<string, string>;
