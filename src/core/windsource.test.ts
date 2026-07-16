import { test, expect } from 'bun:test';
import {
  windInUse, manualWind, manualStatus,
  MANUAL_FRESH_S, MANUAL_MAX_S, ESTIMATE_FRESH_S, INSTRUMENT_FRESH_S, MAX_SPEED_MS,
  type WindSources, type WindClaim,
} from './windsource';

/** 10:00 local, in seconds-of-day — the flight clock, the same one the fixes run on. */
const T10 = 10 * 3600;
const w = (speedMs: number, directionDeg: number, at: number): WindClaim => ({ speedMs, directionDeg, at });
const none: WindSources = { manual: null, instrument: null, estimate: null };

// ---------------------------------------------------------------- the pilot outranks the machines

test('THE PILOT WINS: he typed the briefing wind, and the box shows the briefing wind', () => {
  // VEN-002 exists because he could not type anything. If we ask him for a wind and then overrule it
  // with our own drift, we have taught him that the instrument ignores him — and he will stop
  // looking at the wind field at all, which is worse than where we started.
  const s: WindSources = {
    manual: w(10, 270, T10),
    estimate: w(4, 90, T10),          // our drift disagrees, loudly, and loses
    instrument: w(6, 180, T10),
  };
  const u = windInUse(s, T10 + 60)!;
  expect(u.speedMs).toBe(10);
  expect(u.directionDeg).toBe(270);
  expect(u.source).toBe('manual');
  expect(u.stale).toBe(false);
});

test('a MANUAL DEAD CALM is a claim, not a missing value — he looked at the sock and said calm', () => {
  // The whole discipline of this repo is that an unknown is null and never a plausible zero. The
  // converse must also hold: a zero a HUMAN asserted is real data and must not be mistaken for an
  // empty field, or the one pilot who correctly tells us it is calm gets his answer thrown away.
  const u = windInUse({ ...none, manual: w(0, 0, T10), estimate: w(7, 200, T10) }, T10 + 30)!;
  expect(u.source).toBe('manual');
  expect(u.speedMs).toBe(0);
});

// ---------------------------------------------------------------- and he expires

test('THE 10 O CLOCK WIND DOES NOT FLY THE 5 O CLOCK FINAL GLIDE', () => {
  // The failure this file was written for. He types the morning briefing at 10:00. At 17:00 the sea
  // breeze has been through, the gradient has backed and halved — and the box would still say 20 kt
  // because he said so, with his own hand, which is exactly why he would never doubt it.
  const s: WindSources = { ...none, manual: w(10, 270, T10), estimate: w(4, 90, T10 + 7 * 3600 - 60) };
  const u = windInUse(s, T10 + 7 * 3600)!;
  expect(u.source).toBe('estimate');
  expect(u.speedMs).toBe(4);
  expect(manualStatus(s.manual, T10 + 7 * 3600)).toBe('expired');
});

test('a stale manual is DEMOTED, not deleted: a live drift takes over the moment it goes stale', () => {
  const s: WindSources = { ...none, manual: w(10, 270, T10), estimate: w(4, 90, T10) };
  // One second inside the freshness: still his.
  expect(windInUse(s, T10 + MANUAL_FRESH_S)!.source).toBe('manual');
  // One second past it: the machines take the wheel, and nothing on screen is stale.
  const after = windInUse({ ...s, estimate: w(4, 90, T10 + MANUAL_FRESH_S) }, T10 + MANUAL_FRESH_S + 1)!;
  expect(after.source).toBe('estimate');
  expect(after.stale).toBe(false);
});

test('…but with NOTHING else alive, his stale wind still flies — flagged, because null would be a calm', () => {
  // The subtle trap: returning null here does not mean "no wind", it means the glide computer prices
  // every arrival in STILL AIR. An invented calm is a claim, and a worse one than his 40-minute-old
  // 20 kt. So it is used, and it is marked, and the screen must grey it and ask for a new one.
  const s: WindSources = { ...none, manual: w(10, 270, T10) };
  const u = windInUse(s, T10 + 40 * 60)!;
  expect(u.source).toBe('manual');
  expect(u.stale).toBe(true);
  expect(u.ageS).toBe(40 * 60);
  expect(manualStatus(s.manual, T10 + 40 * 60)).toBe('stale');
});

test('past MANUAL_MAX_S there is NOTHING — an expired wind is not renewed, extrapolated or rounded to calm', () => {
  const s: WindSources = { ...none, manual: w(10, 270, T10) };
  expect(windInUse(s, T10 + MANUAL_MAX_S + 1)).toBeNull();
  expect(manualStatus(s.manual, T10 + MANUAL_MAX_S + 1)).toBe('expired');
});

// ---------------------------------------------------------------- freshness beats rank

test('a LIVE instrument beats the wind he typed an hour ago', () => {
  // Rank decides between equals, never between the living and the dead. Anything else and a
  // forgotten entry from before the first climb outranks a wind arriving right now.
  const s: WindSources = { ...none, manual: w(10, 270, T10), instrument: w(6, 180, T10 + 3600) };
  const u = windInUse(s, T10 + 3600)!;
  expect(u.source).toBe('instrument');
  expect(u.stale).toBe(false);
});

test('OUR drift beats THEIR reported wind — the precedence this repo has always flown', () => {
  // Not a new opinion: `estimate() ?? reportedWind` is what the reach march, the alternates and the
  // terrain alarm already do. The reason it was chosen is in nmea.ts: Condor 3 reversed Condor 2's
  // LXWP0 direction convention, so the instrument's wind can arrive pointing exactly backwards while
  // looking entirely reasonable. Our drift comes from circles we flew, in a convention we own.
  const s: WindSources = { ...none, estimate: w(4, 90, T10), instrument: w(6, 270, T10) };
  expect(windInUse(s, T10 + 10)!.source).toBe('estimate');
});

test('…but on a blue glide with no circle behind us, the instrument is all there is, and it is used', () => {
  expect(windInUse({ ...none, instrument: w(6, 270, T10) }, T10 + 5)!.source).toBe('instrument');
});

// ---------------------------------------------------------------- the machines expire too

test('TWO MINUTES OF SILENCE IS A DEAD LINK, NOT A STEADY WIND', () => {
  // The Bluetooth dropped. The vario's last frame keeps sitting in nav state forever, and without an
  // age it would go on pricing final glides all afternoon as if the box were still talking.
  const s: WindSources = { ...none, instrument: w(6, 270, T10), estimate: w(4, 90, T10 - 600) };
  const u = windInUse(s, T10 + INSTRUMENT_FRESH_S + 1)!;
  expect(u.source).toBe('estimate');   // a 10-minute-old drift is better than a dead 2-minute link
  expect(u.stale).toBe(false);
});

test('an estimate older than the estimator MEMORY is another valley wind, and steps aside', () => {
  // wind.ts keeps WINDOW_S = 1200 s of track. Twenty minutes of glide is fifty kilometres: the wind
  // of that thermal is not the wind here.
  const s: WindSources = { ...none, estimate: w(4, 90, T10), instrument: w(6, 270, T10 + ESTIMATE_FRESH_S + 1) };
  expect(windInUse(s, T10 + ESTIMATE_FRESH_S + 1)!.source).toBe('instrument');
});

// ---------------------------------------------------------------- what it refuses to answer

test('NO SOURCE IS NULL — never a calm, never a zero, never a plausible number', () => {
  // The one line that must never change. Downstream, null means "we do not know" and the screen
  // shows an empty box a human can see. A 0 here would mean "still air", confidently, forever.
  expect(windInUse(none, T10)).toBeNull();
});

test('an NMEA sentence that decoded to NaN is NOT a wind', () => {
  // One NaN in the wind is a NaN in the arrival height, the reach polygon and the terrain alarm:
  // three instruments blank at once, for a truncated sentence. It does not vote, and we fall back.
  const s: WindSources = { ...none, instrument: w(NaN, 270, T10), estimate: w(4, 90, T10) };
  expect(windInUse(s, T10)!.source).toBe('estimate');
  expect(windInUse({ ...none, instrument: w(6, NaN, T10) }, T10)).toBeNull();
  expect(windInUse({ ...none, estimate: w(4, 90, NaN) }, T10)).toBeNull();
});

test('an EMPTY BOX is not a dead calm — Number("") === 0 is how a glide computer lies', () => {
  // The single most dangerous line of JavaScript in a cockpit. The pilot opened the wind dialog,
  // typed nothing, and pressed OK.
  expect(manualWind('', '270', T10)).toBeNull();
  expect(manualWind('  ', '270', T10)).toBeNull();
  expect(manualWind('10', '', T10)).toBeNull();
});

test('letters are not a wind, and a NEGATIVE speed is not a wind', () => {
  expect(manualWind('abc', '270', T10)).toBeNull();
  expect(manualWind(-3, 270, T10)).toBeNull();
  expect(manualWind(Infinity, 270, T10)).toBeNull();
});

test('A DIRECTION TYPED INTO THE SPEED BOX IS REFUSED, NOT CLAMPED', () => {
  // How the absurd number actually arrives: 270 in the wrong field, or km/h that never got
  // converted. Clamping it to MAX_SPEED_MS would hand the final glide a confident, plausible,
  // catastrophic 50 m/s headwind — clamping is how a fat finger becomes an arrival height.
  expect(manualWind(270, 270, T10)).toBeNull();
  expect(manualWind(MAX_SPEED_MS + 0.1, 270, T10)).toBeNull();
  expect(manualWind(MAX_SPEED_MS, 270, T10)).not.toBeNull();   // and the limit itself still works
});

test('a rejected entry does not become a wind — the previous one stands, nothing is substituted', () => {
  // manualWind returning null is the whole contract: the shell keeps what it had. There is no
  // "closest plausible value" in this file.
  const kept = manualWind(10, 270, T10)!;
  const rejected = manualWind('oops', 270, T10 + 60);
  expect(rejected).toBeNull();
  expect(windInUse({ ...none, manual: kept }, T10 + 120)!.speedMs).toBe(10);
});

// ---------------------------------------------------------------- the small mercies

test('the compass wraps, because 370 degrees is 10 degrees on every compass ever made', () => {
  expect(manualWind(8, 370, T10)!.directionDeg).toBe(10);
  expect(manualWind(8, -10, T10)!.directionDeg).toBe(350);
  expect(manualWind(8, 360, T10)!.directionDeg).toBe(0);
});

test('a French keyboard types 4,5 and that is a wind, not a syntax error', () => {
  expect(manualWind('4,5', '270', T10)!.speedMs).toBe(4.5);
});

test('MIDNIGHT AND A REWOUND REPLAY MUST NOT DELETE THE WIND HE JUST TYPED', () => {
  // Seconds-of-day wraps; a replay can be scrubbed backwards under a manual entry. A negative age is
  // a broken clock, not a wind from the future — and a wind that vanishes mid-glide because the day
  // turned over is a bug the pilot experiences as the instrument losing its mind.
  const u = windInUse({ ...none, manual: w(10, 270, 60) }, 10)!;   // "now" is BEFORE the entry
  expect(u.source).toBe('manual');
  expect(u.ageS).toBe(0);
  expect(u.stale).toBe(false);
});

test('every value that leaves here says WHERE IT CAME FROM, and how old it is', () => {
  // VEN-001: a measurement and an estimate are never merged and never wear the same label. Nothing
  // in this module averages the three — it CHOOSES, whole, and stamps the choice.
  const at = T10 + 300;
  for (const [src, s] of [
    ['manual', { ...none, manual: w(9, 10, at) }],
    ['estimate', { ...none, estimate: w(9, 10, at) }],
    ['instrument', { ...none, instrument: w(9, 10, at) }],
  ] as const) {
    const u = windInUse(s, at + 30)!;
    expect(u.source).toBe(src);
    expect(u.ageS).toBe(30);
    expect(u.speedMs).toBe(9);   // never an average of anything
  }
});

test('the thresholds are the file — order them wrong and the rule collapses', () => {
  expect(MANUAL_FRESH_S).toBeLessThan(MANUAL_MAX_S);
  expect(INSTRUMENT_FRESH_S).toBeLessThan(ESTIMATE_FRESH_S);   // a link that stops is dead sooner
  expect(MANUAL_FRESH_S).toBeGreaterThanOrEqual(15 * 60);      // do not nag him for a wind that has not changed
  expect(MANUAL_FRESH_S).toBeLessThanOrEqual(60 * 60);         // and do not let the morning fly the evening
});

test('manualStatus tells the screen when to ask for a new one — BEFORE we overrule him, not after', () => {
  expect(manualStatus(null, T10)).toBe('none');
  expect(manualStatus(w(10, 270, T10), T10 + 60)).toBe('fresh');
  expect(manualStatus(w(10, 270, T10), T10 + MANUAL_FRESH_S + 1)).toBe('stale');
  expect(manualStatus(w(10, 270, T10), T10 + MANUAL_MAX_S + 1)).toBe('expired');
  expect(manualStatus(w(NaN, 270, T10), T10)).toBe('none');    // nonsense is not a wind he typed
});
