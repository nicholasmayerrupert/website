import assert from 'node:assert/strict';
import {
  decodeReplayCapsule,
  MAX_REPLAY_TURNS,
  REPLAY_PREFIX,
} from '../src/sand/game/replayCapsule.js';
import {
  createReplayPanel,
  materializeReplayFallback,
} from '../src/sand/game/replayPanel.js';
import { createReplayCaptureJournal } from '../src/sand/worker/replayCaptureJournal.js';

const init = {
  type: 'init',
  cols: 256,
  rows: 192,
  worldSeed: 0x51f7,
  survival: false,
  creativeKind: 0,
  creativeValue: 35,
  tool: 2,
  creatureNaturalSpawning: false,
  planetId: 0,
  gravityScale: 1,
  missionId: 0,
  loadout: [],
  drawMode: true,
};
const control = {
  type: 'control',
  worldX: 120,
  worldY: 80,
  buttons: 0,
  inside: true,
  drawMode: true,
  camWorldX: 64,
  camWorldY: 48,
  viewCols: 128,
  viewRows: 96,
  suspendStreaming: false,
};
const trigger = {
  type: 'edge',
  kind: 'down',
  button: 0,
  buttons: 1,
  inside: true,
  drawMode: true,
  worldX: 122,
  worldY: 81,
};

const journal = createReplayCaptureJournal();
journal.reset(init);
assert.equal(journal.noteEvent({
  type: 'replay-journal-event', flags: 1,
  event: { tick: 0, message: control }, phase: 'apply-control',
  worldTick: 0, actorTick: 0, epoch: 1, sequence: 1,
}), true);
assert.equal(journal.noteTurn({
  type: 'replay-journal-turn', turns: 1, flags: 1,
  events: [], phase: 'turn-start',
  worldTick: 0, actorTick: 0, epoch: 1, sequence: 1,
}), true);
assert.equal(journal.noteEvent({
  type: 'replay-journal-event', flags: 1,
  event: { tick: 1, message: trigger }, phase: 'apply-edge',
  worldTick: 1, actorTick: 1, epoch: 1, sequence: 2,
}), true);
assert.equal(journal.noteTurn({
  type: 'replay-journal-turn', turns: 2, flags: 1,
  events: [], phase: 'turn-start',
  worldTick: 1, actorTick: 1, epoch: 1, sequence: 2,
}), true);
assert.equal(journal.noteTurn({
  type: 'replay-journal-turn', turns: 3, flags: 2,
  events: [], phase: 'turn-start',
  worldTick: 2, actorTick: 2, epoch: 2, sequence: 0,
}), true);

const final = {
  tick: 2,
  actorTick: 2,
  cols: 256,
  rows: 192,
  gridHash: 0x12345678,
  worldOffsetX: -64,
  worldOffsetY: 32,
  componentCount: 12,
  componentCellCount: 300,
  crossBondCount: 1,
  playerCount: 0,
  itemCount: 0,
  creatureCount: 0,
  projectileCount: 0,
};
const fallback = journal.snapshot(
  { cameraWorldX: 64, cameraWorldY: 48, viewCols: 128, viewRows: 96, zoom: 1 },
  final,
  {
    source: 'main-thread-fallback',
    authorityResponded: false,
    liveness: { stage: 'step-world', turn: 3, awaitingAck: false },
    mirror: { tick: 2, gridHash: final.gridHash },
  },
);
assert.deepEqual(fallback.events, [
  { tick: 0, message: control },
  { tick: 1, message: trigger },
]);
assert.deepEqual(fallback.gates, [
  { start: 0, end: 2, flags: 1 },
  { start: 2, end: 3, flags: 2 },
]);
assert.deepEqual(fallback.final.diagnostics.journal.progress, {
  turns: 3,
  phase: 'turn-start',
  worldTick: 2,
  actorTick: 2,
  epoch: 2,
  sequence: 0,
  awaitingAck: false,
  fullResyncRequested: true,
});

const handlerStall = createReplayCaptureJournal();
handlerStall.reset(init);
const resizeTrigger = { type: 'resize', cols: 320, rows: 224 };
assert.equal(handlerStall.noteEvent({
  type: 'replay-journal-event', flags: 0,
  event: { tick: 0, message: resizeTrigger }, phase: 'apply-resize',
  worldTick: 0, actorTick: 0, epoch: 1, sequence: 1,
}), true);
const preApplyFallback = handlerStall.snapshot({}, final, {});
assert.equal(preApplyFallback.turns, 0);
assert.deepEqual(preApplyFallback.events, [
  { tick: 0, message: resizeTrigger },
]);
assert.equal(
  preApplyFallback.final.diagnostics.journal.progress.phase,
  'apply-resize',
);

const neverResponds = new Promise(() => {});
const encoded = await Promise.race([
  materializeReplayFallback({ fallback, verified: neverResponds }),
  new Promise((_, reject) => setTimeout(
    () => reject(new Error('fallback waited for the authority worker')),
    250,
  )),
]);
assert.ok(encoded.text.startsWith(REPLAY_PREFIX));
assert.deepEqual(await decodeReplayCapsule(encoded.text), fallback);

const broken = createReplayCaptureJournal();
broken.reset(init);
assert.equal(broken.noteTurn({ turns: 2, flags: 0, events: [] }), false);
assert.equal(broken.discontinuous, true);
assert.equal(broken.turns, 0);
assert.equal(broken.noteTurn({
  turns: 1, flags: 0,
  events: [{ tick: 2, message: trigger }],
}), false);
assert.equal(broken.turns, 0);
assert.equal(broken.noteTurn({ turns: 1, flags: 0, events: [] }), false);
assert.equal(broken.turns, 0);

const overflow = createReplayCaptureJournal();
overflow.reset(init);
assert.equal(overflow.noteTurn({
  turns: MAX_REPLAY_TURNS + 1,
  flags: 0,
  events: [],
}), false);
assert.equal(overflow.truncated, true);
assert.equal(overflow.turns, 0);
assert.equal(
  overflow.snapshot({}, final, {}).final.diagnostics.journal.truncated,
  true,
);
assert.equal(
  broken.snapshot({}, final, {}).final.diagnostics.journal.discontinuous,
  true,
);

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
  }
  append(...children) {
    for (const child of children) this.appendChild(child);
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
  focus() {}
  select() {}
  remove() {
    if (!this.parentElement) return;
    const at = this.parentElement.children.indexOf(this);
    if (at >= 0) this.parentElement.children.splice(at, 1);
    this.parentElement = null;
  }
}

const find = (root, predicate) => {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const eventually = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('panel state did not settle');
};

globalThis.document = {
  createElement: (tagName) => new FakeElement(tagName),
  execCommand: () => true,
};
const container = new FakeElement('div');
const staleAuthority = deferred();
const authorityA = deferred();
const authorityB = deferred();
const playback = deferred();
let playbackRequest = null;
const captures = [
  { fallback, verified: staleAuthority.promise },
  { fallback, verified: authorityA.promise },
  { fallback, verified: authorityB.promise },
];
const ctx = {
  container,
  engine: {
    getCam: () => ({ x: 64, y: 48 }),
    getWorldOffsetX: () => 0,
    getWorldOffsetY: () => 0,
  },
  viewCols: 128,
  viewRows: 96,
  zoom: 1,
  worldWorker: {
    captureReplay: () => captures.shift(),
    config: () => {},
    runReplay: (capsule, onProgress, options) => {
      playbackRequest = { capsule, onProgress, options };
      return playback.promise;
    },
  },
};
const panel = createReplayPanel(ctx);
const overlay = container.children[0];
const textarea = find(overlay,
  (node) => node.getAttribute('aria-label') === 'Replay capsule text');
const button = (label) => find(overlay,
  (node) => node.tagName === 'BUTTON' && node.textContent === label);
const status = overlay.children[0].children[1];

await Promise.race([
  panel.open(),
  new Promise((_, reject) => setTimeout(
    () => reject(new Error('panel waited for an unresponsive authority')),
    250,
  )),
]);
assert.ok(textarea.value.startsWith(REPLAY_PREFIX));
assert.equal(button('Copy').disabled, false);
assert.equal(button('Run replay').disabled, true);
assert.match(status.textContent, /copyable now/);

button('Resume & close').dispatchEvent({ type: 'click' });
await panel.open();
const fallbackText = textarea.value;
staleAuthority.resolve({ ...fallback });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(textarea.value, fallbackText);
assert.equal(button('Run replay').disabled, true);
const verified = {
  ...fallback,
  final: {
    ...fallback.final,
    gridHash: 0x87654321,
    diagnostics: {
      ...fallback.final.diagnostics,
      source: 'authority-export',
      authorityResponded: true,
    },
  },
};
authorityA.resolve(verified);
await eventually(() => button('Run replay').disabled === false);
assert.notEqual(textarea.value, fallbackText);
assert.match(status.textContent, /authority's final state/);

button('Run replay').dispatchEvent({ type: 'click' });
await eventually(() => overlay.hidden === true && playbackRequest !== null);
assert.equal(playbackRequest.options.playback, true);
assert.equal(playbackRequest.capsule.final.gridHash, verified.final.gridHash);
playbackRequest.onProgress(1, verified.turns);
playback.resolve({ matched: true, expected: verified.final, actual: verified.final });
await eventually(() => overlay.hidden === false);
assert.match(status.textContent, /Replay verified:/);

button('Resume & close').dispatchEvent({ type: 'click' });
await panel.open();
textarea.value = 'user-edited capture';
authorityB.resolve(verified);
await eventually(() => button('Run replay').disabled === false);
assert.equal(textarea.value, 'user-edited capture');
assert.match(status.textContent, /not replaced/);
panel.destroy();

console.log('replay capture journal preserves an immediately copyable exact prefix');
