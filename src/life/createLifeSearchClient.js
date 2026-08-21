import LifeSearchWorker from './lifeSearchWorkerConstructor.js';
import {
  getLifeSearchWorkerLimit,
  normalizeLifeSearchSettings,
  normalizeLifeSearchWorkers,
} from './searchLimits.js';

export function createLifeSearchClient(onMessage) {
  let workers = [];
  let progress = [];
  let runToken = 0;
  let startedAt = 0;
  let leaderboardSize = 10;
  let progressTimer = null;
  let lastProgressAt = 0;
  let running = false;
  let paused = false;
  let pausePending = false;
  let pausedWorkers = new Set();
  let elapsedBeforePause = 0;

  const terminatePool = () => {
    runToken++;
    for (const worker of workers) worker.terminate();
    workers = [];
    progress = [];
    clearTimeout(progressTimer);
    progressTimer = null;
    running = false;
    paused = false;
    pausePending = false;
    pausedWorkers = new Set();
    elapsedBeforePause = 0;
  };

  const taggedResults = (key) => progress.flatMap((snapshot, workerIndex) =>
    (snapshot?.[key] || []).map((result) => ({ ...result, workerIndex })));

  function aggregateProgress() {
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
      workers: running ? workers.length : 0,
      results,
      loops,
      elapsedMs: elapsedBeforePause + (running ? performance.now() - startedAt : 0),
      running,
    };
  }

  const scheduleProgress = () => {
    if (progressTimer !== null) return;
    const delay = Math.max(0, 100 - (performance.now() - lastProgressAt));
    progressTimer = setTimeout(() => {
      progressTimer = null;
      if (!workers.length || !running) return;
      lastProgressAt = performance.now();
      onMessage(aggregateProgress());
    }, delay);
  };

  const failRun = (message) => {
    terminatePool();
    onMessage({ type: 'error', message });
  };

  return {
    startSoup(settings) {
      terminatePool();
      const token = runToken;
      const workerCount = normalizeLifeSearchWorkers(
        settings.workers,
        getLifeSearchWorkerLimit(),
      );
      const normalizedSettings = normalizeLifeSearchSettings(settings);
      leaderboardSize = normalizedSettings.leaderboardSize;
      progress = Array.from({ length: workerCount }, () => null);
      startedAt = performance.now();
      lastProgressAt = 0;
      running = true;

      for (let index = 0; index < workerCount; index++) {
        let worker;
        try {
          worker = new LifeSearchWorker();
        } catch (error) {
          failRun(error?.message || 'Unable to create Life search worker');
          return;
        }
        worker.onmessage = ({ data }) => {
          if (token !== runToken) return;
          if (data.type === 'started') return;
          if (data.type === 'stopped') {
            if (!pausePending) return;
            pausedWorkers.add(index);
            if (pausedWorkers.size === workers.length) {
              pausePending = false;
              paused = true;
              onMessage(aggregateProgress());
              onMessage({ type: 'stopped' });
            }
            return;
          }
          if (data.type === 'error') {
            failRun(data.message || 'Life search worker failed');
            return;
          }
          if (data.type !== 'soup-progress') return;
          progress[index] = data;
          if (running) scheduleProgress();
        };
        worker.onerror = (event) => {
          if (token !== runToken) return;
          failRun(event.message || 'Life search worker failed');
        };
        workers.push(worker);
        try {
          worker.postMessage({
            type: 'start-soup',
            ...normalizedSettings,
            seed: index === 0 ? settings.seed : `${settings.seed}:${index}`,
            progressIntervalMs: Math.max(100, workerCount * 50),
            progressPhase: index / workerCount,
          });
        } catch (error) {
          failRun(error?.message || 'Unable to start Life search worker');
          return;
        }
      }
      onMessage({ type: 'started', mode: 'soup' });
    },
    stop() {
      if (!running || !workers.length) return;
      elapsedBeforePause += performance.now() - startedAt;
      running = false;
      pausePending = true;
      pausedWorkers = new Set();
      clearTimeout(progressTimer);
      progressTimer = null;
      for (const worker of workers) {
        try {
          worker.postMessage({ type: 'stop' });
        } catch (error) {
          failRun(error?.message || 'Unable to stop Life search worker');
          return;
        }
      }
    },
    resume() {
      if (!paused || !workers.length) return;
      running = true;
      paused = false;
      startedAt = performance.now();
      lastProgressAt = 0;
      for (const worker of workers) {
        try {
          worker.postMessage({ type: 'resume-soup' });
        } catch (error) {
          failRun(error?.message || 'Unable to resume Life search worker');
          return;
        }
      }
      onMessage({ type: 'started', mode: 'soup' });
      onMessage(aggregateProgress());
    },
    reset() {
      terminatePool();
    },
    destroy() {
      terminatePool();
    },
  };
}
