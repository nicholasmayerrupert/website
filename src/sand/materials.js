// JS material identities generated from materials.schema.json. Edit the schema
// and run `npm run generate`; C++ consumes the matching generated header.
//
// renderAnim drives per-frame shimmer/flicker; 'none' = static grain.
// color is packed ABGR (0xAABBGGRR) over the little-endian RGBA ImageData view;
// its alpha byte is not used. `transparency` explicitly controls rendering
// (0 = opaque, 1 = invisible).
// density 0 = weightless (air/gas). looseSorted marks materials that participate
// in density-sorted loose settling (powders + flowing liquids). mobility is the
// per-tick chance a loose material attempts to move (lava < 1 = viscous).
import { KIND, MATERIALS, MAT_CLASS, MC } from './materials.generated.js';

export { KIND, MATERIALS, MAT_CLASS, MC };

// MAT.<NAME> = id, derived from the registry so ids live in exactly one place.
export const MAT = Object.fromEntries(MATERIALS.map((m) => [m.name, m.id]));
