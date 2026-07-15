import { createLifeSearchEngine } from './searchEngineWasm.js';

let engine = null;
let mode = null;
let runToken = 0;
let startedAt = 0;
let lastProgressAt = 0;
let lastBestDepth = -1;
let settings = null;
let extensionInput = null;
let extensionTarget = null;
let extensionJobIndex = 0;
let extensionJobs = 0;
let extensionConflicts = 0;
let extensionRejected = 0;
let extensionOffset = 0;
let extensionDepth = 1;
let extensionJobBudget = 0;
let extensionInputLifetime = null;

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

const equalCells = (left, right) =>
  left.length === right.length && left.every((cell, index) => cell === right[index]);

function startNextExtensionJob() {
  const memorySafeOffset = Math.max(0, Math.floor(8192 / (settings.size * settings.size)) - 1);
  const maxOffset = Math.max(0, Math.min(15, memorySafeOffset, Math.round(settings.maxOffset || 0)));
  const portfolioWidth = maxOffset + 1;
  const round = Math.floor(extensionJobIndex / portfolioWidth);
  const baseBudget = Math.max(1000, Math.min(10000000, Math.round(settings.attemptBudget || 250000)));
  extensionOffset = extensionJobIndex % portfolioWidth;
  extensionDepth = extensionOffset + 1;
  const escalation = settings.workerIndex === 0
    ? 2 ** Math.min(3, Math.floor(round / 2))
    : 1;
  extensionJobBudget = Math.min(
    baseBudget * escalation,
    baseBudget * 8,
  );
  extensionTarget = extensionInput.slice();
  for (let i = 0; i < extensionOffset; i++) extensionTarget = engine.step(extensionTarget);
  engine.startExtension(extensionTarget, extensionInput, {
    depth: extensionDepth,
    seed: hashSeed(`${settings.seed}:${extensionJobIndex}`),
  });
  extensionJobIndex += settings.workerCount;
  extensionJobs++;
}

function extensionMessage(snapshot, type = 'extension-progress') {
  return {
    type,
    status: snapshot.status,
    jobs: extensionJobs,
    conflicts: extensionConflicts + snapshot.conflicts,
    rejected: extensionRejected + snapshot.rejected,
    jobConflicts: snapshot.conflicts,
    jobBudget: extensionJobBudget,
    mergeOffset: extensionOffset,
    depth: extensionDepth,
    inputLifetime: extensionInputLifetime?.lifetime || 0,
    elapsedMs: performance.now() - startedAt,
    running: mode === 'extension',
  };
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
  } else if (mode === 'extension') {
    self.postMessage(extensionMessage(engine.extensionSnapshot(false)));
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
  if (mode === 'extension') {
    const quantum = Math.max(10, Math.min(1000000, Math.round(settings.quantum || 20000)));
    const status = engine.pumpExtension(quantum);
    let snapshot = engine.extensionSnapshot(status === 2);
    if (status === 2) {
      let evolved = snapshot.cells;
      for (let i = 0; i < extensionDepth; i++) evolved = engine.step(evolved);
      const candidateLifetime = engine.measureLifetime(snapshot.cells, settings.verificationHorizon);
      const verified = equalCells(evolved, extensionTarget)
        && candidateLifetime.reason !== 3
        && candidateLifetime.lifetime > extensionInputLifetime.lifetime;
      if (verified) {
        const message = {
          ...extensionMessage(snapshot, 'extension-result'),
          cells: snapshot.cells,
          candidateLifetime: candidateLifetime.lifetime,
          longerBy: candidateLifetime.lifetime - extensionInputLifetime.lifetime,
        };
        mode = null;
        message.running = false;
        self.postMessage(message, [snapshot.cells.buffer]);
        return;
      }
      engine.rejectExtensionResult();
      snapshot = engine.extensionSnapshot(false);
    }
    if (status === 3 || snapshot.conflicts >= extensionJobBudget || snapshot.rejected >= 100) {
      extensionConflicts += snapshot.conflicts;
      extensionRejected += snapshot.rejected;
      startNextExtensionJob();
      postProgress(true);
    } else {
      postProgress();
    }
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
        branchBudget: data.branchBudget,
        seed: hashSeed(data.seed),
      });
      mode = 'reverse';
      lastBestDepth = -1;
      startedAt = lastProgressAt = performance.now();
      self.postMessage({ type: 'started', mode });
      postProgress(true);
      schedulePump(runToken);
      return;
    }
    if (data.type === 'start-extension') {
      runToken++;
      await replaceEngine(data.size);
      settings = data;
      extensionInput = new Uint8Array(data.cells);
      extensionJobIndex = data.workerIndex;
      extensionJobs = 0;
      extensionConflicts = 0;
      extensionRejected = 0;
      extensionInputLifetime = engine.measureLifetime(extensionInput, data.verificationHorizon);
      if (extensionInputLifetime.reason === 3) {
        throw new Error('Forward verification horizon is too short for this input');
      }
      mode = 'extension';
      startedAt = lastProgressAt = performance.now();
      startNextExtensionJob();
      self.postMessage({ type: 'started', mode });
      postProgress(true);
      schedulePump(runToken);
    }
  } catch (error) {
    mode = null;
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
