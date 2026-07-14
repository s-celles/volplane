// ============ the glider library: what the shipped package must satisfy ============
// This file used to test a table typed out inside the app. It now tests a READER, and the two kinds
// of claim it makes are different in a way worth naming:
//
//  · The claims about the PARSER are made against hand-written fixtures — a broken row, a duplicate
//    name, a missing wing area — because those are the cases the shipped data does NOT contain and
//    which we must nevertheless survive the day it does.
//  · The claims about the SHIPPED PACKAGE are made against the real thing, and they are the ones
//    that fail the build if soaring-data ever ships a glider that cannot fly.

import { test, expect } from 'bun:test';
import {
  GLIDER_LIBRARY, parseGliderLibrary, groupLibrary, byManufacturer, entryLabel,
  gliderById, polarOf, slug, unusableRows,
} from './polarlib';
import { sinkAt, type Polar } from 'soaring-core/polar';

const HEAD = 'name,wing_class,mass_dry_gross_kg,max_water_ballast_l,'
  + 'speed1_kmh,sink1_ms,speed2_kmh,sink2_ms,speed3_kmh,sink3_ms,wing_area_m2,fai_class';
const row = (s: string): string => `${HEAD}\n${s}\n`;

// ---- the shipped package ----

test('every shipped glider parses — not one row of the package is unusable', () => {
  // The count is the point. A row that cannot make a polar is DROPPED by the reader, silently as
  // far as the pilot is concerned; this is the place where that silence is broken.
  expect(GLIDER_LIBRARY.length).toBeGreaterThan(100);
  expect(unusableRows).toBe(0);
});

test('every shipped glider yields a polar that actually sinks, at a speed it can actually fly', () => {
  // The one claim that catches a corrupt polar the type system cannot: a glider whose fitted curve
  // CLIMBS in still air, or whose flight envelope is empty. Either would reach the pilot as a final
  // glide he can make and cannot.
  for (const g of GLIDER_LIBRARY) {
    const p = polarOf(g, null);
    expect(p.vMin).toBeLessThan(p.vMax);
    const mid = (p.vMin + p.vMax) / 2;
    expect(sinkAt(p, mid)).toBeLessThan(0);
  }
});

test("no two shipped gliders share an id — the pilot's saved setting is never ambiguous", () => {
  const ids = GLIDER_LIBRARY.map(g => g.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('the unclassified gliders are offered as `glider`, never given a class nobody established', () => {
  // soaring-data leaves fai_class empty for the wings whose class turns on flaps it does not record.
  // The picker must show them, and must not name them. A pilot reading "Standard" beside a flapped
  // 15-metre has been told something false by a machine that had no way of knowing.
  const groups = groupLibrary(GLIDER_LIBRARY).map(g => g.cls);
  expect(groups).toContain('glider');
  expect(groups).not.toContain('');
  expect(groups).not.toContain('standard');   // nothing in the data establishes Standard class
});

// ---- the reader, against what the shipped data does not contain ----

test('a row with a missing point is DROPPED and counted, never fitted through the two it has', () => {
  const lib = parseGliderLibrary(row('Broken,glider,350,0,100,-0.7,120,,150,-1.7,10.2,'));
  expect(lib.length).toBe(0);
  expect(unusableRows).toBe(1);
});

test('a row with no reference mass is DROPPED — a mass is not a thing to default', () => {
  expect(parseGliderLibrary(row('Massless,glider,,0,100,-0.7,120,-0.9,150,-1.7,10.2,')).length).toBe(0);
});

test('a missing wing area is null, never 0 — a wing loading over 0 m² is an infinity', () => {
  const [g] = parseGliderLibrary(row('Arealess,glider,350,0,100,-0.7,120,-0.9,150,-1.7,,'));
  expect(g.wingAreaM2).toBeNull();
  expect(g.refMassKg).toBe(350);
});

test('two gliders with the same name get distinct ids, and neither is dropped', () => {
  const lib = parseGliderLibrary(
    `${HEAD}\nLS 4,glider,350,0,100,-0.7,120,-0.9,150,-1.7,10.2,\n`
    + `LS 4,glider,380,0,100,-0.8,120,-1.0,150,-1.8,10.2,\n`,
  );
  expect(lib.length).toBe(2);
  expect(lib[0].id).not.toBe(lib[1].id);
});

test("columns are read from the file's OWN header — a new column shifts nothing", () => {
  // The bug we have already had once, in the .cup parser: a format revision inserted a column, and
  // the runway WIDTH began appearing in the radio frequency field. A file with columns is a file
  // that will one day have a new one.
  const shifted = 'name,wing_class,SOMETHING_NEW,mass_dry_gross_kg,max_water_ballast_l,'
    + 'speed1_kmh,sink1_ms,speed2_kmh,sink2_ms,speed3_kmh,sink3_ms,wing_area_m2,fai_class';
  const [g] = parseGliderLibrary(`${shifted}\nLS 4,glider,xxx,350,0,100,-0.7,120,-0.9,150,-1.7,10.2,18m\n`);
  expect(g.refMassKg).toBe(350);
  expect(g.wingAreaM2).toBe(10.2);
  expect(g.cls).toBe('18m');
});

test("the id survives an accent, because it is what gets written into the pilot's settings", () => {
  expect(slug('Pégase 101')).toBe('pegase-101');
  expect(slug('ASW 20 BL')).toBe('asw-20-bl');
});

// ---- the mass adjustment, at the app's own door ----

test('polarOf with no mass flies the polar as published — it does not invent his ballast', () => {
  const g = gliderById(GLIDER_LIBRARY[0].id)!;
  expect(polarOf(g, null)).toEqual(polarOf(g, g.refMassKg));
});

test('polarOf at a heavier mass leaves the best glide ratio unchanged (ballast buys speed)', () => {
  const g = GLIDER_LIBRARY.find(x => x.wingAreaM2 !== null)!;
  const bestLd = (p: Polar): number => {
    let best = 0;
    for (let v = p.vMin; v <= p.vMax; v += 0.05) best = Math.max(best, v / -sinkAt(p, v));
    return best;
  };
  expect(bestLd(polarOf(g, g.refMassKg * 1.3))).toBeCloseTo(bestLd(polarOf(g, null)), 2);
});

test('gliderById refuses an unknown id rather than quietly flying another glider', () => {
  expect(gliderById('no-such-glider')).toBeNull();
});

// ---- what the pilot reads ----

test('two gliders under one model name are told apart by what ACTUALLY differs', () => {
  // Stripping `(PAS)`, `(PIL)`, `(15m)` and `(17m)` off the polar file names made the picker readable
  // and made it LIE: the Schleicher group offered `ASH-25` twice, and a pilot picking one of the two
  // had no way to know which. The suffixes were ugly and they were carrying a FACT — these are
  // DIFFERENT POLARS. One ASH-25 is loaded with a passenger and one is not; one DG-400 has 15 metres
  // of wing and the other has 17. Getting it wrong is a final glide computed against the wrong curve.
  for (const { entries } of byManufacturer(GLIDER_LIBRARY)) {
    const labels = entries.map(g => entryLabel(g, entries));
    expect(new Set(labels).size).toBe(labels.length);
  }
});

test('the disambiguator appears where it is needed and NOWHERE else', () => {
  const lib = byManufacturer(GLIDER_LIBRARY);
  const schleicher = lib.find(g => g.maker.includes('Schleicher'))!;
  const label = (m: string): string => {
    const g = schleicher.entries.find(x => entryLabel(x, schleicher.entries).startsWith(m))!;
    return entryLabel(g, schleicher.entries);
  };
  expect(label('ASK-21')).toBe('ASK-21');            // unique: nothing appended
  expect(label('ASH-25 ')).toMatch(/^ASH-25 — \d+ kg$/);  // two of them: the loading tells them apart
});

test('the biggest group is a list a hand can land on, not a haystack', () => {
  // Grouped by FAI class, 106 wings sat in a single list called `glider` — a pilot hunting for his
  // ASW 20 in a scrolling native <select>, in flight, with gloves.
  const named = byManufacturer(GLIDER_LIBRARY).filter(g => g.maker !== '');
  expect(Math.max(...named.map(g => g.entries.length))).toBeLessThan(40);
});
