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

const REPLAY_SEGMENT_DATABASE = 'sand-replay-visual-cache-v1';
const REPLAY_SEGMENT_STORE = 'segments';
const REPLAY_SEGMENT_DATABASE_VERSION = 1;
const REPLAY_SEGMENT_STALE_MS = 24 * 60 * 60 * 1000;
let replaySegmentDatabasePromise = null;

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(
    transaction.error || new Error('Replay cache transaction failed.'),
  );
  transaction.onabort = () => reject(
    transaction.error || new Error('Replay cache transaction was aborted.'),
  );
});

function openReplaySegmentDatabase() {
  if (replaySegmentDatabasePromise) return replaySegmentDatabasePromise;
  const indexedDb = globalThis.indexedDB;
  if (!indexedDb) return Promise.resolve(null);
  const opening = new Promise((resolve, reject) => {
    const request = indexedDb.open(
      REPLAY_SEGMENT_DATABASE, REPLAY_SEGMENT_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(REPLAY_SEGMENT_STORE, {
        keyPath: ['sessionId', 'start'],
      });
      store.createIndex('sessionId', 'sessionId', { unique: false });
      store.createIndex('createdAt', 'createdAt', { unique: false });
    };
    request.onerror = () => reject(
      request.error || new Error('Replay cache database could not be opened.'),
    );
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
  replaySegmentDatabasePromise = opening.catch((error) => {
    replaySegmentDatabasePromise = null;
    throw error;
  });
  return replaySegmentDatabasePromise;
}

async function deleteReplaySegmentRecords(database, indexName, range) {
  const transaction = database.transaction(REPLAY_SEGMENT_STORE, 'readwrite');
  const request = transaction.objectStore(REPLAY_SEGMENT_STORE)
    .index(indexName).openCursor(range);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await transactionDone(transaction);
}

class IndexedDbReplaySegmentStore {
  constructor(database, sessionId, createdAt) {
    this.database = database;
    this.sessionId = sessionId;
    this.createdAt = createdAt;
  }

  async put(segment) {
    const transaction = this.database.transaction(REPLAY_SEGMENT_STORE, 'readwrite');
    transaction.objectStore(REPLAY_SEGMENT_STORE).put({
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      start: segment.start,
      end: segment.end,
      compressed: !!segment.compressed,
      byteLength: segment.byteLength,
      rawByteLength: segment.rawByteLength,
      payload: segment.payload,
    });
    await transactionDone(transaction);
  }

  get(start) {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(REPLAY_SEGMENT_STORE, 'readonly');
      const request = transaction.objectStore(REPLAY_SEGMENT_STORE)
        .get([this.sessionId, start]);
      request.onerror = () => reject(
        request.error || new Error('Replay cache segment could not be read.'),
      );
      request.onsuccess = () => {
        const record = request.result;
        resolve(record ? {
          start: record.start,
          end: record.end,
          compressed: !!record.compressed,
          byteLength: record.byteLength,
          rawByteLength: record.rawByteLength,
          payload: record.payload,
        } : null);
      };
    });
  }

  clear() {
    const keyRange = globalThis.IDBKeyRange;
    if (!keyRange) return Promise.resolve();
    return deleteReplaySegmentRecords(
      this.database, 'sessionId', keyRange.only(this.sessionId),
    );
  }
}

function replaySegmentSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function')
    return globalThis.crypto.randomUUID();
  const words = new Uint32Array(4);
  globalThis.crypto.getRandomValues(words);
  return [...words].map((word) => word.toString(16).padStart(8, '0')).join('');
}

export async function createReplaySegmentBackingStore() {
  try {
    const database = await openReplaySegmentDatabase();
    const keyRange = globalThis.IDBKeyRange;
    if (!database || !keyRange) return null;
    const createdAt = Date.now();
    await deleteReplaySegmentRecords(
      database, 'createdAt',
      keyRange.upperBound(createdAt - REPLAY_SEGMENT_STALE_MS, true),
    );
    return new IndexedDbReplaySegmentStore(
      database, replaySegmentSessionId(), createdAt,
    );
  } catch {
    return null;
  }
}

export class ReplaySegmentCache {
  constructor({ maxBytes, backingStore = null }) {
    this.maxBytes = Math.max(1, Number(maxBytes) || 1);
    this.backingStore = backingStore;
    this.spillWritable = !!backingStore;
    this.limitReached = false;
    this.bytes = 0;
    this.storedBytes = 0;
    this.clock = 0;
    this.segments = new Map();
    this.starts = [];
    this.maxEnds = [];
    this.loads = new Map();
  }

  #startIndex(start) {
    let low = 0;
    let high = this.starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.starts[middle] < start) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  #delete(start) {
    const segment = this.segments.get(start);
    if (!segment) return null;
    this.segments.delete(start);
    if (segment.payload) this.bytes -= segment.byteLength;
    this.storedBytes -= segment.byteLength;
    const index = this.#startIndex(start);
    if (this.starts[index] === start) {
      this.starts.splice(index, 1);
      this.#refreshMaxEnds(index);
    }
    return segment;
  }

  #demote(start) {
    const segment = this.segments.get(start);
    if (!segment?.payload) return false;
    segment.payload = null;
    this.bytes -= segment.byteLength;
    return true;
  }

  #refreshMaxEnds(from) {
    let maximum = from > 0 ? this.maxEnds[from - 1] : -Infinity;
    for (let index = from; index < this.starts.length; index++) {
      maximum = Math.max(maximum, this.segments.get(this.starts[index]).end);
      this.maxEnds[index] = maximum;
    }
    this.maxEnds.length = this.starts.length;
  }

  async add(segment) {
    const existing = this.segments.get(segment.start);
    if (existing && existing.end >= segment.end) {
      existing.lastAccess = ++this.clock;
      return;
    }

    let persisted = false;
    if (this.backingStore && this.spillWritable) {
      try {
        await this.backingStore.put(segment);
        persisted = true;
      } catch {
        this.spillWritable = false;
      }
    }

    if (existing) this.#delete(existing.start);
    segment.lastAccess = ++this.clock;
    segment.persisted = persisted;
    this.segments.set(segment.start, segment);
    const startIndex = this.#startIndex(segment.start);
    this.starts.splice(startIndex, 0, segment.start);
    this.#refreshMaxEnds(startIndex);
    this.bytes += segment.byteLength;
    this.storedBytes += segment.byteLength;

    const candidates = [...this.segments.values()]
      .filter((candidate) => candidate.payload)
      .sort((a, b) => a.lastAccess - b.lastAccess || a.start - b.start);
    for (const victim of candidates) {
      if (this.bytes <= this.maxBytes) break;
      if (victim.persisted) this.#demote(victim.start);
      else {
        this.#delete(victim.start);
        this.limitReached = true;
      }
    }
  }

  getByTurn(turn) {
    let index = this.#startIndex(turn + 1) - 1;
    while (index >= 0 && this.maxEnds[index] >= turn) {
      const segment = this.segments.get(this.starts[index--]);
      if (turn > segment.end) continue;
      segment.lastAccess = ++this.clock;
      return segment;
    }
    return null;
  }

  async loadByTurn(turn) {
    const indexed = this.getByTurn(turn);
    if (!indexed || indexed.payload) return indexed;
    if (!indexed.persisted || !this.backingStore) return null;
    let pending = this.loads.get(indexed.start);
    if (!pending) {
      pending = this.backingStore.get(indexed.start).finally(() => {
        this.loads.delete(indexed.start);
      });
      this.loads.set(indexed.start, pending);
    }
    let loaded;
    try {
      loaded = await pending;
    } catch {
      this.#delete(indexed.start);
      this.limitReached = true;
      return null;
    }
    const current = this.segments.get(indexed.start);
    if (!current || current !== indexed) return null;
    if (!loaded || loaded.start !== current.start || loaded.end !== current.end
        || loaded.byteLength !== current.byteLength
        || !(loaded.payload instanceof ArrayBuffer)) {
      this.#delete(current.start);
      this.limitReached = true;
      return null;
    }
    current.lastAccess = ++this.clock;
    return { ...loaded, lastAccess: current.lastAccess, persisted: true };
  }


  ranges(extraRanges = []) {
    const cached = this.starts.map((start) => {
      const segment = this.segments.get(start);
      return [segment.start, segment.end];
    });
    const extra = extraRanges
      .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && end >= start)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const ranges = [];
    let cachedIndex = 0;
    let extraIndex = 0;
    while (cachedIndex < cached.length || extraIndex < extra.length) {
      if (extraIndex >= extra.length
          || (cachedIndex < cached.length
            && cached[cachedIndex][0] <= extra[extraIndex][0]))
        ranges.push(cached[cachedIndex++]);
      else ranges.push(extra[extraIndex++]);
    }
    const merged = [];
    for (const [start, end] of ranges) {
      const previous = merged.at(-1);
      if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
      else merged.push([start, end]);
    }
    return merged;
  }

  async clear() {
    this.bytes = 0;
    this.storedBytes = 0;
    this.segments.clear();
    this.starts.length = 0;
    this.maxEnds.length = 0;
    this.loads.clear();
    try {
      await this.backingStore?.clear();
    } catch {
      // Stale session records are pruned when a later replay cache opens.
    }
  }
}
