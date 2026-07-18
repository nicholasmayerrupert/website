import WorldWorker from './worldWorker.js?worker&inline';

// The drop-in embed remains one self-contained file, so the worker has no child
// import to resolve from its blob URL.
export default WorldWorker;
