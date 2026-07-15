import LifeSearchWorker from './lifeSearchWorkerConstructor.js';

export function createLifeSearchClient(onMessage) {
  const worker = new LifeSearchWorker();
  worker.onmessage = ({ data }) => onMessage(data);
  worker.onerror = (event) => onMessage({ type: 'error', message: event.message || 'Life search worker failed' });
  return {
    startSoup(settings) { worker.postMessage({ type: 'start-soup', ...settings }); },
    startReverse(settings) {
      const cells = settings.cells.slice();
      worker.postMessage({ type: 'start-reverse', ...settings, cells: cells.buffer }, [cells.buffer]);
    },
    stop() { worker.postMessage({ type: 'stop' }); },
    destroy() { worker.postMessage({ type: 'destroy' }); },
  };
}
