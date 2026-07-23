// Deterministic combat regression for /game: the starter blast gun, the
// dynamiteer's fused throw, and the bore sentinel's telegraphed two-layer cut.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import {
  CREATURE, CREATURE_ATTACK_STATE, ITEM_KIND, OFF, PROJECTILE_KIND, SOUND_EVENT, STRIDES,
} from '../src/sand/wasmBridge/abi.generated.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('explosive survival combat');
const COLS = 180, ROWS = 120, FLOOR = 104;
const PI_PRIMARY = 16;

function arena({ wall = false, background = false } = {}) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0xB1057, sinksOn: false, infinite: false });
  e.setSurvivalInventory(true);
  e.setCreatureRuntime(true, false);
  for (let x = 2; x < COLS - 2; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  if (wall) for (let x = 54; x <= 58; x++) for (let y = 74; y < FLOOR; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  if (background) {
    for (let x = 2; x < COLS - 2; x++) for (let y = FLOOR; y < ROWS; y++) e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
    if (wall) for (let x = 54; x <= 58; x++) for (let y = 74; y < FLOOR; y++) e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
    e.syncComponentsLayer(1);
  }
  return e;
}

// The muzzle sweep begins inside actor space, so it cannot teleport through an
// adjacent cell; non-owner players also trigger the explosive round in co-op.
{
  const e = arena();
  const shooter = e.spawnPlayer(24, FLOOR - 8);
  for (let y = FLOOR - 7; y < FLOOR; y++) e.placeMaterial(28, y, 0, MAT.STONE);
  e.syncComponents();
  e.setPlayerInput(shooter, { bits: PI_PRIMARY, aimX: 80, aimY: FLOOR - 4, seq: 1 });
  e.stepActors();
  check('muzzle sweep detonates on an immediately adjacent wall', e.getProjectiles().length === 0
    && e.getGrid()[(FLOOR - 4) * COLS + 28] === MAT.EMPTY);
  check('point-blank wall impact keeps the owner safe', e.getPlayer(shooter).health === 100);
  e.destroy();

  const pvp = arena();
  const owner = pvp.spawnPlayer(24, FLOOR - 8);
  const teammate = pvp.spawnPlayer(45, FLOOR - 8);
  pvp.setPlayerInput(owner, { bits: PI_PRIMARY, aimX: 90, aimY: FLOOR - 4, seq: 1 });
  for (let i = 0; i < 4 && pvp.getPlayer(teammate).health === 100; i++) pvp.stepActors();
  check('a non-owner player triggers and takes the blast', pvp.getPlayer(teammate).health < 100);
  check('co-op impact still preserves owner immunity', pvp.getPlayer(owner).health === 100);
  pvp.destroy();
}

function drainTypes(e, into) {
  const packed = e.drainSoundEvents();
  const type = OFF.soundEvent.type;
  for (let i = 0; i < packed.length; i += STRIDES.soundEvent) into.add(packed[i + type] | 0);
}

const countStone = (grid) => grid.reduce((total, material) => total + (material === MAT.STONE ? 1 : 0), 0);

// The selected starter weapon launches a swept blast round. It can hit a
// creature between actor frames, damages terrain and that creature, emits both
// weapon/explosion audio, and never hurts its owner.
{
  const e = arena();
  const player = e.spawnPlayer(24, FLOOR - 8);
  const enemy = e.spawnCreature(CREATURE.DYNAMITEER, 60, FLOOR - 5);
  e.setCreatureRuntime(false, false); // stationary target; projectile + blast systems still run
  const kit = e.getInventory(player);
  check('player spawns with the blast gun selected', kit.selected === 0
    && kit.slots[0].itemKind === ITEM_KIND.BLAST_GUN && kit.slots[0].count === 1);
  const healthBefore = e.getCreatures().find((c) => c.id === enemy).health;
  const stoneBefore = countStone(e.getGrid());
  const sounds = new Set();
  e.setPlayerInput(player, { bits: PI_PRIMARY, aimX: 64, aimY: FLOOR - 2.5, seq: 1 });
  e.stepActors(); drainTypes(e, sounds);
  check('primary fire creates a high-velocity blast round', e.getProjectiles().some((p) =>
    p.kind === PROJECTILE_KIND.BLAST_ROUND && Math.hypot(p.vx, p.vy) > 11));
  e.setPlayerInput(player, { bits: 0, aimX: 64, aimY: FLOOR - 2.5, seq: 2 });
  for (let i = 0; i < 8 && e.getProjectiles().length; i++) { e.stepActors(); drainTypes(e, sounds); }
  const healthAfter = e.getCreatures().find((c) => c.id === enemy).health;
  check(`impact blast damages its creature target (${healthBefore} -> ${healthAfter})`, healthAfter < healthBefore);
  check('impact blast carves nearby terrain', countStone(e.getGrid()) < stoneBefore);
  check('the firing player is immune to their own round', e.getPlayer(player).health === 100);
  check('gunshot and explosion semantic sounds are emitted', sounds.has(SOUND_EVENT.BLAST_GUN) && sounds.has(SOUND_EVENT.EXPLOSION));
  e.destroy();
}

// A dynamiteer visibly winds up, launches a rotating/bouncing projectile with a
// replicated fuse, and its autonomous detonation hurts the player and terrain.
{
  const e = arena();
  const player = e.spawnPlayer(30, FLOOR - 8);
  const thrower = e.spawnCreature(CREATURE.DYNAMITEER, 66, FLOOR - 5);
  const stoneBefore = countStone(e.getGrid());
  const sounds = new Set();
  let sawCharge = false, sawThrow = false, rotationFinite = true, firstFuse = 0, minFuse = Infinity;
  for (let tick = 0; tick < 190; tick++) {
    e.stepActors(); drainTypes(e, sounds);
    const c = e.getCreatures().find((candidate) => candidate.id === thrower);
    sawCharge ||= c?.attackState === CREATURE_ATTACK_STATE.CHARGING && c.attackProgress > 0;
    const dynamite = e.getProjectiles().find((p) => p.kind === PROJECTILE_KIND.DYNAMITE);
    if (dynamite) {
      sawThrow = true;
      if (!firstFuse) firstFuse = dynamite.fuse;
      minFuse = Math.min(minFuse, dynamite.fuse);
      rotationFinite &&= Number.isFinite(dynamite.rotation);
    }
    if (sawThrow && !dynamite) break;
  }
  check('dynamiteer enters a replicated wind-up state', sawCharge);
  check(`dynamiteer throws a live fused projectile (${firstFuse} -> ${minFuse})`, sawThrow && firstFuse > minFuse && minFuse > 0);
  check('thrown dynamite exposes finite rotation throughout flight', rotationFinite);
  check('dynamite expires into an autonomous explosion', !e.getProjectiles().some((p) => p.kind === PROJECTILE_KIND.DYNAMITE)
    && sounds.has(SOUND_EVENT.FUSE) && sounds.has(SOUND_EVENT.EXPLOSION));
  check('enemy dynamite damages the player', e.getPlayer(player).health < 100 || !e.getPlayer(player).alive);
  check('enemy dynamite destroys terrain', countStone(e.getGrid()) < stoneBefore);
  e.destroy();
}

// Enemy throws use the same swept path rule as the gun: the projectile begins
// inside actor space rather than teleporting past a wall touching the thrower.
{
  const e = arena();
  e.spawnPlayer(30, FLOOR - 8);
  const thrower = e.spawnCreature(CREATURE.DYNAMITEER, 66, FLOOR - 5);
  for (let y = FLOOR - 6; y < FLOOR; y++) e.placeMaterial(65, y, 0, MAT.STONE);
  e.syncComponents();
  let thrown = null;
  for (let tick = 0; tick < 50 && !thrown; tick++) {
    e.stepActors();
    thrown = e.getProjectiles().find((p) => p.kind === PROJECTILE_KIND.DYNAMITE);
  }
  const actor = e.getCreatures().find((c) => c.id === thrower);
  check('dynamite originates on the thrower side of an adjacent wall', thrown && actor && thrown.x > 65 && thrown.x >= actor.x);
  e.destroy();
}

// The bore sentinel tracks, then locks, its aim before firing. The cut uses the
// component-aware batch eraser in both layers and its thick segment hurts actors.
{
  const e = arena({ wall: true, background: true });
  const player = e.spawnPlayer(24, FLOOR - 8);
  const sentinel = e.spawnCreature(CREATURE.BORE_SENTINEL, 86, FLOOR - 6);
  const cutCell = (FLOOR - 4) * COLS + 56;
  check('bore test wall begins in both simulated layers', e.getGrid()[cutCell] === MAT.STONE && e.getGridBg()[cutCell] === MAT.STONE);
  const sounds = new Set();
  let sawCharge = false, sawLockedAim = false, sawFire = false;
  for (let tick = 0; tick < 100; tick++) {
    e.stepActors(); drainTypes(e, sounds);
    const c = e.getCreatures().find((candidate) => candidate.id === sentinel);
    if (c?.attackState === CREATURE_ATTACK_STATE.CHARGING) {
      sawCharge ||= c.attackProgress > 0.25;
      sawLockedAim ||= c.attackProgress > 0.80 && c.aimX < c.x;
    }
    sawFire ||= c?.attackState === CREATURE_ATTACK_STATE.FIRING;
  }
  check('bore sentinel telegraphs and locks an aim toward the player', sawCharge && sawLockedAim);
  check('bore sentinel exposes a replicated firing animation window', sawFire);
  check('bore beam damages the player', e.getPlayer(player).health === 58);
  check('bore beam cuts the foreground and background wall', e.getGrid()[cutCell] === MAT.EMPTY && e.getGridBg()[cutCell] === MAT.EMPTY);
  check('bore charge and fire semantic sounds are emitted', sounds.has(SOUND_EVENT.BORE_CHARGE) && sounds.has(SOUND_EVENT.BORE_FIRE));
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
