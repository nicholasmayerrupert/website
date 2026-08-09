// Code generator for the shared material registry.
//
//   node scripts/generate-materials.mjs            # regenerate
//   node scripts/generate-materials.mjs --check     # fail if outputs are stale
//
// Reads src/sand/materials.schema.json (the single source of truth) and emits:
//   src/sand/materials.generated.js          (JS constants: KIND, MATERIALS, ...)
//   src/sand/cpp/engine/materials.generated.hpp (C++ enums + flat lookup tables)
// Both are committed; this keeps material ids/properties in exactly one place.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const schemaPath = resolve(root, 'src/sand/materials.schema.json');
const jsPath = resolve(root, 'src/sand/materials.generated.js');
const hppPath = resolve(root, 'src/sand/cpp/engine/materials.generated.hpp');

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const { tableSize, kinds, materialClasses, renderAnims, flagBits, toolClasses, toolTiers, miningSpeed, materials, animColors } = schema;

if (!materialClasses) throw new Error('schema must define materialClasses');
if (!renderAnims || renderAnims.none !== 0) throw new Error('schema must define renderAnims with none = 0');
if (!flagBits) throw new Error('schema must define flagBits');
if (!toolClasses || !toolTiers) throw new Error('schema must define toolClasses and toolTiers');
const toolClassCount = Math.max(...Object.values(toolClasses)) + 1;
const toolTierCount = Math.max(...Object.values(toolTiers)) + 1;
if (!miningSpeed || miningSpeed.classPercent?.length !== toolClassCount || miningSpeed.classPercent.some((r) => r.length !== toolClassCount)) throw new Error('miningSpeed.classPercent must be a square tool-class matrix');
if (miningSpeed.tierPercent?.length !== toolTierCount) throw new Error('miningSpeed.tierPercent must have one entry per tool tier');
if (!Number.isInteger(miningSpeed.progressDivisor) || miningSpeed.progressDivisor < 1) throw new Error('miningSpeed.progressDivisor must be a positive integer');
const maxToolTier = Math.max(...Object.values(toolTiers));

// Materials indexed by id, with empty slots for any gaps up to tableSize.
const byId = new Array(tableSize).fill(null);
for (const m of materials) {
  if (m.id < 0 || m.id >= tableSize) throw new Error(`material ${m.name} id ${m.id} out of range 0..${tableSize - 1}`);
  if (byId[m.id]) throw new Error(`duplicate material id ${m.id}`);
  if (!(m.kind in kinds)) throw new Error(`material ${m.name} has unknown kind ${m.kind}`);
  if (!('materialClass' in m)) throw new Error(`material ${m.name} missing materialClass`);
  if (!(m.materialClass in materialClasses)) throw new Error(`material ${m.name} has unknown materialClass ${m.materialClass}`);
  if (!(m.renderAnim in renderAnims)) throw new Error(`material ${m.name} has unknown renderAnim ${m.renderAnim}`);
  if (!('flags' in m)) throw new Error(`material ${m.name} missing flags`);
  for (const f of m.flags) if (!(f in flagBits)) throw new Error(`material ${m.name} has unknown flag ${f}`);
  if (!('toolClass' in m)) throw new Error(`material ${m.name} missing toolClass`);
  if (!(m.toolClass in toolClasses)) throw new Error(`material ${m.name} has unknown toolClass ${m.toolClass}`);
  if (!('toolTier' in m) || !Number.isInteger(m.toolTier) || m.toolTier < 0 || m.toolTier > maxToolTier) throw new Error(`material ${m.name} has invalid toolTier ${m.toolTier}`);
  if ('transparency' in m && (!Number.isFinite(m.transparency) || m.transparency < 0 || m.transparency > 1)) throw new Error(`material ${m.name} has invalid transparency ${m.transparency}`);
  byId[m.id] = m;
}

// Pack a material's flag-name list into a bitmask using flagBits indices.
const flagMask = (m) => m.flags.reduce((acc, f) => acc | (1 << flagBits[f]), 0);

const hasFlag = (m, f) => m.flags.includes(f);
const mc = (name) => materialClasses[name];
const bearingExceptions = new Set(['VINE', 'GLOWBERRY']);
for (const m of materials) {
  const c = materialClasses[m.materialClass];
  if (m.name === 'EMPTY' && c !== mc('none')) throw new Error('EMPTY must have materialClass none');
  if (m.kind === 'GAS' && c !== mc('gas')) throw new Error(`${m.name}: K_GAS must have materialClass gas`);
  if (m.kind === 'LIQUID' && c !== mc('liquid')) throw new Error(`${m.name}: K_LIQUID must have materialClass liquid`);
  if (m.kind === 'POWDER' && c !== mc('solid')) throw new Error(`${m.name}: K_POWDER must have materialClass solid`);
  if (m.kind === 'FREE_RIGID' && c !== mc('rigid')) throw new Error(`${m.name}: K_FREE_RIGID must have materialClass rigid`);
  if (hasFlag(m, 'rigid') && c !== mc('rigid')) throw new Error(`${m.name}: rigid flag requires materialClass rigid`);
  if (c === mc('rigid') && !hasFlag(m, 'bearing') && !bearingExceptions.has(m.name)) throw new Error(`${m.name}: rigid materials should have bearing flag or an explicit exception`);
  if (c === mc('none') && m.name !== 'EMPTY') throw new Error(`${m.name}: only EMPTY may have materialClass none`);
}

const BANNER = (tool) => `// @generated by scripts/generate-materials.mjs from materials.schema.json\n// DO NOT EDIT BY HAND. Edit the schema, then run \`npm run generate\`.\n// (${tool})\n`;
const animKeys = Object.keys(animColors).filter((k) => !k.startsWith('$'));

// ---------------- JS ----------------
const jsKindLines = Object.entries(kinds).map(([k, v]) => `  ${k}: ${v},`).join('\n');
const jsClassLines = Object.entries(materialClasses).map(([k, v]) => `  ${k.toUpperCase()}: ${v},`).join('\n');
const jsRenderAnimLines = Object.entries(renderAnims).map(([k, v]) => `  ${k.toUpperCase()}: ${v},`).join('\n');
const jsMatLines = materials
  .map((m) => `  { id: ${m.id}, name: '${m.name}', kind: KIND.${m.kind}, materialClass: MC.${m.materialClass.toUpperCase()}, density: ${m.density}, looseSorted: ${m.looseSorted}, mobility: ${m.mobility}, transparency: ${m.transparency ?? 0}, color: ${m.color}, textureAmp: ${m.textureAmp}, durability: ${m.durability}, renderAnim: '${m.renderAnim}' },`)
  .join('\n');
const jsAnimLines = animKeys.map((k) => `export const ${k} = ${animColors[k]};`).join('\n');
const jsFlagLines = Object.entries(flagBits).map(([k, v]) => `  ${k}: ${1 << v},`).join('\n');
const jsToolClassLines = Object.entries(toolClasses).map(([k, v]) => `  ${k}: ${v},`).join('\n');
const jsToolTierLines = Object.entries(toolTiers).map(([k, v]) => `  ${k}: ${v},`).join('\n');
const jsArr = (pick) => byId.map((m) => (m ? pick(m) : 0)).join(', ');
const js = `${BANNER('JS module')}
// Slots in the flat lookup tables (power-of-two headroom over the live ids).
export const TABLE_SIZE = ${tableSize};

// How the engine routes a cell each tick (mirrors C++ enum Kind).
export const KIND = {
${jsKindLines}
};

// Broad gameplay/physics class (mirrors C++ enum MaterialClass / MC_*).
export const MC = {
${jsClassLines}
};

// Render-only texture animation type (mirrors C++ enum RenderAnim / RA_*).
export const RA = {
${jsRenderAnimLines}
};

// Behavior-flag bitmasks (mirrors C++ MF_* constants). OR together per material.
export const MF = {
${jsFlagLines}
};

// Mining tool classes + tiers (mirror C++ enum ToolClass / ToolTier).
export const TC = {
${jsToolClassLines}
};
export const TT = {
${jsToolTierLines}
};

// The material registry. Each entry fully distinguishes one material across the
// whole simulation AND the renderer.
export const MATERIALS = [
${jsMatLines}
];

// Flat lookup tables indexed by material id (empty slots = 0), mirroring the C++
// MAT_CLASS / MAT_FLAGS tables.
export const MAT_CLASS = [${jsArr((m) => materialClasses[m.materialClass])}];
export const MAT_FLAGS = [${jsArr(flagMask)}];
export const MAT_TRANSPARENCY = [${jsArr((m) => m.transparency ?? 0)}];
export const MAT_RENDER_ANIM = [${jsArr((m) => renderAnims[m.renderAnim])}];

// Mining gate tables: which tool class drops a material and the min tier required.
export const MAT_TOOLCLASS = [${jsArr((m) => toolClasses[m.toolClass])}];
export const MAT_TOOLTIER = [${jsArr((m) => m.toolTier)}];
export const TOOL_CLASS_SPEED = [${miningSpeed.classPercent.flat().join(', ')}];
export const TOOL_TIER_SPEED = [${miningSpeed.tierPercent.join(', ')}];
export const MINING_PROGRESS_DIVISOR = ${miningSpeed.progressDivisor};

// Animation-only packed ABGR colors the renderer swaps in per-frame.
${jsAnimLines}
`;

// ---------------- C++ ----------------
const cppEnumMat = materials.map((m) => `${m.name} = ${m.id}`).join(', ');
const cppEnumKind = Object.entries(kinds).map(([k, v]) => `K_${k} = ${v}`).join(', ');
const cppEnumClass = Object.entries(materialClasses).map(([k, v]) => `MC_${k.toUpperCase()} = ${v}`).join(', ');
const cppEnumRenderAnim = Object.entries(renderAnims).map(([k, v]) => `RA_${k.toUpperCase()} = ${v}`).join(', ');
const col = (pick, fmt = (v) => v) => {
  const out = [];
  for (let i = 0; i < tableSize; i++) out.push(fmt(byId[i] ? pick(byId[i]) : null));
  return out.join(', ');
};
const fnum = (v) => (v === null ? '0' : (Number.isInteger(v) ? v : `${v}f`));
const u8 = (v) => (v === null ? '0' : v);
const kindVal = (m) => (m === null ? 'K_NONE' : `K_${m.kind}`);
const classVal = (m) => (m === null ? 'MC_NONE' : `MC_${m.materialClass.toUpperCase()}`);
const hexColor = (m) => (m === null ? '0x00000000u' : `${m.color}u`);
const cppAnimLines = animKeys.map((k) => `static const uint32_t ${k} = ${animColors[k]}u;`).join('\n');
const cppFlagConsts = Object.entries(flagBits).map(([k, v]) => `static const uint16_t MF_${k.toUpperCase()} = 1u << ${v};`).join('\n');
const cppEnumToolClass = Object.entries(toolClasses).map(([k, v]) => `TC_${k.toUpperCase()} = ${v}`).join(', ');
const cppEnumToolTier = Object.entries(toolTiers).map(([k, v]) => `TT_${k.toUpperCase()} = ${v}`).join(', ');
const hpp = `#pragma once
${BANNER('C++ header')}
enum Mat : uint8_t { ${cppEnumMat} };
enum Kind : uint8_t { ${cppEnumKind} };
enum MaterialClass : uint8_t { ${cppEnumClass} };
enum RenderAnim : uint8_t { ${cppEnumRenderAnim} };
// Mining tool classes + tiers (drives MAT_TOOLCLASS / MAT_TOOLTIER drop gating).
enum ToolClass : uint8_t { ${cppEnumToolClass} };
enum ToolTier : uint8_t { ${cppEnumToolTier} };
// Behavior-flag bits packed into MAT_FLAGS[]. Predicates AND against these.
${cppFlagConsts}

static const int MATERIAL_COUNT = ${materials.length};
static const int TABLE = ${tableSize};
static const float    DENSITY[TABLE]        = {${col((m) => m.density, fnum)}};
static const uint8_t  DENSITY_SORTED[TABLE] = {${col((m) => (m.looseSorted ? 1 : 0), u8)}};
static const float    MOBILITY[TABLE]       = {${col((m) => m.mobility, fnum)}};
static const uint8_t  MAT_KIND[TABLE]       = {${materials.length ? col((m) => m, kindVal) : ''}};
// Broad gameplay class and trait flags per material.
static const uint8_t  MAT_CLASS[TABLE]      = {${materials.length ? col((m) => m, classVal) : ''}};
static const uint16_t MAT_FLAGS[TABLE]      = {${col((m) => flagMask(m), u8)}};
// Render transparency: 0 = opaque, 1 = invisible. Packed color alpha is ignored.
static const float    MAT_TRANSPARENCY[TABLE]= {${col((m) => m.transparency ?? 0, fnum)}};
// Mining gate: which tool class drops a material + the min tier required.
static const uint8_t  MAT_TOOLCLASS[TABLE]  = {${col((m) => toolClasses[m.toolClass], u8)}};
static const uint8_t  MAT_TOOLTIER[TABLE]   = {${col((m) => m.toolTier, u8)}};
// Mining speed percentages: held-class x preferred-class matrix, then held tier.
static const int TOOL_CLASS_COUNT = ${toolClassCount};
static const uint8_t  TOOL_CLASS_SPEED[${toolClassCount * toolClassCount}] = {${miningSpeed.classPercent.flat().join(', ')}};
static const uint8_t  TOOL_TIER_SPEED[${toolTierCount}] = {${miningSpeed.tierPercent.join(', ')}};
static const int MINING_PROGRESS_DIVISOR = ${miningSpeed.progressDivisor};
// Renderer lookup tables.
static const uint32_t MAT_COLOR[TABLE]      = {${col((m) => m, hexColor)}};
static const uint8_t  MAT_TEXTURE_AMP[TABLE]= {${col((m) => m.textureAmp, u8)}};
static const uint8_t  MAT_RENDER_ANIM[TABLE] = {${col((m) => renderAnims[m.renderAnim], u8)}};
static const uint8_t  DURABILITY[TABLE]     = {${col((m) => m.durability, u8)}};
// Baseline light emission per material (0 = dark); positional sparkle patterns
// for CRYSTAL/MYCELIUM stay in render.inc (emissionForCell).
static const uint8_t  MAT_EMISSION[TABLE]   = {${col((m) => m.emission ?? 0, u8)}};
${cppAnimLines}
`;

// ---------------- emit / check ----------------
const check = process.argv.includes('--check');
const outputs = [[jsPath, js], [hppPath, hpp]];
let stale = false;
for (const [path, content] of outputs) {
  if (check) {
    let cur = '';
    try { cur = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (cur !== content) { stale = true; console.error(`stale: ${path}`); }
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
}
if (check && stale) { console.error('Generated material files are stale. Run `npm run generate`.'); process.exit(1); }
if (check) console.log('generated material files are up to date');
