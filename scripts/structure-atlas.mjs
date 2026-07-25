// Find and render representative generated structures from the actual two-layer
// cell grids. Usage: npm run worldgen:structure-atlas -- [output.png] [seed]

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MATERIALS } from '../src/sand/materials.generated.js';
import { MAT } from '../src/sand/materials.js';

const output = resolve(process.argv[2] || 'bench/structure-atlas.png');
const seed = Number(process.argv[3] || 0xBED) >>> 0;
const COLS = 320, ROWS = 240, SCALE = 4, GAP = 8;
const panels = [];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
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
  const packed = MATERIALS[id]?.color >>> 0;
  const color = [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255];
  return background ? color.map((v) => Math.round(v * 0.52)) : color;
}

function capture(engine, name, centerX, centerY, width, height) {
  const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
  const x0 = Math.max(offX, Math.min(offX + COLS - width, Math.round(centerX - width / 2)));
  const y0 = Math.max(offY, Math.min(offY + ROWS - height, Math.round(centerY - height / 2)));
  const fg = engine.getGrid(), bg = engine.getGridBg();
  const pixels = Buffer.alloc(width * SCALE * height * SCALE * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const k = (y0 - offY + y) * COLS + x0 - offX + x;
    const foreground = fg[k] !== MAT.EMPTY;
    const color = foreground ? colorOf(fg[k], false) : colorOf(bg[k], true);
    for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
      const p = ((y * SCALE + sy) * width * SCALE + x * SCALE + sx) * 4;
      pixels[p] = color[0]; pixels[p + 1] = color[1]; pixels[p + 2] = color[2]; pixels[p + 3] = 255;
    }
  }
  panels.push({ name, x0, y0, width: width * SCALE, height: height * SCALE, pixels });
}

function findSurfaceStructure(engine) {
  for (let attempt = 0; attempt < 28; attempt++) {
    const bg = engine.getGridBg();
    const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
    let score = 0, weightedX = 0;
    const occupied = new Uint8Array(COLS);
    for (let x = 12; x < COLS - 12; x++) {
      const surface = engine.worldSurfaceAbsAt(offX + x) - offY;
      let column = 0;
      for (let y = Math.max(0, surface - 62); y < Math.min(ROWS, surface); y++)
        if (bg[y * COLS + x] === MAT.BRICK || bg[y * COLS + x] === MAT.SANDSTONE) column++;
      if (column >= 8) {
        occupied[x] = 1;
        score += column;
        weightedX += (offX + x) * column;
      }
    }
    const runs = [];
    for (let x = 0; x < COLS;) {
      if (!occupied[x]) { x++; continue; }
      const start = x;
      while (x < COLS && occupied[x]) x++;
      if (x - start >= 12) runs.push([start, x - 1]);
    }
    const span = runs.length > 1 ? runs.at(-1)[1] - runs[0][0] + 1 : 0;
    if (score >= 420 && runs.length >= 2 && span >= 90) {
      const centerX = weightedX / score;
      return { x: centerX, y: engine.worldSurfaceAbsAt(Math.round(centerX)) - 27 };
    }
    engine.shiftWorldXY(192, 0);
  }
  return null;
}

function findMine(engine) {
  for (let depth = 0; depth < 3; depth++) {
    for (let attempt = 0; attempt < 28; attempt++) {
      const fg = engine.getGrid();
      const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
      for (let y = 16; y < ROWS - 8; y++) {
        let count = 0, first = -1, last = -1;
        for (let x = 0; x < COLS; x++) if (fg[y * COLS + x] === MAT.IRON_ORE) {
          count++; if (first < 0) first = x; last = x;
        }
        if (count >= 70 && last - first >= 100 && first >= 24 && last < COLS - 24)
          return { x: offX + (first + last) / 2, y: offY + y - 28 };
      }
      engine.shiftWorldXY(192, 0);
    }
    engine.shiftWorldXY(0, 96);
  }
  return null;
}

function findRuin(engine) {
  for (let depth = 0; depth < 3; depth++) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const fg = engine.getGrid();
      const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
      const seen = new Uint8Array(fg.length);
      const stack = [];
      for (let start = 0; start < fg.length; start++) {
        if (seen[start] || fg[start] !== MAT.BRICK) continue;
        seen[start] = 1; stack.push(start);
        let count = 0, minX = COLS, maxX = -1, minY = ROWS, maxY = -1;
        while (stack.length) {
          const k = stack.pop();
          const x = k % COLS, y = (k / COLS) | 0;
          count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          for (const nk of [x ? k - 1 : -1, x + 1 < COLS ? k + 1 : -1, y ? k - COLS : -1, y + 1 < ROWS ? k + COLS : -1])
            if (nk >= 0 && !seen[nk] && fg[nk] === MAT.BRICK) { seen[nk] = 1; stack.push(nk); }
        }
        const width = maxX - minX + 1, height = maxY - minY + 1;
        const centerX = offX + (minX + maxX) / 2, centerY = offY + (minY + maxY) / 2;
        let interiorEmpty = 0;
        for (let y = minY + 1; y < maxY; y++) for (let x = minX + 1; x < maxX; x++)
          interiorEmpty += fg[y * COLS + x] === MAT.EMPTY;
        if (count >= 45 && width >= 16 && width <= 70 && height >= 7
            && interiorEmpty > Math.max(30, width * height * 0.30)
            && centerY > engine.worldSurfaceAbsAt(Math.round(centerX)) + 30)
          return { x: centerX, y: centerY };
      }
      engine.shiftWorldXY(160, 0);
    }
    engine.shiftWorldXY(0, 128);
  }
  return null;
}

await initSandWasm();
const engine = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: seed, sinksOn: false, infinite: true });

const surface = findSurfaceStructure(engine);
if (surface) {
  engine.shiftWorldXY(Math.round(surface.x - engine.getWorldOffsetX() - COLS / 2), 0);
  capture(engine, 'surface settlement', surface.x, surface.y, 240, 96);
}

engine.shiftWorldXY(0, 96);
const mine = findMine(engine);
if (mine) {
  engine.shiftWorldXY(Math.round(mine.x - engine.getWorldOffsetX() - COLS / 2), 0);
  capture(engine, 'railroad mine', mine.x, mine.y, 240, 112);
}

engine.shiftWorldXY(0, 128);
const ruin = findRuin(engine);
if (ruin) {
  engine.shiftWorldXY(Math.round(ruin.x - engine.getWorldOffsetX() - COLS / 2), 0);
  capture(engine, 'underground ruin', ruin.x, ruin.y, 180, 96);
}
engine.destroy();

if (panels.length !== 3) throw new Error(`could only find ${panels.length}/3 structure types for seed ${seed}`);
const width = Math.max(...panels.map((p) => p.width));
const height = panels.reduce((sum, p) => sum + p.height, 0) + GAP * (panels.length - 1);
const pixels = Buffer.alloc(width * height * 4);
for (let p = 0; p < pixels.length; p += 4) {
  pixels[p] = 8; pixels[p + 1] = 11; pixels[p + 2] = 17; pixels[p + 3] = 255;
}
let destY = 0;
for (const panel of panels) {
  const destX = Math.floor((width - panel.width) / 2);
  for (let y = 0; y < panel.height; y++)
    panel.pixels.copy(pixels, ((destY + y) * width + destX) * 4, y * panel.width * 4, (y + 1) * panel.width * 4);
  console.log(`${panel.name}: world (${panel.x0}, ${panel.y0}) ${panel.width / SCALE}x${panel.height / SCALE}`);
  destY += panel.height + GAP;
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, encodePng(width, height, pixels));
console.log(`structure atlas: ${output} (${width}x${height}, seed ${seed})`);
