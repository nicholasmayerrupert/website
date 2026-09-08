import assert from 'node:assert/strict';
import { createTalkHud } from '../src/sand/embed/talkHud.js';
import { CREATURE, PLANET } from '../src/sand/wasmBridge/abi.generated.js';

let events = [], frame;
class Node {
  children = [];
  dataset = {};
  attributes = {};
  style = new Proxy({}, { set: (target, key, value) => {
    events.push({ type: 'write', node: this, key }); target[key] = value; return true;
  } });
  classList = { toggle: () => events.push({ type: 'write', node: this }), contains: () => false };
  set textContent(value) { this.text = value; events.push({ type: 'text', node: this }); }
  get textContent() { return this.text || ''; }
  set hidden(value) { this.isHidden = value; events.push({ type: 'write', node: this }); }
  get hidden() { return !!this.isHidden; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  appendChild(node) { this.children.push(node); node.parent = this; events.push({ type: 'write', node }); }
  setAttribute(key, value) { this.attributes[key] = value; events.push({ type: 'write', node: this }); }
  addEventListener() {}
  removeEventListener() {}
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
}
globalThis.document = { createElement: () => new Node() };
globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
globalThis.cancelAnimationFrame = () => {};
const root = new Node();
root.host = { clientWidth: 640, clientHeight: 480 };
const view = { viewCols: 128, viewRows: 96, playerWorldX: 20, playerWorldY: 20 };
const actors = [
  { id: 1, npcId: 1, species: CREATURE.IRIS_COMMANDER, alive: true, worldX: 20, worldY: 20, headWorldY: 12 },
  { id: 2, npcId: 2, species: CREATURE.IRIS_ENGINEER, alive: true, worldX: 40, worldY: 20, headWorldY: 12 },
];
const game = {
  getPlanetState: () => ({ id: PLANET.FRONTIER }),
  getMissionView: () => view,
  getTalkableActors: () => actors,
  worldToScreen(x, y) { events.push({ type: 'read' }); return { x: 100 + x, y: 100 + y }; },
};
const hud = createTalkHud(root, game);
const tick = now => {
  events = []; frame(now);
  const firstWrite = events.findIndex(event => event.type !== 'read');
  assert.ok(firstWrite > 0, 'the frame projects its actors before updating the DOM');
  assert.ok(events.slice(firstWrite).every(event => event.type !== 'read'),
    'no layout-dependent projection runs after a DOM write');
};
tick(0);
const layer = root.children.find(node => node.className === 'sg-talk-layer');
const buttons = () => layer.children.filter(node => node.className === 'sg-talk-button');
assert.equal(buttons().filter(node => !node.hidden).length, 1);
assert.equal(buttons().find(node => !node.hidden).style.transform, 'translate(120px,104px) translate(-50%,-100%)');
assert.equal(buttons().find(node => !node.hidden).textContent, 'T · Talk');
tick(16);
assert.equal(events.filter(event => event.type === 'text').length, 0,
  'unchanged labels do not replace text nodes every frame');
view.playerWorldX = 40;
tick(32);
assert.equal(buttons().find(node => !node.hidden).style.transform, 'translate(140px,104px) translate(-50%,-100%)');
assert.equal(buttons().find(node => !node.hidden).textContent, 'T · Talk');
assert.equal(buttons().find(node => node.hidden).textContent, 'Talk');
hud.destroy();
console.log('talk HUD: batched projection, unchanged text, positioning and nearest actor passed');
