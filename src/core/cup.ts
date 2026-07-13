// ============ waypoint files (CFG-007, LND-001) ============
// There is almost nothing here, and that is the point.
//
// Reading a `.cup` is soaring domain, not app logic. It now lives in the kernel
// (`soaring-core/poi`, v0.4.0), which also reads WinPilot `.dat`/`.wpt` and sniffs the format
// from the CONTENT rather than the file name — pilots rename files.
//
// It was written here first, and it was the THIRD time this family wrote it: ogn-3d-viewer
// already had a .cup reader, and the vario sound law had taught the same lesson a day earlier.
// That is what `C4bis` in the spec now forbids — and the reason it deserves a paragraph rather
// than a quiet deletion is what the consolidation FOUND. The sibling parser answered an
// unreadable elevation with **zero**. In a 3D viewer that only mis-draws a marker. Here it
// would be a final glide computed to a field 1650 m lower than the file said, and the pilot
// would learn it at 200 feet. The kernel answers `null`, and everything downstream is now
// FORCED to decline the glide rather than promise an arrival nobody measured.
//
// What VOLPLANE keeps is what an app should keep: the words it puts on a screen.

export {
  parseCup,
  parseWinPilot,
  parsePoiFile,
  sniffPoiFormat,
  isLandable,
  landablesOf,
  LANDABLE_CATS,
  type Poi,
  type PoiCat,
  type PoiFile,
} from 'soaring-core/poi';

import type { PoiCat } from 'soaring-core/poi';

/** The type of a place, in the words a pilot reads. A LABEL, and only a label — nothing may
 *  ever branch on it. The code that used to live here did exactly that
 *  (`styleName(p.style) === 'gliding airfield'`), which put a drawing decision at the mercy of
 *  an English string: rename the label, and a gliding site silently stops being drawn as one.
 *  Branch on `cat`, which is a closed set the compiler checks. */
export function catLabel(cat: PoiCat): string {
  switch (cat) {
    case 'airfield-grass': return 'grass airfield';
    case 'airfield-gliding': return 'gliding airfield';
    case 'airfield-solid': return 'solid-surface airfield';
    case 'outlanding': return 'outlanding field';
    case 'summit': return 'summit';
    case 'pass': return 'mountain pass';
    case 'obstacle': return 'obstacle';
    case 'landmark': return 'landmark';
    case 'waypoint': return 'waypoint';
  }
}
