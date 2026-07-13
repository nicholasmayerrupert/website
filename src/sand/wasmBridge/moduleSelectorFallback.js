import createSandModule from '../wasm/sandEngine.js';

// Drop-in embeds cannot require the host page to opt into COOP/COEP.
export function selectSandModule() {
  return { threaded: false, promise: createSandModule() };
}
