// Convert the approved animation sheet into the engine's palette-indexed clips.
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { importCreatureWalk } from './import-creature-art.mjs';

const sheet = new URL('../src/sand/art/frost-giant/animation-sheet.png', import.meta.url);
const walkSheet = new URL('../src/sand/art/frost-giant/walk-sheet.png', import.meta.url);
const width = 80, height = 88;
const palette = Object.fromEntries(['#000000', '#101d27', '#253e4a', '#355361', '#456878',
  '#52798a', '#618b9b', '#729ba8', '#85abb6', '#99b9c0', '#aecbd0', '#c6dcda',
  '#7f8377', '#a2a795', '#c4c5ad', '#dddac2', '#f1e8d4', '#443a2b', '#6a573a',
  '#977b4f', '#287897', '#3da9d0', '#72cfe8', '#b1e9f4', '#e4fbfb']
  .map((color, i) => [i ? 'abcdefghijklmnopqrstuvwx'[i - 1] : '.', color]));
const colors = Object.values(palette).slice(1).map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
const symbols = Object.keys(palette).slice(1);
const yEdges = [0, 166, 321, 484, 662, 835, 998, 1172];
const xEdges = [
  [90, 240, 398, 557, 716, 875, 1033, 1191, 1342],
  [90, 240, 398, 553, 715, 875, 1031, 1190, 1342],
  [90, 240, 392, 543, 696, 850, 1020, 1186, 1342],
  [90, 240, 391, 539, 708, 866, 1028, 1189, 1342],
  [90, 240, 394, 526, 705, 875, 1032, 1190, 1342],
  [90, 240, 397, 558, 718, 881, 1034, 1189, 1342],
  [90, 240, 398, 546, 708, 868, 1034, 1190, 1342],
];
// Pelvis anchors keep changing foot spans from moving the torso sideways.
const pelvisX = [
  [168, 326, 485, 644, 801, 960, 1119, 1276],
  [167, 324, 482, 646, 801, 956, 1116, 1273],
];

function convertFrame(data, imageWidth, row, column, crop) {
  const left = crop?.left ?? xEdges[row][column], top = crop?.top ?? yEdges[row];
  const w = crop?.width ?? xEdges[row][column + 1] - left, h = crop?.height ?? yEdges[row + 1] - top;
  const background = new Uint8Array(w * h), queue = [];
  const colorAt = (x, y) => {
    const at = ((top + y) * imageWidth + left + x) * 4;
    return data.slice(at, at + 3);
  };
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h || background[y * w + x]) return;
    const [r, g, b] = colorAt(x, y);
    if ((r - 30) ** 2 + (g - 47) ** 2 + (b - 55) ** 2 > 180) return;
    background[y * w + x] = 1;
    queue.push([x, y]);
  };
  for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1); }
  for (let y = 0; y < h; y++) { enqueue(0, y); enqueue(w - 1, y); }
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    enqueue(x - 1, y); enqueue(x + 1, y); enqueue(x, y - 1); enqueue(x, y + 1);
  }
  // The engine grows the held spear and owns its release and flight.
  if (row === 4 && (column === 2 || column === 3)) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = left + x, sy = top + y;
      if (column === 2 ? sx >= 485 && sy >= 738 && sy <= 765 : (sx < 586 && sy < 704) || (sx >= 688 && sy < 746))
        background[y * w + x] = 1;
    }
  }
  // Discard isolated edge noise without dropping the death clip's ice plates.
  const visited = new Uint8Array(w * h);
  for (let start = 0; start < visited.length; start++) {
    if (background[start] || visited[start]) continue;
    const component = [start]; visited[start] = 1;
    for (let i = 0; i < component.length; i++) {
      const at = component[i], x = at % w, y = Math.floor(at / w);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const next = ny * w + nx;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || background[next] || visited[next]) continue;
        visited[next] = 1; component.push(next);
      }
    }
    if (component.length < (row === 6 ? 8 : 32)) for (const at of component) background[at] = 1;
  }
  // Use the feet to register each frame, retaining the body's vertical motion.
  let bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (!background[y * w + x] && colorAt(x, y).reduce((a, b) => a + b, 0) > 230) bottom = y;
  if (bottom < 0) throw new Error(`Empty frost frame ${row},${column}`);
  let minFoot = w, maxFoot = -1;
  for (let y = Math.max(0, bottom - 6); y <= bottom; y++) for (let x = 0; x < w; x++)
    if (!background[y * w + x] && colorAt(x, y).reduce((a, b) => a + b, 0) > 230) {
      minFoot = Math.min(minFoot, x); maxFoot = Math.max(maxFoot, x);
    }
  const center = crop?.center ?? (pelvisX[row] ? pelvisX[row][column] - left : (minFoot + maxFoot) / 2);
  const nearest = (rgb) => {
    let best = Infinity, index = 0;
    colors.forEach((color, i) => {
      const distance = color.reduce((sum, value, c) => sum + (value - rgb[c]) ** 2, 0);
      if (distance < best) { best = distance; index = i; }
    });
    return symbols[index];
  };
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const scale = crop?.scale ?? 2;
    const sx = Math.round(center + (x - (width - 1) / 2) * scale);
    const sy = Math.round(bottom - (height - 1 - y) * scale);
    return sx < 0 || sx >= w || sy < 0 || sy >= h || background[sy * w + sx]
      ? '.' : nearest(colorAt(sx, sy));
  }).join(''));
}

export async function importFrostGiantArt() {
  const browser = await chromium.launch({ headless: true });
  let image, walk;
  try {
    const page = await browser.newPage();
    const decode = async path => page.evaluate(async source => {
      const img = new Image(); img.src = source; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      let binary = '';
      for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
      return { width: img.width, height: img.height, base64: btoa(binary) };
    }, `data:image/png;base64,${readFileSync(path).toString('base64')}`);
    [image, walk] = await Promise.all([decode(sheet), decode(walkSheet)]);
    for (const decoded of [image, walk]) decoded.data = Buffer.from(decoded.base64, 'base64');
  } finally { await browser.close(); }
  if (image.width !== 1342 || image.height !== 1172) throw new Error('Frost sheet must match the authored 1342×1172 crop map');
  const frames = Array.from({ length: 7 }, (_, row) => Array.from({ length: 8 }, (_, column) => convertFrame(image.data, image.width, row, column)));
  if (walk.width !== 1536 || walk.height !== 1024) throw new Error('Walk sheet must match the 1536×1024 crop map');
  const centers = [221, 605, 988, 1372, 220, 604, 989, 1373];
  frames[1] = centers.map((center, i) => convertFrame(walk.data, walk.width, 1, i, {
    left: i % 4 * 384, top: Math.floor(i / 4) * 512, width: 384, height: 512,
    center: center - i % 4 * 384, scale: 5.6,
  }));
  const clip = (row, indices, ticks) => ({ ticks, frames: indices.map(i => frames[row][i]) });
  const attacks = (sequences, ticks) => ({ ticks, frames: sequences.flatMap((indices, pattern) => indices.map(i => frames[pattern + 2][i])) });
  const record = { width, height, pixelScale: .28, palette, clips: {
    idle: clip(0, [0], 12),
    move: clip(1, [0, 1, 2, 3, 4, 5, 6, 7], 7),
    windup: attacks([[0, 1, 2], [0, 1, 2], [0, 1, 3]], 9),
    attack: attacks([[3, 4, 5], [3, 4, 5], [4, 5, 5]], 4),
    recover: attacks([[6, 7, 7], [5, 1, 7], [5, 6, 7]], 5),
    hurt: clip(5, [0, 1, 2, 3, 4, 5, 6, 7], 3),
    death: clip(6, [0, 1, 2, 3, 4, 5, 6, 7], 4),
    special: clip(2, [3, 4, 5, 4], 8),
  } };
  const compactWalk = new URL('../src/sand/art/creatures/walk/frost_giant.png', import.meta.url);
  if (existsSync(compactWalk)) await importCreatureWalk(record, compactWalk, { moveTicks: 12 });
  return record;
}
