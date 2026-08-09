import { parentPort } from 'node:worker_threads';

globalThis.self = globalThis;
self.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
self.close = () => parentPort.close();
parentPort.on('message', (data) => self.onmessage?.({ data }));

await import('../src/sand/worker/worldWorker.js');
parentPort.postMessage({ type: 'harness-ready' });
