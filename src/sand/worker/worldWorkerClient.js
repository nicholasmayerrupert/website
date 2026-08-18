import WorldWorker from './worldWorkerConstructor.js';
import { Predictor } from '../net/predict.js';
import { OFF, STRIDES } from '../wasmBridge/abi.generated.js';
import { packRecords } from '../wasmBridge/recordCodec.js';
import { mergePlayerPrediction } from './playerPresentation.js';
import { mapActorPacketToOffset, translatePackedPositions } from '../net/localCoordinates.js';
import { prepareMirrorShift } from './mirrorShift.js';
import { createWorkerLivenessMonitor } from './workerLiveness.js';

const REPLAYABLE_CONFIG_KEYS = [
  'tool', 'drawMode', 'creativeKind', 'creativeValue',
  'creatureNaturalSpawning', 'paused', 'artificialDelayMs',
];
const LIVENESS_PROBE_MS = 1000;

/** @param {import('../game/runtimeContext.js').SandRuntimeContext} ctx */
export function createWorldWorkerClient(ctx) {
  let worker = new WorldWorker();
  let initOptions = null;
  const runtimeConfig = {};
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
  let livenessTimer = 0;
  let livenessProbePending = false;
  let failNextMirrorApply = false;
  let closed = false;
  let workerGeneration = 0;
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
  let mission = null;
  let missionSignature = '';
  let missionDirty = false;
  let appliedEpoch = 0;
  let replayRequestId = 0;
  const replayRequests = new Map();
  const liveness = createWorkerLivenessMonitor();
  let state = {
    ready: false, worldTick: 0, worldTps: 0, stepMs: 0, epoch: 0, sequence: 0,
    resizePending: false, resizeControlsSent: 0, controlWorldX: 0, controlWorldY: 0,
    liveness: liveness.snapshot(),
  };

  const post = (message) => {
    if (closed) return false;
    worker.postMessage(message);
    return true;
  };

  const rejectReplayRequests = (message) => {
    for (const request of replayRequests.values()) request.reject(new Error(message));
    replayRequests.clear();
  };

  const probeLiveness = () => {
    if (closed || livenessProbePending) return;
    livenessProbePending = post({ type: 'liveness-probe' });
  };

  const acknowledge = (packet) => {
    if (post({ type: 'ack', epoch: packet.epoch, sequence: packet.sequence }))
      liveness.noteAck();
  };

  const handleMessage = ({ data }) => {
    const receivedAt = performance.now();
    if (typeof data === 'number') {
      if (liveness.noteSignal(data, receivedAt)) livenessProbePending = false;
      return;
    }
    if (!data) return;
    liveness.noteMessage(receivedAt);
    if (data.type === 'replay-capsule') {
      const request = replayRequests.get(data.requestId);
      if (request) {
        replayRequests.delete(data.requestId);
        request.resolve(data.capsule);
      }
      return;
    }
    if (data.type === 'replay-progress') {
      replayRequests.get(data.requestId)?.onProgress?.(data.turn, data.turns);
      return;
    }
    if (data.type === 'replay-complete') {
      const request = replayRequests.get(data.requestId);
      if (request) {
        replayRequests.delete(data.requestId);
        request.resolve({
          matched: !!data.matched,
          expected: data.expected,
          actual: data.actual,
        });
      }
      return;
    }
    if (data.type === 'replay-error') {
      const request = replayRequests.get(data.requestId);
      if (request) {
        replayRequests.delete(data.requestId);
        request.reject(new Error(data.message || 'Replay failed.'));
      }
      return;
    }
    if (data.type === 'full' || data.type === 'shift' || data.type === 'diff') {
      liveness.notePacket(data.worldTick, receivedAt);
      if ((data.epoch | 0) < appliedEpoch) {
        acknowledge(data);
        return;
      }
      // Runtime zoom can emit many buffer sizes in quick succession. While the
      // worker is catching up, discard packets from its old-sized world; applying
      // them to the already-resized render mirror is both stale and expensive.
      if (awaitingResizeId &&
          (data.type !== 'full' || data.resizeId !== awaitingResizeId)) {
        acknowledge(data);
        return;
      }
      // Full and shift packets establish epochs. Never let a diff for a future
      // frame replace one before the browser has applied that coordinate frame.
      if (data.type === 'diff' && data.epoch !== appliedEpoch) {
        acknowledge(data);
        return;
      }
      const packetPriority = { diff: 0, shift: 1, full: 2 };
      if (!pending || data.epoch > pending.epoch ||
          (data.epoch === pending.epoch &&
           (packetPriority[data.type] > packetPriority[pending.type] ||
            (packetPriority[data.type] === packetPriority[pending.type] &&
             data.sequence >= pending.sequence)))) pending = data;
      state = {
        ...state, ...data.perf, ready: true, worldTick: data.worldTick || state.worldTick,
        worldTps: data.perf?.worldTps || state.worldTps,
        stepMs: data.perf?.stepMs || 0, epoch: data.epoch, sequence: data.sequence,
        resizePending: !!awaitingResizeId,
      };
    } else if (data.type === 'draft') {
      if (!data.epoch || data.epoch >= appliedEpoch) pendingDraft = data;
    } else if (data.type === 'creatures') {
      if (!data.epoch || data.epoch >= appliedEpoch) pendingCreatures = data;
    } else if (data.type === 'actors') {
      if (data.epoch && data.epoch < appliedEpoch) return;
      if (pendingActors?.epoch && data.epoch < pendingActors.epoch) return;
      // Actor poses are latest-wins, but sparse packet fields must survive if a
      // newer pose arrives before the next browser frame.
      const prior = pendingActors?.epoch === data.epoch ? pendingActors : null;
      pendingActors = {
        ...data,
        inventory: data.inventory !== undefined ? data.inventory : prior?.inventory,
        cursor: data.inventory !== undefined ? data.cursor : prior?.cursor,
        itemData: data.itemData !== undefined ? data.itemData : prior?.itemData,
        items: data.items !== undefined ? data.items : prior?.items,
        projectileData: data.projectileData !== undefined
          ? data.projectileData
          : prior?.projectileData,
        projectiles: data.projectiles !== undefined ? data.projectiles : prior?.projectiles,
        mission: data.mission !== undefined ? data.mission : prior?.mission,
      };
    } else if (data.type === 'sounds') {
      if (!data.epoch || data.epoch >= appliedEpoch) pendingSounds.push(new Float32Array(data.data));
    } else if (data.type === 'stats') {
      liveness.noteAuthorityTick(data.worldTick, receivedAt);
      state = {
        ...state, ...data.perf, worldTick: data.worldTick ?? state.worldTick,
        worldTps: data.perf?.worldTps ?? state.worldTps,
        stepMs: data.perf?.stepMs ?? state.stepMs,
        controlsReceived: data.perf?.controlsReceived ?? state.controlsReceived,
        edgesProcessed: data.perf?.edgesProcessed ?? state.edgesProcessed,
        toolWrites: data.perf?.toolWrites ?? state.toolWrites,
      };
    } else if (data.type === 'error') {
      liveness.noteFailure(receivedAt);
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
    init({
      survival = false,
      creativeKind = 0,
      creativeValue = 0,
      tool = 0,
      creatureNaturalSpawning = false,
      planetId = ctx.planetId,
      gravityScale = ctx.gravityScale,
      missionId = ctx.missionId,
      loadout = ctx.missionLoadout,
    } = {}) {
      if (closed) return;
      initOptions = {
        survival, creativeKind, creativeValue, tool, creatureNaturalSpawning,
        planetId, gravityScale, missionId, loadout,
        ...runtimeConfig,
      };
      post({
        type: 'init', cols: ctx.cols, rows: ctx.rows, worldSeed: ctx.worldSeed,
        ...initOptions, drawMode: ctx.drawModeOn,
      });
      probeLiveness();
    },
    updateControl() {
      const e = ctx.engine;
      // Controls require a live engine, unlike replayable config/resize messages
      // that the worker can queue during startup. Do not cache a signature from
      // this window, or the stable first viewport may never be resent.
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
      post(message);
    },
    edge(kind, button) {
      post({
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
      post({ type: 'input', input: normalized });
      if (predictor && predictorEngine === e) predictor.predict(seq >>> 0, input);
    },
    intent(intent, fields = {}) { post({ type: 'intent', intent, ...fields }); },
    testPaintDisc(material, localX, localY, radius) {
      const e = ctx.engine;
      if (!e) return;
      post({
        type: 'test-paint-disc', material: material | 0, radius: radius | 0,
        worldX: e.getWorldOffsetX() + (localX | 0), worldY: e.getWorldOffsetY() + (localY | 0),
      });
    },
    testSeedReaction(material, cap = 600, phase = 0) {
      post({ type: 'test-seed-reaction', material: material | 0, cap: cap | 0, phase: phase | 0 });
    },
    testCreatureRuntime(simulate, naturalSpawn = false) {
      post({ type: 'test-creature-runtime', simulate: !!simulate, naturalSpawn: !!naturalSpawn });
    },
    testNaturalSpawn(species, salt = 0, forceBreach = false) {
      post({
        type: 'test-natural-spawn', species: species | 0, salt: salt | 0,
        forceBreach: !!forceBreach,
      });
    },
    testStepActors(steps = 1) {
      post({ type: 'test-step-actors', steps: steps | 0 });
    },
    exportReplay(view) {
      if (closed) return Promise.reject(new Error('Simulation worker is closed.'));
      const requestId = ++replayRequestId;
      return new Promise((resolve, reject) => {
        replayRequests.set(requestId, { resolve, reject });
        if (!post({ type: 'replay-export', requestId, view })) {
          replayRequests.delete(requestId);
          reject(new Error('Simulation worker is unavailable.'));
        }
      });
    },
    runReplay(capsule, onProgress) {
      if (closed) return Promise.reject(new Error('Simulation worker is closed.'));
      if (!!capsule?.init?.survival !== ctx.survival)
        return Promise.reject(new Error('Open this replay in the matching creative or survival mode.'));
      const cols = capsule?.final?.cols | 0;
      const rows = capsule?.final?.rows | 0;
      if (!cols || !rows)
        return Promise.reject(new Error('Replay dimensions are missing.'));
      pending = null;
      pendingDraft = null;
      pendingCreatures = null;
      pendingActors = null;
      awaitingResizeId = 0;
      appliedEpoch = 0;
      lastControl = '';
      predictor = null;
      predictorEngine = null;
      predictorPlayerId = 0;
      authoritativePlayerId = 0;
      players = [];
      items = new Float32Array(0);
      projectiles = new Float32Array(0);
      ctx.worldSeed = capsule.init.worldSeed >>> 0;
      if (Number.isFinite(capsule.init.planetId)) ctx.planetId = capsule.init.planetId | 0;
      if (Number.isFinite(capsule.init.gravityScale)) ctx.gravityScale = capsule.init.gravityScale;
      ctx.fns.rebuildEngineForReplay?.(cols, rows);
      const requestId = ++replayRequestId;
      return new Promise((resolve, reject) => {
        replayRequests.set(requestId, { resolve, reject, onProgress });
        if (!post({ type: 'replay-run', requestId, capsule })) {
          replayRequests.delete(requestId);
          reject(new Error('Simulation worker is unavailable.'));
        }
      });
    },
    testFailNextMirrorApply() {
      failNextMirrorApply = true;
    },
    config(config) {
      for (const key of REPLAYABLE_CONFIG_KEYS) {
        if (config[key] !== undefined) runtimeConfig[key] = config[key];
      }
      if (initOptions) Object.assign(initOptions, runtimeConfig);
      post({ type: 'config', ...config });
    },
    resize(cols, rows, worldCenter) {
      if (closed) return;
      pending = null;
      lastControl = '';
      awaitingResizeId = ++resizeId;
      state = { ...state, resizePending: true };
      clearTimeout(resizeTimer);
      // Key repeat/mobile taps otherwise queue every huge intermediate resize in
      // the worker. Send only the settled zoom size.
      resizeTimer = setTimeout(() => {
        resizeTimer = 0;
        post({
          type: 'resize', cols: cols | 0, rows: rows | 0, resizeId: awaitingResizeId,
          worldCenterX: worldCenter?.x, worldCenterY: worldCenter?.y,
        });
      }, 150);
    },
    applyPending() {
      let changed = false;
      let appliedWorldTick = null;
      if (pending && ctx.engine) {
        const packet = pending;
        pending = null;
        const applyStarted = performance.now();
        const previousAppliedEpoch = appliedEpoch;
        const previousResizeId = awaitingResizeId;
        let packetBytes = 0;
        let mirrorFrame = null;
        let settled = false;
        const settle = (requestResync) => {
          if (!settled) {
            acknowledge(packet);
            settled = true;
          }
          if (requestResync)
            post({ type: 'resync', epoch: packet.epoch, sequence: packet.sequence });
        };
        try {
          if (failNextMirrorApply) {
            failNextMirrorApply = false;
            throw new Error('forced mirror packet failure');
          }
          const bytes = new Uint8Array(packet.data);
          packetBytes = bytes.length;
          let requestResync = false;
          if (packet.type === 'full' || packet.type === 'shift') {
            mirrorFrame = {
              cam: ctx.engine.getCam(),
              offsetX: ctx.engine.getWorldOffsetX(),
              offsetY: ctx.engine.getWorldOffsetY(),
            };
          }
        if (packet.type === 'full') {
          const { cam, offsetX: oldOffsetX, offsetY: oldOffsetY } = mirrorFrame;
          const worldCamX = Number.isFinite(packet.replayView?.cameraWorldX)
            ? packet.replayView.cameraWorldX
            : oldOffsetX + cam.x;
          const worldCamY = Number.isFinite(packet.replayView?.cameraWorldY)
            ? packet.replayView.cameraWorldY
            : oldOffsetY + cam.y;
          const containsView = worldCamX >= packet.worldOffsetX && worldCamY >= packet.worldOffsetY &&
            worldCamX + ctx.viewCols <= packet.worldOffsetX + packet.cols &&
            worldCamY + ctx.viewRows <= packet.worldOffsetY + packet.rows;
          // A fast camera move can overtake one already-posted stream snapshot.
          // Applying a window that no longer contains the visible view would
          // clamp the camera and permanently lose its world center. Ack it and
          // let the worker's next turn stream around the latest control instead.
          if ((packet.reason === 'stream' || packet.reason === 'resync') && !containsView) {
            state = { ...state, droppedStaleStreams: (state.droppedStaleStreams || 0) + 1 };
            requestResync = true;
          } else {
            const applied = ctx.engine.applyWorldMirror(
              bytes, packet.worldOffsetX, packet.worldOffsetY,
            );
            if (applied === false) {
              state = {
                ...state,
                rejectedWorldPackets: (state.rejectedWorldPackets || 0) + 1,
              };
              requestResync = true;
            } else {
              ctx.engine.cameraSet(worldCamX - packet.worldOffsetX, worldCamY - packet.worldOffsetY);
              ctx.engine.setMirrorWorldTick(packet.worldTick);
              appliedWorldTick = packet.worldTick;
              rebasePresentation(oldOffsetX, oldOffsetY, packet.worldOffsetX, packet.worldOffsetY);
              appliedEpoch = packet.epoch | 0;
              if (awaitingResizeId && packet.resizeId === awaitingResizeId) awaitingResizeId = 0;
              ctx.forceFullRender = true;
              changed = true;
            }
          }
        } else if (packet.type === 'shift') {
          const { cam, offsetX: oldOffsetX, offsetY: oldOffsetY } = mirrorFrame;
          const worldCamX = oldOffsetX + cam.x;
          const worldCamY = oldOffsetY + cam.y;
          const dx = packet.shiftDx | 0;
          const dy = packet.shiftDy | 0;
          const containsView = worldCamX >= packet.worldOffsetX && worldCamY >= packet.worldOffsetY &&
            worldCamX + ctx.viewCols <= packet.worldOffsetX + packet.cols &&
            worldCamY + ctx.viewRows <= packet.worldOffsetY + packet.rows;
          const validFrame = packet.cols === ctx.engine.cols && packet.rows === ctx.engine.rows &&
            packet.fromWorldOffsetX === oldOffsetX && packet.fromWorldOffsetY === oldOffsetY &&
            packet.worldOffsetX === oldOffsetX + dx && packet.worldOffsetY === oldOffsetY + dy &&
            Math.abs(dx) < packet.cols && Math.abs(dy) < packet.rows && (dx || dy);
          if (!validFrame || !containsView) {
            const key = validFrame ? 'droppedStaleStreams' : 'droppedMismatchedShifts';
            state = { ...state, [key]: (state[key] || 0) + 1 };
            requestResync = true;
          } else if (!prepareMirrorShift(ctx.engine, packet, bytes)) {
            state = {
              ...state,
              rejectedWorldPackets: (state.rejectedWorldPackets || 0) + 1,
            };
            requestResync = true;
          } else {
            const applied = ctx.engine.applyDiffMirror(
              bytes, packet.lightEditX0, packet.lightEditX1,
            );
            ctx.engine.cameraSet(worldCamX - packet.worldOffsetX, worldCamY - packet.worldOffsetY);
            rebasePresentation(oldOffsetX, oldOffsetY, packet.worldOffsetX, packet.worldOffsetY);
            if (applied === false) {
              state = {
                ...state,
                rejectedWorldPackets: (state.rejectedWorldPackets || 0) + 1,
              };
              requestResync = true;
              ctx.forceFullRender = true;
            } else {
              ctx.engine.setMirrorWorldTick(packet.worldTick);
              appliedWorldTick = packet.worldTick;
              appliedEpoch = packet.epoch | 0;
              state = {
                ...state,
                shiftPacketsApplied: (state.shiftPacketsApplied || 0) + 1,
                lastShiftPacketBytes: bytes.length,
              };
            }
            changed = true;
          }
        } else if ((packet.epoch | 0) === appliedEpoch) {
          const applied = ctx.engine.applyDiffMirror(
            bytes, packet.lightEditX0, packet.lightEditX1,
          );
          if (applied === false) {
            state = {
              ...state,
              rejectedWorldPackets: (state.rejectedWorldPackets || 0) + 1,
            };
            requestResync = true;
          } else {
            ctx.engine.setMirrorWorldTick(packet.worldTick);
            appliedWorldTick = packet.worldTick;
            changed = true;
          }
        } else {
          state = { ...state, droppedWrongEpochDiffs: (state.droppedWrongEpochDiffs || 0) + 1 };
        }
          settle(requestResync);
          state = {
            ...state, epoch: appliedEpoch,
            mirrorApplyMs: performance.now() - applyStarted, packetBytes,
            packetType: packet.type, resizePending: !!awaitingResizeId,
          };
          if (appliedWorldTick !== null)
            liveness.noteApplied(appliedWorldTick, performance.now());
        } catch (error) {
          // A mirror-side failure must release the authority's packet gate. The
          // next full snapshot replaces any partially applied local state.
          settle(true);
          if (mirrorFrame) {
            try {
              ctx.engine.setMirrorWorldOffset(mirrorFrame.offsetX, mirrorFrame.offsetY);
              ctx.engine.cameraSet(mirrorFrame.cam.x, mirrorFrame.cam.y);
            } catch (restoreError) {
              console.error('sand mirror frame restore failed', restoreError);
            }
          }
          appliedEpoch = previousAppliedEpoch;
          awaitingResizeId = previousResizeId;
          appliedWorldTick = null;
          changed = false;
          state = {
            ...state,
            mirrorApplyMs: performance.now() - applyStarted,
            packetBytes,
            packetType: packet.type,
            mirrorPacketErrors: (state.mirrorPacketErrors || 0) + 1,
            lastMirrorPacketError: error?.message || String(error),
            resizePending: !!awaitingResizeId,
          };
          console.error('sand world mirror packet failed', error);
        }
      }
      // Draft indices do not carry enough information to translate across
      // frames, so apply only after their matching coordinate frame is installed.
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
        const targetOffsetX = ctx.engine.getWorldOffsetX();
        const targetOffsetY = ctx.engine.getWorldOffsetY();
        const itemDx = (Number.isFinite(rawPacket.worldOffsetX) ? rawPacket.worldOffsetX : targetOffsetX) - targetOffsetX;
        const itemDy = (Number.isFinite(rawPacket.worldOffsetY) ? rawPacket.worldOffsetY : targetOffsetY) - targetOffsetY;
        const packet = mapActorPacketToOffset(
          rawPacket, targetOffsetX, targetOffsetY,
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
        if (packet.itemData !== undefined) {
          items = new Float32Array(packet.itemData);
          translatePackedPositions(items, STRIDES.itemSnapshot,
            OFF.itemSnapshot.x, OFF.itemSnapshot.y, itemDx, itemDy);
        } else if (packet.items !== undefined) {
          items = packRecords(packet.items, 'itemSnapshot', Float32Array);
        }
        if (packet.projectileData !== undefined) {
          projectiles = new Float32Array(packet.projectileData);
          translatePackedPositions(projectiles, STRIDES.projectileSnapshot,
            OFF.projectileSnapshot.x, OFF.projectileSnapshot.y, itemDx, itemDy);
        } else if (packet.projectiles !== undefined) {
          projectiles = packRecords(packet.projectiles, 'projectileSnapshot', Float32Array);
        }
        mineProgress = packet.mineProgress || 0;
        mineTarget = packet.mineTarget || null;
        actionCount = packet.actionCount | 0;
        if (packet.mission !== undefined) {
          mission = packet.mission;
          const signature = mission
            ? `${mission.revision}:${mission.phase}:${mission.threatLevel}:` +
              `${Math.floor((mission.elapsedTicks || 0) / 60)}:` +
              mission.objectives.map((objective) =>
                `${objective.id},${objective.state},${objective.current},${objective.worldX},${objective.worldY}`,
              ).join('|')
            : '';
          if (signature !== missionSignature) {
            missionSignature = signature;
            missionDirty = true;
          }
        }
        state = { ...state, actorTick: packet.actorTick | 0 };
        changed = true;
      }
      return changed;
    },
    destroy() {
      if (closed) return;
      closed = true;
      rejectReplayRequests('Simulation worker was closed.');
      clearTimeout(resizeTimer);
      resizeTimer = 0;
      clearInterval(livenessTimer);
      livenessTimer = 0;
      workerGeneration++;
      const target = worker;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(destroyTimer);
        destroyTimer = 0;
        target.onmessage = null;
        target.onerror = null;
        target.onmessageerror = null;
        target.terminate();
      };
      target.onmessage = ({ data }) => { if (data?.type === 'destroyed') finish(); };
      target.onerror = finish;
      // Give the worker time to tear down cleanly. Forced termination is a last
      // resort for a crashed/unresponsive worker, not the normal path.
      destroyTimer = setTimeout(finish, 1500);
      try { target.postMessage({ type: 'destroy' }); }
      catch { finish(); return; }
    },
    get state() {
      state.liveness = liveness.snapshot();
      return state;
    },
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
    getMission() { return mission; },
    consumeMissionDirty() {
      const dirty = missionDirty;
      missionDirty = false;
      return dirty;
    },
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
      if (closed) return;
      retryCount = 0;
      ctx.setAuthorityError?.(null);
      restartWorker();
    },
  };
  const handleError = (event) => {
    if (closed) return;
    rejectReplayRequests('Simulation worker failed during replay.');
    liveness.noteFailure();
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
    const target = worker;
    const generation = workerGeneration;
    target.onmessage = (event) => {
      if (closed || target !== worker || generation !== workerGeneration) return;
      handleMessage(event);
    };
    target.onerror = (event) => {
      if (closed || target !== worker || generation !== workerGeneration) return;
      handleError(event);
    };
    target.onmessageerror = (event) => {
      if (closed || target !== worker || generation !== workerGeneration) return;
      handleError(event);
    };
  };
  const restartWorker = () => {
    if (closed) return;
    clearTimeout(resizeTimer);
    resizeTimer = 0;
    awaitingResizeId = 0;
    lastControl = '';
    const previous = worker;
    workerGeneration++;
    previous.onmessage = null;
    previous.onerror = null;
    previous.onmessageerror = null;
    try { previous.terminate(); } catch { /* already stopped */ }
    if (predictorEngine && predictorPlayerId) {
      try { predictorEngine.removePlayer(predictorPlayerId); } catch { /* mirror was rebuilt */ }
    }
    pending = pendingDraft = pendingCreatures = pendingActors = null;
    pendingSounds = [];
    predictor = predictorEngine = null;
    predictorPlayerId = authoritativePlayerId = 0;
    appliedEpoch = 0;
    players = []; inventory = cursor = mission = null;
    missionSignature = ''; missionDirty = false;
    items = new Float32Array(0); projectiles = new Float32Array(0);
    inventoryDirty = false; mineProgress = 0; mineTarget = null; actionCount = 0;
    ctx.localPlayerId = 0;
    liveness.reset();
    livenessProbePending = false;
    worker = new WorldWorker();
    state = {
      ready: false, worldTick: 0, worldTps: 0, stepMs: 0, epoch: 0, sequence: 0,
      resizePending: false, resizeControlsSent: 0, controlWorldX: 0, controlWorldY: 0,
      liveness: liveness.snapshot(),
    };
    bindWorker();
    if (initOptions) post({
      type: 'init', cols: ctx.cols, rows: ctx.rows, worldSeed: ctx.worldSeed,
      ...initOptions, drawMode: ctx.drawModeOn,
    });
    probeLiveness();
  };
  bindWorker();
  livenessTimer = setInterval(probeLiveness, LIVENESS_PROBE_MS);
  return api;
}
