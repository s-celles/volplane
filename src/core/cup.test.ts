// The PARSER is the kernel's, and the kernel tests it (soaring-core/src/poi.test.ts — 13 tests
// over .cup, .wpt, the coordinate dialects and the refusal discipline). What this file pins is
// the one thing a re-export can silently break: that VOLPLANE really is speaking the kernel's
// dialect, and has not quietly grown a second one.
//
// It is a small test with a real job. THREE apps in this family wrote a .cup reader — and the
// one this app was about to keep would have been the third. Worse, the sibling's answered an
// unreadable elevation with ZERO, which in a flight computer is a final glide to a field
// 1650 m lower than the file said. The rule below is the one that must never come back.
import { test, expect } from 'bun:test';
import { parseCup, parsePoiFile, isLandable, catLabel, LANDABLE_CATS } from './cup';
import * as kernel from 'soaring-core/poi';

const CUP = [
  'name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc',
  '"Saint-Auban","STA","FR",4402.900N,00559.700E,459.0m,4,110,1000.0m,"122.500","Gliding site"',
  '"Champ Nord","CN","FR",4510.000N,00600.000E,650.0m,3,,,,"Outlanding"',
  '"Mont Ventoux","VTX","FR",4417.400N,00516.100E,1909.0m,7,,,,"Summit"',
  '"No Elev","NE","FR",4430.000N,00530.000E,,4,,,,"a gliding site with NO elevation"',
].join('\r\n');

test('the app parses through the KERNEL, not a local copy of it', () => {
  expect(parseCup(CUP)).toEqual(kernel.parseCup(CUP));
  expect(parsePoiFile(CUP)).toEqual(kernel.parsePoiFile(CUP));
  expect(LANDABLE_CATS).toEqual(kernel.LANDABLE_CATS);
});

test('an unreadable elevation is NULL — the field survives, the NUMBER does not', () => {
  // The regression that must never return. A zero here is a final glide to a field that is not
  // where the computer thinks it is, and the pilot learns it at 200 feet.
  const p = parseCup(CUP).pois.find(x => x.name === 'No Elev')!;
  expect(p.elevM).toBeNull();
  expect(p.cat).toBe('airfield-gliding');     // …and it is STILL a landable gliding site
  expect(isLandable(p.cat)).toBe(true);
});

test('landability is the FILE\'s verdict, and a summit is not a landable', () => {
  const pois = parseCup(CUP).pois;
  expect(pois.filter(p => isLandable(p.cat)).map(p => p.name))
    .toEqual(['Saint-Auban', 'Champ Nord', 'No Elev']);
  expect(isLandable(pois.find(p => p.name === 'Mont Ventoux')!.cat)).toBe(false);
});

test('catLabel is a LABEL — the app reads it, nothing branches on it', () => {
  expect(catLabel('airfield-gliding')).toBe('gliding airfield');
  expect(catLabel('outlanding')).toBe('outlanding field');
  // Every landable category has words, so no row can render "undefined".
  for (const c of LANDABLE_CATS) expect(catLabel(c).length).toBeGreaterThan(0);
});
