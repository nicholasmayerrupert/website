import assert from 'node:assert/strict';
import {
  reconstructReplayWorld,
  replayFrameBytes,
} from '../src/sand/worker/replayVisualBuffer.js';

const pushU16 = (out, value) => out.push(value & 0xff, (value >>> 8) & 0xff);
const encodeLayer = (grid, out) => {
  let start = 0;
  while (start < grid.length) {
    let end = start + 1;
    while (end < grid.length && grid[end] === grid[start]) end++;
    const run = end - start;
    out.push(run & 0xff, (run >>> 8) & 0xff, (run >>> 16) & 0xff,
      (run >>> 24) & 0xff, grid[start]);
    start = end;
  }
};
const full = (foreground, background) => {
  const out = [];
  encodeLayer(foreground, out);
  encodeLayer(background, out);
  return Uint8Array.from(out).buffer;
};
const diff = (foregroundRects, backgroundRects) => {
  const out = [];
  for (const rects of [foregroundRects, backgroundRects]) {
    pushU16(out, rects.length);
    for (const { x0, y0, x1, y1, cells } of rects) {
      pushU16(out, x0); pushU16(out, y0); pushU16(out, x1); pushU16(out, y1);
      out.push(...cells);
    }
  }
  return Uint8Array.from(out).buffer;
};
const decode = (buffer, cells) => {
  const bytes = new Uint8Array(buffer);
  const grids = [];
  let offset = 0;
  for (let layer = 0; layer < 2; layer++) {
    const grid = [];
    while (grid.length < cells) {
      const run = (bytes[offset] | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
      const value = bytes[offset + 4];
      offset += 5;
      for (let i = 0; i < run; i++) grid.push(value);
    }
    grids.push(grid);
  }
  assert.equal(offset, bytes.length);
  return grids;
};

const frames = [
  {
    view: { cameraWorldX: 2, cameraWorldY: 1 },
    world: {
      type: 'full', cols: 4, rows: 2, worldOffsetX: 0, worldOffsetY: 0,
      worldTick: 0,
      data: full([1, 1, 0, 0, 2, 2, 2, 0], [3, 3, 3, 3, 0, 0, 0, 0]),
    },
  },
  {
    view: { cameraWorldX: 3, cameraWorldY: 1 },
    world: {
      type: 'diff', worldOffsetX: 0, worldOffsetY: 0, worldTick: 1,
      data: diff(
        [{ x0: 2, y0: 0, x1: 4, y1: 1, cells: [4, 4] }],
        [{ x0: 1, y0: 1, x1: 3, y1: 2, cells: [5, 6] }],
      ),
    },
  },
  {
    view: { cameraWorldX: 4, cameraWorldY: 1 },
    world: {
      type: 'diff', worldOffsetX: 0, worldOffsetY: 0, worldTick: 2,
      data: diff([{ x0: 0, y0: 1, x1: 1, y1: 2, cells: [7] }], []),
    },
  },
];

const reconstructed = reconstructReplayWorld(frames, 2);
assert.equal(reconstructed.type, 'full');
assert.equal(reconstructed.reason, 'replay-buffer-seek');
assert.equal(reconstructed.worldTick, 2);
assert.deepEqual(reconstructed.replayView, frames[2].view);
assert.deepEqual(decode(reconstructed.data, 8), [
  [1, 1, 4, 4, 7, 2, 2, 0],
  [3, 3, 3, 3, 0, 5, 6, 0],
]);
assert.equal(replayFrameBytes({
  world: { data: new ArrayBuffer(4) },
  actors: { itemData: new ArrayBuffer(8), projectileData: new ArrayBuffer(12) },
  creatures: { data: new ArrayBuffer(16) },
}), 40);
assert.throws(() => reconstructReplayWorld([], 0), /outside the buffered range/);

console.log('replay visual buffer checks passed');
