const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);

function decodeLayer(bytes, offset, cells, textures = false) {
  const grid = textures ? new Uint16Array(cells) : new Uint8Array(cells);
  let cursor = 0;
  while (cursor < cells) {
    if (offset + (textures ? 6 : 5) > bytes.length) throw new Error('Truncated replay visual keyframe.');
    const run = bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24);
    const length = run >>> 0;
    const value = textures ? readU16(bytes, offset + 4) : bytes[offset + 4];
    offset += textures ? 6 : 5;
    if (!length || length > cells - cursor)
      throw new Error('Invalid replay visual keyframe run.');
    grid.fill(value, cursor, cursor + length);
    cursor += length;
  }
  return { grid, offset };
}

function encodeLayer(grid, output, textures = false) {
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
      value & 0xff,
    );
    if (textures) output.push(value >>> 8);
    start = end;
  }
}

function applyDiffLayer(bytes, offset, grid, texels, cols, rows) {
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
    const area = width * (y1 - y0);
    if (offset + area * 3 > bytes.length) throw new Error('Truncated replay visual rectangle cells.');
    let textureOffset = offset + area;
    for (let y = y0; y < y1; y++) {
      if (offset + width > bytes.length)
        throw new Error('Truncated replay visual rectangle cells.');
      grid.set(bytes.subarray(offset, offset + width), y * cols + x0);
      offset += width;
      for (let x = x0; x < x1; x++) {
        texels[y * cols + x] = readU16(bytes, textureOffset);
        textureOffset += 2;
      }
    }
    offset += area * 2;
  }
  return offset;
}

function shiftLayer(grid, cols, rows, dx, dy) {
  if (!dx && !dy) return grid;
  if (Math.abs(dx) >= cols || Math.abs(dy) >= rows)
    throw new Error('Replay visual shift is outside the loaded world.');
  const shifted = new grid.constructor(grid.length);
  if (grid instanceof Uint16Array) shifted.fill(0xffff);
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
  const foregroundTexels = decodeLayer(source, background.offset, cells, true);
  const backgroundTexels = decodeLayer(source, foregroundTexels.offset, cells, true);
  if (backgroundTexels.offset !== source.length)
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
    if (packet.type === 'shift') {
      foregroundTexels.grid = shiftLayer(foregroundTexels.grid, cols, rows, packet.shiftDx | 0, packet.shiftDy | 0);
      backgroundTexels.grid = shiftLayer(backgroundTexels.grid, cols, rows, packet.shiftDx | 0, packet.shiftDy | 0);
    }
    const bytes = new Uint8Array(packet.data);
    let offset = applyDiffLayer(bytes, 0, foreground.grid, foregroundTexels.grid, cols, rows);
    offset = applyDiffLayer(bytes, offset, background.grid, backgroundTexels.grid, cols, rows);
    if (offset !== bytes.length) throw new Error('Replay visual delta has trailing bytes.');
  }

  const encoded = [];
  encodeLayer(foreground.grid, encoded);
  encodeLayer(background.grid, encoded);
  encodeLayer(foregroundTexels.grid, encoded, true);
  encodeLayer(backgroundTexels.grid, encoded, true);
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
