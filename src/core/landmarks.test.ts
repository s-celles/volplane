// The rule that follows the data all the way from `soaring-data`: a peak whose elevation the
// source did not give arrives as NULL, never 0. A summit at sea level is a lie a chart draws
// without hesitating — and the whole reason these landmarks may be shipped at all is that they
// are the one thing we can state without qualification.
import { test, expect } from 'bun:test';
import { parsePeaks, parseShapes, shapesIn, peaksIn } from './landmarks';
import peaksCsv from 'soaring-data/datasets/landmarks/peaks.csv' with { type: 'text' };
import coastline from 'soaring-data/datasets/landmarks/coastline.geojson' with { type: 'json' };
import lakes from 'soaring-data/datasets/landmarks/lakes.geojson' with { type: 'json' };

test('the real package parses: hundreds of named peaks, all placed', () => {
  const peaks = parsePeaks(peaksCsv);
  expect(peaks.length).toBeGreaterThan(500);
  for (const p of peaks) {
    expect(p.name.length).toBeGreaterThan(0);
    expect(Number.isFinite(p.lon)).toBe(true);
    expect(Number.isFinite(p.lat)).toBe(true);
    expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
    // The one that matters: an elevation is a real number or it is NOTHING. Never a zero
    // standing in for an absence.
    expect(p.elevM === null || Number.isFinite(p.elevM)).toBe(true);
    expect(p.elevM).not.toBe(0);
  }
  // And a landmark may sit BELOW the sea: Death Valley and the Qattara Depression are in this
  // package at −86 m and −133 m. A first version of this test demanded elevM > 0 and failed on
  // them — the data was right and the test was wrong. Clamping them to zero, or dropping them,
  // would have been the map lying about the ground to satisfy an assertion.
  const deep = parsePeaks(peaksCsv).filter(p => (p.elevM ?? 1) < 0);
  expect(deep.length).toBeGreaterThan(0);
  expect(deep.every(p => p.kind === 'depression')).toBe(true);
  // A landmark we can name: Mont Blanc is in there, and it is where it should be.
  const mb = peaks.find(p => p.name.includes('Blanc'));
  expect(mb).toBeDefined();
  expect(mb!.lat).toBeCloseTo(45.8, 0);
  expect(mb!.elevM!).toBeGreaterThan(4000);
});

test('an unreadable row is dropped, not guessed at', () => {
  const csv = [
    'name,kind,elev_m,lon,lat',
    'Good,mountain,3000,6.0,45.0',
    'NoPosition,mountain,3000,,',      // no place: not a landmark
    ',mountain,3000,6.0,45.0',         // no name: a dot nobody can point at
    'NoElev,mountain,,6.1,45.1',       // no height: KEPT, with null
  ].join('\n');
  const p = parsePeaks(csv);
  expect(p.map(x => x.name)).toEqual(['Good', 'NoElev']);
  expect(p[1].elevM).toBeNull();       // the place survives, the number does not
});

test('the coastline and the lakes parse into paintable rings', () => {
  const coast = parseShapes(coastline);
  expect(coast.length).toBeGreaterThan(50);
  expect(coast[0].rings[0].length).toBeGreaterThan(1);
  const lk = parseShapes(lakes);
  expect(lk.some(s => s.name != null)).toBe(true);      // lakes carry a name; coastlines do not
  expect(coast.every(s => s.name == null)).toBe(true);
});

test('geometry we do not understand is SKIPPED, never invented', () => {
  expect(parseShapes(null)).toEqual([]);
  expect(parseShapes({ features: [{ geometry: { type: 'Point', coordinates: [1, 2] } }] })).toEqual([]);
  expect(parseShapes({ features: [{ geometry: { type: 'LineString', coordinates: [[1, 2]] } }] }))
    .toEqual([]);                                        // a one-point "line" is not a line
});

test('only what is on screen is handed to the painter', () => {
  const alps = { west: 5, south: 44, east: 8, north: 47 };
  const peaks = parsePeaks(peaksCsv);
  const near = peaksIn(peaks, alps);
  expect(near.length).toBeGreaterThan(0);
  expect(near.length).toBeLessThan(peaks.length);        // the world is not the Alps
  for (const p of near) {
    expect(p.lon).toBeGreaterThanOrEqual(5);
    expect(p.lon).toBeLessThanOrEqual(8);
  }
  // And a window over empty ocean holds nothing, rather than the nearest thing to it.
  expect(peaksIn(peaks, { west: -30, south: 30, east: -28, north: 32 }).length).toBe(0);
  expect(shapesIn(parseShapes(coastline), { west: -30, south: 30, east: -28, north: 32 }).length).toBe(0);
});
