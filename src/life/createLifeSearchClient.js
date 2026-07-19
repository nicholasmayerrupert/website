import LifeSearchWorker from './lifeSearchWorkerConstructor.js';

const normalizeWorkers = (value) => Math.max(1, Math.round(value) || 1);

export function createLifeSearchClient(onMessage) {
  let workers = [];
  let progress = [];
  let runToken = 0;
  let startedAt = 0;
  let leaderboardSize = 10;
  let progressTimer = null;
  let lastProgressAt = 0;

  const stopPool = (notify) => {
    runToken++;
    for (const worker of workers) worker.terminate();
    workers = [];
    progress = [];
    clearTimeout(progressTimer);
    progressTimer = null;
    if (notify) onMessage({ type: 'stopped' });
  };

  const taggedResults = (key) => progress.flatMap((snapshot, workerIndex) =>
    (snapshot?.[key] || []).map((result) => ({ ...result, workerIndex })));

  const aggregateProgress = () => {
    const results = taggedResults('results')
      .sort((left, right) =>
        right.lifetime - left.lifetime ||
        left.workerIndex - right.workerIndex ||
        left.serial - right.serial)
      .slice(0, leaderboardSize);
    const loops = taggedResults('loops')
      .sort((left, right) =>
        right.period - left.period ||
        right.lifetime - left.lifetime ||
        left.workerIndex - right.workerIndex ||
        left.serial - right.serial)
      .slice(0, leaderboardSize);
    return {
      type: 'soup-progress',
      searched: progress.reduce((total, snapshot) => total + (snapshot?.searched || 0), 0),
      workers: workers.length,
      results,
      loops,
      elapsedMs: performance.now() - startedAt,
      running: true,
    };
  };

  const scheduleProgress = () => {
    if (progressTimer !== null) return;
    const delay = Math.max(0, 100 - (performance.now() - lastProgressAt));
    progressTimer = setTimeout(() => {
      progressTimer = null;
      if (!workers.length) return;
      lastProgressAt = performance.now();
      onMessage(aggregateProgress());
    }, delay);
  };

  const failRun = (message) => {
    stopPool(false);
    onMessage({ type: 'error', message });
  };

  return {
    startSoup(settings) {
      stopPool(false);
      const token = runToken;
      const workerCount = normalizeWorkers(settings.workers);
      leaderboardSize = Math.max(1, Math.min(100, Math.round(settings.leaderboardSize) || 10));
      progress = Array.from({ length: workerCount }, () => null);
      startedAt = performance.now();
      lastProgressAt = 0;

      for (let index = 0; index < workerCount; index++) {
        const worker = new LifeSearchWorker();
        worker.onmessage = ({ data }) => {
          if (token !== runToken) return;
          if (data.type === 'started') return;
          if (data.type === 'error') {
            failRun(data.message || 'Life search worker failed');
            return;
          }
          if (data.type !== 'soup-progress') return;
          progress[index] = data;
          scheduleProgress();
        };
        worker.onerror = (event) => {
          if (token !== runToken) return;
          failRun(event.message || 'Life search worker failed');
        };
        workers.push(worker);
        worker.postMessage({
          type: 'start-soup',
          ...settings,
          seed: index === 0 ? settings.seed : `${settings.seed}:${index}`,
          progressIntervalMs: Math.max(100, workerCount * 50),
          progressPhase: index / workerCount,
        });
      }
      onMessage({ type: 'started', mode: 'soup' });
    },
    stop() {
      stopPool(true);
    },
    destroy() {
      stopPool(false);
    },
  };
}
