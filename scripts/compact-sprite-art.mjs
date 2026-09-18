// Point-sample generated sheets onto a square grid, then flatten their palette.
import sharp from 'sharp';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cutFrame } from './creature-art-pixels.mjs';
import { makePalette } from './import-creature-art.mjs';

const root = new URL('../src/sand/art/', import.meta.url);
const path = name => fileURLToPath(new URL(name, root));
const readJson = async name => JSON.parse(await readFile(path(name), 'utf8'));
const writeJson = async (name, value) => writeFile(path(name), JSON.stringify(value, null, 2) + '\n');
const active = new Set();
const report = {};

async function compact(name, { columns = 4, rows = 3, count = columns * rows, rowEdges, shortEdge = 32, colors = 16 } = {}) {
  active.add(name);
  const input = await readFile(path(name));
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Compact sources are edited directly; rerunning must not resample pixel edits.
  if (info.width <= 512 && info.height <= 512) return null;
  const source = Array.from({ length: count }, (_, i) => cutFrame({ data, width: info.width, height: info.height }, i % columns, Math.floor(i / columns), columns, rows, rowEdges));
  const scale = Math.min(info.width / columns, info.height / rows) / shortEdge;
  const cellWidth = Math.round(info.width / columns / scale);
  const edges = [0];
  for (let row = 0; row < rows; row++) {
    const height = (rowEdges?.[row + 1] ?? Math.round((row + 1) * info.height / rows)) - (rowEdges?.[row] ?? Math.round(row * info.height / rows));
    edges.push(edges.at(-1) + Math.round(height / scale));
  }
  const frames = source.map((frame, n) => {
    const height = edges[Math.floor(n / columns) + 1] - edges[Math.floor(n / columns)];
    return Array.from({ length: cellWidth * height }, (_, i) => {
      const x = Math.floor((i % cellWidth + .5) * frame.width / cellWidth);
      const y = Math.floor((Math.floor(i / cellWidth) + .5) * frame.height / height);
      return frame.background[y * frame.width + x] ? null : frame.pixels[y * frame.width + x];
    });
  });
  const palette = makePalette(frames, colors).colors;
  const cache = new Map();
  const width = cellWidth * columns, height = edges.at(-1), pixels = Buffer.alloc(width * height * 4);
  frames.forEach((frame, n) => frame.forEach((rgb, i) => {
    if (!rgb) return;
    const key = rgb.join(',');
    if (!cache.has(key)) {
      let best = Infinity, chosen;
      for (const color of palette) {
        const distance = color.reduce((sum, value, channel) => sum + (value - rgb[channel]) ** 2, 0);
        if (distance < best) { best = distance; chosen = color; }
      }
      cache.set(key, chosen);
    }
    const x = n % columns * cellWidth + i % cellWidth;
    const y = edges[Math.floor(n / columns)] + Math.floor(i / cellWidth);
    pixels.set([...cache.get(key), 255], (y * width + x) * 4);
  }));
  const output = await sharp(pixels, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, palette: true, colours: colors + 1, dither: 0 }).toBuffer();
  await writeFile(path(name), output);
  report[name] = { before: { width: info.width, height: info.height, bytes: input.length }, after: { width, height, bytes: output.length } };
  console.log(`${name}: ${info.width}×${info.height} → ${width}×${height}`);
  return edges;
}

const manifest = await readJson('creatures/manifest.json');
for (const metadata of Object.values(manifest.creatures)) {
  const { columns, rows, swim = [], count = Math.max(12, ...swim.map(i => i + 1)), rowEdges } = metadata.atlas;
  const edges = await compact('creatures/' + metadata.sheet, { columns, rows, count, rowEdges, shortEdge: metadata.height >= 50 ? 64 : 32 });
  if (edges) metadata.atlas.rowEdges = edges;
}
await writeJson('creatures/manifest.json', manifest);
for (const name of ['base', 'wayfarer', 'hedgeweaver', 'hearthguard'])
  await compact(`player/${name}-grid-v2.png`, { count: 10 });
for (const name of ['locomotion', 'attacks'])
  await compact(`skeleton-dragon/${name}-coarse-v1.png`, { shortEdge: 64, colors: 24 });
const swim = await readJson('creatures/swim/manifest.json');
for (const metadata of swim.creatures) {
  // A swim limb may cross a nominal cell edge; sample the complete strip together.
  await compact('creatures/swim/' + metadata.file, { columns: 1, rows: 1, shortEdge: 64, colors: 24 });
  metadata.sourceGrid = true;
}
await writeJson('creatures/swim/manifest.json', swim);

if (process.argv.includes('--references')) {
  async function references(directory) {
    for (const entry of await readdir(path(directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { await references(name); continue; }
      if (!name.endsWith('.png') || active.has(name)) continue;
      const input = await readFile(path(name)), image = sharp(input), metadata = await image.metadata();
      if (Math.max(metadata.width, metadata.height) <= 384) continue;
      // References retain their layout; nearest sampling and palette reduction have no dithering.
      const output = await image.resize({ width: 384, height: 384, fit: 'inside', kernel: 'nearest' }).png({ compressionLevel: 9, palette: true, colours: 32, dither: 0 }).toBuffer();
      await writeFile(path(name), output);
      const result = await sharp(output).metadata();
      report[name] = { before: { width: metadata.width, height: metadata.height, bytes: input.length }, after: { width: result.width, height: result.height, bytes: output.length } };
    }
  }
  for (const directory of ['creatures', 'player', 'skeleton-dragon', 'frost-giant']) await references(directory);
}
if (Object.keys(report).length) await writeJson('source-grid-report.json', report);
const entries = Object.values(report);
console.log(`${entries.length} PNGs: ${(entries.reduce((n, e) => n + e.before.bytes, 0) / 1e6).toFixed(2)} MB → ${(entries.reduce((n, e) => n + e.after.bytes, 0) / 1e6).toFixed(2)} MB`);
