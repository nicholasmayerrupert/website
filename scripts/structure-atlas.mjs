// Render representative generated structures discovered through semantic world
// context. Usage: npm run worldgen:structure-atlas -- [output.png] [seed]

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  initSandWasm, createEngineWasm, CAVE_BIOME_DEFS, WORLD_FEATURE,
} from '../src/sand/wasmBridge/engineFactory.js';
import { MATERIAL_BY_ID } from '../src/sand/materials.generated.js';
import { MAT } from '../src/sand/materials.js';

const output = resolve(process.argv[2] || 'bench/structure-atlas.png');
const seed = Number(process.argv[3] || 0xBED) >>> 0;
const COLS = 320, ROWS = 240, SCALE = 4, GAP = 8;
const panels = [];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const out = Buffer.allocUnsafe(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), data.length + 8);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const scanlines = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    scanlines[row] = 0;
    rgba.copy(scanlines, row + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function colorOf(id, background) {
  if (id === MAT.EMPTY) return [17, 24, 36];
  const packed = MATERIAL_BY_ID[id]?.color >>> 0;
  const color = [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255];
  return background ? color.map((value) => Math.round(value * 0.52)) : color;
}

function capture(engine, name, bounds, width, height) {
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
  const x0 = Math.max(offX,
    Math.min(offX + COLS - width, Math.round(centerX - width / 2)));
  const y0 = Math.max(offY,
    Math.min(offY + ROWS - height, Math.round(centerY - height / 2)));
  const fg = engine.getGrid(), bg = engine.getGridBg();
  const pixels = Buffer.alloc(width * SCALE * height * SCALE * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const k = (y0 - offY + y) * COLS + x0 - offX + x;
    const foreground = fg[k] !== MAT.EMPTY;
    const color = foreground ? colorOf(fg[k], false) : colorOf(bg[k], true);
    for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
      const p = ((y * SCALE + sy) * width * SCALE + x * SCALE + sx) * 4;
      pixels[p] = color[0];
      pixels[p + 1] = color[1];
      pixels[p + 2] = color[2];
      pixels[p + 3] = 255;
    }
  }
  panels.push({ name, width: width * SCALE, height: height * SCALE, pixels });
}

function findFeature(engine, featureKind, {
  horizontalWindows = 32, verticalWindows = 1, step = 8,
} = {}) {
  for (let depth = 0; depth < verticalWindows; depth++) {
    for (let attempt = 0; attempt < horizontalWindows; attempt++) {
      const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
      for (let y = step; y < ROWS - step; y += step) {
        for (let x = step; x < COLS - step; x += step) {
          const context = engine.worldContextAt(offX + x, offY + y);
          if (context.featureKind === featureKind) return context;
        }
      }
      engine.shiftWorldXY(192, 0);
    }
    engine.shiftWorldXY(0, 128);
  }
  return null;
}

function centerFeature(engine, context) {
  const centerX = (context.bounds.left + context.bounds.right) / 2;
  const centerY = (context.bounds.top + context.bounds.bottom) / 2;
  const shiftX = Math.round((centerX - engine.getWorldOffsetX() - COLS / 2) / 32) * 32;
  const shiftY = Math.round((centerY - engine.getWorldOffsetY() - ROWS / 2) / 32) * 32;
  if (shiftX || shiftY) engine.shiftWorldXY(shiftX, shiftY);
}

function captureDeepMonuments(engine) {
  const deepBiomes = CAVE_BIOME_DEFS.filter((def) => def.deep);
  const deepById = new Map(deepBiomes.map((def) => [def.id, def]));
  const foundBiomes = new Set();
  const foundFeatures = new Set();
  while (engine.getWorldOffsetY() < 640) engine.shiftWorldXY(0, 160);
  for (let depth = 0; depth < 6 && foundBiomes.size < deepBiomes.length; depth++) {
    for (let attempt = 0; attempt < 36; attempt++) {
      const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
      const pending = [];
      for (let y = 8; y < ROWS - 8; y += 8) {
        for (let x = 8; x < COLS - 8; x += 8) {
          const context = engine.worldContextAt(offX + x, offY + y);
          if (context.featureKind !== WORLD_FEATURE.DEEP_STRUCTURE
              || foundFeatures.has(context.featureId)
              || !deepById.has(context.biome)
              || foundBiomes.has(context.biome)) continue;
          pending.push(context);
          foundFeatures.add(context.featureId);
          foundBiomes.add(context.biome);
        }
      }
      for (const context of pending) {
        const def = deepById.get(context.biome);
        capture(engine, def.name, context.bounds, 220, 112);
      }
      engine.shiftWorldXY(160, 0);
    }
    engine.shiftWorldXY(0, 160);
  }
  return { found: foundBiomes.size, expected: deepBiomes.length };
}

await initSandWasm();
const engine = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: seed, sinksOn: false, infinite: true,
});

const representatives = [
  { kind: WORLD_FEATURE.VILLAGE, name: 'surface settlement', width: 300, height: 100,
    search: {} },
  { kind: WORLD_FEATURE.MINE, name: 'railroad mine', width: 240, height: 112,
    search: { verticalWindows: 3 } },
  { kind: WORLD_FEATURE.RUIN, name: 'underground ruin', width: 180, height: 96,
    search: { horizontalWindows: 30, verticalWindows: 3 } },
];
for (const representative of representatives) {
  const context = findFeature(engine, representative.kind, representative.search);
  if (!context) continue;
  centerFeature(engine, context);
  capture(engine, representative.name, context.bounds,
          representative.width, representative.height);
}

const deep = captureDeepMonuments(engine);
engine.destroy();

const expectedPanels = representatives.length + deep.expected;
if (panels.length !== expectedPanels)
  throw new Error(`found ${panels.length}/${expectedPanels} structure panels; deep ${deep.found}/${deep.expected}`);
const width = Math.max(...panels.map((panel) => panel.width));
const height = panels.reduce((sum, panel) => sum + panel.height, 0)
  + GAP * (panels.length - 1);
const pixels = Buffer.alloc(width * height * 4);
for (let p = 0; p < pixels.length; p += 4) {
  pixels[p] = 8;
  pixels[p + 1] = 11;
  pixels[p + 2] = 17;
  pixels[p + 3] = 255;
}
let destY = 0;
for (const panel of panels) {
  const destX = Math.floor((width - panel.width) / 2);
  for (let y = 0; y < panel.height; y++) {
    const source = y * panel.width * 4;
    const destination = ((destY + y) * width + destX) * 4;
    panel.pixels.copy(pixels, destination, source, source + panel.width * 4);
  }
  destY += panel.height + GAP;
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, encodePng(width, height, pixels));
console.log(`structure atlas: ${output} (${width}x${height}, seed ${seed}; ${panels.map((panel) => panel.name).join(', ')})`);
