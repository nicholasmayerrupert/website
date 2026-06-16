// Single source of truth for material identity.
//
// Each entry below declares everything that distinguishes one material from
// another across the whole simulation AND the renderer. To add a material:
// add one entry here. If it moves in a way no existing `kind` covers, also add
// a case to the engine's step() dispatch — otherwise no other file needs editing.
//
// Numeric ids are explicit and MUST stay stable: saved scenes, worldgen, and
// the benchmark/tests key off them.

// How the engine routes a cell each tick. The hot loop reads KIND[m] (a flat
// Uint8Array built from these), never per-cell objects.
export const KIND = {
  NONE: 0, // empty / inert: no per-cell motion pass
  POWDER: 1, // sand-like: falls straight then slides diagonally
  LIQUID: 2, // water/oil/acid/lava: flow + density displacement (mobility gates lava)
  GAS: 3, // fire/steam: rise + spread
  COMPONENT: 4, // stone/wood/plant/ice: tracked as connected rigid assemblies
  FREE_RIGID: 5, // rasterized footprints of continuous rigid bodies
};

// renderAnim drives per-frame shimmer/flicker in renderCore; 'none' = static grain.
//
// color is packed ABGR (0xAABBGGRR) over the little-endian RGBA ImageData view.
// density 0 = weightless (air/gas). looseSorted marks materials that participate
// in density-sorted loose settling (powders + flowing liquids). mobility is the
// per-tick chance a loose material attempts to move (lava < 1 = viscous).
export const MATERIALS = [
  { id: 0,  name: 'EMPTY', kind: KIND.NONE,       density: 0,   looseSorted: false, mobility: 0,    color: 0x00000000, textureAmp: 0, renderAnim: 'none' },
  { id: 1,  name: 'SAND',  kind: KIND.POWDER,     density: 1.6, looseSorted: true,  mobility: 1.0,  color: 0x7978c8e6, textureAmp: 7, renderAnim: 'none' },
  { id: 2,  name: 'WATER', kind: KIND.LIQUID,     density: 1.0, looseSorted: true,  mobility: 1.0,  color: 0x66ffaa78, textureAmp: 3, renderAnim: 'none' },
  { id: 3,  name: 'STONE', kind: KIND.COMPONENT,  density: 2.6, looseSorted: false, mobility: 0,    color: 0xb3968c8c, textureAmp: 8, renderAnim: 'none' },
  { id: 4,  name: 'OIL',   kind: KIND.LIQUID,     density: 0.8, looseSorted: true,  mobility: 1.0,  color: 0x8c1c4869, textureAmp: 4, renderAnim: 'none' },
  { id: 5,  name: 'FIRE',  kind: KIND.GAS,        density: 0,   looseSorted: false, mobility: 0,    color: 0xb8226cff, textureAmp: 0, renderAnim: 'fire' },
  { id: 6,  name: 'STEAM', kind: KIND.GAS,        density: 0,   looseSorted: false, mobility: 0,    color: 0x42ffe6d2, textureAmp: 0, renderAnim: 'steam' },
  { id: 7,  name: 'SEED',  kind: KIND.COMPONENT,  density: 0.5, looseSorted: false, mobility: 0,    color: 0xc7162e58, textureAmp: 5, renderAnim: 'none' },
  { id: 8,  name: 'WOOD',  kind: KIND.COMPONENT,  density: 0.6, looseSorted: false, mobility: 0,    color: 0xc2234c80, textureAmp: 7, renderAnim: 'none' },
  { id: 9,  name: 'PLANT', kind: KIND.COMPONENT,  density: 0.4, looseSorted: false, mobility: 0,    color: 0xa354aa5b, textureAmp: 9, renderAnim: 'none' },
  { id: 10, name: 'ACID',  kind: KIND.LIQUID,     density: 1.1, looseSorted: true,  mobility: 1.0,  color: 0x8020ff80, textureAmp: 4, renderAnim: 'none' },
  { id: 11, name: 'LAVA',  kind: KIND.LIQUID,     density: 2.8, looseSorted: true,  mobility: 0.35, color: 0xc81050ff, textureAmp: 0, renderAnim: 'lava' },
  { id: 12, name: 'ICE',   kind: KIND.COMPONENT,  density: 0.9, looseSorted: false, mobility: 0,    color: 0x90fff0c0, textureAmp: 5, renderAnim: 'none' },
  { id: 13, name: 'RIGID', kind: KIND.FREE_RIGID, density: 1.4, looseSorted: false, mobility: 0,    color: 0xff8a725e, textureAmp: 6, renderAnim: 'none' },
  { id: 14, name: 'DRIFTWOOD', kind: KIND.COMPONENT, density: 0.6, looseSorted: false, mobility: 0, color: 0xc26e7d8c, textureAmp: 7, renderAnim: 'none' },
];

// Slots in the flat tables. 16 keeps a power-of-two-ish headroom over the 14
// current ids and matches the engine's existing array sizing.
const TABLE_SIZE = 16;

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
