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
  check('point-blank ground/wall impact deals only a small self-hit',
    e.getPlayer(shooter).health >= 90 && e.getPlayer(shooter).health < 100);
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

function killForWeaponDrop(e, species, itemKind, x, y, label) {
  const id = e.spawnCreature(species, x, y);
  const creature = e.getCreatures().find((candidate) => candidate.id === id);
  const hitX = Math.floor(creature.x + creature.w * 0.5);
  const hitY = Math.floor(creature.y + creature.h * 0.5);
  check(`${label} can be dealt lethal damage`, e.damageCreatures(hitX, hitY, 2, 999));
  e.stepActors();
  check(`${label} enters its corpse state`, e.getCreatures().find((candidate) => candidate.id === id)?.alive === false);
  for (let tick = 0; tick < 25; tick++) e.stepActors();
  const drops = e.getItems().filter((item) => item.kind === 0 && item.itemKind === itemKind);
  check(`${label} death drops exactly one weapon and never duplicates it`, drops.length === 1 && drops[0].count === 1);
  return drops[0];
}

function collectAndEquipWeapon(e, playerId, itemKind, drop, label) {
  const player = e.getPlayer(playerId);
  e.setPlayerState(playerId, {
    ...player,
    x: drop.x - player.w * 0.5,
    y: Math.min(FLOOR - player.h, drop.y - player.h),
    vx: 0,
    vy: 0,
    grounded: true,
  });
  for (let tick = 0; tick < 20; tick++) {
    e.stepActors();
    if (e.getInventory(playerId).slots.some((slot) => slot.itemKind === itemKind && slot.count === 1)) break;
  }
  const inventory = e.getInventory(playerId);
  const slot = inventory.slots.findIndex((candidate) => candidate.itemKind === itemKind && candidate.count === 1);
  check(`${label} can be picked up`, slot >= 0 && !e.getItems().some((item) => item.itemKind === itemKind));
  if (slot >= 0) e.setSelectedSlot(playerId, slot);
  const equipped = e.getInventory(playerId);
  check(`${label} can be equipped`, slot >= 0 && equipped.selected === slot
    && e.getPlayer(playerId).heldItemKind === itemKind);
  return slot;
}

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

// Armed enemies deterministically surrender their weapon once. The generic
// dropped-item path carries that special stack into the inventory, where the
// captured satchel can be equipped and used to throw a player-owned charge.
{
  const e = arena();
  const player = e.spawnPlayer(18, FLOOR - 8);
  const drop = killForWeaponDrop(
    e, CREATURE.DYNAMITEER, ITEM_KIND.DYNAMITE_SATCHEL, 82, FLOOR - 5, 'dynamiteer',
  );
  const slot = collectAndEquipWeapon(e, player, ITEM_KIND.DYNAMITE_SATCHEL, drop, 'dynamite satchel');
  const pose = e.getPlayer(player);
  e.setPlayerInput(player, {
    bits: PI_PRIMARY,
    aimX: Math.min(COLS - 4, pose.x + 54),
    aimY: pose.y + pose.h * 0.35,
    seq: 1,
  });
  e.stepActors();
  const thrown = e.getProjectiles().find((projectile) =>
    projectile.kind === PROJECTILE_KIND.DYNAMITE && projectile.owner === player);
  check('equipped dynamite satchel throws a live player-owned charge',
    slot >= 0 && thrown?.fuse > 0 && thrown.vx > 0 && Number.isFinite(thrown.rotation));
  for (let tick = 0; tick < 25; tick++) e.stepActors();
  check('dynamiteer corpse cleanup does not create another satchel',
    !e.getItems().some((item) => item.itemKind === ITEM_KIND.DYNAMITE_SATCHEL)
      && e.getInventory(player).slots.filter((item) =>
        item.itemKind === ITEM_KIND.DYNAMITE_SATCHEL && item.count > 0).length === 1);
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

// The captured bore cannon has a harmless charge window, then reuses the
// component-aware bore path to cut terrain and damage a target without hitting
// its owner.
{
  const e = arena();
  const player = e.spawnPlayer(18, FLOOR - 8);
  const drop = killForWeaponDrop(
    e, CREATURE.BORE_SENTINEL, ITEM_KIND.BORE_CANNON, 76, FLOOR - 6, 'bore sentinel',
  );
  const slot = collectAndEquipWeapon(e, player, ITEM_KIND.BORE_CANNON, drop, 'bore cannon');
  const pose = e.getPlayer(player);
  const beamY = Math.floor(pose.y + pose.h * 0.42);
  const wallX = Math.min(COLS - 40, Math.floor(pose.x) + 30);
  for (let y = beamY - 8; y <= beamY + 8; y++) e.placeMaterial(wallX, y, 0, MAT.STONE);
  e.syncComponents();
  const target = e.spawnCreature(CREATURE.DYNAMITEER, wallX + 24, FLOOR - 5);
  e.setCreatureRuntime(false, false);
  const cutCell = beamY * COLS + wallX;
  const targetHealth = e.getCreatures().find((creature) => creature.id === target)?.health;
  let seq = 0;
  for (let tick = 0; tick < 59; tick++) {
    e.setPlayerInput(player, { bits: PI_PRIMARY, aimX: COLS - 4, aimY: beamY, seq: ++seq });
    e.stepActors();
  }
  check('bore cannon charge is visible but non-destructive',
    slot >= 0 && e.getGrid()[cutCell] === MAT.STONE
      && e.getCreatures().find((creature) => creature.id === target)?.health === targetHealth);
  e.setPlayerInput(player, { bits: PI_PRIMARY, aimX: COLS - 4, aimY: beamY, seq: ++seq });
  e.stepActors();
  check('charged bore cannon carves its aimed line', e.getGrid()[cutCell] === MAT.EMPTY);
  const boreFlash = e.getProjectiles().find((projectile) =>
    projectile.kind === PROJECTILE_KIND.BORE_BEAM && projectile.owner === player);
  check('player bore shot exposes a latched replicated firing beam',
    boreFlash?.fuse > 0 && boreFlash.vx > 0.99 && Math.abs(boreFlash.vy) < 0.02);
  check('charged bore cannon damages an enemy beyond the wall',
    e.getCreatures().find((creature) => creature.id === target)?.health < targetHealth);
  check('bore cannon preserves its owner immunity', e.getPlayer(player).health === 100);
  for (let tick = 0; tick < 25; tick++) e.stepActors();
  check('bore sentinel corpse cleanup does not create another cannon',
    !e.getItems().some((item) => item.itemKind === ITEM_KIND.BORE_CANNON)
      && e.getInventory(player).slots.filter((item) =>
        item.itemKind === ITEM_KIND.BORE_CANNON && item.count > 0).length === 1);
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

// The bore sentinel tracks for 60 ticks, then leaves a harmless committed line
// for 30 more ticks before firing. The cut uses the component-aware batch eraser
// in both layers and its thick segment hurts actors that did not dodge.
{
  const e = arena({ wall: true, background: true });
  const dodger = e.spawnPlayer(24, FLOOR - 8);
  const sentinel = e.spawnCreature(CREATURE.BORE_SENTINEL, 86, FLOOR - 6);
  const cutCell = (FLOOR - 4) * COLS + 56;
  check('bore test wall begins in both simulated layers', e.getGrid()[cutCell] === MAT.STONE && e.getGridBg()[cutCell] === MAT.STONE);
  const sounds = new Set();
  e.stepActors(); drainTypes(e, sounds); // acquire target and enter charge
  for (let tick = 0; tick < 60; tick++) { e.stepActors(); drainTypes(e, sounds); }
  const lockStart = e.getCreatures().find((candidate) => candidate.id === sentinel);
  check('bore warning tracks for exactly 60 charge ticks before locking',
    lockStart?.attackState === CREATURE_ATTACK_STATE.CHARGING
      && lockStart.attackProgress > 0.65 && lockStart.attackProgress < 0.68);
  const lockedAim = { x: lockStart?.aimX, y: lockStart?.aimY };

  const beforeDodge = e.getPlayer(dodger);
  e.setPlayerState(dodger, { ...beforeDodge, x: beforeDodge.x, y: 15, vx: 0, vy: 0 });
  const victim = e.spawnPlayer(24, FLOOR - 8);
  for (let tick = 0; tick < 29; tick++) { e.stepActors(); drainTypes(e, sounds); }
  const finalWarning = e.getCreatures().find((candidate) => candidate.id === sentinel);
  check('bore aim stays committed for the final 30-tick dodge window',
    finalWarning?.attackState === CREATURE_ATTACK_STATE.CHARGING
      && finalWarning.attackProgress > 0.98
      && Math.abs(finalWarning.aimX - lockedAim.x) < 1e-4
      && Math.abs(finalWarning.aimY - lockedAim.y) < 1e-4);
  check('the full 90-tick warning remains non-destructive',
    e.getPlayer(dodger).health === 100 && e.getPlayer(victim).health === 100
      && e.getGrid()[cutCell] === MAT.STONE && e.getGridBg()[cutCell] === MAT.STONE);

  e.stepActors(); drainTypes(e, sounds);
  const fired = e.getCreatures().find((candidate) => candidate.id === sentinel);
  check('bore sentinel exposes a replicated firing animation window',
    fired?.attackState === CREATURE_ATTACK_STATE.FIRING);
  check('the locked warning gives the original target time to dodge', e.getPlayer(dodger).health === 100);
  check('bore beam damages an actor that remains on the committed line', e.getPlayer(victim).health === 58);
  check('bore beam cuts the foreground and background wall', e.getGrid()[cutCell] === MAT.EMPTY && e.getGridBg()[cutCell] === MAT.EMPTY);
  check('bore charge and fire semantic sounds are emitted', sounds.has(SOUND_EVENT.BORE_CHARGE) && sounds.has(SOUND_EVENT.BORE_FIRE));
  e.destroy();
}

// Each new demolition crew has an autonomous telegraph and emits its distinct
// projectile/sound from the AI path—not just from the captured player weapon.
{
  const scenarios = [
    {
      label: 'caustic mortarman', species: CREATURE.CAUSTIC_MORTARMAN,
      x: 68, y: FLOOR - 6, projectile: PROJECTILE_KIND.ACID_SHELL,
      sound: SOUND_EVENT.ACID_MORTAR,
    },
    {
      label: 'cluster wasp', species: CREATURE.CLUSTER_WASP,
      x: 70, y: FLOOR - 28, projectile: PROJECTILE_KIND.CLUSTER_BOMB,
      sound: SOUND_EVENT.CLUSTER_LAUNCH,
    },
    {
      label: 'quake brute', species: CREATURE.QUAKE_BRUTE,
      x: 68, y: FLOOR - 7, projectile: PROJECTILE_KIND.SEISMIC_WAVE,
      sound: SOUND_EVENT.QUAKE,
    },
  ];
  for (const scenario of scenarios) {
    const e = arena();
    e.spawnPlayer(30, FLOOR - 8);
    const enemy = e.spawnCreature(scenario.species, scenario.x, scenario.y);
    const sounds = new Set();
    let sawCharge = false, sawProjectile = false;
    for (let tick = 0; tick < 100; tick++) {
      e.stepActors(); drainTypes(e, sounds);
      const creature = e.getCreatures().find((candidate) => candidate.id === enemy);
      sawCharge ||= creature?.attackState === CREATURE_ATTACK_STATE.CHARGING
        && creature.attackProgress > 0;
      sawProjectile ||= e.getProjectiles().some((projectile) =>
        projectile.kind === scenario.projectile);
      if (sawCharge && sawProjectile && sounds.has(scenario.sound)) break;
    }
    check(`${scenario.label} telegraphs and launches its autonomous attack`,
      sawCharge && sawProjectile && sounds.has(scenario.sound));
    e.destroy();
  }
}

// Defeating each new crew member yields one polished, singleton weapon. The
// ordinary pickup/equip path then drives the same destructive projectile logic.
{
  const e = arena();
  const player = e.spawnPlayer(18, FLOOR - 8);
  const drop = killForWeaponDrop(
    e, CREATURE.CAUSTIC_MORTARMAN, ITEM_KIND.ACID_MORTAR,
    78, FLOOR - 6, 'caustic mortarman',
  );
  const slot = collectAndEquipWeapon(e, player, ITEM_KIND.ACID_MORTAR, drop, 'acid mortar');
  const acidBefore = e.getGrid().reduce((n, material) => n + (material === MAT.ACID ? 1 : 0), 0);
  e.setPlayerInput(player, { bits: PI_PRIMARY, aimX: 76, aimY: FLOOR - 1, seq: 1 });
  e.stepActors();
  let sawShell = e.getProjectiles().some((p) => p.kind === PROJECTILE_KIND.ACID_SHELL && p.owner === player);
  e.setPlayerInput(player, { bits: 0, aimX: 76, aimY: FLOOR - 1, seq: 2 });
  for (let tick = 0; tick < 90; tick++) {
    e.stepActors();
    sawShell ||= e.getProjectiles().some((p) => p.kind === PROJECTILE_KIND.ACID_SHELL && p.owner === player);
    if (sawShell && !e.getProjectiles().some((p) => p.kind === PROJECTILE_KIND.ACID_SHELL)) break;
  }
  const acidAfter = e.getGrid().reduce((n, material) => n + (material === MAT.ACID ? 1 : 0), 0);
  check(`captured acid mortar leaves a corrosive pool (${acidBefore} -> ${acidAfter})`,
    slot >= 0 && sawShell && acidAfter > acidBefore);
  e.destroy();
}

{
  const e = arena();
  const player = e.spawnPlayer(18, FLOOR - 8);
  const drop = killForWeaponDrop(
    e, CREATURE.CLUSTER_WASP, ITEM_KIND.CLUSTER_LAUNCHER,
    78, FLOOR - 30, 'cluster wasp',
  );
  const slot = collectAndEquipWeapon(e, player, ITEM_KIND.CLUSTER_LAUNCHER, drop, 'cluster launcher');
  const stoneBefore = countStone(e.getGrid());
  e.setPlayerInput(player, { bits: PI_PRIMARY, aimX: 78, aimY: FLOOR - 1, seq: 1 });
  e.stepActors();
  e.setPlayerInput(player, { bits: 0, aimX: 78, aimY: FLOOR - 1, seq: 2 });
  let sawCarrier = false, maxBomblets = 0;
  for (let tick = 0; tick < 100; tick++) {
    e.stepActors();
    const cluster = e.getProjectiles().filter((p) => p.kind === PROJECTILE_KIND.CLUSTER_BOMB);
    sawCarrier ||= cluster.some((p) => p.charge < 0.5);
    maxBomblets = Math.max(maxBomblets, cluster.filter((p) => p.charge > 0.5).length);
  }
  check(`captured cluster launcher splits into five live bomblets (max ${maxBomblets})`,
    slot >= 0 && sawCarrier && maxBomblets === 5);
  const stoneAfter = countStone(e.getGrid());
  check(`cluster bomblets leave multiple destructive craters (${stoneBefore} -> ${stoneAfter})`,
    stoneAfter < stoneBefore);
  e.destroy();
}

{
  const e = arena({ background: true });
  const player = e.spawnPlayer(18, FLOOR - 8);
  const drop = killForWeaponDrop(
    e, CREATURE.QUAKE_BRUTE, ITEM_KIND.SEISMIC_HAMMER,
    72, FLOOR - 7, 'quake brute',
  );
  const slot = collectAndEquipWeapon(e, player, ITEM_KIND.SEISMIC_HAMMER, drop, 'seismic hammer');
  const foregroundBefore = countStone(e.getGrid());
  const backgroundBefore = countStone(e.getGridBg());
  e.setPlayerInput(player, { bits: PI_PRIMARY, aimX: 90, aimY: FLOOR - 1, seq: 1 });
  e.stepActors();
  let sawWave = e.getProjectiles().some((p) =>
    p.kind === PROJECTILE_KIND.SEISMIC_WAVE && p.owner === player);
  e.setPlayerInput(player, { bits: 0, aimX: 90, aimY: FLOOR - 1, seq: 2 });
  for (let tick = 0; tick < 12; tick++) {
    e.stepActors();
    sawWave ||= e.getProjectiles().some((p) =>
      p.kind === PROJECTILE_KIND.SEISMIC_WAVE && p.owner === player);
  }
  check('captured seismic hammer launches a ground-following fracture', slot >= 0 && sawWave);
  check('seismic fracture cuts component terrain in both simulated layers',
    countStone(e.getGrid()) < foregroundBefore && countStone(e.getGridBg()) < backgroundBefore);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
