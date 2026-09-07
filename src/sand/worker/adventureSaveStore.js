import { GAME_WORLD } from '../content/catalog.js';
import { EQUIPMENT } from '../content/equipment.js';
import { contentHash } from '../content/compile.js';

// Gameplay compatibility deliberately excludes sprite pixels, text, and UI styling.
const identity = contentHash({ version: 2, seed: GAME_WORLD.seed,
  quests: GAME_WORLD.quests.map(q => [q.key, q.target, q.giver, q.condition, q.after, q.reward && [q.reward.kind, q.reward.gear ?? q.reward.material ?? q.reward.item, q.reward.count]]),
  sites: GAME_WORLD.sites.map(s => [s.id, s.origin, s.anchors, s.operations]),
  residents: GAME_WORLD.residents.map(n => [n.id, n.species, n.anchor]),
  equipment: EQUIPMENT.map(g => [g.id, g.family, g.slot, g.power, g.defense]),
});
const key = `hollow-bell:2:${identity.toString(16)}`;
const database = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('aster-adventures', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('checkpoints');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function compress(bytes) {
  if (typeof CompressionStream === 'undefined') return { bytes, compressed: false };
  const data = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return { bytes: new Uint8Array(data), compressed: true };
}
async function decode(record) {
  if (!record) return null;
  let bytes;
  if (record.compressed) {
    const reader = new Blob([record.bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 192 * 1024 * 1024) { await reader.cancel(); throw new Error('Checkpoint is too large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  } else bytes = new Uint8Array(record.bytes);
  if (bytes.length < 24 || bytes.length > 192 * 1024 * 1024) throw new Error('Invalid checkpoint size');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x52455453 || header.getUint32(4, true) !== 2) throw new Error('Unsupported checkpoint');
  let hash = 2166136261;
  for (let i = 0; i < bytes.length - 4; i++) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0;
  if (hash !== header.getUint32(bytes.length - 4, true)) throw new Error('Checkpoint checksum mismatch');
  return { bytes, cols: header.getUint32(8, true), rows: header.getUint32(12, true), savedAt: record.savedAt };
}
export async function loadAdventure() {
  const db = await database();
  try {
    const get = recordKey => new Promise((resolve, reject) => {
      const request = db.transaction('checkpoints').objectStore('checkpoints').get(recordKey);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await decode(await get(key)); }
    catch (error) {
      const record = await get(`${key}:previous`);
      const previous = await decode(record);
      if (!previous) throw error;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('checkpoints', 'readwrite');
        transaction.objectStore('checkpoints').put(record, key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Save recovery cancelled'));
      });
      return previous;
    }
  } finally { db.close(); }
}
export async function saveAdventure(bytes, savedAt = Date.now()) {
  const payload = await compress(bytes);
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('checkpoints', 'readwrite'), store = transaction.objectStore('checkpoints');
      const previous = store.get(key);
      previous.onsuccess = () => {
        if (previous.result) store.put(previous.result, `${key}:previous`);
        store.put({ ...payload, savedAt }, key);
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Save cancelled'));
    });
    return savedAt;
  } finally { db.close(); }
}

// Replay origins carry the same authoritative checkpoint as a resumed adventure.
export async function encodeAdventureOrigin(bytes) {
  const payload = await compress(bytes);
  let binary = '';
  for (let at = 0; at < payload.bytes.length; at += 0x8000)
    binary += String.fromCharCode(...payload.bytes.subarray(at, at + 0x8000));
  return { data: btoa(binary), compressed: payload.compressed };
}
export async function decodeAdventureOrigin(origin) {
  if (!origin || typeof origin.data !== 'string' || origin.data.length > 48 * 1024 * 1024)
    throw new Error('Invalid replay checkpoint');
  const binary = atob(origin.data), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return decode({ bytes, compressed: !!origin.compressed, savedAt: 0 });
}
