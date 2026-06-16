// Material identity for the JS side of the sim/renderer.
//
// The registry itself (KIND, MATERIALS) is generated from
// src/sand/materials.schema.json — the single source shared with the C++ engine.
// Edit the schema, then run `npm run generate`. To add a material: add a schema
// entry. If it moves in a way no existing `kind` covers, also add a case to the
// engine's step() dispatch (C++) — otherwise no other file needs editing.
//
// This module re-exports the registry and derives the flat lookup tables the
// JS hot paths read (TABLE[m]), plus MAT.<NAME> = id.
//
// renderAnim drives per-frame shimmer/flicker in renderCore; 'none' = static grain.
// color is packed ABGR (0xAABBGGRR) over the little-endian RGBA ImageData view.
// density 0 = weightless (air/gas). looseSorted marks materials that participate
// in density-sorted loose settling (powders + flowing liquids). mobility is the
// per-tick chance a loose material attempts to move (lava < 1 = viscous).
import { KIND, MATERIALS, TABLE_SIZE } from './materials.generated.js';

export { KIND, MATERIALS };

// MAT.<NAME> = id, derived from the registry so ids live in exactly one place.
export const MAT = Object.fromEntries(MATERIALS.map((m) => [m.name, m.id]));

const buildFloat = (pick) => {
  const a = new Float32Array(TABLE_SIZE);
  for (const m of MATERIALS) a[m.id] = pick(m);
  return a;
};
const buildU8 = (pick) => {
  const a = new Uint8Array(TABLE_SIZE);
  for (const m of MATERIALS) a[m.id] = pick(m);
  return a;
};
const buildU32 = (pick) => {
  const a = new Uint32Array(TABLE_SIZE);
  for (const m of MATERIALS) a[m.id] = pick(m) >>> 0;
  return a;
};

// Engine-side flat tables (consumed in hot loops as TABLE[m]).
export const buildDensity = () => buildFloat((m) => m.density);
export const buildLooseSorted = () => buildU8((m) => (m.looseSorted ? 1 : 0));
export const buildMobility = () => buildFloat((m) => m.mobility);
export const buildKind = () => buildU8((m) => m.kind);

// Renderer-side flat tables.
export const buildColorLUT = () => buildU32((m) => m.color);
export const buildTextureAmp = () => buildU8((m) => m.textureAmp);
