import {
  copyReplayValue,
  MAX_REPLAY_EVENTS,
  MAX_REPLAY_TURNS,
  normalizeReplayInit,
  REPLAY_FORMAT,
  REPLAY_VERSION,
} from '../game/replayCapsule.js';
import { ABI_FINGERPRINT, ABI_VERSION } from '../wasmBridge/abi.generated.js';

const validEvent = (event, turns) => event && typeof event === 'object'
  && Number.isInteger(event.tick) && event.tick >= 0 && event.tick <= turns
  && event.message && typeof event.message === 'object';

export function createReplayCaptureJournal() {
  let init = null;
  let turns = 0;
  let events = [];
  let gates = [];
  let progress = null;
  let truncated = false;
  let discontinuous = false;

  const reset = (value) => {
    init = normalizeReplayInit(value || {});
    turns = 0;
    events = [];
    gates = [];
    progress = null;
    truncated = false;
    discontinuous = false;
  };

  const noteEvent = (message) => {
    if (!init || truncated || discontinuous) return false;
    const event = message?.event;
    if (!validEvent(event, turns) || event.tick !== turns
        || event.tick < (events.at(-1)?.tick ?? -1)) {
      discontinuous = true;
      return false;
    }
    if (events.length >= MAX_REPLAY_EVENTS) {
      truncated = true;
      return false;
    }
    const flags = message.flags | 0;
    if (flags & ~3) {
      discontinuous = true;
      return false;
    }
    events.push(event);
    progress = {
      turns,
      phase: typeof message.phase === 'string' ? message.phase : 'apply-message',
      worldTick: Math.max(0, message.worldTick | 0),
      actorTick: Math.max(0, message.actorTick | 0),
      epoch: message.epoch | 0,
      sequence: message.sequence | 0,
      awaitingAck: !!(flags & 1),
      fullResyncRequested: !!(flags & 2),
    };
    return true;
  };

  const noteTurn = (message) => {
    const nextTurns = message?.turns;
    if (!init || truncated || discontinuous
        || !Number.isInteger(nextTurns) || nextTurns < 1) return false;
    if (nextTurns <= turns) return false;
    if (nextTurns > MAX_REPLAY_TURNS) {
      truncated = true;
      return false;
    }
    if (nextTurns !== turns + 1) {
      discontinuous = true;
      return false;
    }

    if (!Array.isArray(message.events)) {
      discontinuous = true;
      return false;
    }
    const accepted = message.events;
    if (events.length + accepted.length > MAX_REPLAY_EVENTS) {
      truncated = true;
      return false;
    }
    let previousTick = events.at(-1)?.tick ?? -1;
    for (const event of accepted) {
      if (!validEvent(event, nextTurns) || event.tick < previousTick) {
        discontinuous = true;
        return false;
      }
      previousTick = event.tick;
    }

    const turn = nextTurns - 1;
    const flags = message.flags | 0;
    if (flags & ~3) {
      discontinuous = true;
      return false;
    }
    if (flags) {
      const previous = gates.at(-1);
      if (previous?.end === turn && previous.flags === flags) previous.end++;
      else if (gates.length < MAX_REPLAY_TURNS)
        gates.push({ start: turn, end: turn + 1, flags });
      else {
        truncated = true;
        return false;
      }
    }

    for (const event of accepted) events.push(event);
    turns = nextTurns;
    progress = {
      turns,
      phase: message.phase === 'turn-start' ? 'turn-start' : 'unknown',
      worldTick: Math.max(0, message.worldTick | 0),
      actorTick: Math.max(0, message.actorTick | 0),
      epoch: message.epoch | 0,
      sequence: message.sequence | 0,
      awaitingAck: !!(flags & 1),
      fullResyncRequested: !!(flags & 2),
    };
    return true;
  };

  const abortTurn = () => {
    if (!init || turns < 1) return false;
    const aborted = turns;
    turns -= 1;
    events = events.filter((event) => event.tick < aborted);
    for (let i = gates.length - 1; i >= 0; i--) {
      const gate = gates[i];
      if (gate.start >= aborted) gates.splice(i, 1);
      else if (gate.end > aborted) gate.end = aborted;
    }
    if (progress) progress = { ...progress, turns };
    return true;
  };

  const replace = (capsule) => {
    reset(capsule.init);
    turns = capsule.turns | 0;
    events = capsule.events.slice();
    gates = capsule.gates.map((gate) => ({ ...gate }));
    const lastGate = gates.at(-1);
    const flags = lastGate && lastGate.start < turns && lastGate.end >= turns
      ? lastGate.flags : 0;
    progress = {
      turns,
      phase: 'authority-export',
      worldTick: Math.max(0, capsule.final?.tick | 0),
      actorTick: Math.max(0, capsule.final?.actorTick | 0),
      epoch: capsule.final?.diagnostics?.authority?.epoch | 0,
      sequence: capsule.final?.diagnostics?.authority?.sequence | 0,
      awaitingAck: !!(flags & 1),
      fullResyncRequested: !!(flags & 2),
    };
  };

  const snapshot = (view, final, diagnostics) => {
    if (!init) return null;
    const journal = { turns, truncated, discontinuous, progress: progress && { ...progress } };
    const finalState = copyReplayValue(final || {});
    if (!Number.isInteger(finalState.tick) || finalState.tick < 0
        || finalState.tick > MAX_REPLAY_TURNS)
      finalState.tick = turns;
    return {
      format: REPLAY_FORMAT,
      version: REPLAY_VERSION,
      abiVersion: ABI_VERSION,
      abiFingerprint: ABI_FINGERPRINT,
      init: copyReplayValue(init),
      turns,
      events: events.map((event) => ({
        tick: event.tick,
        message: copyReplayValue(event.message),
      })),
      gates: gates.map((gate) => ({ ...gate })),
      view: copyReplayValue(view || {}),
      final: {
        ...finalState,
        diagnostics: copyReplayValue({ ...(diagnostics || {}), journal }),
      },
    };
  };

  return {
    reset,
    noteEvent,
    noteTurn,
    abortTurn,
    replace,
    snapshot,
    get ready() { return !!init; },
    get turns() { return turns; },
    get progress() { return progress && { ...progress }; },
    get truncated() { return truncated; },
    get discontinuous() { return discontinuous; },
  };
}
