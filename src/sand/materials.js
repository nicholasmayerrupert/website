// Material identity for the JS side of the sim/renderer.
//
// The registry itself (KIND, MC, MATERIALS) is generated from
// src/sand/materials.schema.json — the single source shared with the C++ engine.
// Edit the schema, then run `npm run generate`. To add a material: add a schema
// entry. If it moves in a way no existing `kind` covers, also add a case to the
// engine's step() dispatch (C++) — otherwise no other file needs editing.
//
// This module re-exports the registry and derives MAT.<NAME> = id for the JS
// shell. The simulation and the renderer both run in C++/WASM now, so JS no
// longer builds flat density/kind/color lookup tables — the engine reads its
// own generated tables (materials.generated.hpp) from the same schema.
//
// renderAnim drives per-frame shimmer/flicker; 'none' = static grain.
// color is packed ABGR (0xAABBGGRR) over the little-endian RGBA ImageData view.
// density 0 = weightless (air/gas). looseSorted marks materials that participate
// in density-sorted loose settling (powders + flowing liquids). mobility is the
// per-tick chance a loose material attempts to move (lava < 1 = viscous).
import { KIND, MATERIALS, MAT_CLASS, MC } from './materials.generated.js';

export { KIND, MATERIALS, MAT_CLASS, MC };

// MAT.<NAME> = id, derived from the registry so ids live in exactly one place.
export const MAT = Object.fromEntries(MATERIALS.map((m) => [m.name, m.id]));
