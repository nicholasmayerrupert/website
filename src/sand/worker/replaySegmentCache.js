const SEGMENT_MAGIC = 0x53475231; // SGR1
const BUFFER_KEYS = Object.freeze([
  ['world', 'data'],
  ['actors', 'itemData'],
  ['actors', 'projectileData'],
  ['creatures', 'data'],
  ['draft', 'data'],
  ['sounds', 'data'],
]);

const bufferView = (value) => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
};

function withoutBuffers(frame) {
  const clone = { ...frame };
  for (const [packetKey, bufferKey] of BUFFER_KEYS) {
    const packet = clone[packetKey];
    if (!packet || !Object.prototype.hasOwnProperty.call(packet, bufferKey)) continue;
    if (packet === frame[packetKey]) clone[packetKey] = { ...packet };
    delete clone[packetKey][bufferKey];
  }
  return clone;
}

function restoreBuffers(record, values) {
  const frame = { ...record };
  for (let index = 0; index < BUFFER_KEYS.length; index++) {
    const [packetKey, bufferKey] = BUFFER_KEYS[index];
    const packet = record[packetKey];
    if (!packet) continue;
    if (frame[packetKey] === packet) frame[packetKey] = { ...packet };
    frame[packetKey][bufferKey] = values[index];
  }
  return frame;
}

async function transformBytes(bytes, kind) {
  const Stream = kind === 'gzip' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof Stream !== 'function') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeReplaySegment(frames) {
  if (!Array.isArray(frames) || !frames.length)
    throw new Error('Cannot encode an empty replay segment.');
  if (frames[0]?.world?.type !== 'full')
    throw new Error('A replay segment must begin with a full visual keyframe.');

  const records = frames.map(withoutBuffers);
  const metadata = new TextEncoder().encode(JSON.stringify(records));
  const lengths = new Uint32Array(frames.length * BUFFER_KEYS.length);
  const values = [];
  let payloadBytes = 0;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex];
    for (let keyIndex = 0; keyIndex < BUFFER_KEYS.length; keyIndex++) {
      const [packetKey, bufferKey] = BUFFER_KEYS[keyIndex];
      const bytes = bufferView(frame?.[packetKey]?.[bufferKey]);
      const length = bytes?.byteLength || 0;
      lengths[frameIndex * BUFFER_KEYS.length + keyIndex] = length;
      if (length) values.push(bytes);
      payloadBytes += length;
    }
  }

  const headerBytes = 12 + lengths.byteLength;
  const raw = new Uint8Array(headerBytes + metadata.byteLength + payloadBytes);
  const header = new DataView(raw.buffer);
  header.setUint32(0, SEGMENT_MAGIC, true);
  header.setUint32(4, frames.length, true);
  header.setUint32(8, metadata.byteLength, true);
  raw.set(new Uint8Array(lengths.buffer), 12);
  raw.set(metadata, headerBytes);
  let offset = headerBytes + metadata.byteLength;
  for (const bytes of values) {
    raw.set(bytes, offset);
    offset += bytes.byteLength;
  }

  const gzip = await transformBytes(raw, 'gzip');
  const payload = gzip && gzip.byteLength < raw.byteLength ? gzip : raw;
  const compressed = payload === gzip;
  return {
    start: frames[0].turn | 0,
    end: frames.at(-1).turn | 0,
    payload: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
    compressed,
    byteLength: payload.byteLength + 128,
    rawByteLength: raw.byteLength + 128,
    lastAccess: 0,
  };
}

export async function decodeReplaySegment(segment) {
  if (!segment?.payload)
    throw new Error('Replay segment is invalid.');
  const stored = new Uint8Array(segment.payload);
  const raw = segment.compressed ? await transformBytes(stored, 'gunzip') : stored;
  if (!raw) throw new Error('This browser cannot decompress replay segments.');
  if (raw.byteLength < 12) throw new Error('Replay segment payload is truncated.');
  const header = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (header.getUint32(0, true) !== SEGMENT_MAGIC)
    throw new Error('Replay segment has an invalid header.');
  const frameCount = header.getUint32(4, true);
  const metadataBytes = header.getUint32(8, true);
  const lengthCount = frameCount * BUFFER_KEYS.length;
  const headerBytes = 12 + lengthCount * Uint32Array.BYTES_PER_ELEMENT;
  const metadataEnd = headerBytes + metadataBytes;
  if (!Number.isSafeInteger(lengthCount) || metadataEnd > raw.byteLength)
    throw new Error('Replay segment length table is truncated.');

  const lengths = new Uint32Array(lengthCount);
  for (let index = 0; index < lengthCount; index++)
    lengths[index] = header.getUint32(12 + index * 4, true);
  let records;
  try {
    records = JSON.parse(new TextDecoder().decode(raw.subarray(headerBytes, metadataEnd)));
  } catch {
    throw new Error('Replay segment metadata is invalid.');
  }
  if (!Array.isArray(records) || records.length !== frameCount)
    throw new Error('Replay segment frame count does not match its index.');
  let offset = metadataEnd;
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const buffers = [];
    for (let keyIndex = 0; keyIndex < BUFFER_KEYS.length; keyIndex++) {
      const length = lengths[frameIndex * BUFFER_KEYS.length + keyIndex];
      if (length > raw.byteLength - offset)
        throw new Error('Replay segment buffer is truncated.');
      buffers.push(raw.slice(offset, offset + length).buffer);
      offset += length;
    }
    frames.push(restoreBuffers(records[frameIndex], buffers));
  }
  if (offset !== raw.byteLength)
    throw new Error('Replay segment has trailing bytes.');
  return frames;
}

export class ReplaySegmentCache {
  constructor({ maxBytes }) {
    this.maxBytes = Math.max(1, Number(maxBytes) || 1);
    this.bytes = 0;
    this.clock = 0;
    this.segments = new Map();
  }

  add(segment, protectedStarts = []) {
    const existing = this.segments.get(segment.start);
    if (existing && existing.end >= segment.end) {
      existing.lastAccess = ++this.clock;
      return [];
    }
    const evicted = [];
    if (existing) {
      this.bytes -= existing.byteLength;
      evicted.push(existing.start);
    }
    segment.lastAccess = ++this.clock;
    this.segments.set(segment.start, segment);
    this.bytes += segment.byteLength;
    const protectedSet = new Set(protectedStarts);
    protectedSet.add(segment.start);
    while (this.bytes > this.maxBytes && this.segments.size > protectedSet.size) {
      const candidates = [...this.segments.values()]
        .filter((candidate) => !protectedSet.has(candidate.start))
        .sort((a, b) => a.lastAccess - b.lastAccess || a.start - b.start);
      const victim = candidates[0];
      if (!victim) break;
      this.segments.delete(victim.start);
      this.bytes -= victim.byteLength;
      evicted.push(victim.start);
    }
    return evicted;
  }

  getByTurn(turn) {
    for (const segment of this.segments.values()) {
      if (turn < segment.start || turn > segment.end) continue;
      segment.lastAccess = ++this.clock;
      return segment;
    }
    return null;
  }

  hasTurn(turn) { return !!this.getByTurn(turn); }

  ranges(extraRanges = []) {
    const ranges = [
      ...[...this.segments.values()].map((segment) => [segment.start, segment.end]),
      ...extraRanges,
    ]
      .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && end >= start)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const [start, end] of ranges) {
      const previous = merged.at(-1);
      if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
      else merged.push([start, end]);
    }
    return merged;
  }
}
