// Tests for the Phase 9 protocol additions: dropped-item, inventory and cursor
// snapshots (host -> client) and the survival-inventory intents (client -> host).
// All run in Node with no real network. Run with:
//   node scripts/net-protocol-test.mjs

import {
  MSG, encode, decode, makeItems, makeCreatures, makeSounds, makeInventory, makeCursor,
  makeSelect, makeSize, makeMove, makePick, makeThrow,
  INV_SLOTS, ITEM_FIELDS, CREATURE_FIELDS, SOUND_FIELDS, INV_FIELDS, PROTOCOL_VERSION,
} from '../src/sand/net/protocol.js';
import { SOUND_EVENT } from '../src/sand/wasmBridge/abi.generated.js';

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const rt = (m) => decode(encode(m)); // round trip through the wire format

// 0. version bump (gates new sends on the JOIN ack).
{
  console.log('protocol version');
  check('PROTOCOL_VERSION is 8', PROTOCOL_VERSION === 8);
}

// Semantic sound records round trip without exposing browser audio details.
{
  console.log('sounds round trip');
  const packed = [SOUND_EVENT.EXPLOSION, -12.5, 44.25, 1.75, 7, 0];
  const d = rt(makeSounds(45, packed));
  check('decodes to sounds', d && d.t === MSG.SOUNDS && d.tick === 45);
  check('sound record matches ABI stride', d && d.data.length === SOUND_FIELDS);
  check('position/intensity preserved', d && d.data[1] === -12.5 && d.data[2] === 44.25 && d.data[3] === 1.75);
  check('semantic fields preserved', d && d.data[0] === SOUND_EVENT.EXPLOSION && d.data[4] === 7 && d.data[5] === 0);
  check('empty sound batch allowed', rt(makeSounds(0, [])).data.length === 0);
}

// Creature actor snapshot round trip + bounds.
{
  console.log('creatures round trip');
  const creatures = [{ id: 7, species: 1, x: 22.5, y: -3.25, vx: 0.4, vy: -0.1, w: 7, h: 3, facing: -1, health: 41, maxHealth: 55, alive: true, animFrame: 1 }];
  const d = rt(makeCreatures(43, creatures));
  check('decodes to creatures', d && d.t === MSG.CREATURES && d.tick === 43);
  check('creature flat length matches ABI', d && d.data.length === CREATURE_FIELDS);
  check('creature pose/health preserved', d && d.data[0] === 7 && d.data[1] === 1 && d.data[2] === 22.5 && d.data[3] === -3.25 && d.data[9] === 41 && d.data[11] === 1);
  check('empty creatures allowed', rt(makeCreatures(0, [])).data.length === 0);
}

// 1. items snapshot round trip + exactness (mixed item/particle, neg coords).
{
  console.log('items round trip');
  const items = [
    { id: 5, kind: 0, material: 7, count: 3, x: 10.5, y: -4.25, life: 0, plantType: 2 },
    { id: 9, kind: 1, material: 2, count: 1, x: 200.75, y: 119, life: 12, plantType: 0 },
  ];
  const d = rt(makeItems(42, items));
  check('decodes to items', d && d.t === MSG.ITEMS && d.tick === 42);
  check('flat length matches', d && d.data.length === items.length * ITEM_FIELDS);
  check('first item fields preserved', d && d.data[0] === 5 && d.data[1] === 0 && d.data[2] === 7 && d.data[3] === 3 && d.data[4] === 10.5 && d.data[5] === -4.25 && d.data[6] === 0);
  check('seed species preserved', d && d.data[7] === 2);
  check('second item fields preserved', d && d.data[ITEM_FIELDS] === 9 && d.data[ITEM_FIELDS + 1] === 1 && d.data[ITEM_FIELDS + 4] === 200.75 && d.data[ITEM_FIELDS + 6] === 12);
  check('empty items allowed', rt(makeItems(0, [])).data.length === 0);
}

// 2. inventory snapshot round trip + exactness.
{
  console.log('inventory round trip');
  const slots = Array.from({ length: INV_SLOTS }, (_, i) => ({ material: i, isTool: i === 0, toolClass: i === 0 ? 1 : 0, toolTier: i === 0 ? 2 : 0, count: i }));
  const d = rt(makeInventory(7, 3, slots, 4, 2));
  check('decodes to inventory', d && d.t === MSG.INVENTORY && d.player === 3 && d.selected === 4 && d.selectedFootprint === 2);
  check('flat inventory length matches ABI', d && d.data.length === INV_SLOTS * INV_FIELDS);
  check('slot 0 is a tool (isTool + class + tier)', d && d.data[1] === 1 && d.data[2] === 1 && d.data[3] === 2);
  check('slot 5 count preserved', d && d.data[5 * INV_FIELDS + 4] === 5);
}

// 3. cursor round trip (carried + empty).
{
  console.log('cursor round trip');
  const d = rt(makeCursor(1, 2, { material: 9, isTool: false, toolClass: 0, toolTier: 0, count: 64 }));
  check('carried cursor preserved', d && d.t === MSG.CURSOR && d.player === 2 && d.cur && d.cur.material === 9 && d.cur.count === 64 && d.cur.isTool === 0);
  const e = rt(makeCursor(1, 2, null));
  check('empty cursor preserved', e && e.cur === null);
}

// 4. intents round trip.
{
  console.log('intents round trip');
  check('select', rt(makeSelect('r', 'c', 3)).slot === 3);
  check('size', rt(makeSize('r', 'c', 4)).footprint === 4);
  check('move', (() => { const d = rt(makeMove('r', 'c', 9, 35)); return d.from === 9 && d.to === 35; })());
  check('pick half', (() => { const d = rt(makePick('r', 'c', 4, true)); return d.slot === 4 && d.half === 1; })());
  check('throw whole', rt(makeThrow('r', 'c', true)).whole === 1);
}

// 5. malformed messages are rejected (strict validation; a desync vector).
{
  console.log('reject malformed');
  check('items bad record length', decode(JSON.stringify({ t: 'items', tick: 0, data: [1, 2, 3] })) === null);
  check('items NaN coord', decode(JSON.stringify({ t: 'items', tick: 0, data: [1, 0, 0, 1, Number.NaN, 0, 0] })) === null);
  check('items non-int field', decode(JSON.stringify({ t: 'items', tick: 0, data: [1.5, 0, 0, 1, 0, 0, 0] })) === null);
  check('items data not array', decode(JSON.stringify({ t: 'items', tick: 0, data: 'x' })) === null);
  check('creatures bad record length', decode(JSON.stringify({ t: 'creatures', tick: 0, data: [1, 2, 3] })) === null);
  check('creatures NaN coord', decode(JSON.stringify({ t: 'creatures', tick: 0, data: [1, 0, Number.NaN, 0, 0, 0, 4, 2, 1, 10, 10, 1, 0] })) === null);
  check('sounds bad record length', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [1, 2, 3] })) === null);
  check('sounds NaN intensity', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [0, 1, 2, Number.NaN, 0, 0] })) === null);
  check('sounds non-int semantic field', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [0.5, 1, 2, 1, 0, 0] })) === null);
  check('sounds unknown event type', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [999, 1, 2, 1, 0, 0] })) === null);
  check('sounds invalid layer', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [0, 1, 2, 1, 0, 2] })) === null);
  check('inventory wrong slot count', decode(JSON.stringify({ t: 'inv', tick: 0, player: 0, data: [1, 2, 3], selected: 0, selectedFootprint: 0 })) === null);
  check('inventory selected out of range', decode(JSON.stringify({ t: 'inv', tick: 0, player: 0, data: new Array(INV_SLOTS * INV_FIELDS).fill(0), selected: INV_SLOTS, selectedFootprint: 0 })) === null);
  check('inventory footprint required', decode(JSON.stringify({ t: 'inv', tick: 0, player: 0, data: new Array(INV_SLOTS * INV_FIELDS).fill(0), selected: 0 })) === null);
  check('cursor bad shape', decode(JSON.stringify({ t: 'cursor', tick: 0, player: 0, cur: { material: 1.2 } })) === null);
  check('select slot >= INV_SLOTS rejected', decode(JSON.stringify({ t: 'aselect', room: 'r', client: 'c', slot: INV_SLOTS })) === null);
  check('select negative slot rejected', decode(JSON.stringify({ t: 'aselect', room: 'r', client: 'c', slot: -1 })) === null);
  check('size negative rejected', decode(JSON.stringify({ t: 'asize', room: 'r', client: 'c', footprint: -1 })) === null);
  check('move slot out of range rejected', decode(JSON.stringify({ t: 'amove', room: 'r', client: 'c', from: 0, to: 999 })) === null);
  check('pick half non-bit rejected', decode(JSON.stringify({ t: 'apick', room: 'r', client: 'c', slot: 0, half: 2 })) === null);
  check('throw non-bit rejected', decode(JSON.stringify({ t: 'athrow', room: 'r', client: 'c', whole: 5 })) === null);
}

// 6. large item snapshot rejected (resource bound).
{
  console.log('resource bounds');
  const huge = new Array((1024 + 1) * ITEM_FIELDS).fill(0);
  check('over-cap item snapshot rejected', decode(JSON.stringify({ t: 'items', tick: 0, data: huge })) === null);
  const hugeCreatures = new Array((128 + 1) * CREATURE_FIELDS).fill(0);
  check('over-cap creature snapshot rejected', decode(JSON.stringify({ t: 'creatures', tick: 0, data: hugeCreatures })) === null);
  const hugeSounds = new Array((192 + 1) * SOUND_FIELDS).fill(0);
  check('over-cap sound snapshot rejected', decode(JSON.stringify({ t: 'sounds', tick: 0, data: hugeSounds })) === null);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
