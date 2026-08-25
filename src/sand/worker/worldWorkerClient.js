import WorldWorker from './worldWorkerConstructor.js';
import { Predictor } from '../net/predict.js';
import { OFF, STRIDES } from '../wasmBridge/abi.generated.js';
import { packRecords } from '../wasmBridge/recordCodec.js';
import { mergePlayerPrediction } from './playerPresentation.js';
import { mapActorPacketToOffset, translatePackedPositions } from '../net/localCoordinates.js';
import { prepareMirrorShift } from './mirrorShift.js';
import { createWorkerLivenessMonitor } from './workerLiveness.js';
import { createReplayCaptureJournal } from './replayCaptureJournal.js';
import { REPLAY_EVENT_TYPES } from '../game/replayCapsule.js';
import {
  DEFAULT_WEATHER_ID,
  resolveWeatherIdForPlanet,
} from '../game/weather.js';

const REPLAYABLE_CONFIG_KEYS = [
  'tool', 'drawMode', 'creativeKind', 'creativeValue',
  'creatureNaturalSpawning', 'paused', 'artificialDelayMs',
];
const LIVENESS_PROBE_MS = 1000;
const CAPTURE_PERF_KEYS = [
  'worldTps', 'stepMs', 'actorMs', 'groundingMs', 'crossLayerGroundingMs',
  'componentIndexMs', 'assemblyUnionMs', 'carryMs', 'bodyMs', 'sandMs',
  'liquidMs', 'gasMs', 'reactMs', 'tailMs', 'layersMs', 'crossMs',
  'lightMs', 'fillMs', 'uploadMs', 'liquidRelaxMs', 'liquidSurfaceMs',
  'shiftSave', 'shiftBuffers', 'shiftTranslate', 'shiftRegister', 'shiftFill',
  'forcePrepareMs', 'forceWakeMs',
  'dirtyChunks', 'dirtyRows', 'dirtyCells', 'componentCount',
  'componentCellCount', 'crossBondCount', 'wasmHeapBytes',
  'controlsReceived', 'edgesProcessed', 'toolWrites',
];

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
  let pendingReplayView = null;
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
  let replayMicroscopeOpen = false;
  let replayBufferOpen = false;
  let pendingReplayFrameTurn = null;
  const replayJournal = createReplayCaptureJournal();
  const liveness = createWorkerLivenessMonitor();
  let state = {
    ready: false, worldTick: 0, worldTps: 0, stepMs: 0, epoch: 0, sequence: 0,
    resizePending: false, resizeControlsSent: 0, controlWorldX: 0, controlWorldY: 0,
    liveness: liveness.snapshot(),
  };

  const post = (message) => {
    if (closed) return false;
    if ((replayMicroscopeOpen || replayBufferOpen)
        && REPLAY_EVENT_TYPES.has(message.type)) return true;
    worker.postMessage(message);
    return true;
  };
  const isBufferedReplayFrame = (packet) => replayBufferOpen
    && Number.isInteger(packet?.replayFrameTurn);

  const rejectReplayRequests = (message) => {
    for (const request of replayRequests.values()) request.reject(new Error(message));
    replayRequests.clear();
    pendingReplayView = null;
    pendingReplayFrameTurn = null;
    replayBufferOpen = false;
    state = { ...state, replayPlaying: false, replayMode: '', replayBuffering: false };
  };

  const settleMicroscopeRequest = (requestId) => {
    const request = replayRequests.get(requestId);
    if (!request?.frame || !request.mirrorApplied) return;
    replayRequests.delete(requestId);
    request.resolve(request.frame);
  };

  const settleReplayResumeRequest = (requestId) => {
    const request = replayRequests.get(requestId);
    if (!request?.ready || !request.mirrorApplied) return;
    replayRequests.delete(requestId);
    replayBufferOpen = false;
    state = {
      ...state,
      replayPlaying: false,
      replayMode: '',
      replayBuffering: false,
      replayPaused: false,
    };
    post({ type: 'replay-buffer-resume-applied', requestId });
    request.resolve({ turn: request.turn });
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
    if (data.type === 'replay-journal-reset') {
      replayJournal.reset(data.init);
      state = { ...state, replayTurns: 0, replayJournalTruncated: false };
      return;
    }
    if (data.type === 'replay-journal-event') {
      replayJournal.noteEvent(data);
      state = {
        ...state,
        replayTurns: replayJournal.turns,
        replayJournalTruncated: replayJournal.truncated,
        replayJournalDiscontinuous: replayJournal.discontinuous,
      };
      return;
    }
    if (data.type === 'replay-journal-abort-turn') {
      replayJournal.abortTurn();
      state = {
        ...state,
        replayTurns: replayJournal.turns,
        replayJournalTruncated: replayJournal.truncated,
        replayJournalDiscontinuous: replayJournal.discontinuous,
      };
      return;
    }
    if (data.type === 'replay-journal-turn') {
      replayJournal.noteTurn(data);
      if (Number.isSafeInteger(data.liveness))
        liveness.noteSignal(data.liveness, receivedAt);
      state = {
        ...state,
        replayTurns: replayJournal.turns,
        replayJournalTruncated: replayJournal.truncated,
        replayJournalDiscontinuous: replayJournal.discontinuous,
      };
      return;
    }
    if (data.type === 'replay-capsule') {
      const request = replayRequests.get(data.requestId);
      if (request) {
        replayRequests.delete(data.requestId);
        request.resolve(data.capsule);
      }
      return;
    }
    if (data.type === 'replay-buffer-started') {
      const request = replayRequests.get(data.requestId);
      if (request?.kind === 'buffer-start') {
        replayRequests.delete(data.requestId);
        request.resolve({ turns: Math.max(0, data.turns | 0) });
      }
      return;
    }
    if (data.type === 'replay-buffer-status') {
      const cachedRanges = Array.isArray(data.cachedRanges)
        ? data.cachedRanges
          .filter((range) => Array.isArray(range) && range.length === 2)
          .map((range) => [Math.max(0, range[0] | 0), Math.max(0, range[1] | 0)])
        : [];
      state = {
        ...state,
        replayPlaying: true,
        replayMode: 'buffered',
        replayTurn: Math.max(0, data.turn | 0),
        replayTurns: Math.max(0, data.turns | 0),
        replayBufferedTurn: Math.max(0, data.bufferedTurn | 0),
        replayBuildTurn: Math.max(0, data.buildTurn | 0),
        replaySeekTarget: Number.isInteger(data.seekTarget)
          ? Math.max(0, data.seekTarget | 0) : null,
        replayCachedRanges: cachedRanges,
        replayPaused: !data.playing,
        replayBuffering: !!data.buffering,
        replayBufferComplete: !!data.complete,
        replayBufferLimitReached: !!data.limitReached,
        replayMatched: data.matched,
        replayBufferBytes: Math.max(0, Number(data.bufferBytes) || 0),
        replayBufferError: '',
      };
      return;
    }
    if (data.type === 'replay-buffer-frame-ready') {
      pendingReplayFrameTurn = Math.max(0, data.turn | 0);
      pendingReplayView = data.view || pendingReplayView;
      return;
    }
    if (data.type === 'replay-buffer-resume-progress') {
      replayRequests.get(data.requestId)?.onProgress?.(data.turn, data.turns);
      state = {
        ...state,
        replayResumeTurn: Math.max(0, data.turn | 0),
        replayResumeTurns: Math.max(0, data.turns | 0),
      };
      return;
    }
    if (data.type === 'replay-buffer-resume-ready') {
      const request = replayRequests.get(data.requestId);
      if (request?.kind === 'buffer-resume') {
        request.ready = true;
        request.turn = Math.max(0, data.turn | 0);
        settleReplayResumeRequest(data.requestId);
      }
      return;
    }
    if (data.type === 'replay-branch') {
      replayJournal.replace(data.capsule);
      return;
    }
    if (data.type === 'replay-progress') {
      if (data.view && typeof data.view === 'object') pendingReplayView = data.view;
      state = {
        ...state,
        replayTurn: Math.max(0, data.turn | 0),
        replayTurns: Math.max(0, data.turns | 0),
      };
      replayRequests.get(data.requestId)?.onProgress?.(data.turn, data.turns);
      return;
    }
    if (data.type === 'replay-complete') {
      const request = replayRequests.get(data.requestId);
      if (request) {
        replayRequests.delete(data.requestId);
        if (request.kind === 'run') lastControl = '';
        if (request.capsule) replayJournal.replace(request.capsule);
        state = { ...state, replayPlaying: false };
        request.resolve({
          matched: !!data.matched,
          expected: data.expected,
          actual: data.actual,
        });
      }
      return;
    }
    if (data.type === 'replay-microscope-frame') {
      const request = replayRequests.get(data.requestId);
      if (request?.kind === 'microscope') {
        request.frame = data.diagnostics;
        settleMicroscopeRequest(data.requestId);
      }
      return;
    }
    if (data.type === 'replay-error') {
      const request = replayRequests.get(data.requestId);
      if (request) {
        replayRequests.delete(data.requestId);
        if (request.kind === 'run') lastControl = '';
        if (request.kind === 'buffer-start' || request.kind === 'buffer-resume')
          replayBufferOpen = false;
        state = {
          ...state,
          replayPlaying: false,
          replayMode: '',
          replayBuffering: false,
        };
        request.reject(new Error(data.message || 'Replay failed.'));
      } else if (replayBufferOpen) {
        state = {
          ...state,
          replayPaused: true,
          replayBuffering: false,
          replayBufferError: data.message || 'Replay buffering failed.',
        };
      }
      return;
    }
    if (data.type === 'full' || data.type === 'shift' || data.type === 'diff') {
      const bufferedReplayFrame = isBufferedReplayFrame(data);
      if (data.replayView && typeof data.replayView === 'object')
        pendingReplayView = data.replayView;
      liveness.notePacket(data.worldTick, receivedAt);
      const resumeSnapshot = Number.isInteger(data.replayResumeRequestId);
      if (!bufferedReplayFrame && !resumeSnapshot && (data.epoch | 0) < appliedEpoch) {
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
      if (resumeSnapshot || bufferedReplayFrame || !pending || data.epoch > pending.epoch ||
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
      if (isBufferedReplayFrame(data) || !data.epoch || data.epoch >= appliedEpoch)
        pendingDraft = data;
    } else if (data.type === 'creatures') {
      if (isBufferedReplayFrame(data) || !data.epoch || data.epoch >= appliedEpoch)
        pendingCreatures = data;
    } else if (data.type === 'actors') {
      const bufferedReplayFrame = isBufferedReplayFrame(data);
      if (!bufferedReplayFrame && data.epoch && data.epoch < appliedEpoch) return;
      if (!bufferedReplayFrame && pendingActors?.epoch
          && data.epoch < pendingActors.epoch) return;
      // Actor poses are latest-wins, but sparse packet fields must survive if a
      // newer pose arrives before the next browser frame.
      const prior = !bufferedReplayFrame && pendingActors?.epoch === data.epoch
        ? pendingActors : null;
      pendingActors = {
        ...data,
        inventory: data.inventory !== undefined ? data.inventory : prior?.inventory,
        cursor: data.cursor !== undefined ? data.cursor : prior?.cursor,
        itemData: data.itemData !== undefined ? data.itemData : prior?.itemData,
        items: data.items !== undefined ? data.items : prior?.items,
        projectileData: data.projectileData !== undefined
          ? data.projectileData
          : prior?.projectileData,
        projectiles: data.projectiles !== undefined ? data.projectiles : prior?.projectiles,
        mission: data.mission !== undefined ? data.mission : prior?.mission,
      };
    } else if (data.type === 'sounds') {
      if (!data.epoch || data.epoch >= appliedEpoch) {
        if (typeof document === 'undefined' || !document.hidden) {
          pendingSounds.push(new Float32Array(data.data));
          if (pendingSounds.length > 32) pendingSounds.splice(0, pendingSounds.length - 32);
        }
      }
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

  const mirrorFinalState = () => {
    const engine = ctx.engine;
    let mirrorPerf = {};
    try { mirrorPerf = engine?.getPerf?.() || {}; } catch { /* diagnostics stay best-effort */ }
    const read = (operation, fallback = 0) => {
      try { return operation(); } catch { return fallback; }
    };
    const cols = Math.max(1, (engine?.cols || ctx.cols || 1) | 0);
    const rows = Math.max(1, (engine?.rows || ctx.rows || 1) | 0);
    return {
      tick: Math.max(0, read(() => engine.getTick(), state.worldTick) | 0),
      actorTick: Math.max(0, state.actorTick | 0),
      cols,
      rows,
      gridHash: read(() => engine.gridHash(), 0) >>> 0,
      worldOffsetX: read(() => engine.getWorldOffsetX(), 0) | 0,
      worldOffsetY: read(() => engine.getWorldOffsetY(), 0) | 0,
      componentCount: state.componentCount || mirrorPerf.componentCount || 0,
      componentCellCount: state.componentCellCount || mirrorPerf.componentCellCount || 0,
      crossBondCount: state.crossBondCount || mirrorPerf.crossBondCount || 0,
      playerCount: players.length,
      itemCount: Math.floor(items.length / STRIDES.itemSnapshot),
      creatureCount: state.creatureCount || 0,
      projectileCount: Math.floor(projectiles.length / STRIDES.projectileSnapshot),
    };
  };

  const captureDiagnostics = (authorityResponded, mirror) => {
    const perf = {};
    for (const key of CAPTURE_PERF_KEYS) {
      const value = state[key];
      if (typeof value === 'number' && Number.isFinite(value)) perf[key] = value;
    }
    const live = { ...liveness.snapshot() };
    const queuedPacket = pending ? {
      type: pending.type,
      epoch: pending.epoch | 0,
      sequence: pending.sequence | 0,
      worldTick: pending.worldTick | 0,
      bytes: pending.data?.byteLength || 0,
    } : null;
    return {
      source: authorityResponded ? 'authority-export' : 'main-thread-fallback',
      authorityResponded,
      liveness: live,
      authority: {
        worldTick: state.worldTick | 0,
        actorTick: state.actorTick | 0,
        epoch: state.epoch | 0,
        sequence: state.sequence | 0,
        replayProgress: replayJournal.progress,
      },
      transport: {
        appliedEpoch,
        awaitingResizeId,
        queuedPacket,
        packetType: state.packetType || '',
        packetBytes: state.packetBytes || 0,
        mirrorApplyMs: state.mirrorApplyMs || 0,
        mirrorPacketErrors: state.mirrorPacketErrors || 0,
        lastMirrorPacketError: state.lastMirrorPacketError || '',
      },
      mirror: { ...mirror },
      perf,
    };
  };

  const addCaptureDiagnostics = (capsule, authorityResponded) => {
    const mirror = mirrorFinalState();
    return {
      ...capsule,
      final: {
        ...capsule.final,
        diagnostics: {
          ...captureDiagnostics(authorityResponded, mirror),
          journal: {
            turns: capsule.turns,
            truncated: replayJournal.truncated,
            discontinuous: replayJournal.discontinuous,
            progress: replayJournal.progress,
          },
        },
      },
    };
  };

  const fallbackReplay = (view) => {
    const mirror = mirrorFinalState();
    return replayJournal.snapshot(view, mirror, captureDiagnostics(false, mirror));
  };

  const requestReplayExport = (view) => {
    if (closed) return Promise.reject(new Error('Simulation worker is closed.'));
    for (const [id, request] of replayRequests) {
      if (request.kind !== 'export') continue;
      replayRequests.delete(id);
      request.reject(new Error('Replay export was superseded by a newer capture.'));
    }
    const requestId = ++replayRequestId;
    return new Promise((resolve, reject) => {
      replayRequests.set(requestId, { resolve, reject, kind: 'export' });
      if (!post({ type: 'replay-export', requestId, view })) {
        replayRequests.delete(requestId);
        reject(new Error('Simulation worker is unavailable.'));
      }
    });
  };

  const api = {
    init({
      survival = false,
      creativeKind = 0,
      creativeValue = 0,
      tool = 0,
      creatureNaturalSpawning = false,
      planetId = ctx.planetId,
      weatherId = ctx.weatherId,
      gravityScale = ctx.gravityScale,
      missionId = ctx.missionId,
      loadout = ctx.missionLoadout,
    } = {}) {
      if (closed) return;
      replayMicroscopeOpen = false;
      initOptions = {
        survival, creativeKind, creativeValue, tool, creatureNaturalSpawning,
        planetId, weatherId, gravityScale, missionId, loadout,
        ...runtimeConfig,
      };
      const message = {
        type: 'init', cols: ctx.cols, rows: ctx.rows, worldSeed: ctx.worldSeed,
        ...initOptions, drawMode: ctx.drawModeOn,
      };
      replayJournal.reset(message);
      post(message);
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
    captureReplay(view) {
      const fallback = fallbackReplay(view);
      const verified = requestReplayExport(view)
        .then((capsule) => addCaptureDiagnostics(capsule, true));
      return { fallback, verified };
    },
    exportReplay(view) {
      return requestReplayExport(view)
        .then((capsule) => addCaptureDiagnostics(capsule, true));
    },
    runReplay(capsule, onProgress, options = {}) {
      if (closed) return Promise.reject(new Error('Simulation worker is closed.'));
      replayBufferOpen = false;
      replayMicroscopeOpen = false;
      if (!!capsule?.init?.survival !== ctx.survival)
        return Promise.reject(new Error('Open this replay in the matching creative or survival mode.'));
      const replayPlanetId = capsule?.init?.planetId | 0;
      if (replayPlanetId !== ctx.planetId)
        return Promise.reject(new Error('Open this replay on the matching planet.'));
      const replayWeatherId = resolveWeatherIdForPlanet(
        capsule?.init?.weatherId ?? DEFAULT_WEATHER_ID,
        replayPlanetId,
      );
      if (capsule?.init?.weatherId !== undefined
          && capsule.init.weatherId !== replayWeatherId)
        return Promise.reject(new Error('Replay weather is invalid for its planet.'));
      const playback = !!options.playback;
      const dims = playback ? capsule?.init : capsule?.final;
      const cols = dims?.cols | 0;
      const rows = dims?.rows | 0;
      if (!cols || !rows)
        return Promise.reject(new Error('Replay dimensions are missing.'));
      pending = null;
      pendingDraft = null;
      pendingCreatures = null;
      pendingActors = null;
      pendingReplayView = null;
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
      ctx.weatherId = replayWeatherId;
      ctx.weatherVisualKey = 0;
      if (Number.isFinite(capsule.init.gravityScale)) ctx.gravityScale = capsule.init.gravityScale;
      ctx.fns.rebuildEngineForReplay?.(cols, rows);
      state = {
        ...state,
        replayPlaying: playback,
        replayTurn: 0,
        replayTurns: Math.max(0, capsule.turns | 0),
      };
      const requestId = ++replayRequestId;
      return new Promise((resolve, reject) => {
        replayRequests.set(requestId, {
          resolve, reject, onProgress, capsule, kind: 'run',
        });
        if (!post({ type: 'replay-run', requestId, capsule, playback })) {
          replayRequests.delete(requestId);
          state = { ...state, replayPlaying: false };
          reject(new Error('Simulation worker is unavailable.'));
        }
      });
    },
    startBufferedReplay(capsule) {
      if (closed) return Promise.reject(new Error('Simulation worker is closed.'));
      replayMicroscopeOpen = false;
      if (!!capsule?.init?.survival !== ctx.survival)
        return Promise.reject(new Error('Open this replay in the matching creative or survival mode.'));
      const replayPlanetId = capsule?.init?.planetId | 0;
      if (replayPlanetId !== ctx.planetId)
        return Promise.reject(new Error('Open this replay on the matching planet.'));
      const replayWeatherId = resolveWeatherIdForPlanet(
        capsule?.init?.weatherId ?? DEFAULT_WEATHER_ID,
        replayPlanetId,
      );
      if (capsule?.init?.weatherId !== undefined
          && capsule.init.weatherId !== replayWeatherId)
        return Promise.reject(new Error('Replay weather is invalid for its planet.'));
      const cols = capsule?.init?.cols | 0;
      const rows = capsule?.init?.rows | 0;
      if (!cols || !rows)
        return Promise.reject(new Error('Replay dimensions are missing.'));
      pending = pendingDraft = pendingCreatures = pendingActors = null;
      pendingReplayView = null;
      pendingReplayFrameTurn = null;
      awaitingResizeId = 0;
      appliedEpoch = 0;
      lastControl = '';
      predictor = predictorEngine = null;
      predictorPlayerId = authoritativePlayerId = 0;
      players = [];
      items = new Float32Array(0);
      projectiles = new Float32Array(0);
      ctx.worldSeed = capsule.init.worldSeed >>> 0;
      ctx.planetId = replayPlanetId;
      ctx.weatherId = replayWeatherId;
      ctx.weatherVisualKey = 0;
      if (Number.isFinite(capsule.init.gravityScale))
        ctx.gravityScale = capsule.init.gravityScale;
      ctx.fns.rebuildEngineForReplay?.(cols, rows);
      replayBufferOpen = true;
      state = {
        ...state,
        replayPlaying: true,
        replayMode: 'buffered',
        replayTurn: 0,
        replayTurns: Math.max(0, capsule.turns | 0),
        replayBufferedTurn: 0,
        replayBuildTurn: 0,
        replaySeekTarget: null,
        replayCachedRanges: [[0, 0]],
        replayPaused: false,
        replayBuffering: true,
        replayBufferComplete: false,
        replayBufferLimitReached: false,
        replayBufferError: '',
      };
      const requestId = ++replayRequestId;
      return new Promise((resolve, reject) => {
        replayRequests.set(requestId, { resolve, reject, kind: 'buffer-start' });
        if (!post({ type: 'replay-buffer-start', requestId, capsule })) {
          replayRequests.delete(requestId);
          replayBufferOpen = false;
          state = { ...state, replayPlaying: false, replayMode: '' };
          reject(new Error('Simulation worker is unavailable.'));
        }
      });
    },
    pauseBufferedReplay(paused) {
      if (!replayBufferOpen) return false;
      state = { ...state, replayPaused: !!paused };
      return post({ type: 'replay-buffer-pause', paused: !!paused });
    },
    seekBufferedReplay(turn, { playAfter = false } = {}) {
      if (!replayBufferOpen) return false;
      const target = Math.max(0, turn | 0);
      const cached = (state.replayCachedRanges || [])
        .some(([start, end]) => target >= start && target <= end);
      state = {
        ...state,
        replayPaused: !playAfter,
        replayBuffering: !cached,
        replaySeekTarget: target,
      };
      return post({
        type: 'replay-buffer-seek',
        turn: target,
        playAfter: !!playAfter,
      });
    },
    resumeBufferedReplay(turn, onProgress) {
      if (!replayBufferOpen)
        return Promise.reject(new Error('Open a buffered replay before resuming.'));
      const requestId = ++replayRequestId;
      pending = pendingDraft = pendingCreatures = pendingActors = null;
      pendingReplayView = null;
      pendingReplayFrameTurn = null;
      appliedEpoch = 0;
      state = { ...state, replayPaused: true, replayBuffering: true };
      return new Promise((resolve, reject) => {
        replayRequests.set(requestId, {
          resolve, reject, onProgress, kind: 'buffer-resume',
          ready: false, mirrorApplied: false, turn: Math.max(0, turn | 0),
        });
        if (!post({
          type: 'replay-buffer-resume', requestId,
          turn: Math.max(0, turn | 0),
        })) {
          replayRequests.delete(requestId);
          reject(new Error('Simulation worker is unavailable.'));
        }
      });
    },
    openReplayMicroscope(capsule, onProgress, options = {}) {
      if (closed) return Promise.reject(new Error('Simulation worker is closed.'));
      replayBufferOpen = false;
      if (!!capsule?.init?.survival !== ctx.survival)
        return Promise.reject(new Error('Open this replay in the matching creative or survival mode.'));
      const replayPlanetId = capsule?.init?.planetId | 0;
      if (replayPlanetId !== ctx.planetId)
        return Promise.reject(new Error('Open this replay on the matching planet.'));
      const replayWeatherId = resolveWeatherIdForPlanet(
        capsule?.init?.weatherId ?? DEFAULT_WEATHER_ID,
        replayPlanetId,
      );
      if (capsule?.init?.weatherId !== undefined
          && capsule.init.weatherId !== replayWeatherId)
        return Promise.reject(new Error('Replay weather is invalid for its planet.'));
      const cols = capsule?.init?.cols | 0;
      const rows = capsule?.init?.rows | 0;
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
      ctx.planetId = replayPlanetId;
      ctx.weatherId = replayWeatherId;
      ctx.weatherVisualKey = 0;
      if (Number.isFinite(capsule.init.gravityScale))
        ctx.gravityScale = capsule.init.gravityScale;
      ctx.fns.rebuildEngineForReplay?.(cols, rows);
      replayMicroscopeOpen = true;
      const requestId = ++replayRequestId;
      return new Promise((resolve, reject) => {
        replayRequests.set(requestId, {
          resolve, reject, onProgress, kind: 'microscope',
          frame: null, mirrorApplied: false,
        });
        if (!post({
          type: 'replay-microscope-seek', requestId,
          capsule, turn: 0, options,
        })) {
          replayRequests.delete(requestId);
          replayMicroscopeOpen = false;
          reject(new Error('Simulation worker is unavailable.'));
        }
      });
    },
    seekReplayMicroscope(turn, onProgress, options = {}) {
      if (closed) return Promise.reject(new Error('Simulation worker is closed.'));
      if (!replayMicroscopeOpen)
        return Promise.reject(new Error('Open a replay before seeking its timeline.'));
      pending = null;
      pendingDraft = null;
      pendingCreatures = null;
      pendingActors = null;
      const requestId = ++replayRequestId;
      return new Promise((resolve, reject) => {
        replayRequests.set(requestId, {
          resolve, reject, onProgress, kind: 'microscope',
          frame: null, mirrorApplied: false,
        });
        if (!post({
          type: 'replay-microscope-seek', requestId,
          turn: turn | 0, options,
        })) {
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
    // Discrete auto-weather flip. Recorded by the replay journal like config.
    sendWeather(weatherId) {
      post({ type: 'weather', weatherId: weatherId | 0 });
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
          if (packet.type === 'full'
              && (packet.reason === 'replay-microscope' || state.replayPlaying)
              && (packet.cols !== ctx.engine.cols || packet.rows !== ctx.engine.rows)) {
            ctx.fns.rebuildEngineForReplay?.(packet.cols, packet.rows);
          }
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
              if (packet.microscopeRequestId) {
                const request = replayRequests.get(packet.microscopeRequestId);
                if (request?.kind === 'microscope') {
                  request.mirrorApplied = true;
                  settleMicroscopeRequest(packet.microscopeRequestId);
                }
              }
              if (packet.replayResumeRequestId) {
                const request = replayRequests.get(packet.replayResumeRequestId);
                if (request?.kind === 'buffer-resume') {
                  request.mirrorApplied = true;
                  settleReplayResumeRequest(packet.replayResumeRequestId);
                }
              }
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
          if (packet.microscopeRequestId) {
            const request = replayRequests.get(packet.microscopeRequestId);
            if (request?.kind === 'microscope') {
              replayRequests.delete(packet.microscopeRequestId);
              request.reject(error);
            }
          }
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
      if (pendingReplayView && ctx.engine) {
        const view = pendingReplayView;
        pendingReplayView = null;
        if (Number.isFinite(view.cameraWorldX) && Number.isFinite(view.cameraWorldY)) {
          ctx.engine.cameraSet(
            view.cameraWorldX - ctx.engine.getWorldOffsetX(),
            view.cameraWorldY - ctx.engine.getWorldOffsetY(),
          );
          changed = true;
        }
      }
      if (pendingReplayFrameTurn !== null && ctx.engine) {
        const turn = pendingReplayFrameTurn;
        pendingReplayFrameTurn = null;
        state = { ...state, replayTurn: turn };
        // The RAF still has camera, HUD, audio, and rendering work after this
        // mirror apply. Release replay building once that presentation task has
        // completed so background simulation cannot contend with the frame.
        queueMicrotask(() => {
          post({ type: 'replay-buffer-frame-applied', turn });
        });
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
    pendingReplayFrameTurn = null;
    pendingSounds = [];
    replayBufferOpen = false;
    replayMicroscopeOpen = false;
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
    if (initOptions) {
      const message = {
        type: 'init', cols: ctx.cols, rows: ctx.rows, worldSeed: ctx.worldSeed,
        ...initOptions, drawMode: ctx.drawModeOn,
      };
      replayJournal.reset(message);
      post(message);
    }
    probeLiveness();
  };
  bindWorker();
  livenessTimer = setInterval(probeLiveness, LIVENESS_PROBE_MS);
  return api;
}
