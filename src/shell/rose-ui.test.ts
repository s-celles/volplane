import { expect, test, describe } from 'bun:test';
import { roseSvg as roseSvgT } from './rose-ui';
import { translator } from '../core/i18n';

const en = translator('en');
const roseSvg = (r: Parameters<typeof roseSvgT>[0], w?: number, h?: number): string =>
  w == null ? roseSvgT(r, en) : roseSvgT(r, en, w, h);
import { BINS, type Rose, type RoseBin } from '../core/circleassist';

/** A rose whose bins are given by a vz per sector; null = unsampled. `noAdvice` says WHY there is
 *  no arrow, exactly as core says it — 'flat' by default, since these fixtures fill the circle. */
const rose = (
  vz: (number | null)[], best: Rose['best'] = null, noAdvice: Rose['noAdvice'] = null,
): Rose => {
  const bins: RoseBin[] = [];
  for (let b = 0; b < BINS; b++) {
    const v = vz[b] ?? null;
    bins.push({ bearing: b * (360 / BINS), vzMs: v, weight: v == null ? 0 : 1 });
  }
  return {
    est: true, bins, best,
    noAdvice: best ? null : noAdvice ?? 'flat',
    centre: { lon: 6, lat: 45 }, samples: 40,
  };
};

const full = (v: number): number[] => Array(BINS).fill(v);

describe('a rose we do not have', () => {
  test('null renders the honest placeholder, not an empty circle', () => {
    const h = roseSvg(null);
    expect(h).toContain('not circling');
    expect(h).not.toContain('<svg');
  });

  test('and it never prints a number — a 0.0 here would be lift nobody measured', () => {
    expect(roseSvg(null)).not.toContain('0.0');
  });
});

describe('the wedges (THE-001)', () => {
  test('every sector is drawn', () => {
    const h = roseSvg(rose(full(1.5)));
    expect(h.match(/class="rose-wedge/g)?.length).toBe(BINS);
  });

  test('an unsampled sector is HOLLOW — never painted in the colour of zero lift', () => {
    const vz: (number | null)[] = full(1.5);
    vz[3] = null;
    const h = roseSvg(rose(vz));
    expect(h).toContain('rose-empty');
    // The empty wedge carries the hatch and no colour from the lift ramp.
    const empty = h.match(/<path class="rose-wedge rose-empty"[^>]*>/g) ?? [];
    expect(empty.length).toBe(1);
    expect(empty[0]).toContain('url(#rose-hatch)');
    expect(empty[0]).not.toContain('rgba');
    expect(empty[0]).toContain('data-bearing="90"');
  });

  test('a sampled sector wears the kernel colour ramp, not the hatch', () => {
    const h = roseSvg(rose(full(2.5)));
    expect(h).toContain('rose-lift');
    expect(h).toContain('rgba(');
    expect(h).not.toContain('rose-empty');
  });

  test('a sunk sector and an unsampled sector do not look alike', () => {
    const sunk = roseSvg(rose(full(-1.5)));
    const vz: (number | null)[] = full(-1.5);
    vz[0] = null;
    const holed = roseSvg(rose(vz));
    expect(sunk).not.toContain('rose-empty');
    expect(holed).toContain('rose-empty');
    expect(sunk).not.toBe(holed);
  });
});

describe('the advice (THE-002)', () => {
  test('a named best sector draws the arrow, pointing at that sector', () => {
    const h = roseSvg(rose(full(1), { bearing: 210, vzMs: 3.2 }));
    expect(h).toContain('rose-arrow');
    expect(h).toContain('data-bearing="210"');
    expect(h).toContain('210°');
  });

  test('no best sector ⇒ NO arrow at all, and the rose says so in words', () => {
    const h = roseSvg(rose(full(1), null));
    expect(h).not.toContain('rose-arrow');
    expect(h).not.toContain('polygon');
    expect(h).toContain('even lift — no shift');
  });

  // The claim: the two SILENCES are two different facts and must not share a sentence. A flat
  // rose is a measurement ("stay where you are"). An under-sampled one is the absence of a
  // measurement — and "even lift" said over sectors nobody has flown is exactly the fake zero the
  // hatched wedges beneath it exist to deny (POT-007). The words are what the pilot reads at
  // sixty degrees of bank.
  test('an under-sampled circle says so — it NEVER claims the lift is even', () => {
    const vz: (number | null)[] = full(2);
    for (const b of [2, 3, 4, 5, 6, 7, 8]) vz[b] = null;     // 7 of 12 sectors never flown
    const h = roseSvg(rose(vz, null, 'under-sampled'));
    expect(h).toContain('not enough of the circle sampled');
    expect(h).not.toContain('even lift');                    // the claim nobody measured
    expect(h).not.toContain('rose-arrow');
    expect(h).toContain('rose-unsampled');                   // greyed, like every other unknown
  });

  test('a flat rose still says "even lift" — it IS a measurement, and it is not greyed', () => {
    const h = roseSvg(rose(full(2), null, 'flat'));
    expect(h).toContain('even lift — no shift');
    expect(h).not.toContain('not enough of the circle sampled');
    expect(h).not.toContain('rose-unsampled');
  });
});

describe('the badge (POT-007)', () => {
  test('every rose wears the est badge, in the markup the wind already uses', () => {
    for (const r of [rose(full(1)), rose(full(1), { bearing: 30, vzMs: 2 })]) {
      const h = roseSvg(r);
      expect(h).toContain('<span class="badge estimated"');
      expect(h).toContain('>est</span>');
    }
  });
});
