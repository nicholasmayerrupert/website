import { createLifeSearchEngine } from './searchEngineWasm.js';

let engine = null;
let mode = null;
let runToken = 0;
let startedAt = 0;
let lastProgressAt = 0;
let lastBestDepth = -1;
let settings = null;

const hashSeed = (value) => {
  const text = String(value || 'life-search');
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
};

async function replaceEngine(size) {
  engine?.destroy();
  engine = await createLifeSearchEngine(size);
}

function postProgress(force = false) {
  const now = performance.now();
  if (!force && now - lastProgressAt < 100) return;
  lastProgressAt = now;
  if (mode === 'soup') {
    const snapshot = engine.soupSnapshot();
    self.postMessage({
      type: 'soup-progress',
      ...snapshot,
      elapsedMs: now - startedAt,
      running: true,
    });
  } else if (mode === 'reverse') {
    const summary = engine.reverseSnapshot(false);
    const improved = summary.bestDepth > lastBestDepth;
    if (improved) lastBestDepth = summary.bestDepth;
    const snapshot = improved ? engine.reverseSnapshot(true) : summary;
    const transfer = snapshot.layers?.map((layer) => layer.buffer) || [];
    self.postMessage({
      type: 'reverse-progress',
      ...snapshot,
      elapsedMs: now - startedAt,
      running: summary.status === 1,
    }, transfer);
  }
}

function schedulePump(token) {
  setTimeout(() => pump(token), 0);
}

function pump(token) {
  if (token !== runToken || !mode || !engine) return;
  if (mode === 'soup') {
    engine.pumpSoup(settings.batchSize);
    postProgress();
    schedulePump(token);
    return;
  }
  const status = engine.pumpReverse(settings.conflictBudget);
  postProgress(status !== 1);
  if (status === 1) schedulePump(token);
  else mode = null;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'stop') {
      runToken++;
      engine?.stop();
      postProgress(true);
      mode = null;
      self.postMessage({ type: 'stopped' });
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
      runToken++;
      await replaceEngine(data.size);
      settings = data;
      engine.startSoup({
        density: data.density,
        horizon: data.horizon,
        seed: hashSeed(data.seed),
        leaderboardSize: data.leaderboardSize,
      });
      mode = 'soup';
      startedAt = lastProgressAt = performance.now();
      self.postMessage({ type: 'started', mode });
      schedulePump(runToken);
      return;
    }
    if (data.type === 'start-reverse') {
      runToken++;
      await replaceEngine(data.size);
      settings = data;
      engine.startReverse(new Uint8Array(data.cells), {
        maxDepth: data.maxDepth,
        seed: hashSeed(data.seed),
      });
      mode = 'reverse';
      lastBestDepth = -1;
      startedAt = lastProgressAt = performance.now();
      self.postMessage({ type: 'started', mode });
      postProgress(true);
      schedulePump(runToken);
    }
  } catch (error) {
    mode = null;
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
