import WorldWorker from './worldWorker.js?worker&inline';

export function createWorldWorkerClient(ctx) {
  const worker = new WorldWorker();
  let pending = null;
  let pendingDraft = null;
  let pendingCreatures = null;
  let lastControl = '';
  let resizeTimer = 0;
  let resizeId = 0;
  let awaitingResizeId = 0;
  let state = { ready: false, worldTick: 0, worldTps: 0, stepMs: 0, epoch: 0, sequence: 0 };

  worker.onmessage = ({ data }) => {
    if (!data) return;
    if (data.type === 'full' || data.type === 'diff') {
      // Runtime zoom can emit many buffer sizes in quick succession. While the
      // worker is catching up, discard packets from its old-sized world; applying
      // them to the already-resized render mirror is both stale and expensive.
      if (awaitingResizeId && data.resizeId !== awaitingResizeId) {
        worker.postMessage({ type: 'ack', epoch: data.epoch, sequence: data.sequence });
        return;
      }
      if (awaitingResizeId && data.type === 'full') awaitingResizeId = 0;
      // A full snapshot supersedes an obsolete diff during resize/streaming.
      if (!pending || data.type === 'full' || data.epoch >= pending.epoch) pending = data;
      state = {
        ...state, ready: true, worldTick: data.worldTick || state.worldTick,
        worldTps: data.perf?.worldTps || state.worldTps,
        stepMs: data.perf?.stepMs || 0, epoch: data.epoch, sequence: data.sequence,
      };
    } else if (data.type === 'draft') {
      pendingDraft = data;
    } else if (data.type === 'creatures') {
      pendingCreatures = data;
    } else if (data.type === 'stats') {
      state = {
        ...state, worldTick: data.worldTick ?? state.worldTick,
        worldTps: data.perf?.worldTps ?? state.worldTps,
        stepMs: data.perf?.stepMs ?? state.stepMs,
        controlsReceived: data.perf?.controlsReceived ?? state.controlsReceived,
        edgesProcessed: data.perf?.edgesProcessed ?? state.edgesProcessed,
        toolWrites: data.perf?.toolWrites ?? state.toolWrites,
      };
    }
  };

  const worldPoint = () => {
    const e = ctx.engine;
    if (!e) return { worldX: 0, worldY: 0 };
    const aim = e.getAim();
    return { worldX: e.getWorldOffsetX() + aim.x, worldY: e.getWorldOffsetY() + aim.y };
  };

  const api = {
    init({ creativeKind = 0, creativeValue = 0, tool = 0, creatureNaturalSpawning = false } = {}) {
      worker.postMessage({
        type: 'init', cols: ctx.cols, rows: ctx.rows, worldSeed: ctx.worldSeed,
        drawMode: ctx.drawModeOn, tool, creativeKind, creativeValue, creatureNaturalSpawning,
      });
    },
    updateControl() {
      const e = ctx.engine;
      if (!e) return;
      const p = worldPoint();
      const cam = e.getCam();
      const message = {
        type: 'control', ...p, buttons: ctx.mouseButtons, inside: ctx.inside,
        drawMode: ctx.drawModeOn,
        camWorldX: e.getWorldOffsetX() + cam.x,
        camWorldY: e.getWorldOffsetY() + cam.y,
        viewCols: ctx.viewCols, viewRows: ctx.viewRows,
      };
      const signature = Object.values(message).join('|');
      if (signature === lastControl) return;
      lastControl = signature;
      worker.postMessage(message);
    },
    edge(kind, button) {
      worker.postMessage({ type: 'edge', kind, button: button | 0, buttons: ctx.mouseButtons | 0, ...worldPoint() });
    },
    config(config) { worker.postMessage({ type: 'config', ...config }); },
    resize(cols, rows) {
      pending = null;
      lastControl = '';
      awaitingResizeId = ++resizeId;
      clearTimeout(resizeTimer);
      // Key repeat/mobile taps otherwise queue every huge intermediate resize in
      // the worker. Send only the settled zoom size.
      resizeTimer = setTimeout(() => {
        resizeTimer = 0;
        worker.postMessage({ type: 'resize', cols: cols | 0, rows: rows | 0, resizeId: awaitingResizeId });
      }, 150);
    },
    applyPending() {
      let changed = false;
      if (pendingDraft) {
        const cells = new Int32Array(pendingDraft.data);
        ctx.engine?.setMirrorDraft(cells, pendingDraft.material);
        pendingDraft = null;
        ctx.previewDirty = true;
        changed = true;
      }
      if (pendingCreatures && ctx.engine) {
        ctx.engine.setMirrorCreatures(new Float32Array(pendingCreatures.data), pendingCreatures.worldOffsetX, pendingCreatures.worldOffsetY);
        pendingCreatures = null;
        changed = true;
      }
      if (!pending || !ctx.engine) return changed;
      const packet = pending;
      pending = null;
      const bytes = new Uint8Array(packet.data);
      const applyStarted = performance.now();
      if (packet.type === 'full') {
        const cam = ctx.engine.getCam();
        const worldCamX = ctx.engine.getWorldOffsetX() + cam.x;
        const worldCamY = ctx.engine.getWorldOffsetY() + cam.y;
        ctx.engine.applyWorldMirror(bytes, packet.worldOffsetX, packet.worldOffsetY);
        ctx.engine.cameraSet(worldCamX - packet.worldOffsetX, worldCamY - packet.worldOffsetY);
        ctx.forceFullRender = true;
      } else {
        ctx.engine.applyDiffMirror(bytes);
      }
      ctx.engine.setMirrorWorldTick(packet.worldTick);
      worker.postMessage({ type: 'ack', epoch: packet.epoch, sequence: packet.sequence });
      state = { ...state, mirrorApplyMs: performance.now() - applyStarted, packetBytes: bytes.length };
      changed = true;
      return changed;
    },
    destroy() { clearTimeout(resizeTimer); worker.postMessage({ type: 'destroy' }); worker.terminate(); },
    get state() { return state; },
  };
  worker.onerror = (event) => {
    console.error('sand world worker failed', event.message || event);
    worker.terminate();
    if (ctx.worldWorker === api) ctx.worldWorker = null; // safe main-thread fallback
  };
  return api;
}
