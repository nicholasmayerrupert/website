const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);

function decodeLayer(bytes, offset, cells) {
  const grid = new Uint8Array(cells);
  let cursor = 0;
  while (cursor < cells) {
    if (offset + 5 > bytes.length) throw new Error('Truncated replay visual keyframe.');
    const run = bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24);
    const length = run >>> 0;
    const value = bytes[offset + 4];
    offset += 5;
    if (!length || length > cells - cursor)
      throw new Error('Invalid replay visual keyframe run.');
    grid.fill(value, cursor, cursor + length);
    cursor += length;
  }
  return { grid, offset };
}

function encodeLayer(grid, output) {
  let start = 0;
  while (start < grid.length) {
    const value = grid[start];
    let end = start + 1;
    while (end < grid.length && grid[end] === value) end++;
    const run = end - start;
    output.push(
      run & 0xff,
      (run >>> 8) & 0xff,
      (run >>> 16) & 0xff,
      (run >>> 24) & 0xff,
      value,
    );
    start = end;
  }
}

function applyDiffLayer(bytes, offset, grid, cols, rows) {
  if (offset + 2 > bytes.length) throw new Error('Truncated replay visual delta.');
  const rectCount = readU16(bytes, offset);
  offset += 2;
  for (let rect = 0; rect < rectCount; rect++) {
    if (offset + 8 > bytes.length) throw new Error('Truncated replay visual rectangle.');
    const x0 = readU16(bytes, offset);
    const y0 = readU16(bytes, offset + 2);
    const x1 = readU16(bytes, offset + 4);
    const y1 = readU16(bytes, offset + 6);
    offset += 8;
    if (x0 > x1 || y0 > y1 || x1 > cols || y1 > rows)
      throw new Error('Invalid replay visual rectangle.');
    const width = x1 - x0;
    for (let y = y0; y < y1; y++) {
      if (offset + width > bytes.length)
        throw new Error('Truncated replay visual rectangle cells.');
      grid.set(bytes.subarray(offset, offset + width), y * cols + x0);
      offset += width;
    }
  }
  return offset;
}

function shiftLayer(grid, cols, rows, dx, dy) {
  if (!dx && !dy) return grid;
  if (Math.abs(dx) >= cols || Math.abs(dy) >= rows)
    throw new Error('Replay visual shift is outside the loaded world.');
  const shifted = new Uint8Array(grid.length);
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(cols, cols - dx);
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(rows, rows - dy);
  const width = x1 - x0;
  for (let y = y0; y < y1; y++) {
    const source = (y + dy) * cols + x0 + dx;
    shifted.set(grid.subarray(source, source + width), y * cols + x0);
  }
  return shifted;
}

export function reconstructReplayWorld(frames, targetIndex) {
  if (!Array.isArray(frames) || targetIndex < 0 || targetIndex >= frames.length)
    throw new RangeError('Replay visual target is outside the buffered range.');
  let keyframeIndex = targetIndex;
  while (keyframeIndex > 0 && frames[keyframeIndex]?.world?.type !== 'full')
    keyframeIndex--;
  const keyframe = frames[keyframeIndex]?.world;
  if (!keyframe || keyframe.type !== 'full')
    throw new Error('Replay visual buffer has no keyframe for this turn.');
  const cols = keyframe.cols | 0;
  const rows = keyframe.rows | 0;
  const cells = cols * rows;
  if (cols < 1 || rows < 1 || !Number.isSafeInteger(cells))
    throw new Error('Replay visual keyframe dimensions are invalid.');
  const source = new Uint8Array(keyframe.data);
  let foreground = decodeLayer(source, 0, cells);
  let background = decodeLayer(source, foreground.offset, cells);
  if (background.offset !== source.length)
    throw new Error('Replay visual keyframe has trailing bytes.');

  for (let index = keyframeIndex + 1; index <= targetIndex; index++) {
    const packet = frames[index]?.world;
    if (!packet) continue;
    if (packet.type === 'full')
      return reconstructReplayWorld(frames.slice(index), targetIndex - index);
    if (packet.type !== 'diff' && packet.type !== 'shift')
      throw new Error('Replay visual buffer contains an unsupported world packet.');
    if (packet.type === 'shift') {
      if (packet.cols !== cols || packet.rows !== rows)
        throw new Error('Replay visual shift changed the loaded dimensions.');
      foreground.grid = shiftLayer(
        foreground.grid, cols, rows, packet.shiftDx | 0, packet.shiftDy | 0,
      );
      background.grid = shiftLayer(
        background.grid, cols, rows, packet.shiftDx | 0, packet.shiftDy | 0,
      );
    }
    const bytes = new Uint8Array(packet.data);
    let offset = applyDiffLayer(bytes, 0, foreground.grid, cols, rows);
    offset = applyDiffLayer(bytes, offset, background.grid, cols, rows);
    if (offset !== bytes.length) throw new Error('Replay visual delta has trailing bytes.');
  }

  const encoded = [];
  encodeLayer(foreground.grid, encoded);
  encodeLayer(background.grid, encoded);
  const target = frames[targetIndex];
  return {
    ...keyframe,
    ...target.world,
    type: 'full',
    reason: 'replay-buffer-seek',
    cols,
    rows,
    worldOffsetX: target.world.worldOffsetX ?? keyframe.worldOffsetX,
    worldOffsetY: target.world.worldOffsetY ?? keyframe.worldOffsetY,
    worldTick: target.world.worldTick ?? keyframe.worldTick,
    replayView: target.view || null,
    data: Uint8Array.from(encoded).buffer,
  };
}

export function replayFrameBytes(frame) {
  const bytes = (value) => value instanceof ArrayBuffer ? value.byteLength : 0;
  return bytes(frame?.world?.data)
    + bytes(frame?.actors?.itemData)
    + bytes(frame?.actors?.projectileData)
    + bytes(frame?.creatures?.data)
    + bytes(frame?.draft?.data)
    + bytes(frame?.sounds?.data);
}
