// Render a deterministic, whole-depth world atlas from the engine's canonical
// terrain queries. Usage: npm run worldgen:atlas -- [output.png] [seed]

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';

const output = resolve(process.argv[2] || 'bench/worldgen-atlas.png');
const seed = Number(process.argv[3] || 0xBED) >>> 0;
const WIDTH = 1024;
const WORLD_X0 = -1536, WORLD_Y0 = -96;
const X_SCALE = 3, Y_SCALE = 2;
const PANE_HEIGHT = 480, GAP = 8, HEIGHT = PANE_HEIGHT * 2 + GAP;
const SEA_LEVEL = 18, CAVE_BOTTOM = 576, UNDERWORLD_TOP = 832;

const biomeColors = [
  [92, 151, 76],   // plains
  [46, 112, 64],   // forest
  [202, 164, 91],  // desert
  [120, 124, 132], // rocky
  [202, 218, 221], // tundra
  [35, 132, 69],   // jungle
  [73, 105, 74],   // swamp
];
const caveColors = [
  [72, 75, 84],    // default
  [79, 184, 205],  // crystal
  [143, 74, 143],  // mushroom
  [58, 137, 80],   // lush
];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

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

await initSandWasm();
const engine = createEngineWasm({
  cols: 128, rows: 128, worldSeed: seed, sinksOn: false, infinite: true,
});
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
const surfaces = new Int32Array(WIDTH);
const biomes = new Uint8Array(WIDTH);
for (let px = 0; px < WIDTH; px++) {
  const wx = WORLD_X0 + px * X_SCALE;
  surfaces[px] = engine.worldSurfaceAbsAt(wx);
  biomes[px] = engine.worldBiomeAt(wx);
}

function paintPixel(x, y, color) {
  const i = (y * WIDTH + x) * 4;
  pixels[i] = color[0];
  pixels[i + 1] = color[1];
  pixels[i + 2] = color[2];
  pixels[i + 3] = 255;
}

for (let layer = 0; layer < 2; layer++) {
  const paneY = layer * (PANE_HEIGHT + GAP);
  for (let py = 0; py < PANE_HEIGHT; py++) {
    const wy = WORLD_Y0 + py * Y_SCALE;
    for (let px = 0; px < WIDTH; px++) {
      const wx = WORLD_X0 + px * X_SCALE;
      const surface = surfaces[px];
      const biomeColor = biomeColors[biomes[px]];
      let color;
      if (wy < surface) {
        if (wy >= SEA_LEVEL) {
          const depth = Math.min(1, (wy - SEA_LEVEL) / 96);
          color = mix([45, 110, 154], [18, 48, 81], depth);
        } else {
          const sky = Math.max(0, Math.min(1, (wy - WORLD_Y0) / 150));
          color = mix([19, 31, 52], [72, 112, 145], sky);
        }
      } else if (engine.worldIsCaveAt(layer, wx, wy)) {
        color = caveColors[engine.worldCaveBiomeAt(wx, wy)];
        if (layer) color = mix([15, 18, 24], color, 0.58);
      } else if (wy >= UNDERWORLD_TOP) {
        color = [72, 26, 29];
      } else {
        const depth = Math.max(0, wy - surface);
        color = depth < 12 ? biomeColor : mix([73, 61, 54], [33, 31, 34], Math.min(1, depth / 620));
        if (layer) color = mix([12, 14, 19], color, 0.70);
      }
      if (wy === CAVE_BOTTOM || wy === UNDERWORLD_TOP) color = mix(color, [230, 189, 91], 0.55);
      paintPixel(px, paneY + py, color);
    }
  }
}
for (let y = PANE_HEIGHT; y < PANE_HEIGHT + GAP; y++)
  for (let x = 0; x < WIDTH; x++) paintPixel(x, y, [8, 10, 14]);

engine.destroy();
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, encodePng(WIDTH, HEIGHT, pixels));
console.log(`worldgen atlas: ${output} (${WIDTH}x${HEIGHT}, seed ${seed})`);
