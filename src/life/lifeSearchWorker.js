import { createLifeSearchEngine } from './searchEngineWasm.js';

let engine = null;
let runToken = 0;
let settings = null;
let startedAt = 0;
let lastProgressAt = 0;

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
  if (!engine || (!force && now - lastProgressAt < 100)) return;
  lastProgressAt = now;
  self.postMessage({
    type: 'soup-progress',
    ...engine.soupSnapshot(),
    elapsedMs: now - startedAt,
    running: true,
  });
}

function pump(token) {
  if (token !== runToken || !engine || !settings) return;
  engine.pumpSoup(settings.batchSize);
  postProgress();
  setTimeout(() => pump(token), 0);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'stop') {
      runToken++;
      engine?.stop();
      settings = null;
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
      startedAt = lastProgressAt = performance.now();
      self.postMessage({ type: 'started', mode: 'soup' });
      pump(runToken);
    }
  } catch (error) {
    settings = null;
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
