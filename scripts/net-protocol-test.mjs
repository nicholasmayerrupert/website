// Protocol tests for dropped-item, inventory, and cursor
// snapshots (host -> client) and the survival-inventory intents (client -> host).
// All run in Node with no real network. Run with:
//   node scripts/net-protocol-test.mjs

import {
  MSG, encode, decode, makeItems, makeCreatures, makeProjectiles, makeSounds, makeInventory, makeCursor,
  makeSelect, makeSize, makeMove, makePick, makeThrow, makeCraft, makeRespawn,
  INV_SLOTS, ITEM_FIELDS, CREATURE_FIELDS, PROJECTILE_FIELDS, SOUND_FIELDS, INV_FIELDS, PROTOCOL_VERSION,
} from '../src/sand/net/protocol.js';
import {
  CREATURE, CREATURE_ATTACK_STATE, ITEM_KIND, OFF, PROJECTILE_KIND, SOUND_EVENT,
} from '../src/sand/wasmBridge/abi.generated.js';
import { MATERIALS } from '../src/sand/materials.generated.js';

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const rt = (m) => decode(encode(m)); // round trip through the wire format

// 0. version bump (gates new sends on the JOIN ack).
{
  console.log('protocol version');
  check('PROTOCOL_VERSION is 19', PROTOCOL_VERSION === 19);
}

{
  console.log('projectiles round trip');
  const d = rt(makeProjectiles(4, [{
    id: 2, owner: -7, x: 1.5, y: 2.5, vx: 4, vy: -1, charge: 0.75,
    kind: PROJECTILE_KIND.DYNAMITE, fuse: 84, rotation: 1.25,
  }]));
  check('projectile record matches the expanded ABI', d?.t === MSG.PROJECTILES && d.data.length === PROJECTILE_FIELDS);
  check('projectile kind, fuse, and rotation survive', d?.data[7] === PROJECTILE_KIND.DYNAMITE && d.data[8] === 84 && d.data[9] === 1.25);
}

// Semantic sound records round trip without exposing browser audio details.
{
  console.log('sounds round trip');
  const packed = [
    SOUND_EVENT.SHIELD_BREAK, -12.5, 44.25, 1.75, 7, 0,
    SOUND_EVENT.SPAWN_BREACH, 18, -7, 0.9, 0, 0,
    SOUND_EVENT.WEAPON_EXPLOSION, 24, 11, 0.75, 16, 0,
  ];
  const d = rt(makeSounds(45, packed));
  check('decodes to sounds', d && d.t === MSG.SOUNDS && d.tick === 45);
  check('sound records match ABI stride', d && d.data.length === SOUND_FIELDS * 3);
  check('position/intensity preserved', d && d.data[1] === -12.5 && d.data[2] === 44.25 && d.data[3] === 1.75);
  check('shield semantic fields preserved', d && d.data[0] === SOUND_EVENT.SHIELD_BREAK && d.data[4] === 7 && d.data[5] === 0);
  check('spawn-breach semantic fields preserved',
    d && d.data[SOUND_FIELDS] === SOUND_EVENT.SPAWN_BREACH
      && d.data[SOUND_FIELDS + 1] === 18 && d.data[SOUND_FIELDS + 2] === -7);
  check('weapon-explosion semantic fields preserved',
    d && d.data[SOUND_FIELDS * 2] === SOUND_EVENT.WEAPON_EXPLOSION
      && d.data[SOUND_FIELDS * 2 + 1] === 24 && d.data[SOUND_FIELDS * 2 + 2] === 11);
  check('empty sound batch allowed', rt(makeSounds(0, [])).data.length === 0);
}

// Creature actor snapshot round trip + bounds.
{
  console.log('creatures round trip');
  const creatures = [{ id: 7, species: CREATURE.BORE_SENTINEL, x: 22.5, y: -3.25, vx: 0.4, vy: -0.1, w: 9, h: 6, facing: -1, health: 141, maxHealth: 170, alive: true, animFrame: 2, attackState: CREATURE_ATTACK_STATE.CHARGING, attackProgress: 0.75, aimX: -11.5, aimY: 48.25, spawnProgress: 0.625 }];
  const d = rt(makeCreatures(43, creatures));
  check('decodes to creatures', d && d.t === MSG.CREATURES && d.tick === 43);
  check('creature flat length matches ABI', d && d.data.length === CREATURE_FIELDS);
  check('creature pose/health preserved', d && d.data[0] === 7 && d.data[1] === 8 && d.data[2] === 22.5 && d.data[3] === -3.25 && d.data[9] === 141 && d.data[11] === 1);
  check('creature attack state, progress, and aim survive', d && d.data[13] === 1 && d.data[14] === 0.75 && d.data[15] === -11.5 && d.data[16] === 48.25);
  check('creature breach progress survives', d && d.data[OFF.creatureSnapshot.spawnProgress] === 0.625);
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
  slots[5] = {
    material: 0, isTool: false, toolClass: 0, toolTier: 0,
    count: 250, itemKind: ITEM_KIND.MINIGUN,
  };
  const d = rt(makeInventory(7, 3, slots, 4, 2));
  check('decodes to inventory', d && d.t === MSG.INVENTORY && d.player === 3 && d.selected === 4 && d.selectedFootprint === 2);
  check('flat inventory length matches ABI', d && d.data.length === INV_SLOTS * INV_FIELDS);
  check('slot 0 is a tool (isTool + class + tier)', d && d.data[1] === 1 && d.data[2] === 1 && d.data[3] === 2);
  check('finite weapon kind and ammo count survive inventory transport',
    d && d.data[5 * INV_FIELDS + OFF.inventorySlot.itemKind] === ITEM_KIND.MINIGUN
      && d.data[5 * INV_FIELDS + OFF.inventorySlot.count] === 250);
}

// 3. cursor round trip (carried + empty).
{
  console.log('cursor round trip');
  const d = rt(makeCursor(1, 2, {
    material: 0, isTool: false, toolClass: 0, toolTier: 0,
    count: 15, itemKind: ITEM_KIND.BORE_CANNON,
  }));
  check('finite weapon ammo survives cursor transport',
    d && d.t === MSG.CURSOR && d.player === 2 && d.cur
      && d.cur.itemKind === ITEM_KIND.BORE_CANNON && d.cur.count === 15
      && d.cur.isTool === 0);
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
  check('craft max', (() => { const d = rt(makeCraft('r', 'c', 4, true)); return d.recipe === 4 && d.max === 1; })());
  check('respawn', rt(makeRespawn('r', 'c')).t === MSG.ACT_RESPAWN);
}

// 5. malformed messages are rejected (strict validation; a desync vector).
{
  console.log('reject malformed');
  const item = new Array(ITEM_FIELDS).fill(0);
  item[OFF.itemSnapshot.id] = 1; item[OFF.itemSnapshot.count] = 1;
  const creature = new Array(CREATURE_FIELDS).fill(0);
  creature[OFF.creatureSnapshot.id] = 1; creature[OFF.creatureSnapshot.species] = CREATURE.BORE_SENTINEL;
  creature[OFF.creatureSnapshot.w] = 9; creature[OFF.creatureSnapshot.h] = 6;
  creature[OFF.creatureSnapshot.health] = 170; creature[OFF.creatureSnapshot.maxHealth] = 170;
  creature[OFF.creatureSnapshot.alive] = 1;
  const projectile = new Array(PROJECTILE_FIELDS).fill(0);
  projectile[OFF.projectileSnapshot.id] = 1;
  check('items bad record length', decode(JSON.stringify({ t: 'items', tick: 0, data: [1, 2, 3] })) === null);
  check('items NaN coord', decode(JSON.stringify({ t: 'items', tick: 0, data: Object.assign([...item], { [OFF.itemSnapshot.x]: Number.NaN }) })) === null);
  check('items non-int field', decode(JSON.stringify({ t: 'items', tick: 0, data: Object.assign([...item], { [OFF.itemSnapshot.id]: 1.5 }) })) === null);
  check('items undefined material', decode(JSON.stringify({ t: 'items', tick: 0, data: Object.assign([...item], { [OFF.itemSnapshot.material]: MATERIALS.length }) })) === null);
  check('items unknown item kind', decode(JSON.stringify({ t: 'items', tick: 0, data: Object.assign([...item], { [OFF.itemSnapshot.itemKind]: 99 }) })) === null);
  check('items data not array', decode(JSON.stringify({ t: 'items', tick: 0, data: 'x' })) === null);
  check('creatures bad record length', decode(JSON.stringify({ t: 'creatures', tick: 0, data: [1, 2, 3] })) === null);
  check('creatures NaN coord', decode(JSON.stringify({ t: 'creatures', tick: 0, data: Object.assign([...creature], { [OFF.creatureSnapshot.x]: Number.NaN }) })) === null);
  check('creatures NaN aim', decode(JSON.stringify({ t: 'creatures', tick: 0, data: Object.assign([...creature], { [OFF.creatureSnapshot.aimX]: Number.NaN }) })) === null);
  check('creatures invalid attack state', decode(JSON.stringify({ t: 'creatures', tick: 0, data: Object.assign([...creature], { [OFF.creatureSnapshot.attackState]: 99 }) })) === null);
  check('creatures zero width', decode(JSON.stringify({ t: 'creatures', tick: 0, data: Object.assign([...creature], { [OFF.creatureSnapshot.w]: 0 }) })) === null);
  check('creatures oversized height', decode(JSON.stringify({ t: 'creatures', tick: 0, data: Object.assign([...creature], { [OFF.creatureSnapshot.h]: 33 }) })) === null);
  check('creatures negative attack progress', decode(JSON.stringify({ t: 'creatures', tick: 0, data: Object.assign([...creature], { [OFF.creatureSnapshot.attackProgress]: -0.1 }) })) === null);
  check('creatures attack progress above one', decode(JSON.stringify({ t: 'creatures', tick: 0, data: Object.assign([...creature], { [OFF.creatureSnapshot.attackProgress]: 1.1 }) })) === null);
  check('creatures spawn progress above one', decode(JSON.stringify({ t: 'creatures', tick: 0, data: Object.assign([...creature], { [OFF.creatureSnapshot.spawnProgress]: 1.1 }) })) === null);
  check('projectiles unknown kind', decode(JSON.stringify({ t: 'projectiles', tick: 0, data: Object.assign([...projectile], { [OFF.projectileSnapshot.kind]: 99 }) })) === null);
  check('projectiles negative fuse', decode(JSON.stringify({ t: 'projectiles', tick: 0, data: Object.assign([...projectile], { [OFF.projectileSnapshot.fuse]: -1 }) })) === null);
  check('projectiles NaN rotation', decode(JSON.stringify({ t: 'projectiles', tick: 0, data: Object.assign([...projectile], { [OFF.projectileSnapshot.rotation]: Number.NaN }) })) === null);
  check('sounds bad record length', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [1, 2, 3] })) === null);
  check('sounds NaN intensity', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [0, 1, 2, Number.NaN, 0, 0] })) === null);
  check('sounds non-int semantic field', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [0.5, 1, 2, 1, 0, 0] })) === null);
  check('sounds unknown event type', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [999, 1, 2, 1, 0, 0] })) === null);
  check('sounds undefined material', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [0, 1, 2, 1, MATERIALS.length, 0] })) === null);
  check('sounds invalid layer', decode(JSON.stringify({ t: 'sounds', tick: 0, data: [0, 1, 2, 1, 0, 2] })) === null);
  check('inventory wrong slot count', decode(JSON.stringify({ t: 'inv', tick: 0, player: 0, data: [1, 2, 3], selected: 0, selectedFootprint: 0 })) === null);
  check('inventory selected out of range', decode(JSON.stringify({ t: 'inv', tick: 0, player: 0, data: new Array(INV_SLOTS * INV_FIELDS).fill(0), selected: INV_SLOTS, selectedFootprint: 0 })) === null);
  check('inventory footprint required', decode(JSON.stringify({ t: 'inv', tick: 0, player: 0, data: new Array(INV_SLOTS * INV_FIELDS).fill(0), selected: 0 })) === null);
  const badInventoryKind = new Array(INV_SLOTS * INV_FIELDS).fill(0);
  badInventoryKind[OFF.inventorySlot.itemKind] = Math.max(...Object.values(ITEM_KIND)) + 1;
  check('inventory unknown item kind', decode(JSON.stringify({ t: 'inv', tick: 0, player: 0, data: badInventoryKind, selected: 0, selectedFootprint: 0 })) === null);
  const badInventoryMaterial = new Array(INV_SLOTS * INV_FIELDS).fill(0);
  badInventoryMaterial[OFF.inventorySlot.material] = MATERIALS.length;
  check('inventory undefined material', decode(JSON.stringify({ t: 'inv', tick: 0, player: 0, data: badInventoryMaterial, selected: 0, selectedFootprint: 0 })) === null);
  check('cursor bad shape', decode(JSON.stringify({ t: 'cursor', tick: 0, player: 0, cur: { material: 1.2 } })) === null);
  check('cursor undefined material', decode(JSON.stringify({
    t: 'cursor', tick: 0, player: 0,
    cur: { material: MATERIALS.length, isTool: 0, toolClass: 0, toolTier: 0, count: 1, itemKind: 0 },
  })) === null);
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
