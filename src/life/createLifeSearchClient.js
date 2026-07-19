import LifeSearchWorker from './lifeSearchWorkerConstructor.js';

const clampWorkers = (value) => Math.max(1, Math.min(64, Math.round(value) || 1));

export function createLifeSearchClient(onMessage) {
  let workers = [];
  let progress = [];
  let runToken = 0;
  let startedAt = 0;
  let leaderboardSize = 10;

  const stopPool = (notify) => {
    runToken++;
    for (const worker of workers) worker.terminate();
    workers = [];
    progress = [];
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

  const failRun = (message) => {
    stopPool(false);
    onMessage({ type: 'error', message });
  };

  return {
    startSoup(settings) {
      stopPool(false);
      const token = runToken;
      const workerCount = clampWorkers(settings.workers);
      leaderboardSize = Math.max(1, Math.min(100, Math.round(settings.leaderboardSize) || 10));
      progress = Array.from({ length: workerCount }, () => null);
      startedAt = performance.now();

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
          onMessage(aggregateProgress());
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
