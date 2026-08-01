// Browser WebGL implementations reject some views backed by growable WASM
// memory. Adapt only the sand context; other WebGL users keep their native
// prototype methods.

const PATCHED_CONTEXT = Symbol('sandResizableBufferContext');

function needsFixedBuffer(value) {
  const buffer = ArrayBuffer.isView(value) ? value.buffer : value;
  return buffer?.resizable === true;
}

function isBufferArg(value) {
  return ArrayBuffer.isView(value)
    || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer);
}

function fixedBufferArg(value) {
  if (value == null) return value;
  if (ArrayBuffer.isView(value)) {
    if (!needsFixedBuffer(value)) return value;
    if (typeof DataView !== 'undefined' && value instanceof DataView) {
      const bytes = new Uint8Array(value.byteLength);
      bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return new DataView(bytes.buffer);
    }
    const Ctor = value.constructor;
    const copy = new Ctor(value.length);
    copy.set(value);
    return copy;
  }
  if (!needsFixedBuffer(value)) return value;
  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value));
  return copy.buffer;
}

function contextMethodNames(gl) {
  const names = new Set();
  for (let proto = Object.getPrototypeOf(gl);
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  return names;
}

function installMethod(gl, name, wrap) {
  const original = gl[name];
  if (typeof original !== 'function') return;
  Object.defineProperty(gl, name, {
    configurable: true,
    writable: true,
    value: wrap(original),
  });
}

export function patchResizableWebGLContext(gl) {
  if (!gl || gl[PATCHED_CONTEXT]) return gl;
  Object.defineProperty(gl, PATCHED_CONTEXT, { value: true });

  const wrapDataArg = (name, dataIndex) => installMethod(gl, name, (original) =>
    function resizableSafeData(...args) {
      if (args.length > dataIndex) args[dataIndex] = fixedBufferArg(args[dataIndex]);
      return original.apply(this, args);
    });

  const wrapPixelsScan = (name) => installMethod(gl, name, (original) =>
    function resizableSafePixels(...args) {
      for (let i = 0; i < args.length; i++) {
        if (isBufferArg(args[i])) args[i] = fixedBufferArg(args[i]);
      }
      return original.apply(this, args);
    });

  wrapDataArg('bufferData', 1);
  wrapDataArg('bufferSubData', 2);
  wrapPixelsScan('texImage2D');

  installMethod(gl, 'texSubImage2D', (original) =>
    function resizableSafeTexSubImage2D(...args) {
      const heap = args[8];
      const srcOffset = args[9] | 0;
      if (args.length >= 10 && ArrayBuffer.isView(heap) && needsFixedBuffer(heap)
          && args[6] === 0x1908 && args[7] === 0x1401) { // RGBA / UNSIGNED_BYTE
        const width = args[4] | 0;
        const height = args[5] | 0;
        const rowLength = this.getParameter(0x0CF2) || width; // UNPACK_ROW_LENGTH
        const skipRows = this.getParameter(0x0CF3) | 0;
        const skipPixels = this.getParameter(0x0CF4) | 0;
        const pixels = Math.max(0,
          (skipRows + height - 1) * rowLength + skipPixels + width);
        const count = Math.min(heap.length - srcOffset, pixels * 4);
        const fixed = new Uint8Array(Math.max(0, count));
        fixed.set(heap.subarray(srcOffset, srcOffset + count));
        args[8] = fixed;
        args[9] = 0;
        return original.apply(this, args);
      }
      for (let i = 0; i < args.length; i++) {
        if (isBufferArg(args[i])) args[i] = fixedBufferArg(args[i]);
      }
      return original.apply(this, args);
    });

  wrapPixelsScan('compressedTexImage2D');
  wrapPixelsScan('compressedTexSubImage2D');

  installMethod(gl, 'readPixels', (original) =>
    function resizableSafeReadPixels(...args) {
      if (args.length >= 7 && ArrayBuffer.isView(args[6]) && needsFixedBuffer(args[6])) {
        const heap = args[6];
        const offset = args[7] | 0;
        const width = args[2] | 0;
        const height = args[3] | 0;
        const fixed = new Uint8Array(Math.max(0, width * height * 4));
        const result = original.call(
          this, args[0], args[1], width, height, args[4], args[5], fixed,
        );
        heap.set(fixed, offset);
        return result;
      }
      const last = args.length - 1;
      const destination = args[last];
      if (ArrayBuffer.isView(destination) && needsFixedBuffer(destination)) {
        const fixed = fixedBufferArg(destination);
        args[last] = fixed;
        const result = original.apply(this, args);
        destination.set(fixed);
        return result;
      }
      return original.apply(this, args);
    });

  for (const name of contextMethodNames(gl)) {
    if (!/^uniform\d/.test(name) && !/^vertexAttrib\d/.test(name)) continue;
    if (name.includes('Pointer')) continue;
    installMethod(gl, name, (original) =>
      function resizableSafeUniform(...args) {
        for (let i = 0; i < args.length; i++) {
          if (ArrayBuffer.isView(args[i])) args[i] = fixedBufferArg(args[i]);
        }
        return original.apply(this, args);
      });
  }
  return gl;
}

export function withResizableTextDecoder(callback) {
  if (typeof TextDecoder === 'undefined') return callback();
  const proto = TextDecoder.prototype;
  const original = proto.decode;
  if (typeof original !== 'function') return callback();
  const safeDecode = function decodeResizableSafe(input, options) {
    return original.call(this, fixedBufferArg(input), options);
  };
  proto.decode = safeDecode;
  try {
    return callback();
  } finally {
    if (proto.decode === safeDecode) proto.decode = original;
  }
}

export function withPatchedCanvasWebGLContext(canvas, callback) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(canvas, 'getContext');
  const getContext = canvas.getContext;
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    writable: true,
    value(type, ...args) {
      const context = getContext.call(this, type, ...args);
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
        patchResizableWebGLContext(context);
      }
      return context;
    },
  });
  try {
    return withResizableTextDecoder(callback);
  } finally {
    if (ownDescriptor) Object.defineProperty(canvas, 'getContext', ownDescriptor);
    else delete canvas.getContext;
  }
}
