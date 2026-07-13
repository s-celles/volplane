// TER-001, and mostly the half of it that is easy to forget: an ombrage is owed *là où* the DEM
// is loaded, and nowhere else. These tests pin what the pilot sees — a hole where there is no
// data, no phantom relief out of flat ground, and a lit flank brighter than a shaded one.
import { test, expect } from 'bun:test';
import type { ElevSampler } from 'soaring-core/ports';
import { mPerLng, M_PER_LAT } from 'soaring-core/geo';
import { elevColor, shadeGrid, type Shade, type ShadeView } from './hillshade';

const LON0 = 6, LAT0 = 45;
const W = 160, H = 160, CELL = 8, MPP = 50;   // 20 × 20 cells, 400 m of ground each

/** A view centred on LON0/LAT0, x east and y south, the way a screen runs. */
const view = (): ShadeView => ({
  wPx: W, hPx: H, cellPx: CELL, mPerPx: MPP,
  at: (px, py) => [
    LON0 + (px - W / 2) * MPP / mPerLng(LAT0),
    LAT0 - (py - H / 2) * MPP / M_PER_LAT,
  ],
});

const cellAt = (g: { cells: (Shade | null)[]; wCells: number }, i: number, j: number) => g.cells[j * g.wCells + i];
const lum = (s: Shade) => s.r + s.g + s.b;

/** Distance (m) from the view centre — the ground the cone tests are built on. */
const distFromCentre = (lon: number, lat: number) =>
  Math.hypot((lon - LON0) * mPerLng(LAT0), (lat - LAT0) * M_PER_LAT);

test('nothing loaded, nothing painted as ground', () => {
  // The whole TER-001 honesty claim in one assertion. A sampler that knows nothing must not
  // produce a single coloured cell — not one grey pixel that could be read as sea or plain.
  const nowhere: ElevSampler = () => null;
  const g = shadeGrid(nowhere, view());

  expect(g.wCells).toBe(20);
  expect(g.hCells).toBe(20);
  expect(g.cells.length).toBe(400);
  expect(g.cells.every(c => c === null)).toBe(true);
  expect(g.unknownFraction).toBe(1);
});

test('flat ground makes no relief', () => {
  // A DEM that is flat at 800 m must shade to ONE colour. Anything else is relief invented out
  // of rounding noise — the map would show ridges where there is a plain.
  const flat: ElevSampler = () => 800;
  const g = shadeGrid(flat, view());

  const first = g.cells[0];
  expect(first).not.toBeNull();
  for (const c of g.cells) expect(c).toEqual(first!);
  expect(g.unknownFraction).toBe(0);

  // …and that one colour is the hypsometric colour of 800 m under a 45°-high sun: cos(zenith)
  // with a zero slope, computed here independently of the module's internals.
  const f = Math.cos((90 - 45) * Math.PI / 180);
  const base = elevColor(800);
  expect(first).toEqual({
    r: Math.round(base.r * f), g: Math.round(base.g * f), b: Math.round(base.b * f),
  });
});

test('the flank facing the sun is brighter than the flank in its shadow', () => {
  // A cone peaking at the view centre: its north-west flank descends toward the north-west, so
  // it faces the default NW light; its south-east flank turns away. Two cells symmetric about the
  // summit sit at the SAME elevation, hence the same ramp colour — any brightness difference
  // between them is the hillshade, and nothing else.
  const cone: ElevSampler = (lon, lat) => 2000 - 0.2 * distFromCentre(lon, lat);
  const g = shadeGrid(cone, view());

  const nw = cellAt(g, 4, 4);
  const se = cellAt(g, 15, 15);
  expect(nw).not.toBeNull();
  expect(se).not.toBeNull();
  expect(lum(nw!)).toBeGreaterThan(lum(se!));
});

test('half a DEM is half a map, and the empty half stays empty', () => {
  // The realistic case: the pack covers the west of the screen and not the east. Every cell east
  // of the meridian must be a hole, and the readiness figure must say so out loud.
  const westOnly: ElevSampler = (lon, lat) => (lon > LON0 ? null : 1200 + 0.1 * (lat - LAT0) * M_PER_LAT);
  const g = shadeGrid(westOnly, view());

  expect(g.unknownFraction).toBeCloseTo(0.5, 6);

  for (let j = 0; j < g.hCells; j++)
    for (let i = 0; i < g.wCells; i++) {
      const [lon] = view().at((i + 0.5) * CELL, (j + 0.5) * CELL);
      const c = cellAt(g, i, j);
      if (lon > LON0) expect(c).toBeNull();          // not one unloaded cell carries a colour
      else expect(c).not.toBeNull();
    }
});

test('a NaN in the DEM is unknown, never a colour', () => {
  // A badly decoded tile hands back NaN. A NaN that reached the ramp would come out as some
  // colour or other, and the map would paint garbage as ground.
  const broken: ElevSampler = () => NaN;
  expect(shadeGrid(broken, view()).unknownFraction).toBe(1);
});

test('the ramp climbs, and never breaks', () => {
  expect(elevColor(2500)).not.toEqual(elevColor(300));
  // Rock and snow are not the same colour as the valley: the ramp must actually carry altitude.
  expect(lum(elevColor(3500))).toBeGreaterThan(lum(elevColor(0)));
  expect(lum(elevColor(1000))).toBeGreaterThan(lum(elevColor(0)));

  for (const m of [0, -50, 9000]) {
    const c = elevColor(m);
    for (const v of [c.r, c.g, c.b]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  }
  expect(elevColor(-50)).toEqual(elevColor(0));       // below the sea the ramp clamps, it does not wrap
});
