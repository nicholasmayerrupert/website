import assert from 'node:assert/strict';
import {
  patchResizableWebGLContext,
  withPatchedCanvasWebGLContext,
  withResizableTextDecoder,
} from '../src/sand/wasmBridge/resizableBrowserBuffers.js';

class FakeWebGLContext {
  constructor() { this.calls = []; }
  bufferData(...args) { this.calls.push(args); }
  getParameter() { return 0; }
  uniform4fv(...args) { this.calls.push(args); }
}

const originalBufferData = FakeWebGLContext.prototype.bufferData;
const sandContext = new FakeWebGLContext();
const otherContext = new FakeWebGLContext();
patchResizableWebGLContext(sandContext);

assert.equal(FakeWebGLContext.prototype.bufferData, originalBufferData,
  'patching sand must not change the shared WebGL prototype');
assert.equal(otherContext.bufferData, originalBufferData,
  'another renderer must retain its native WebGL method');
assert.notEqual(sandContext.bufferData, originalBufferData,
  'the sand context receives the growable-buffer adapter');

const fixed = new Uint8Array([1, 2, 3]);
sandContext.bufferData(0, fixed, 0);
assert.equal(sandContext.calls.at(-1)[1], fixed,
  'ordinary typed arrays pass through without copying');

const growable = new ArrayBuffer(16, { maxByteLength: 32 });
if (growable.resizable) {
  const heap = new Uint8Array(growable);
  heap.set([4, 5, 6]);
  sandContext.bufferData(0, heap, 0);
  const adapted = sandContext.calls.at(-1)[1];
  assert.notEqual(adapted, heap, 'growable WASM views are copied for sand');
  assert.equal(adapted.buffer.resizable, false, 'the WebGL copy has fixed backing');
  assert.deepEqual([...adapted.slice(0, 3)], [4, 5, 6]);
}

const originalDecode = TextDecoder.prototype.decode;
withResizableTextDecoder(() => {
  assert.notEqual(TextDecoder.prototype.decode, originalDecode,
    'TextDecoder is adapted during synchronous shader setup');
});
assert.equal(TextDecoder.prototype.decode, originalDecode,
  'TextDecoder is restored immediately after shader setup');

const canvas = { getContext: () => sandContext };
const originalGetContext = canvas.getContext;
withPatchedCanvasWebGLContext(canvas, () => {
  assert.equal(canvas.getContext('webgl2'), sandContext);
});
assert.equal(canvas.getContext, originalGetContext,
  'the canvas interception is removed after context creation');

console.log('webgl buffer isolation checks passed');
