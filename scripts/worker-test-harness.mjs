import { register } from 'node:module';

export function installWorkerMock() {
  const workers = [];
  globalThis.sandTestWorkerConstructor = class {
    constructor() { workers.push(this); this.messages = []; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  };
  const module = 'data:text/javascript,' + encodeURIComponent(
    'export default globalThis.sandTestWorkerConstructor;');
  register('data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === './worldWorkerConstructor.js')
        return { url: ${JSON.stringify(module)}, shortCircuit: true };
      return nextResolve(specifier, context);
    }
  `), import.meta.url);
  return workers;
}

export function installTestClock() {
  let now = 0, sequence = 0;
  const timeouts = new Map(), intervals = new Map();
  globalThis.performance = { now: () => now };
  globalThis.setTimeout = (callback, delay) => {
    const id = ++sequence;
    timeouts.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timeouts.delete(id);
  globalThis.setInterval = (callback, delay) => {
    const id = ++sequence;
    intervals.set(id, { callback, delay });
    return id;
  };
  globalThis.clearInterval = (id) => intervals.delete(id);
  return { timeouts, intervals, setNow: (value) => { now = value; } };
}
