import WorldWorker from './worldWorker.js?worker';

// The site build emits a real worker asset so imports inside the worker resolve
// relative to that asset instead of an unresolvable blob: URL.
export default WorldWorker;
