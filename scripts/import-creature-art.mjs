// Import compact full-sprite sheets; gameplay, attachments, and effects stay in the engine.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import art from '../src/sand/content/creatureArt.js';
import { cutFrame } from './creature-art-pixels.mjs';
export { cutFrame } from './creature-art-pixels.mjs';

const directory = new URL('../src/sand/art/creatures/', import.meta.url);
const manifestPath = new URL('manifest.json', directory);
const symbols = 'abcdefghijklmnopqrstuvwxyzABCDE';

export function makePalette(frames) {
  const histogram = new Map();
  for (const frame of frames) for (const rgb of frame) if (rgb) {
    const key = rgb.map(c => Math.round(c / 8) * 8).join(',');
    const entry = histogram.get(key) || { rgb, count: 0 }; entry.count++; histogram.set(key, entry);
  }
  const boxes = [[...histogram.values()]];
  const range = box => [0, 1, 2].map(c => Math.max(...box.map(p => p.rgb[c])) - Math.min(...box.map(p => p.rgb[c])));
  while (boxes.length < 31) {
    let best = -1, score = -1;
    boxes.forEach((box, i) => {
      const value = Math.max(...range(box)) * Math.sqrt(box.reduce((n, p) => n + p.count, 0));
      if (box.length > 1 && value > score) { best = i; score = value; }
    });
    if (best < 0) break;
    const box = boxes.splice(best, 1)[0], ranges = range(box), channel = ranges.indexOf(Math.max(...ranges));
    box.sort((a, b) => a.rgb[channel] - b.rgb[channel]);
    const half = box.reduce((n, p) => n + p.count, 0) / 2;
    let count = 0, split = 0;
    while (split < box.length - 1 && count < half) count += box[split++].count;
    boxes.push(box.slice(0, split), box.slice(split));
  }
  const colors = boxes.map(box => {
    const count = box.reduce((n, p) => n + p.count, 0);
    return [0, 1, 2].map(c => Math.round(box.reduce((n, p) => n + p.rgb[c] * p.count, 0) / count));
  });
  const palette = { '.': '#000000' };
  colors.forEach((rgb, i) => { palette[symbols[i]] = '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join(''); });
  return { palette, colors };
}

function convert(image, metadata) {
  const source = Array.from({ length: 12 }, (_, i) => cutFrame(image, i % 4, Math.floor(i / 4)));
  const idle = source[4], { width, height, targetBounds, grounded } = metadata;
  let scale = Math.max((idle.maxX - idle.minX + 1) / targetBounds.width, (idle.maxY - idle.minY + 1) / targetBounds.height);
  // One scale for the whole sheet keeps the head and torso size consistent.
  for (const frame of source) scale = Math.max(scale, (frame.maxX - frame.minX + 1) / (width - 4), (frame.maxY - frame.minY + 1) / (height - 4));
  const nativeCenterY = targetBounds.bottom - targetBounds.height / 2;
  const frames = source.map((frame, index) => {
    // The authored cell center preserves pose translation. Clamp only to avoid clipping wide attacks.
    const override = metadata.anchors?.[index];
    let centerX = override?.x ?? frame.width / 2;
    centerX = Math.max(frame.maxX - (width / 2 - 2) * scale, Math.min(centerX, frame.minX + (width / 2 - 2) * scale));
    const floor = override?.y ?? (index < 4 ? Math.max(...source.slice(0, 4).map(f => f.maxY)) : frame.maxY);
    const centerY = override?.y ?? (frame.minY + frame.maxY) / 2;
    return Array.from({ length: width * height }, (_, i) => {
      const x = i % width, y = Math.floor(i / width);
      const sx = Math.round(centerX + (x - (width - 1) / 2) * scale);
      const sy = Math.round(grounded ? floor + (y - targetBounds.bottom) * scale : centerY + (y - nativeCenterY) * scale);
      if (sx < 0 || sy < 0 || sx >= frame.width || sy >= frame.height || frame.background[sy * frame.width + sx]) return null;
      return frame.pixels[sy * frame.width + sx];
    });
  });
  // Human NPC clothing and hair tints refer to palette indices in the renderer.
  const { palette, colors } = metadata.palette
    ? { palette: metadata.palette, colors: Object.values(metadata.palette).slice(1).map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))) }
    : makePalette(frames);
  const frameSymbols = Object.keys(palette).slice(1), cache = new Map();
  const encoded = frames.map(frame => {
    const chars = frame.map(rgb => {
      if (!rgb) return '.';
      const key = rgb.join(','); if (cache.has(key)) return cache.get(key);
      let best = Infinity, symbol = '.';
      colors.forEach((color, i) => { const distance = color.reduce((n, value, c) => n + (value - rgb[c]) ** 2, 0); if (distance < best) { best = distance; symbol = frameSymbols[i]; } });
      cache.set(key, symbol); return symbol;
    });
    if (chars.filter(c => c !== '.').length < 12) throw new Error('Empty imported pose');
    return Array.from({ length: height }, (_, y) => chars.slice(y * width, (y + 1) * width).join(''));
  });
  const clip = (indices, ticks) => ({ ticks, frames: indices.map(i => encoded[i]) });
  return { width, height, pixelScale: metadata.pixelScale, palette, clips: {
    idle: clip([4], 12), move: clip([0, 1, 2, 3], metadata.moveTicks ?? 7),
    windup: clip(metadata.clipFrames?.windup ?? [5], 9), attack: clip(metadata.clipFrames?.attack ?? [6], 4), recover: clip(metadata.clipFrames?.recover ?? [7], 5),
    hurt: clip([8], 3), death: clip([9, 10, 11], 7), special: clip([6], 8),
  } };
}

async function decodePng(page, path) {
  const image = await page.evaluate(async src => {
    const img = new Image(); img.src = src; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, img.width, img.height).data;
    let binary = '';
    for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
    return { width: img.width, height: img.height, base64: btoa(binary) };
  }, `data:image/png;base64,${readFileSync(path).toString('base64')}`);
  image.data = Buffer.from(image.base64, 'base64');
  return image;
}

export async function importCreatureWalk(record, path, options = {}, existingPage) {
  const browser = existingPage ? null : await chromium.launch({ headless: true });
  try {
    const image = await decodePng(existingPage || await browser.newPage(), path);
    const source = Array.from({ length: 4 }, (_, i) => cutFrame(image, i % 2, Math.floor(i / 2), 2, 2));
    const idle = record.clips.idle.frames[0], points = [];
    idle.forEach((row, y) => [...row].forEach((p, x) => { if (p !== '.') points.push([x, y]); }));
    const top = Math.min(...points.map(p => p[1])), bottom = Math.max(...points.map(p => p[1]));
    const center = (Math.min(...points.map(p => p[0])) + Math.max(...points.map(p => p[0]))) / 2;
    const heights = source.map(f => f.maxY - f.minY + 1).sort((a, b) => a - b);
    const scale = options.walkScale ?? ((heights[1] + heights[2]) / 2 / (bottom - top + 1));
    const colors = Object.values(record.palette).slice(1).map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
    const symbols = Object.keys(record.palette).slice(1), cache = new Map();
    const nearest = rgb => {
      const key = rgb.join(','); if (cache.has(key)) return cache.get(key);
      let best = Infinity, symbol = '.';
      colors.forEach((color, i) => { const distance = color.reduce((n, value, c) => n + (value - rgb[c]) ** 2, 0); if (distance < best) { best = distance; symbol = symbols[i]; } });
      cache.set(key, symbol); return symbol;
    };
    record.clips.move = { ticks: options.moveTicks ?? 7, frames: source.map((frame, index) => {
      const anchor = options.walkAnchors?.[index];
      const sourceCenter = anchor?.x ?? (frame.minX + frame.maxX) / 2;
      const floor = anchor?.y ?? frame.maxY;
      return Array.from({ length: record.height }, (_, y) => Array.from({ length: record.width }, (_, x) => {
        const sx = Math.round(sourceCenter + (x - center) * scale), sy = Math.round(floor + (y - bottom) * scale);
        if (sx < 0 || sy < 0 || sx >= frame.width || sy >= frame.height || frame.background[sy * frame.width + sx]) return '.';
        return nearest(frame.pixels[sy * frame.width + sx]);
      }).join(''));
    }) };
  } finally { await browser?.close(); }
  return record;
}

export async function importCreatureArt(keys) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const chosen = keys ?? Object.keys(manifest.creatures).filter(key => existsSync(new URL(manifest.creatures[key].sheet, directory)));
  const result = {}, browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const key of chosen) {
      const metadata = manifest.creatures[key];
      if (!metadata) throw new Error(`No compact sheet registered for ${key}`);
      const image = await decodePng(page, new URL(metadata.sheet, directory));
      result[key] = convert(image, metadata);
      if (metadata.walkSheet) {
        const walk = new URL(metadata.walkSheet, directory);
        if (!existsSync(walk)) throw new Error(`Missing dedicated walk sheet for ${key}`);
        await importCreatureWalk(result[key], walk, metadata, page);
      }
      metadata.status = 'imported';
      console.log(`Imported ${key}: 12 poses, ${metadata.width}×${metadata.height}`);
    }
  } finally { await browser.close(); }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const imported = await importCreatureArt(process.argv.length > 2 ? process.argv.slice(2) : undefined);
  await (await import('./import-creature-swim.mjs')).importRegisteredSwim(imported);
  Object.assign(art, imported);
  writeFileSync(new URL('../src/sand/content/creatureArt.js', import.meta.url), '// Editable native-resolution creature clips.\nexport default ' + JSON.stringify(art, null, 2) + ';\n');
}
