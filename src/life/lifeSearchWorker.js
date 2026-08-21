import { createLifeSearchEngine } from './searchEngineWasm.js';
import {
  MAX_LIFE_SEARCH_BATCH,
  tuneLifeSearchBatch,
} from './searchLimits.js';

let engine = null;
let runToken = 0;
let settings = null;
let startedAt = 0;
let lastProgressAt = 0;
let nextBatchSize = 32;

const pumpChannel = typeof MessageChannel === 'undefined' ? null : new MessageChannel();

const hashSeed = (value) => {
  const text = String(value || 'life-search');
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
};

function postProgress(force = false) {
  const now = performance.now();
  const interval = Math.max(100, settings?.progressIntervalMs || 100);
  if (!engine || (!force && now - lastProgressAt < interval)) return;
  lastProgressAt = now;
  const snapshot = engine.soupSnapshot();
  const transfer = [...snapshot.results, ...snapshot.loops]
    .map((result) => result.cells.buffer);
  self.postMessage({
    type: 'soup-progress',
    ...snapshot,
    elapsedMs: now - startedAt,
    running: true,
  }, transfer);
}

function pump(token) {
  if (token !== runToken || !engine || !settings) return;
  const before = performance.now();
  const completed = engine.pumpSoup(nextBatchSize);
  const elapsed = performance.now() - before;
  nextBatchSize = tuneLifeSearchBatch(nextBatchSize, completed, elapsed);
  postProgress();
  if (pumpChannel) pumpChannel.port2.postMessage(token);
  else setTimeout(() => pump(token), 0);
}

if (pumpChannel) {
  pumpChannel.port1.onmessage = ({ data: token }) => pump(token);
}

async function createSoupEngine(data, token) {
  let replacement;
  try {
    replacement = await createLifeSearchEngine(data.size);
  } catch (error) {
    if (token !== runToken) return false;
    throw error;
  }
  if (token !== runToken) {
    replacement.destroy();
    return false;
  }
  engine = replacement;
  return true;
}

function beginSoup(data, token) {
  nextBatchSize = Math.max(1, Math.min(
    MAX_LIFE_SEARCH_BATCH,
    Math.round(data.batchSize) || 32,
  ));
  engine.startSoup({
    density: data.density,
    horizon: data.horizon,
    seed: hashSeed(data.seed),
    leaderboardSize: data.leaderboardSize,
  });
  startedAt = performance.now();
  const interval = Math.max(100, data.progressIntervalMs || 100);
  const phase = Math.max(0, Math.min(1, data.progressPhase || 0));
  lastProgressAt = startedAt - interval * phase;
  self.postMessage({ type: 'started', mode: 'soup' });
  if (pumpChannel) pumpChannel.port2.postMessage(token);
  else setTimeout(() => pump(token), 0);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'stop') {
      runToken++;
      postProgress(true);
      engine?.stop();
      self.postMessage({ type: 'stopped' });
      return;
    }
    if (data.type === 'resume-soup') {
      if (!settings) throw new Error('No paused Life search to resume');
      const token = ++runToken;
      if (!engine) {
        if (await createSoupEngine(settings, token)) beginSoup(settings, token);
        return;
      }
      engine.resume();
      startedAt = performance.now();
      lastProgressAt = startedAt - Math.max(100, settings.progressIntervalMs || 100);
      self.postMessage({ type: 'started', mode: 'soup' });
      if (pumpChannel) pumpChannel.port2.postMessage(token);
      else setTimeout(() => pump(token), 0);
      return;
    }
    if (data.type === 'destroy') {
      runToken++;
      engine?.destroy();
      engine = null;
      close();
      return;
    }
    if (data.type === 'start-soup') {
      const token = ++runToken;
      engine?.destroy();
      engine = null;
      settings = data;
      if (await createSoupEngine(data, token)) beginSoup(data, token);
    }
  } catch (error) {
    settings = null;
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
