import WorldWorker from './worldWorkerConstructor.js';
import { Predictor } from '../net/predict.js';
import { OFF, STRIDES } from '../wasmBridge/abi.generated.js';
import { mergePlayerPrediction } from './playerPresentation.js';
import { mapActorPacketToOffset, translatePackedPositions } from '../net/localCoordinates.js';

export function createWorldWorkerClient(ctx) {
  let worker = new WorldWorker();
  let initOptions = null;
  let retryCount = 0;
  let pending = null;
  let pendingDraft = null;
  let pendingCreatures = null;
  let pendingActors = null;
  let pendingSounds = [];
  let lastControl = '';
  let resizeTimer = 0;
  let resizeId = 0;
  let awaitingResizeId = 0;
  let destroyTimer = 0;
  let predictor = null;
  let predictorEngine = null;
  let predictorPlayerId = 0;
  let authoritativePlayerId = 0;
  let players = [];
  let inventory = null;
  let cursor = null;
  let inventoryDirty = false;
  let items = new Float32Array(0);
  let projectiles = new Float32Array(0);
  let mineProgress = 0;
  let mineTarget = null;
  let actionCount = 0;
  let appliedEpoch = 0;
  let state = {
    ready: false, worldTick: 0, worldTps: 0, stepMs: 0, epoch: 0, sequence: 0,
    resizePending: false, resizeControlsSent: 0, controlWorldX: 0, controlWorldY: 0,
  };

  const handleMessage = ({ data }) => {
    if (!data) return;
    if (data.type === 'full' || data.type === 'diff') {
      if ((data.epoch | 0) < appliedEpoch) {
        worker.postMessage({ type: 'ack', epoch: data.epoch, sequence: data.sequence });
        return;
      }
      // Runtime zoom can emit many buffer sizes in quick succession. While the
      // worker is catching up, discard packets from its old-sized world; applying
      // them to the already-resized render mirror is both stale and expensive.
      if (awaitingResizeId && data.resizeId !== awaitingResizeId) {
        worker.postMessage({ type: 'ack', epoch: data.epoch, sequence: data.sequence });
        return;
      }
      if (awaitingResizeId && data.type === 'full') awaitingResizeId = 0;
      // A full snapshot establishes an epoch. Never let a diff for a future
      // frame replace it before the browser has applied that coordinate frame.
      if (data.type === 'diff' && data.epoch !== appliedEpoch) {
        worker.postMessage({ type: 'ack', epoch: data.epoch, sequence: data.sequence });
        return;
      }
      if (!pending || data.epoch > pending.epoch ||
          (data.type === 'full' && data.epoch >= pending.epoch) ||
          (data.type === 'diff' && pending.type !== 'full' && data.sequence >= pending.sequence)) pending = data;
      state = {
        ...state, ...data.perf, ready: true, worldTick: data.worldTick || state.worldTick,
        worldTps: data.perf?.worldTps || state.worldTps,
        stepMs: data.perf?.stepMs || 0, epoch: data.epoch, sequence: data.sequence,
        resizePending: !!awaitingResizeId,
      };
    } else if (data.type === 'destroyed') {
      clearTimeout(destroyTimer);
      destroyTimer = 0;
      worker.terminate();
    } else if (data.type === 'draft') {
      if (!data.epoch || data.epoch >= appliedEpoch) pendingDraft = data;
    } else if (data.type === 'creatures') {
      if (!data.epoch || data.epoch >= appliedEpoch) pendingCreatures = data;
    } else if (data.type === 'actors') {
      if (data.epoch && data.epoch < appliedEpoch) return;
      if (pendingActors?.epoch && data.epoch < pendingActors.epoch) return;
      // Actor poses are latest-wins, but revision-gated inventory/items must
      // survive if a newer pose packet arrives before the next browser frame.
      const prior = pendingActors?.epoch === data.epoch ? pendingActors : null;
      pendingActors = {
        ...data,
        inventory: data.inventory !== undefined ? data.inventory : prior?.inventory,
        cursor: data.inventory !== undefined ? data.cursor : prior?.cursor,
        items: data.items !== undefined ? data.items : prior?.items,
      };
    } else if (data.type === 'sounds') {
      if (!data.epoch || data.epoch >= appliedEpoch) pendingSounds.push(new Float32Array(data.data));
    } else if (data.type === 'stats') {
      state = {
        ...state, ...data.perf, worldTick: data.worldTick ?? state.worldTick,
        worldTps: data.perf?.worldTps ?? state.worldTps,
        stepMs: data.perf?.stepMs ?? state.stepMs,
        controlsReceived: data.perf?.controlsReceived ?? state.controlsReceived,
        edgesProcessed: data.perf?.edgesProcessed ?? state.edgesProcessed,
        toolWrites: data.perf?.toolWrites ?? state.toolWrites,
      };
    } else if (data.type === 'error') {
      handleError(new Error(data.message || 'simulation worker failed'));
    }
  };

  const worldPoint = () => {
    const e = ctx.engine;
    if (!e) return { worldX: 0, worldY: 0 };
    const aim = e.getAim();
    return { worldX: e.getWorldOffsetX() + aim.x, worldY: e.getWorldOffsetY() + aim.y };
  };

  const rebasePresentation = (oldOffsetX, oldOffsetY, newOffsetX, newOffsetY) => {
    const dx = oldOffsetX - newOffsetX, dy = oldOffsetY - newOffsetY;
    if (!dx && !dy) return;
    const mapped = mapActorPacketToOffset({
      worldOffsetX: oldOffsetX, worldOffsetY: oldOffsetY,
      players, mineTarget,
    }, newOffsetX, newOffsetY);
    players = mapped.players || [];
    mineTarget = mapped.mineTarget || null;
    translatePackedPositions(items, STRIDES.itemSnapshot,
      OFF.itemSnapshot.x, OFF.itemSnapshot.y, dx, dy);
    translatePackedPositions(projectiles, STRIDES.projectileSnapshot,
      OFF.projectileSnapshot.x, OFF.projectileSnapshot.y, dx, dy);
    if (predictor && predictorEngine === ctx.engine) predictor.rebase(dx, dy);
  };

  const api = {
    init({ survival = false, creativeKind = 0, creativeValue = 0, tool = 0, creatureNaturalSpawning = false } = {}) {
      initOptions = { survival, creativeKind, creativeValue, tool, creatureNaturalSpawning };
      worker.postMessage({
        type: 'init', cols: ctx.cols, rows: ctx.rows, worldSeed: ctx.worldSeed,
        survival, drawMode: ctx.drawModeOn, tool, creativeKind, creativeValue, creatureNaturalSpawning,
      });
    },
    updateControl() {
      const e = ctx.engine;
      // The worker intentionally ignores every message except init until its
      // engine exists. Do not cache a control signature that was sent during
      // that startup window, or the stable first viewport may never be resent.
      if (!e || !state.ready) return;
      // fit() resizes the render mirror immediately but deliberately debounces
      // the expensive worker resize. Pointer/world coordinates must keep flowing
      // during that window so drawing follows a moving camera; only STREAMING is
      // suspended until the worker owns the new buffer dimensions.
      const resizePending = !!awaitingResizeId;
      const p = worldPoint();
      const cam = e.getCam();
      const message = {
        type: 'control', ...p, buttons: ctx.mouseButtons, inside: ctx.inside,
        drawMode: ctx.drawModeOn,
        camWorldX: e.getWorldOffsetX() + cam.x,
        camWorldY: e.getWorldOffsetY() + cam.y,
        viewCols: ctx.viewCols, viewRows: ctx.viewRows,
        suspendStreaming: resizePending,
      };
      const signature = Object.values(message).join('|');
      if (signature === lastControl) return;
      lastControl = signature;
      state = {
        ...state,
        resizePending,
        resizeControlsSent: (state.resizeControlsSent || 0) + (resizePending ? 1 : 0),
        controlWorldX: p.worldX,
        controlWorldY: p.worldY,
      };
      worker.postMessage(message);
    },
    edge(kind, button) {
      worker.postMessage({
        type: 'edge', kind, button: button | 0, buttons: ctx.mouseButtons | 0,
        inside: ctx.inside, drawMode: ctx.drawModeOn, ...worldPoint(),
      });
    },
    sendInput(input, seq) {
      const e = ctx.engine;
      if (!e) return;
      const normalized = {
        ...input, seq: seq >>> 0,
        worldAimX: e.getWorldOffsetX() + (input.aimX | 0),
        worldAimY: e.getWorldOffsetY() + (input.aimY | 0),
      };
      worker.postMessage({ type: 'input', input: normalized });
      if (predictor && predictorEngine === e) predictor.predict(seq >>> 0, input);
    },
    intent(intent, fields = {}) { worker.postMessage({ type: 'intent', intent, ...fields }); },
    testPaintDisc(material, localX, localY, radius) {
      const e = ctx.engine;
      if (!e) return;
      worker.postMessage({
        type: 'test-paint-disc', material: material | 0, radius: radius | 0,
        worldX: e.getWorldOffsetX() + (localX | 0), worldY: e.getWorldOffsetY() + (localY | 0),
      });
    },
    testSeedReaction(material, cap = 600, phase = 0) {
      worker.postMessage({ type: 'test-seed-reaction', material: material | 0, cap: cap | 0, phase: phase | 0 });
    },
    testCreatureRuntime(simulate, naturalSpawn = false) {
      worker.postMessage({ type: 'test-creature-runtime', simulate: !!simulate, naturalSpawn: !!naturalSpawn });
    },
    testNaturalSpawn(species, salt = 0, forceBreach = false) {
      worker.postMessage({
        type: 'test-natural-spawn', species: species | 0, salt: salt | 0,
        forceBreach: !!forceBreach,
      });
    },
    config(config) { worker.postMessage({ type: 'config', ...config }); },
    resize(cols, rows, worldCenter) {
      pending = null;
      lastControl = '';
      awaitingResizeId = ++resizeId;
      state = { ...state, resizePending: true };
      clearTimeout(resizeTimer);
      // Key repeat/mobile taps otherwise queue every huge intermediate resize in
      // the worker. Send only the settled zoom size.
      resizeTimer = setTimeout(() => {
        resizeTimer = 0;
        worker.postMessage({
          type: 'resize', cols: cols | 0, rows: rows | 0, resizeId: awaitingResizeId,
          worldCenterX: worldCenter?.x, worldCenterY: worldCenter?.y,
        });
      }, 150);
    },
    applyPending() {
      let changed = false;
      if (pending && ctx.engine) {
        const packet = pending;
        pending = null;
        const bytes = new Uint8Array(packet.data);
        const applyStarted = performance.now();
        if (packet.type === 'full') {
          const cam = ctx.engine.getCam();
          const oldOffsetX = ctx.engine.getWorldOffsetX();
          const oldOffsetY = ctx.engine.getWorldOffsetY();
          const worldCamX = oldOffsetX + cam.x;
          const worldCamY = oldOffsetY + cam.y;
          const containsView = worldCamX >= packet.worldOffsetX && worldCamY >= packet.worldOffsetY &&
            worldCamX + ctx.viewCols <= packet.worldOffsetX + packet.cols &&
            worldCamY + ctx.viewRows <= packet.worldOffsetY + packet.rows;
          // A fast camera move can overtake one already-posted stream snapshot.
          // Applying a window that no longer contains the visible view would
          // clamp the camera and permanently lose its world center. Ack it and
          // let the worker's next turn stream around the latest control instead.
          if (packet.reason === 'stream' && !containsView) {
            state = { ...state, droppedStaleStreams: (state.droppedStaleStreams || 0) + 1 };
          } else {
            ctx.engine.applyWorldMirror(bytes, packet.worldOffsetX, packet.worldOffsetY);
            ctx.engine.cameraSet(worldCamX - packet.worldOffsetX, worldCamY - packet.worldOffsetY);
            ctx.engine.setMirrorWorldTick(packet.worldTick);
            rebasePresentation(oldOffsetX, oldOffsetY, packet.worldOffsetX, packet.worldOffsetY);
            appliedEpoch = packet.epoch | 0;
            ctx.forceFullRender = true;
            changed = true;
          }
        } else if ((packet.epoch | 0) === appliedEpoch) {
          ctx.engine.applyDiffMirror(bytes);
          ctx.engine.setMirrorWorldTick(packet.worldTick);
          changed = true;
        } else {
          state = { ...state, droppedWrongEpochDiffs: (state.droppedWrongEpochDiffs || 0) + 1 };
        }
        worker.postMessage({ type: 'ack', epoch: packet.epoch, sequence: packet.sequence });
        state = {
          ...state, epoch: appliedEpoch,
          mirrorApplyMs: performance.now() - applyStarted, packetBytes: bytes.length,
        };
      }
      // Draft indices do not carry enough information to translate across
      // frames, so apply only after their matching full world is installed.
      if (pendingDraft && (!pendingDraft.epoch || pendingDraft.epoch <= appliedEpoch)) {
        if (!pendingDraft.epoch || pendingDraft.epoch === appliedEpoch) {
          const cells = new Int32Array(pendingDraft.data);
          ctx.engine?.setMirrorDraft(cells, pendingDraft.material);
          ctx.previewDirty = true;
          changed = true;
        }
        pendingDraft = null;
      }
      if (pendingCreatures && ctx.engine) {
        if (!pendingCreatures.epoch || pendingCreatures.epoch >= appliedEpoch) {
          ctx.engine.setMirrorCreatures(
            new Float32Array(pendingCreatures.data),
            pendingCreatures.worldOffsetX, pendingCreatures.worldOffsetY,
          );
          changed = true;
        }
        pendingCreatures = null;
      }
      if (pendingActors && ctx.engine) {
        const rawPacket = pendingActors;
        pendingActors = null;
        if (rawPacket.epoch && rawPacket.epoch < appliedEpoch) return changed;
        const packet = mapActorPacketToOffset(
          rawPacket, ctx.engine.getWorldOffsetX(), ctx.engine.getWorldOffsetY(),
        );
        authoritativePlayerId = packet.localPlayerId | 0;
        players = packet.players || [];
        const own = players.find((p) => p.id === authoritativePlayerId) || null;
        if (own?.alive !== false) {
          if (!predictor || predictorEngine !== ctx.engine) {
            if (!predictorPlayerId || predictorEngine !== ctx.engine) predictorPlayerId = ctx.engine.spawnPlayer(own.x, own.y);
            predictor = new Predictor(ctx.engine, predictorPlayerId);
            predictorEngine = ctx.engine;
          }
          predictor.reconcile(own, packet.ackSeq >>> 0, packet.actorTick | 0);
          ctx.localPlayerId = authoritativePlayerId;
        } else if (own) {
          predictor = null;
          ctx.localPlayerId = authoritativePlayerId;
        }
        if (packet.inventory !== undefined) { inventory = packet.inventory; inventoryDirty = true; }
        if (packet.cursor !== undefined) cursor = packet.cursor;
        if (packet.items !== undefined) {
          const O = OFF.itemSnapshot;
          items = new Float32Array(packet.items.length * STRIDES.itemSnapshot);
          for (let i = 0; i < packet.items.length; i++) {
            const item = packet.items[i], o = i * STRIDES.itemSnapshot;
            items[o + O.id] = item.id; items[o + O.kind] = item.kind; items[o + O.material] = item.material;
            items[o + O.count] = item.count; items[o + O.x] = item.x; items[o + O.y] = item.y;
            items[o + O.life] = item.life; items[o + O.plantType] = item.plantType || 0;
            items[o + O.itemKind] = item.itemKind || 0; items[o + O.isTool] = item.isTool ? 1 : 0;
            items[o + O.toolClass] = item.toolClass || 0; items[o + O.toolTier] = item.toolTier || 0;
          }
        }
        if (packet.projectiles !== undefined) {
          const O = OFF.projectileSnapshot;
          projectiles = new Float32Array(packet.projectiles.length * STRIDES.projectileSnapshot);
          for (let i = 0; i < packet.projectiles.length; i++) {
            const projectile = packet.projectiles[i], o = i * STRIDES.projectileSnapshot;
            projectiles[o + O.id] = projectile.id; projectiles[o + O.owner] = projectile.owner;
            projectiles[o + O.x] = projectile.x; projectiles[o + O.y] = projectile.y;
            projectiles[o + O.vx] = projectile.vx; projectiles[o + O.vy] = projectile.vy;
            projectiles[o + O.charge] = projectile.charge; projectiles[o + O.kind] = projectile.kind ?? 0;
            projectiles[o + O.fuse] = projectile.fuse ?? 0; projectiles[o + O.rotation] = projectile.rotation ?? 0;
          }
        }
        mineProgress = packet.mineProgress || 0;
        mineTarget = packet.mineTarget || null;
        actionCount = packet.actionCount | 0;
        state = { ...state, actorTick: packet.actorTick | 0 };
        changed = true;
      }
      return changed;
    },
    destroy() {
      clearTimeout(resizeTimer);
      try { worker.postMessage({ type: 'destroy' }); }
      catch { worker.terminate(); return; }
      // Give the worker time to tear down cleanly. Forced termination is a last
      // resort for a crashed/unresponsive worker, not the normal path.
      destroyTimer = setTimeout(() => worker.terminate(), 1500);
    },
    get state() { return state; },
    getOwnPlayer() {
      const own = players.find((p) => p.id === authoritativePlayerId) || null;
      const predicted = own?.alive === false ? null : predictor?.renderState();
      return mergePlayerPrediction(own, predicted, authoritativePlayerId);
    },
    getPlayersForRender() {
      const own = this.getOwnPlayer();
      return players.filter((p) => p.active !== false).map((p) => p.id === authoritativePlayerId && own ? own : p);
    },
    advancePresentation() { predictor?.advanceRenderSmoothing(); },
    getItemsForRender() { return items; },
    getProjectilesForRender() { return projectiles; },
    getInventory() { return inventory; },
    getCursor() { return cursor; },
    consumeInventoryDirty() { const dirty = inventoryDirty; inventoryDirty = false; return dirty; },
    getMineProgress() { return mineProgress; },
    getMineTarget() { return mineTarget; },
    getActionCount() { return actionCount; },
    consumeSoundEvents() {
      if (!pendingSounds.length) return new Float32Array(0);
      if (pendingSounds.length === 1) return pendingSounds.shift();
      let length = 0;
      for (const batch of pendingSounds) length += batch.length;
      const joined = new Float32Array(length);
      let offset = 0;
      for (const batch of pendingSounds) { joined.set(batch, offset); offset += batch.length; }
      pendingSounds = [];
      return joined;
    },
    get ownPlayerId() { return authoritativePlayerId; },
    retry() {
      retryCount = 0;
      ctx.setAuthorityError?.(null);
      restartWorker();
    },
  };
  const handleError = (event) => {
    clearTimeout(destroyTimer);
    console.error('sand world worker failed', event.message || event);
    worker.terminate();
    if (!state.ready && retryCount === 0) {
      retryCount++;
      restartWorker();
      return;
    }
    ctx.setAuthorityError?.('The simulation worker could not continue.');
  };
  const bindWorker = () => {
    worker.onmessage = handleMessage;
    worker.onerror = handleError;
  };
  const restartWorker = () => {
    try { worker.terminate(); } catch { /* already stopped */ }
    if (predictorEngine && predictorPlayerId) {
      try { predictorEngine.removePlayer(predictorPlayerId); } catch { /* mirror was rebuilt */ }
    }
    pending = pendingDraft = pendingCreatures = pendingActors = null;
    pendingSounds = [];
    predictor = predictorEngine = null;
    predictorPlayerId = authoritativePlayerId = 0;
    appliedEpoch = 0;
    players = []; inventory = cursor = null; items = new Float32Array(0); projectiles = new Float32Array(0);
    inventoryDirty = false; mineProgress = 0; mineTarget = null; actionCount = 0;
    ctx.localPlayerId = 0;
    worker = new WorldWorker();
    state = {
      ready: false, worldTick: 0, worldTps: 0, stepMs: 0, epoch: 0, sequence: 0,
      resizePending: false, resizeControlsSent: 0, controlWorldX: 0, controlWorldY: 0,
    };
    bindWorker();
    if (initOptions) worker.postMessage({
      type: 'init', cols: ctx.cols, rows: ctx.rows, worldSeed: ctx.worldSeed,
      ...initOptions, drawMode: ctx.drawModeOn,
    });
  };
  bindWorker();
  return api;
}
