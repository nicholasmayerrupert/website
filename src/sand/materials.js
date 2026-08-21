// JS material identities generated from materials.schema.json. Edit the schema
// and run `npm run generate`; C++ consumes the matching generated header.
//
// renderAnim drives per-frame shimmer/flicker; 'none' = static grain.
// color is packed ABGR (0xAABBGGRR) over the little-endian RGBA ImageData view;
// its alpha byte is not used. `transparency` explicitly controls rendering
// (0 = opaque, 1 = invisible).
// density 0 = weightless (air/gas). looseSorted marks powders and liquids that
// density-sort at liquid interfaces; powder/powder contacts remain supportive.
// mobility is the per-tick chance for viscosity-limited settling and spreading;
// a generated movement profile may keep unobstructed vertical fall on the
// gravity cadence.
import { KIND, MATERIALS, MATERIAL_BY_ID, MAT_CLASS, MC, TABLE_SIZE } from './materials.generated.js';

export { KIND, MATERIALS, MATERIAL_BY_ID, MAT_CLASS, MC, TABLE_SIZE };

// MAT.<NAME> = id, derived from the registry so ids live in exactly one place.
export const MAT = Object.fromEntries(MATERIALS.map((m) => [m.name, m.id]));
