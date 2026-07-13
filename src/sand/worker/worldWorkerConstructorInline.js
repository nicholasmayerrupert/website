import WorldWorker from './worldWorker.js?worker&inline';

// The drop-in embed remains one self-contained file. Its WASM selector is
// already aliased to the non-threaded module, so the blob has no child import.
export default WorldWorker;
