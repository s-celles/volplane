// The Frictionless resources of `soaring-data`, imported straight into the bundle so the world
// exists before the first byte of network (OFF-001). They are STANDARD formats on purpose —
// a CSV and some GeoJSON — so nothing but a text import is needed to read them, and nothing in
// this app is the only thing that can.
//
// `unknown`, not a hand-written GeoJSON interface: the shape is validated where it is parsed
// (core/landmarks.ts), which refuses what it does not understand rather than trusting a type
// assertion nobody checked at runtime.
declare module '*.geojson' {
  const value: unknown;
  export default value;
}
declare module '*.csv' {
  const value: string;
  export default value;
}
