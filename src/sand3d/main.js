import './style.css';
import wasmURL from './wasm/voxelDemo.wasm?url';

const $ = (id) => document.getElementById(id);
const canvas = $('voxel-canvas');
const coarse = matchMedia('(pointer:coarse)').matches;
const tools = [
  ['Mining tool', 'Remove material'], ['Sand', 'Pour loose grains'],
  ['Stone', 'Place a solid voxel'], ['Timber', 'Place a solid voxel'],
  ['Throw', 'Launch a moving block'],
];
const materials = ['Air', 'Sand', 'Bedrock', 'Stone', 'Timber', 'Grass', 'Copper', 'Leaves'];
const keyMap = { KeyW: 0, ArrowUp: 0, KeyS: 1, ArrowDown: 1, KeyA: 2, ArrowLeft: 2, KeyD: 3, ArrowRight: 3, Space: 4, KeyC: 5, ControlLeft: 5, ShiftLeft: 6, ShiftRight: 6 };
const events = new AbortController();
const on = (target, event, handler, options = {}) => target.addEventListener(event, handler, { ...options, signal: events.signal });
let engine, frame = 0, last = 0, accumulator = 0, ready = false, disposed = false;
let inMenu = true, dragging = null, canvasToolPointer = null, frames = 0, fpsStart = 0, lastHud = 0;
let lastLimitHits = 0;
document.body.classList.add('in-menu');
if (coarse) $('quality').value = '0.6';

function resize() {
  const scale = Number($('quality').value);
  const rect = canvas.getBoundingClientRect();
  const factor = Math.min(1, (coarse ? 600 : 900) * scale / Math.max(rect.width, rect.height));
  canvas.width = Math.max(1, Math.round(rect.width * factor));
  canvas.height = Math.max(1, Math.round(rect.height * factor));
  if (ready && inMenu) engine._demo_render(canvas.width, canvas.height);
}
function stats() {
  const pointer = engine._demo_stats();
  return Array.from(engine.HEAPF32.subarray(pointer / 4, pointer / 4 + 17));
}
function refreshHud(now) {
  if (now - lastHud < 200) return;
  lastHud = now;
  const s = stats();
  $('body-count').textContent = `${s[1]} solids · ${s[2]} awake`;
  $('mined-count').textContent = `${s[3]} mined`;
  $('target-label').textContent = s[9] ? `${materials[s[9]]} · ${s[16].toFixed(1)} m` : '';
  if (s[13] > lastLimitHits) {
    $('status').textContent = 'Moving-solid limit reached. Mine existing pieces or reset the quarry.';
    lastLimitHits = s[13];
  }
  if (now - fpsStart > 1000) {
    $('fps').textContent = `${Math.round(frames * 1000 / (now - fpsStart))} FPS`;
    frames = 0; fpsStart = now;
  }
}
function animate(now) {
  frame = 0;
  if (!ready || inMenu || document.hidden || disposed) return;
  accumulator += Math.min((now - last) / 1000, 0.05); last = now;
  let steps = 0;
  while (accumulator >= 1 / 60 && steps++ < 3) {
    engine._demo_step(1 / 60); accumulator -= 1 / 60;
  }
  engine._demo_render(canvas.width, canvas.height);
  ++frames; refreshHud(now);
  frame = requestAnimationFrame(animate);
}
function startFrames() {
  if (frame || inMenu || disposed || document.hidden) return;
  last = performance.now(); fpsStart = last; frames = 0; accumulator = 0;
  frame = requestAnimationFrame(animate);
}
function menu(open) {
  if (!ready) return;
  inMenu = open;
  $('intro').hidden = !open;
  document.body.classList.toggle('in-menu', open);
  engine._demo_clear_input(); engine._demo_pause(open ? 1 : 0); dragging = null; canvasToolPointer = null;
  if (open) {
    cancelAnimationFrame(frame); frame = 0;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    $('enter').textContent = 'Continue exploring →';
    $('enter').focus();
  } else startFrames();
}
function selectTool(value) {
  engine?._demo_tool(value);
  document.querySelectorAll('[data-tool]').forEach(button => {
    const selected = Number(button.dataset.tool) === value;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  $('tool-name').textContent = tools[value][0]; $('tool-hint').textContent = tools[value][1];
  $('touch-use').textContent = ['MINE', 'POUR', 'PLACE', 'PLACE', 'THROW'][value];
}
function lockPointer() {
  if (coarse || !canvas.requestPointerLock) return;
  try {
    const result = canvas.requestPointerLock();
    result?.catch(() => { $('status').textContent = 'Drag with the right mouse button to look. Left click uses your tool.'; });
  } catch { $('status').textContent = 'Drag with the right mouse button to look. Left click uses your tool.'; }
}
on($('enter'), 'click', () => { menu(false); canvas.focus(); lockPointer(); });
on($('menu'), 'click', () => menu(true));
on($('retry'), 'click', () => location.reload());
on(document, 'pointerlockchange', () => { if (!document.pointerLockElement && !inMenu && !coarse) menu(true); });
on(document, 'pointerlockerror', () => { $('status').textContent = 'Drag with the right mouse button to look. Left click uses your tool.'; });
on(document, 'mousemove', event => {
  if (ready && !inMenu && document.pointerLockElement === canvas) engine._demo_look(event.movementX, event.movementY);
});
on(canvas, 'contextmenu', event => event.preventDefault());
on(canvas, 'pointerdown', event => {
  if (!ready || inMenu) return;
  if (event.pointerType === 'touch' || event.button === 2) {
    if (document.pointerLockElement !== canvas) {
      dragging = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId);
    }
  } else if (event.button === 0) {
    canvasToolPointer = event.pointerId;
    engine._demo_hold(1);
    if (document.pointerLockElement !== canvas) canvas.setPointerCapture(event.pointerId);
  }
});
on(canvas, 'pointermove', event => {
  if (dragging?.id !== event.pointerId || inMenu) return;
  engine._demo_look((event.clientX - dragging.x) * 1.7, (event.clientY - dragging.y) * 1.7);
  dragging.x = event.clientX; dragging.y = event.clientY;
});
function release(event) {
  if (dragging?.id === event.pointerId) dragging = null;
  if (canvasToolPointer === event.pointerId) { canvasToolPointer = null; engine?._demo_hold(0); }
}
on(canvas, 'pointerup', release); on(canvas, 'pointercancel', release); on(canvas, 'lostpointercapture', release);
on(window, 'blur', () => { if (ready && !inMenu) menu(true); });
on(document, 'visibilitychange', () => { if (document.hidden && ready) menu(true); });

on(document, 'keydown', event => {
  if (!ready || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'Escape') { if (!inMenu) menu(true); return; }
  if (inMenu) return;
  if (keyMap[event.code] !== undefined) { event.preventDefault(); engine._demo_key(keyMap[event.code], 1); }
  if (/^Digit[1-5]$/.test(event.code)) selectTool(Number(event.code.at(-1)) - 1);
  if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
    $('brush').value = String(Math.max(0.5, Math.min(3.5, Number($('brush').value) + (event.code === 'BracketLeft' ? -1 : 1))));
    engine._demo_brush(Number($('brush').value));
  }
});
on(document, 'keyup', event => { if (keyMap[event.code] !== undefined) engine?._demo_key(keyMap[event.code], 0); });
document.querySelectorAll('[data-tool]').forEach(button => on(button, 'click', () => selectTool(Number(button.dataset.tool))));
on($('brush'), 'input', () => engine?._demo_brush(Number($('brush').value)));
on($('quality'), 'change', resize);
on($('reset'), 'click', () => {
  if (!ready) return;
  engine._demo_reset(); lastLimitHits = 0; $('status').textContent = 'Quarry reset';
  if (inMenu) engine._demo_render(canvas.width, canvas.height);
});
document.querySelectorAll('[data-move]').forEach(button => {
  on(button, 'pointerdown', event => {
    if (!ready || inMenu) return;
    event.preventDefault(); button.setPointerCapture(event.pointerId); engine._demo_key(Number(button.dataset.move), 1);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on(button, event, () => engine?._demo_key(Number(button.dataset.move), 0));
});
on($('touch-use'), 'pointerdown', event => {
  if (!ready || inMenu) return;
  event.preventDefault(); $('touch-use').setPointerCapture(event.pointerId); engine._demo_hold(1);
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on($('touch-use'), event, () => engine?._demo_hold(0));
const observer = new ResizeObserver(resize); observer.observe(canvas);
on(canvas, 'webglcontextlost', event => {
  event.preventDefault(); menu(true); ready = false;
  $('enter').disabled = true; $('enter').textContent = 'Graphics interrupted';
  $('load-status').textContent = 'Reload to reopen the quarry.'; $('retry').hidden = false;
});
function dispose() {
  disposed = true; ready = false; cancelAnimationFrame(frame); frame = 0;
  observer.disconnect(); events.abort(); engine?._demo_destroy(); engine = null;
  delete window.__voxelDemo;
}
on(window, 'pagehide', dispose);
// A restored document must recreate its disposed graphics context and input bindings.
window.addEventListener('pageshow', event => { if (event.persisted && disposed) location.reload(); });

async function initialize() {
  try {
    const { default: createModule } = await import('./wasm/voxelDemo.js');
    const instance = await createModule({ locateFile: path => path.endsWith('.wasm') ? wasmURL : path, canvas });
    if (disposed) return;
    engine = instance;
    $('load-status').textContent = 'Carving the quarry';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (disposed) return;
    if (!engine._demo_create(1)) throw new Error('WebGL2 could not start on this browser.');
    ready = true; engine._demo_pause(1); resize();
    // Some graphics backends compile the native shader on its first draw.
    if (canvas.getContext('webgl2').getError() !== 0) throw new Error('The 3D renderer could not draw on this graphics device.');
    $('enter').disabled = false; $('enter').textContent = 'Enter the quarry →';
    $('load-status').textContent = coarse ? 'Touch controls ready' : 'Mouse + keyboard · Free-flight camera';
    canvas.dataset.ready = 'true';
    if (new URLSearchParams(location.search).has('test')) {
      window.__voxelDemo = {
        stats, pause: value => engine._demo_pause(value ? 1 : 0),
        camera: (...args) => engine._demo_camera(...args),
        tool: selectTool, use: () => engine._demo_use(),
        step: count => { for (let i = 0; i < count; ++i) engine._demo_step(1 / 60); },
        reset: () => engine._demo_reset(), render: () => engine._demo_render(canvas.width, canvas.height),
        cell: (...args) => engine._demo_cell(...args),
        menu, get running() { return frame !== 0; },
      };
    }
  } catch (error) {
    if (disposed) return;
    ready = false;
    console.error(error); $('enter').textContent = 'Unable to open the quarry';
    $('load-status').textContent = `${error.message || 'The 3D engine could not load.'} Try reloading or use a browser with WebGL2.`;
    $('retry').hidden = false;
  }
}
void initialize();
