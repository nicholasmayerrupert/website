// Deterministic ward mechanics: 120-degree directional coverage, durability,
// recharge, overflow, unshieldable hazards, and the principal combat routes.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { KEY_CODES } from '../src/sand/game/runtimeConfig.js';
import {
  CREATURE, INPUT, OFF, SOUND_EVENT, STRIDES,
} from '../src/sand/wasmBridge/abi.generated.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('directional ward shield');
const COLS = 180, ROWS = 120, FLOOR = 104;

function arena() {
  const e = attachTestHooks(createEngineWasm({
    cols: COLS, rows: ROWS, worldSeed: 0x51E1D, sinksOn: false, infinite: false,
  }));
  e.setCreatureRuntime(true, false);
  for (let x = 2; x < COLS - 2; x++)
    for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  return e;
}

function activateWard(e, id, angle = 0, seq = 1) {
  const p = e.getPlayer(id);
  const cx = p.x + p.w * .5, cy = p.y + p.h * .5;
  e.setPlayerInput(id, {
    bits: INPUT.SHIELD,
    aimX: cx + Math.cos(angle) * 40,
    aimY: cy + Math.sin(angle) * 40,
    seq,
  });
  e.stepActors();
  return { cx: e.getPlayer(id).x + p.w * .5, cy: e.getPlayer(id).y + p.h * .5 };
}

function soundTypes(e) {
  const packed = e.drainSoundEvents();
  const types = new Set();
  for (let i = 0; i < packed.length; i += STRIDES.soundEvent)
    types.add(packed[i + OFF.soundEvent.type] | 0);
  return types;
}

{
  const e = arena();
  e.inputKey(KEY_CODES.f, 1);
  check('holding F maps through the camera input policy to PI_SHIELD',
    (e.localInputBits() & INPUT.SHIELD) !== 0);
  e.inputKey(KEY_CODES.f, 0);
  check('releasing F clears PI_SHIELD',
    (e.localInputBits() & INPUT.SHIELD) === 0);
  e.destroy();
}

// The inclusive front boundary is +/-60 degrees (a 120-degree total sector);
// immediately outside it and directly behind the player reach health instead.
for (const [label, sourceAngle, blocked] of [
  ['front centre', 0, true],
  ['upper +60-degree boundary', -Math.PI / 3, true],
  ['lower +60-degree boundary', Math.PI / 3, true],
  ['just outside the boundary', Math.PI / 3 + .02, false],
  ['directly behind', Math.PI, false],
]) {
  const e = arena();
  const id = e.spawnPlayer(80, FLOOR - 8);
  const { cx, cy } = activateWard(e, id);
  const healthDamage = e._damagePlayer(
    id, 20, cx + Math.cos(sourceAngle) * 30, cy + Math.sin(sourceAngle) * 30,
  );
  const p = e.getPlayer(id);
  check(`${label} is ${blocked ? 'covered' : 'uncovered'}`,
    blocked
      ? healthDamage === 0 && p.health === 100 && p.shieldHealth === 180
      : healthDamage === 20 && p.health === 80 && p.shieldHealth === 200);
  if (label === 'front centre') {
    const sounds = soundTypes(e);
    check('a fully absorbed hit emits shield feedback without a break',
      sounds.has(SOUND_EVENT.SHIELD_HIT) && !sounds.has(SOUND_EVENT.SHIELD_BREAK));
  }
  e.destroy();
}

// Blocking in front must not grant ordinary invulnerability to an unguarded
// direction during the ward's anti-multihit cooldown.
{
  const e = arena();
  const id = e.spawnPlayer(80, FLOOR - 8);
  const { cx, cy } = activateWard(e, id);
  e._damagePlayer(id, 20, cx + 30, cy);
  const healthDamage = e._damagePlayer(id, 20, cx - 30, cy);
  const p = e.getPlayer(id);
  check('a frontal block does not protect a follow-up hit from behind',
    healthDamage === 20 && p.health === 80 && p.shieldHealth === 180);
  e.destroy();
}

// A ward hit starts a one-second recharge delay. It then regenerates two points
// per tick and caps at its 200-point maximum.
{
  const e = arena();
  const id = e.spawnPlayer(80, FLOOR - 8);
  const { cx, cy } = activateWard(e, id);
  e._damagePlayer(id, 40, cx + 20, cy);
  for (let tick = 0; tick < 60; tick++) e.stepActors();
  check('ward does not regenerate during its 60-tick post-hit delay',
    e.getPlayer(id).shieldHealth === 160);
  e.stepActors();
  check('ward begins regenerating immediately after the delay',
    e.getPlayer(id).shieldHealth === 162);
  for (let tick = 0; tick < 19; tick++) e.stepActors();
  check('ward quickly regenerates to, but never above, 200 health',
    e.getPlayer(id).shieldHealth === 200);
  e.destroy();
}

// Overflow crosses from ward durability into ordinary health. Depletion also
// turns the active state off and produces distinct hit/break feedback.
{
  const e = arena();
  const id = e.spawnPlayer(80, FLOOR - 8);
  const { cx, cy } = activateWard(e, id);
  const healthDamage = e._damagePlayer(id, 250, cx + 20, cy);
  const p = e.getPlayer(id);
  const sounds = soundTypes(e);
  check('a 250-point frontal hit consumes 200 ward and overflows 50 to health',
    healthDamage === 50 && p.shieldHealth === 0 && p.health === 50 && !p.shieldActive);
  check('ward absorption and depletion emit hit and break events',
    sounds.has(SOUND_EVENT.SHIELD_HIT) && sounds.has(SOUND_EVENT.SHIELD_BREAK));
  e.destroy();
}

// Missing source coordinates deliberately identify environmental/contact harm:
// fall, fire, acid, lava and burial use this same unshieldable route.
{
  const e = arena();
  const id = e.spawnPlayer(80, FLOOR - 8);
  activateWard(e, id);
  const healthDamage = e._damagePlayer(id, 20);
  const p = e.getPlayer(id);
  check('source-less environmental damage bypasses the directional ward',
    healthDamage === 20 && p.health === 80 && p.shieldHealth === 200);
  e.destroy();
}

// The shared explosion actor path supplies its blast centre as the incoming
// direction, covering dynamite, cluster bomblets, blast rounds and minigun puffs.
{
  const e = arena();
  const id = e.spawnPlayer(80, FLOOR - 8);
  const { cx, cy } = activateWard(e, id);
  e._detonateTnt(Math.round(cx + 12), Math.round(cy));
  const p = e.getPlayer(id);
  check('a frontal explosion drains ward durability without damaging health',
    p.health === 100 && p.shieldHealth < 200);
  e.destroy();
}

// Bore damage is instantaneous rather than a projectile collision, so verify
// its dedicated line path also supplies the sentinel muzzle as the source.
{
  const e = arena();
  const id = e.spawnPlayer(28, FLOOR - 8);
  e.spawnCreature(CREATURE.BORE_SENTINEL, 90, FLOOR - 6);
  let p = e.getPlayer(id);
  for (let tick = 0; tick < 120 && p.shieldHealth === 200; tick++) {
    e.setPlayerInput(id, {
      bits: INPUT.SHIELD, aimX: 150, aimY: p.y + p.h * .5, seq: tick + 1,
    });
    e.stepActors();
    p = e.getPlayer(id);
  }
  check('a frontal bore beam is absorbed by the ward',
    p.health === 100 && p.shieldHealth < 200);
  e.destroy();
}

// Swept minigun rounds detonate through the explosion path after actor contact.
{
  const e = arena();
  const id = e.spawnPlayer(72, FLOOR - 8);
  e.spawnCreature(CREATURE.MINIGUNNER, 122, FLOOR - 6);
  let p = e.getPlayer(id);
  for (let tick = 0; tick < 100 && p.shieldHealth === 200; tick++) {
    e.setPlayerInput(id, {
      bits: INPUT.SHIELD, aimX: 150, aimY: p.y + p.h * .5, seq: tick + 1,
    });
    e.stepActors();
    p = e.getPlayer(id);
  }
  check('frontal minigun impacts are absorbed by the ward',
    p.health === 100 && p.shieldHealth < 200);
  e.destroy();
}

// Contact attacks use the creature centre rather than becoming untyped damage.
{
  const e = arena();
  const id = e.spawnPlayer(80, FLOOR - 8);
  e.spawnCreature(CREATURE.FOX, 92, FLOOR - 4);
  let p = e.getPlayer(id);
  for (let tick = 0; tick < 120 && p.shieldHealth === 200; tick++) {
    e.setPlayerInput(id, {
      bits: INPUT.SHIELD, aimX: 140, aimY: p.y + p.h * .5, seq: tick + 1,
    });
    e.stepActors();
    p = e.getPlayer(id);
  }
  check('a frontal creature melee attack is absorbed by the ward',
    p.health === 100 && p.shieldHealth < 200);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
