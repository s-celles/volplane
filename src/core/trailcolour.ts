// ============ CAR-006: the trail, coloured by what the air was doing ============
//
// The trail is not decoration. It is the only place on the screen where the pilot can see the DAY
// rather than the instant: where the lift was, how wide it was, whether the line he flew paid. A
// grey trail says only "you were here", which he already knew. A coloured one says "there was two
// up, three hundred metres back, and you flew out of it" — and that is a decision he can still act
// on, because he can turn round.
//
// ---- the convention, and why it is not negotiable ----
//
// Up is WARM, down is COLD, zero is neutral. Every soaring instrument the pilot has ever used says
// this, and a tool that inverts a convention the user already owns does not teach him a new one — it
// just gets misread once, in a thermal, when he is busy.
//
// ---- the three constraints that actually decide the colours ----
//
//  1. THE MAP IS DARK, AND THE COCKPIT IS IN FULL SUN. A canopy is a greenhouse with a washed-out
//     screen in it. So every colour on this ramp is LIGHT — the lightness floor is L_MIN, and even
//     the darkest end (strong sink) stays well clear of the dark terrain under it. A saturated deep
//     blue at 40 % lightness looks superb in a dark room and is a black line on a hillside at noon.
//     A segment that vanishes into the map has stopped being a trail.
//
//  2. A COLOUR-BLIND PILOT MUST STILL READ IT. Roughly one man in twelve cannot separate red from
//     green, and gliding is not a hobby that screens for it. So HUE IS NOT ALLOWED TO CARRY THE
//     ANSWER ALONE: LIGHTNESS carries it too, monotonically, over the whole range — sink is dark,
//     zero is pale, climb is brilliant. Photocopy this trail to greyscale and it still reads. The
//     hue is a second, redundant channel for the pilot who has it, not the message itself.
//
//  3. GREEN IS ALREADY SPOKEN FOR. In this app green means "you can reach that airfield" (LND-003).
//     A trail that goes through green on its way from sink to lift would be saying a word the map
//     has already given to somebody else — and green/amber is precisely the pair a deuteranope
//     cannot tell apart anyway. So blue → white → amber, and NEVER through green. Which is why hue
//     is HELD per side and not interpolated across zero: a linear sweep from blue (222°) to amber
//     (42°) passes straight through 130° — green — at about +2.5 m/s, the single most important
//     value on the ramp. That bug is invisible in a unit test that only checks the endpoints, so
//     there is a test below that checks the MIDDLE.
//
// The hue flip at zero is invisible because saturation is nearly gone there: both sides are the same
// pale near-white within a tenth of a metre per second of zero. Neutral is a saturation, not a hue.
//
// ---- what this module refuses ----
//
// No vario, or a vario that has gone to NaN (a climb rate differentiated from two identical GPS
// altitudes will do that), gets NO COLOUR — `null`. Not neutral. Neutral is a MEASUREMENT: it means
// the air was still. Painting "I don't know" in the same colour as "zero" would put a claim on the
// map that nobody made, and it is the one claim the pilot cannot check afterwards. The shell draws
// those segments in a plain, dashed grey: a texture, not a colour, so absence cannot be read as a
// number.
//
// Pure. No canvas, no clock, no state.

/** Beyond ±5 m/s the exact shade stops teaching anything: at four up you are already committed to
 *  the thermal, and at six down you are already leaving. What the pilot reads at the extremes is
 *  "very good" and "very bad", and both are saturated by then. Clamping also keeps one freak fix —
 *  a vario spike through a gust front, a bad pressure sample — from re-scaling nothing and simply
 *  drawing itself at the end of the ramp, where it belongs. */
export const TRAIL_CLAMP_MS = 5;

/** The lightness floor, at the sink end. Kept high on purpose: see constraint 1 — the map under this
 *  line is dark terrain, and the pilot reading it is in the sun. */
const L_MIN = 58;
/** ...and the ceiling, at the climb end. The strongest climb is the brightest thing on the map,
 *  because it is the thing worth turning back for. */
const L_MAX = 88;

/** Hue is held constant per side. Blue for sink, amber for climb — never anything between them. */
const H_SINK = 222;
const H_CLIMB = 42;

/** Saturation at zero. Not 0: a pure grey would be the same colour the shell paints a trail with no
 *  vario at all, and those two things must never look alike. This is a pale, all-but-white tint —
 *  neutral to the eye, and still not "no data". */
const S_ZERO = 14;
const S_SINK = 76;
const S_CLIMB = 94;

/** The climb rate to colour a trail SEGMENT by is an AVERAGED one, over about this many seconds.
 *
 *  This is the difference between a trail that can be read and one that cannot. A raw 1 Hz vario in
 *  a thermal swings several m/s between fixes — gusts, the stick, the instrument's own noise — and a
 *  trail painted from it is confetti: every colour on the ramp, every hundred metres, meaning
 *  nothing. Eight seconds is long enough to bury that noise and short enough to leave the lift WHERE
 *  IT WAS: the whole point of CAR-006 is a geographic claim, and the 30 s average the infoboxes use
 *  would smear a good core over half a kilometre of the following cruise and paint the pilot a
 *  thermal he has already left. */
export const TRAIL_SMOOTH_S = 8;

/** The colour of one trail segment, from the (averaged) climb rate that was measured along it, in
 *  m/s. Positive is up. A CSS colour, in the legacy comma form so that the oldest WebView we might
 *  ever be embedded in still parses it.
 *
 *  Returns `null` — never a colour — when the climb rate is unknown or not a number. */
export function trailColour(varioMs: number | null): string | null {
  // NaN and ±Infinity are what a differentiated altitude produces when the fixes are bad, and they
  // are the reason this guard is `isFinite` and not `!= null`: NaN would sail through every
  // comparison below, land in the clamp, and come out as a confident neutral white.
  if (varioMs === null || !Number.isFinite(varioMs)) return null;

  const v = Math.max(-TRAIL_CLAMP_MS, Math.min(TRAIL_CLAMP_MS, varioMs));

  // ONE monotone ramp for lightness, across the whole range — this is the colour-blind guarantee,
  // and it holds by construction rather than by good intentions.
  const l = L_MIN + ((v + TRAIL_CLAMP_MS) / (2 * TRAIL_CLAMP_MS)) * (L_MAX - L_MIN);

  const mag = Math.abs(v) / TRAIL_CLAMP_MS;               // 0 at still air, 1 at the clamp
  const h = v < 0 ? H_SINK : H_CLIMB;
  const s = S_ZERO + mag * ((v < 0 ? S_SINK : S_CLIMB) - S_ZERO);

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/** The key the map draws next to the ramp. A colour scale with no legend is a colour scale the pilot
 *  invents his own meaning for, and he will not invent the same one we did — the ends especially,
 *  which are clamped and therefore mean "at least this much", not "this much". */
export const TRAIL_LEGEND: readonly { ms: number; css: string }[] = [-5, -2.5, 0, 2.5, 5].map(ms => ({
  ms,
  // Non-null by construction: every one of these is a finite number. The `?? ''` would be a lie, so
  // it is an assertion instead — if this ever throws, the ramp is broken and the map should not open.
  css: trailColour(ms)!,
}));
