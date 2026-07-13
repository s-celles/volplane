// ============ the compass rose (THE-001, THE-002, POT-007) ============
// The circling assistant, drawn. core/circleassist has already laid the vario onto the circle
// it was measured on and named the sector to shift towards; nothing is re-derived here. This
// file has exactly one job, and it is the one where the honesty is spent: making sure the
// picture says the same thing the object says — including, above all, where the object says
// NOTHING.
//
// Pure, like xsection-ui and landables-ui: values in, an SVG string out, no DOM and no fetch.
//
// THE RULE THIS FILE EXISTS FOR. An UNSAMPLED sector and a DEAD sector are two different facts
// about the sky and must not look alike. The pilot reads a rose in one glance, at sixty degrees
// of bank, and what he takes from it is a shape — so a bin with no evidence painted in the
// colour of zero lift would not be a small inaccuracy, it would be a lie shaped like advice:
// "there is no lift over there", said about a quarter of the circle nobody has flown yet. So
// `vzMs === null` is drawn HOLLOW — hatched, uncoloured, visibly a hole in the evidence — and
// the lift ramp never touches it (POT-007, the same discipline as the cross-section's holes).
//
// And the rose keeps its mouth shut when it has nothing to say. `best === null` means
// circleassist refused to name a sector — too little of the circle flown, or too flat a rose to
// tell lift from noise — and then there is NO arrow. Not a faint one, not a default one pointing
// north: none. An arrow the pilot cannot trust is worse than no arrow, because he will fly it.
// Which of those two refusals it was arrives with the rose (`noAdvice`), and the words below say
// so: a flat rose is a finding, an unmapped one is an absence, and the same sentence for both
// would smuggle the absence in wearing the finding's clothes.
//
// The colours are the KERNEL's (C4). soaring-core's liftviz owns the one colour language this
// ecosystem speaks for vertical air motion — the lift map, the potential fields and this rose
// must all mean the same thing by the same orange — so we import its bins and its palette
// rather than inventing a fifth dialect of "green is up".

import { BINS, type Rose } from '../core/circleassist';
import { liftBin, BIN_COLORS } from 'soaring-core/liftviz';

/** VEN-001's badge, character for character as main.ts writes it for the wind — same class,
 *  same shape, because the two things wear the same epistemic status and the pilot must learn
 *  ONE badge, not two. The rose is an estimate built out of measurements: real vario readings,
 *  binned and decayed around a circle centre we INFERRED. It is not the vario. */
const EST_BADGE =
  '<span class="badge estimated" title="binned vario around an inferred circle centre — an estimate, not the instrument">est</span>';

/** The kernel's RGBA tuple as CSS. Alpha comes out of liftviz in 0–255, where it encodes the
 *  strength of the claim; we keep it — a weak bin SHOULD look weak — but floor it, because a
 *  wedge at alpha 45 on a sunlit canopy is a wedge nobody sees. */
function liftColour(vz: number): string {
  const [r, g, b, a] = BIN_COLORS[liftBin(vz)]!;
  return `rgba(${r},${g},${b},${Math.max(0.35, a / 255).toFixed(2)})`;
}

/** North is up and bearings run clockwise — the rose is read against the outside world, not
 *  against the glider's nose, because the sector it names is a PLACE and the pilot displaces
 *  his circle towards places. */
function pt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = deg * Math.PI / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function wedge(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = pt(cx, cy, r1, a0), [x1, y1] = pt(cx, cy, r1, a1);
  const [x2, y2] = pt(cx, cy, r0, a1), [x3, y3] = pt(cx, cy, r0, a0);
  const f = (v: number): string => v.toFixed(1);
  return `M ${f(x0)} ${f(y0)} A ${f(r1)} ${f(r1)} 0 0 1 ${f(x1)} ${f(y1)}`
    + ` L ${f(x2)} ${f(y2)} A ${f(r0)} ${f(r0)} 0 0 0 ${f(x3)} ${f(y3)} Z`;
}

/** The rose, as an HTML string wrapping an SVG. Null in ⇒ the honest placeholder: the glider is
 *  not circling (or has not closed a circle, or has no vario), and an empty ring drawn anyway
 *  would read as "no lift anywhere on this circle" — a measurement nobody made. */
export function roseSvg(r: Rose | null, wPx = 200, hPx = 200): string {
  if (!r) {
    return `<div class="rose rose-none">not circling — no rose</div>`;
  }

  const cx = wPx / 2, cy = hPx / 2;
  const rOut = Math.min(wPx, hPx) / 2 - 12;
  const rIn = rOut * 0.35;
  const half = 180 / BINS;

  const wedges = r.bins.map(b => {
    const d = wedge(cx, cy, rIn, rOut, b.bearing - half, b.bearing + half);
    // The hole, drawn as a hole. No fill from the lift ramp ever reaches this branch — that is
    // the whole point of the branch.
    if (b.vzMs == null) {
      return `<path class="rose-wedge rose-empty" d="${d}" fill="url(#rose-hatch)"`
        + ` data-bearing="${b.bearing}"><title>${b.bearing}° — not sampled</title></path>`;
    }
    return `<path class="rose-wedge rose-lift" d="${d}" fill="${liftColour(b.vzMs)}"`
      + ` data-bearing="${b.bearing}"><title>${b.bearing}° — ${b.vzMs.toFixed(1)} m/s</title></path>`;
  }).join('');

  // THE-002. The arrow exists only when circleassist named a sector; it points at that sector's
  // bearing and says so in the markup, so a rose that pointed the wrong way could not pass a test.
  const arrow = r.best
    ? (() => {
        const [tx, ty] = pt(cx, cy, rOut + 8, r.best.bearing);
        const [lx, ly] = pt(cx, cy, rIn * 0.7, r.best.bearing - 12);
        const [rx, ry] = pt(cx, cy, rIn * 0.7, r.best.bearing + 12);
        const f = (v: number): string => v.toFixed(1);
        return `<polygon class="rose-arrow" data-bearing="${r.best.bearing}"`
          + ` points="${f(tx)},${f(ty)} ${f(lx)},${f(ly)} ${f(rx)},${f(ry)}"/>`;
      })()
    : '';

  // The words under the picture. When there is no arrow the rose must SAY there is no arrow —
  // an absent glyph is ambiguous (did it fail to draw?), a sentence is not.
  //
  // And it must say WHICH silence this is. "Even lift — no shift" is a MEASUREMENT: the circle was
  // mapped and the lift really is flat, so the pilot may stay where he is. It was also, until now,
  // what the rose printed when it had barely sampled the circle at all — a claim about air nobody
  // had flown, in the plainest words on the screen, sitting under the very hatched wedges drawn to
  // deny it. The picture said "seven holes"; the sentence said "even lift", and at sixty degrees
  // of bank the sentence is what he reads. Two facts, two sentences (POT-007).
  const advice = r.best
    ? `shift towards ${String(Math.round(r.best.bearing)).padStart(3, '0')}° · ${r.best.vzMs.toFixed(1)} m/s`
    : r.noAdvice === 'under-sampled'
      ? 'not enough of the circle sampled — no advice'
      : 'even lift — no shift';
  // The unmeasured case is greyed, like every other "we do not know" on this screen. A refusal
  // and a finding must not read alike.
  const adviceClass = r.best == null && r.noAdvice === 'under-sampled'
    ? 'rose-advice rose-unsampled' : 'rose-advice';

  const svg = `<svg class="rose-svg" viewBox="0 0 ${wPx} ${hPx}" width="${wPx}" height="${hPx}">`
    + `<defs><pattern id="rose-hatch" width="6" height="6" patternUnits="userSpaceOnUse"`
    + ` patternTransform="rotate(45)"><line class="rose-hatch-line" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>`
    + wedges
    + arrow
    + `<circle class="rose-ring" cx="${cx}" cy="${cy}" r="${rOut.toFixed(1)}" fill="none"/>`
    + `<text class="rose-n" x="${cx}" y="10" text-anchor="middle">N</text>`
    + `</svg>`;

  return `<div class="rose">`
    + `<div class="rose-head">Circling assistant ${EST_BADGE}</div>`
    + svg
    + `<div class="${adviceClass}">${advice}</div>`
    + `</div>`;
}
