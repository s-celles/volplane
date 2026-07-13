import { expect, test, describe } from 'bun:test';
import {
  alertsHtml as alertsHtmlT, trafficPanelHtml as trafficPanelHtmlT,
  clockOf as clockOfT, arrowOf,
} from './alerts-ui';
import { SEE_AND_AVOID, type AlarmLevel, type FlarmStatus, type Traffic } from '../core/flarm';
import type { TerrainVerdict } from '../core/terrainalarm';
import { translator } from '../core/i18n';
import { PRESETS } from '../core/units';

// IHM-006. The renderers now take a translator, and every claim below is unchanged: the sentences
// moved into the catalogue, not out of the app. SEE_AND_AVOID is still imported from the KERNEL,
// and i18n.test.ts asserts the English catalogue entry is character-for-character that constant —
// so a test that reads the English rendering is still reading flarm.ts's own promise.
const en = translator('en');
const fr = translator('fr');
// Metric unless a test says otherwise — the units the claims below were written in. CFG-003's own
// claim (the banners follow the pilot's choice) is pinned separately, at the bottom of the file.
const METRIC = PRESETS.metric;
const alertsHtml = (x: Parameters<typeof alertsHtmlT>[0]): string => alertsHtmlT(x, METRIC, en);
const trafficPanelHtml = (f: FlarmStatus | null, pic: readonly Traffic[]): string =>
  trafficPanelHtmlT(f, pic, METRIC, en);
const clockOf = (b: number | null): string | null => clockOfT(b, en);

const CLEAR: TerrainVerdict = { kind: 'clear' };

const flarm = (o: Partial<FlarmStatus> = {}): FlarmStatus => ({
  rx: 3, alarm: 2, bearing: 60, relVertical: -40, relDistance: 800, at: 100, ...o,
});

const other = (o: Partial<Traffic> = {}): Traffic => ({
  id: 'DD8F41', alarm: 0, relNorth: 900, relEast: 1200, relVertical: -40,
  track: 90, groundSpeed: 30, climbRate: 1.2, at: 100, ...o,
});

describe('the clock direction', () => {
  test('dead ahead is twelve, never zero', () => {
    expect(clockOf(0)).toBe("12 o'clock");
    expect(clockOf(5)).toBe("12 o'clock");
  });

  test('positive is to the right, negative to the left', () => {
    expect(clockOf(60)).toBe("2 o'clock");
    expect(clockOf(-60)).toBe("10 o'clock");
    expect(clockOf(180)).toBe("6 o'clock");
    expect(clockOf(-180)).toBe("6 o'clock");
  });

  test('an unknown bearing has no direction — not a default one', () => {
    expect(clockOf(null)).toBeNull();
    expect(arrowOf(null)).toBeNull();
  });

  test('the arrow points the way the clock says', () => {
    expect(arrowOf(0)).toBe('↑');
    expect(arrowOf(90)).toBe('→');
    expect(arrowOf(-90)).toBe('←');
  });
});

describe('the FLARM banner (FLM-002, FLM-005)', () => {
  test('nothing to shout about renders nothing', () => {
    expect(alertsHtml({ flarm: null, terrain: CLEAR })).toBe('');
    expect(alertsHtml({ flarm: flarm({ alarm: 0 }), terrain: CLEAR })).toBe('');
  });

  test('level 3 and level 2 are visually distinct facts, not the same banner twice', () => {
    const two = alertsHtml({ flarm: flarm({ alarm: 2 }), terrain: CLEAR });
    const three = alertsHtml({ flarm: flarm({ alarm: 3 }), terrain: CLEAR });
    expect(two).toContain('alarm-2');
    expect(three).toContain('alarm-3');
    expect(two).not.toContain('alarm-3');
    expect(three).not.toContain('alarm-2');
    expect(two).not.toBe(three);
  });

  test('the banner names the direction of the threat', () => {
    const h = alertsHtml({ flarm: flarm({ alarm: 3, bearing: 60 }), terrain: CLEAR });
    expect(h).toContain("2 o'clock");
    expect(h).toContain('↗');
    expect(h).toContain('+60°');
  });

  test('a null bearing renders the dash — never a guessed direction', () => {
    const h = alertsHtml({ flarm: flarm({ bearing: null }), terrain: CLEAR });
    expect(h).toContain('—');
    expect(h).not.toContain("o'clock");
  });

  test('a null height and a null distance render the dash, never a zero', () => {
    const h = alertsHtml({
      flarm: flarm({ relVertical: null, relDistance: null }), terrain: CLEAR,
    });
    expect(h).toContain('—');
    expect(h).not.toContain('0 m');
  });

  test('the height and distance are shown when the instrument has them', () => {
    const h = alertsHtml({ flarm: flarm({ relVertical: -40, relDistance: 800 }), terrain: CLEAR });
    // Both figures now come out of the units table (CFG-003), which is what lets them follow the
    // pilot's choice instead of contradicting the boxes above them. A separation BELOW is a true
    // minus (U+2212), the same glyph the divert margins and the task ribbon already use — one
    // vocabulary for one fact — and the range is read in his distance unit.
    expect(h).toContain('−40 m');
    expect(h).toContain('0.8 km');
  });

  test('FLM-005: the see-and-avoid sentence ships with every alarm, verbatim', () => {
    for (const alarm of [1, 2, 3] as const) {
      expect(alertsHtml({ flarm: flarm({ alarm }), terrain: CLEAR })).toContain(SEE_AND_AVOID);
    }
  });
});

describe('the terrain banner (TER-008)', () => {
  test('clear is silence — the empty string', () => {
    expect(alertsHtml({ flarm: null, terrain: { kind: 'clear' } })).toBe('');
  });

  test('an alarm names the level, the distance and the time to impact', () => {
    const h = alertsHtml({
      flarm: null,
      terrain: {
        kind: 'alarm', level: 3, distanceM: 1200, timeToImpactS: 24,
        cause: 'terrain', bearing: 130,
      },
    });
    expect(h).toContain('TERRAIN');
    expect(h).toContain('alarm-3');
    expect(h).toContain('1.2 km');
    expect(h).toContain('24 s');
  });

  test('level 2 and level 3 do not wear the same class', () => {
    const two = alertsHtml({
      flarm: null,
      terrain: { kind: 'alarm', level: 2, distanceM: 1800, timeToImpactS: 50, cause: 'glide', bearing: 90 },
    });
    expect(two).toContain('alarm-2');
    expect(two).not.toContain('alarm-3');
  });

  test('a null time to impact renders the dash, never a zero', () => {
    const h = alertsHtml({
      flarm: null,
      terrain: {
        kind: 'alarm', level: 2, distanceM: 900, timeToImpactS: null,
        cause: 'glide', bearing: 10,
      },
    });
    expect(h).toContain('—');
    expect(h).not.toContain('0 s');
  });

  test('unmeasured is a NOTE and never an alarm: no alarm class, no siren word', () => {
    const h = alertsHtml({ flarm: null, terrain: { kind: 'unmeasured', distanceM: 3400 } });
    expect(h).toContain('NOT loaded');
    expect(h).toContain('3.4 km');
    // TER-008's honesty rule, made testable: an absence of measurement is not a danger.
    expect(h).not.toContain('alarm-');
    expect(h).not.toContain('ALARM');
    expect(h).not.toContain('TERRAIN —');
    expect(h).not.toContain('class="alert');
  });

  test('the two banners can stand together, traffic first', () => {
    const h = alertsHtml({
      flarm: flarm({ alarm: 3 }),
      terrain: { kind: 'alarm', level: 2, distanceM: 1500, timeToImpactS: 40, cause: 'terrain', bearing: 0 },
    });
    expect(h.indexOf('FLARM')).toBeLessThan(h.indexOf('TERRAIN'));
  });
});

describe('the traffic panel beside the banner', () => {
  // THE CLAIM THIS FILE EXISTS TO KEEP. FLM-005 is a display requirement, and the sentence is
  // now shared between two renderers — the banner shouts it under an alarm, the panel carries it
  // when there is none. Shared means breakable: it takes one careless edit for the sentence to
  // appear twice (noise, and the second copy teaches the eye that the first is decoration) or
  // zero times (a traffic display that never says see-and-avoid, which is the requirement gone).
  // So the pair is pinned as a pair, at every level the instrument can report.
  test('SEE_AND_AVOID appears EXACTLY ONCE at every alarm level, banner plus panel', () => {
    for (const level of [0, 1, 2, 3] as AlarmLevel[]) {
      const f = flarm({ alarm: level });
      const html = alertsHtml({ flarm: f, terrain: CLEAR })
        + trafficPanelHtml(f, [other({ alarm: level })]);
      const count = html.split(SEE_AND_AVOID).length - 1;
      expect(count).toBe(1);
    }
  });

  test('no FLARM heard: no panel at all — an empty box teaches the eye to skip that strip', () => {
    expect(trafficPanelHtml(null, [])).toBe('');
    expect(trafficPanelHtml(null, [other()])).toBe('');
  });

  test('the panel does NOT restate the alarm — the banner owns that word', () => {
    const p = trafficPanelHtml(flarm({ alarm: 3 }), [other({ alarm: 3 })]);
    expect(p).not.toContain('ALARM');
    expect(p).toContain('3 heard');            // it says what it alone knows: who is out there
    expect(p).toContain('DD8F41');
    expect(p).toContain('alarm-3');            // …and it keeps the LEVEL's colour on the row
  });

  test('an unknown relative height is a dash, never a zero on the same line as a real one', () => {
    const p = trafficPanelHtml(flarm({ alarm: 0 }), [other({ relVertical: null })]);
    expect(p).toContain('—');
    expect(p).not.toContain('0 m');
  });
});


// ---- IHM-006: the same panel, in French ----

describe('the alerts speak the pilot\'s language (IHM-006)', () => {
  test('the see-and-avoid sentence is TRANSLATED, not merely reprinted in English', () => {
    const f = flarm({ alarm: 3 });
    const english = alertsHtmlT({ flarm: f, terrain: CLEAR }, METRIC, en);
    const french = alertsHtmlT({ flarm: f, terrain: CLEAR }, METRIC, fr);
    // The kernel's sentence is what the English renders; the French renders a real translation of
    // it — and NOT the English one, which would be the failure mode a catalogue exists to prevent
    // (a French pilot reading a warning he cannot parse is a pilot who does not heed it).
    expect(english).toContain(SEE_AND_AVOID);
    expect(french).toContain(fr('flarm.seeAndAvoid'));
    expect(french).not.toContain(SEE_AND_AVOID);
    expect(french).toContain('ALARME 3');
  });

  test('the unmeasured-ground note is French too — and still not an alarm', () => {
    const v: TerrainVerdict = { kind: 'unmeasured', distanceM: 3400 };
    const french = alertsHtmlT({ flarm: null, terrain: v }, METRIC, fr);
    expect(french).toContain(fr('alert.groundAhead', { dist: '3.4 km' }));
    expect(french).not.toContain('NOT loaded');
    expect(french).not.toContain('alert');          // still a note, never a banner (TER-008)
  });
});


// ---- CFG-003: the banners read in the unit the pilot chose ----

test('the banners honour the pilot\'s units — the same quantity cannot read twice on one screen', () => {
  // The failure this pins: the InfoBoxes a centimetre above the banner printed feet while the
  // banner printed metres, because the banner had no idea a unit setting existed.
  const AV = PRESETS.aviation;
  const f = flarm({ relVertical: -40, relDistance: 1852 });
  const h = alertsHtmlT({ flarm: f, terrain: CLEAR }, AV, en);
  expect(h).toContain('−131 ft');                 // 40 m below, in the unit he flies
  expect(h).toContain('1.0 NM');
  expect(h).not.toContain('−40 m');
  expect(h).not.toContain('0.8 km');

  // The terrain note too — and its distance reaches the catalogue already formatted, so no
  // kilometre survives in the sentence itself.
  const note = alertsHtmlT(
    { flarm: null, terrain: { kind: 'unmeasured', distanceM: 3704 } }, AV, en);
  expect(note).toContain('2.0 NM');
  expect(note).not.toContain('km');

  // And the traffic rows, which are the same three facts in a list.
  const rows = trafficPanelHtmlT(flarm({ alarm: 0 }), [other({ relVertical: 120 })], AV, en);
  expect(rows).toContain('+394 ft');
  expect(rows).not.toContain('+120 m');
});
