import assert from 'node:assert/strict';
import {
  reconstructReplayWorld,
  replayFrameBytes,
} from '../src/sand/worker/replayVisualBuffer.js';
import {
  decodeReplaySegment,
  encodeReplaySegment,
  ReplaySegmentCache,
} from '../src/sand/worker/replaySegmentCache.js';

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

const shiftedFrames = [
  {
    turn: 0,
    view: { cameraWorldX: 1, cameraWorldY: 1 },
    world: {
      type: 'full', cols: 4, rows: 2, worldOffsetX: 0, worldOffsetY: 0,
      worldTick: 0,
      data: full([1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1]),
    },
    creatures: { type: 'creatures', data: new Uint8Array([1, 2]).buffer },
  },
  {
    turn: 1,
    view: { cameraWorldX: 2, cameraWorldY: 1 },
    world: {
      type: 'shift', cols: 4, rows: 2,
      fromWorldOffsetX: 0, fromWorldOffsetY: 0,
      shiftDx: 1, shiftDy: 0,
      worldOffsetX: 1, worldOffsetY: 0, worldTick: 1,
      data: diff(
        [{ x0: 3, y0: 0, x1: 4, y1: 2, cells: [9, 10] }],
        [{ x0: 3, y0: 0, x1: 4, y1: 2, cells: [11, 12] }],
      ),
    },
    actors: {
      type: 'actors', itemData: new Uint8Array([3]).buffer,
      projectileData: new Uint8Array([4, 5]).buffer,
    },
  },
];
const shifted = reconstructReplayWorld(shiftedFrames, 1);
assert.deepEqual(decode(shifted.data, 8), [
  [2, 3, 4, 9, 6, 7, 8, 10],
  [7, 6, 5, 11, 3, 2, 1, 12],
]);

const segment = await encodeReplaySegment(shiftedFrames);
assert.equal(segment.start, 0);
assert.equal(segment.end, 1);
assert.ok(segment.byteLength > 0);
const decodedFrames = await decodeReplaySegment(segment);
assert.deepEqual(
  decode(reconstructReplayWorld(decodedFrames, 1).data, 8),
  decode(shifted.data, 8),
);
assert.deepEqual([...new Uint8Array(decodedFrames[0].creatures.data)], [1, 2]);
assert.deepEqual([...new Uint8Array(decodedFrames[1].actors.itemData)], [3]);
assert.deepEqual([...new Uint8Array(decodedFrames[1].actors.projectileData)], [4, 5]);

const cacheSegment = (start) => ({
  start, end: start, byteLength: 10, rawByteLength: 10,
  payload: new ArrayBuffer(0), compressed: false,
});
const forwardCache = new ReplaySegmentCache({ maxBytes: 50 });
for (let turn = 0; turn < 5; turn++) forwardCache.add(cacheSegment(turn));
assert.deepEqual(forwardCache.ranges(), [[0, 4]]);
forwardCache.add(cacheSegment(5));
assert.deepEqual(forwardCache.ranges(), [[1, 5]]);

const islandCache = new ReplaySegmentCache({ maxBytes: 50 });
for (let turn = 3; turn < 8; turn++) islandCache.add(cacheSegment(turn));
islandCache.add(cacheSegment(0));
assert.deepEqual(islandCache.ranges(), [[0, 0], [4, 7]]);
islandCache.add(cacheSegment(1));
assert.deepEqual(islandCache.ranges(), [[0, 1], [5, 7]]);
const complete = { ...cacheSegment(8), end: 9 };
const partial = cacheSegment(8);
islandCache.add(complete);
islandCache.add(partial);
assert.equal(islandCache.getByTurn(9), complete);

const boundedCache = new ReplaySegmentCache({ maxBytes: 50 });
boundedCache.add({ ...cacheSegment(0), end: 119, byteLength: 30 });
boundedCache.add(
  { ...cacheSegment(120), end: 239, byteLength: 30 },
  { protectedStarts: [0], retainTurn: 0 },
);
assert.equal(boundedCache.bytes, 30);
assert.deepEqual(boundedCache.ranges(), [[0, 119]]);
boundedCache.add(
  { ...cacheSegment(120), end: 239, byteLength: 30 },
  { protectedStarts: [0], retainTurn: 120 },
);
assert.equal(boundedCache.bytes, 30);
assert.deepEqual(boundedCache.ranges(), [[120, 239]]);

const playheadCache = new ReplaySegmentCache({ maxBytes: 90 });
for (let start = 0; start < 600; start += 120) {
  playheadCache.add(
    { ...cacheSegment(start), end: start + 119, byteLength: 30 },
    { protectedStarts: [0], retainTurn: 0 },
  );
}
assert.deepEqual(playheadCache.ranges(), [[0, 359]]);
playheadCache.add(
  { ...cacheSegment(360), end: 479, byteLength: 30 },
  { protectedStarts: [240], retainTurn: 240 },
);
assert.deepEqual(playheadCache.ranges(), [[120, 479]]);
assert.equal(playheadCache.getByTurn(119), null);
assert.equal(playheadCache.getByTurn(120)?.start, 120);

const overlapCache = new ReplaySegmentCache({ maxBytes: 100 });
overlapCache.add({ ...cacheSegment(0), end: 119 });
overlapCache.add({ ...cacheSegment(60), end: 89 });
assert.equal(overlapCache.getByTurn(100)?.start, 0);

console.log('replay visual buffer checks passed');
