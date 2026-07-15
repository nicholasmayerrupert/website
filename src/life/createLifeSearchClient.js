import LifeSearchWorker from './lifeSearchWorkerConstructor.js';

export function createLifeSearchClient(onMessage) {
  const worker = new LifeSearchWorker();
  let extensionWorkers = [];
  let extensionProgress = [];
  let extensionRun = 0;
  let ignoredStops = 0;

  const stopExtension = () => {
    extensionRun++;
    for (const extensionWorker of extensionWorkers) extensionWorker.terminate();
    extensionWorkers = [];
    extensionProgress = [];
  };

  const aggregateExtensionProgress = (message, workerIndex) => {
    extensionProgress[workerIndex] = message;
    const totals = extensionProgress.reduce((summary, progress) => ({
      jobs: summary.jobs + (progress?.jobs || 0),
      conflicts: summary.conflicts + (progress?.conflicts || 0),
      rejected: summary.rejected + (progress?.rejected || 0),
    }), { jobs: 0, conflicts: 0, rejected: 0 });
    return { ...message, ...totals, workers: extensionWorkers.length };
  };

  worker.onmessage = ({ data }) => {
    if (data.type === 'stopped' && ignoredStops > 0) {
      ignoredStops--;
      return;
    }
    onMessage(data);
  };
  worker.onerror = (event) => onMessage({ type: 'error', message: event.message || 'Life search worker failed' });
  return {
    startSoup(settings) {
      stopExtension();
      worker.postMessage({ type: 'start-soup', ...settings });
    },
    startReverse(settings) {
      stopExtension();
      const cells = settings.cells.slice();
      worker.postMessage({ type: 'start-reverse', ...settings, cells: cells.buffer }, [cells.buffer]);
    },
    startExtension(settings) {
      stopExtension();
      ignoredStops++;
      worker.postMessage({ type: 'stop' });
      const run = extensionRun;
      const workerCount = Math.max(1, Math.min(8, Math.round(settings.workers || 1)));
      extensionProgress = Array.from({ length: workerCount }, () => null);
      for (let index = 0; index < workerCount; index++) {
        const extensionWorker = new LifeSearchWorker();
        extensionWorker.onmessage = ({ data }) => {
          if (run !== extensionRun) return;
          if (data.type === 'started') return;
          const aggregate = aggregateExtensionProgress(data, index);
          if (data.type === 'extension-result') {
            stopExtension();
            onMessage({ ...aggregate, type: 'extension-result', running: false });
          } else {
            onMessage(aggregate);
          }
        };
        extensionWorker.onerror = (event) => {
          if (run !== extensionRun) return;
          stopExtension();
          onMessage({
            type: 'error',
            message: event.message || 'Life extension worker failed',
          });
        };
        extensionWorkers.push(extensionWorker);
        const cells = settings.cells.slice();
        extensionWorker.postMessage({
          type: 'start-extension',
          ...settings,
          seed: `${settings.seed}:${index}`,
          workerIndex: index,
          workerCount,
          cells: cells.buffer,
        }, [cells.buffer]);
      }
      onMessage({ type: 'started', mode: 'extension' });
    },
    stop() {
      stopExtension();
      worker.postMessage({ type: 'stop' });
    },
    destroy() {
      stopExtension();
      worker.postMessage({ type: 'destroy' });
    },
  };
}
