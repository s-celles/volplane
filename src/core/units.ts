// ============ units, per quantity, converted at the last centimetre (CFG-003) ============
// "Le système DOIT permettre le choix des unités par grandeur." Per QUANTITY — not one global
// switch. A European glider pilot routinely flies feet for altitude, knots for speed and metres
// per second for the vario, all at once; a single metric/imperial toggle cannot express the way
// he actually reads his panel.
//
// The canonical in-memory unit — what every other module stores, computes and passes around:
//
//   altitude      m          distance     m
//   speed         m/s        vario        m/s
//   mass          kg         wingload     kg/m²
//   pressure      hPa        temperature  °C
//
// hPa and °C rather than Pa and K, deliberately. The app already stores QNH in hPa (compute.ts's
// qnhAlt(pressureAlt, qnh) subtracts 1013.25) and the sounding in °C. Inventing a second internal
// spelling of pressure would create exactly the drift this module exists to end — two truths in
// the store, and a factor of 100 waiting for a hurried commit.
//
// Conversion happens at the RENDER, never at the store. A store that holds feet is a store that
// can no longer be re-read in metres: the metre is gone, only its rounded shadow remains, and
// every downstream computation — the glide, the polar, the arrival height — now has to guess
// which unit it was handed. Worse, a pilot who changes his unit would change his FLIGHT: the
// numbers feeding the safety logic would move because he touched a display setting. So the store
// is SI, the maths is SI, and only the last centimetre before the pixel knows what a foot is.
//
// And a null formats as a dash, never as a zero (POT-007). "0 ft" is a measurement; a dash is the
// honest admission that nobody made one. The unit disappears with the value, because "— ft" still
// claims a foot was involved.

export type Quantity =
  | 'altitude' | 'distance' | 'speed' | 'vario'
  | 'mass' | 'wingload' | 'pressure' | 'temperature';

/** The exhaustive list, in the order the settings screen shows it. The UI iterates THIS, so a
 *  new quantity appears on screen without the UI file changing — and the tests below force it
 *  to carry a unit in every system before it can be added at all. */
export const QUANTITIES: readonly Quantity[] = [
  'altitude', 'distance', 'speed', 'vario', 'mass', 'wingload', 'pressure', 'temperature',
];

/** A preset that fills a whole row of choices — never the choice itself (that is per quantity).
 *
 *  'aviation' is the mixed system most European glider pilots actually fly: feet for altitude
 *  (that is what the airspace is written in), knots for speed, nautical miles for distance, and
 *  metres per second for the vario — because a vario in ft/min is a number a European pilot has
 *  to translate before he can decide whether to turn. It is not an inconsistency, it is the
 *  panel. */
export type UnitSystem = 'metric' | 'imperial' | 'aviation';

export type UnitCode =
  | 'm' | 'ft' | 'km' | 'NM' | 'mi'
  | 'km/h' | 'kt' | 'mph' | 'm/s' | 'ft/min'
  | 'kg' | 'lb' | 'kg/m²' | 'lb/ft²'
  | 'hPa' | 'inHg' | '°C' | '°F';

/** What the pilot chose, one system per quantity. Mixing rows is the normal case, not an edge
 *  case: { ...PRESETS.metric, altitude: 'aviation' } is a real panel. */
export type UnitPrefs = Record<Quantity, UnitSystem>;

/** From SI to the unit, and the digits it is read to. An affine form (scale then offset) because
 *  temperature is not a ratio: 0 °C is 32 °F, and a naive multiply would quietly say 0 °F on a
 *  freezing day — the exact kind of plausible-looking wrong this module exists to prevent. */
interface UnitDef {
  code: UnitCode;
  scale: number;
  offset: number;
  digits: number;
}

const U = (code: UnitCode, scale: number, digits: number, offset = 0): UnitDef =>
  ({ code, scale, offset, digits });

/** The one table. Every conversion in the app comes from here, so there is exactly one place a
 *  wrong factor can hide — and exactly one place to fix it. */
const TABLE: Record<Quantity, Record<UnitSystem, UnitDef>> = {
  altitude: {
    metric: U('m', 1, 0),
    imperial: U('ft', 1 / 0.3048, 0),
    aviation: U('ft', 1 / 0.3048, 0),
  },
  distance: {
    metric: U('km', 1 / 1000, 1),
    imperial: U('mi', 1 / 1609.344, 1),
    aviation: U('NM', 1 / 1852, 1),
  },
  speed: {
    metric: U('km/h', 3.6, 0),
    imperial: U('mph', 2.2369363, 0),
    aviation: U('kt', 1.9438445, 0),
  },
  vario: {
    metric: U('m/s', 1, 1),
    imperial: U('ft/min', 196.8504, 0),
    aviation: U('m/s', 1, 1),          // the point of the mixed system: knots outside, m/s here
  },
  mass: {
    metric: U('kg', 1, 0),
    imperial: U('lb', 2.2046226, 0),
    aviation: U('kg', 1, 0),
  },
  wingload: {
    metric: U('kg/m²', 1, 1),
    imperial: U('lb/ft²', 0.2048161, 1),
    aviation: U('kg/m²', 1, 1),
  },
  pressure: {
    metric: U('hPa', 1, 2),
    imperial: U('inHg', 1 / 33.8639, 2),
    aviation: U('hPa', 1, 2),
  },
  temperature: {
    metric: U('°C', 1, 0),
    imperial: U('°F', 9 / 5, 0, 32),
    aviation: U('°C', 1, 0),
  },
};

const fill = (sys: UnitSystem): UnitPrefs =>
  Object.fromEntries(QUANTITIES.map(q => [q, sys])) as UnitPrefs;

/** A preset is a starting point the pilot then edits row by row. */
export const PRESETS: Record<UnitSystem, UnitPrefs> = {
  metric: fill('metric'),
  imperial: fill('imperial'),
  aviation: fill('aviation'),
};

/** Metric by default, deliberately: it is exactly what the screen already shows. A default that
 *  changed the display would make every existing test move for a reason that has nothing to do
 *  with units. */
export const DEFAULT_UNITS: UnitPrefs = PRESETS.metric;

export function unitFor(q: Quantity, sys: UnitSystem): UnitCode {
  return TABLE[q][sys].code;
}

/** SI value → the pilot's unit. Pure arithmetic: no rounding here, because rounding is a display
 *  decision and this function is also used to compare and to plot. */
export function convert(siValue: number, q: Quantity, sys: UnitSystem): number {
  const u = TABLE[q][sys];
  return siValue * u.scale + u.offset;
}

/** The pilot's unit → SI, the exact inverse of convert. It exists for the ONE direction of travel
 *  the app has: a number he TYPED. He types a mass in the unit his panel shows him, and the store
 *  holds kilograms — so the conversion has to happen on the way in as surely as it happens on the
 *  way out, and it has to happen through this table, not through a factor somebody remembered.
 *
 *  A field parsed with the wrong inverse is worse than an unconverted one: it looks converted. */
export function toSI(value: number, q: Quantity, sys: UnitSystem): number {
  const u = TABLE[q][sys];
  return (value - u.offset) / u.scale;
}

/** THE formatter — the last centimetre. Text and unit come back apart so the screen can size them
 *  apart (a big number, a small unit), and so an unknown can drop the unit entirely.
 *
 *  null, undefined, NaN, ±Infinity → { text: '—', unit: '' }. Never '0', never 'NaN', never a unit
 *  standing beside a measurement nobody made (POT-007). A zero is a fact about the air; a dash is
 *  a fact about our ignorance, and the pilot is entitled to tell them apart. */
export function format(
  siValue: number | null | undefined,
  q: Quantity,
  sys: UnitSystem,
  digits?: number,
): { text: string; unit: string } {
  if (siValue == null || !Number.isFinite(siValue)) return { text: '—', unit: '' };
  const u = TABLE[q][sys];
  const d = digits ?? u.digits;
  const v = convert(siValue, q, sys);
  const text = v.toFixed(d);
  // A vario of -0.04 m/s rounds to "-0.0": a minus sign telling the pilot he is sinking when the
  // number itself says he is not. Round-to-zero is zero, without the sign.
  return { text: Number(text) === 0 ? (0).toFixed(d) : text, unit: u.code };
}

/** The same conversion, as ONE string — for the panels that print a number inside a sentence
 *  rather than inside a box: '12.4 km' in a divert row, 'beyond 8 km' in a terrain note.
 *
 *  It exists so those panels can honour the pilot's unit choice without each of them inventing its
 *  own `${(m/1000).toFixed(1)} km`. That sprinkle is exactly how one screen came to show two units
 *  for the same quantity: the InfoBoxes in feet, the divert row beside them in metres. One table,
 *  one formatter, every readout.
 *
 *  An unknown is a bare dash and no unit — '— km' still claims a kilometre was measured. */
export function formatText(
  siValue: number | null | undefined,
  q: Quantity,
  sys: UnitSystem,
  digits?: number,
): string {
  const { text, unit } = format(siValue, q, sys, digits);
  return unit === '' ? text : `${text} ${unit}`;
}
