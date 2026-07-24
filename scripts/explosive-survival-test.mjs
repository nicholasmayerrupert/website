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
const WEAPON_PICKUP_AMMO = Object.freeze({
  [ITEM_KIND.DYNAMITE_SATCHEL]: 10,
  [ITEM_KIND.BORE_CANNON]: 15,
  [ITEM_KIND.ACID_MORTAR]: 20,
  [ITEM_KIND.CLUSTER_LAUNCHER]: 15,
  [ITEM_KIND.MINIGUN]: 250,
});

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

function drainTypeCount(e, wantedType) {
  const packed = e.drainSoundEvents();
  const type = OFF.soundEvent.type;
  let count = 0;
  for (let i = 0; i < packed.length; i += STRIDES.soundEvent)
    if ((packed[i + type] | 0) === wantedType) count++;
  return count;
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
  const expectedAmmo = WEAPON_PICKUP_AMMO[itemKind];
  check(`${label} death drops one fully loaded weapon (${expectedAmmo} ammo)`,
    drops.length === 1 && drops[0].count === expectedAmmo);
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
  const expectedAmmo = WEAPON_PICKUP_AMMO[itemKind];
  for (let tick = 0; tick < 20; tick++) {
    e.stepActors();
    if (e.getInventory(playerId).slots.some((slot) =>
      slot.itemKind === itemKind && slot.count === expectedAmmo)) break;
  }
  const inventory = e.getInventory(playerId);
  const slot = inventory.slots.findIndex((candidate) =>
    candidate.itemKind === itemKind && candidate.count === expectedAmmo);
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
  check('gunshot and unsuppressed weapon-explosion sounds are emitted',
    sounds.has(SOUND_EVENT.BLAST_GUN) && sounds.has(SOUND_EVENT.WEAPON_EXPLOSION));
  e.destroy();
}

// Held automatic fire retains the starter gun's behavior, but its cadence is
// now exactly half the previous 11-tick rate.
{
  const e = arena();
  const player = e.spawnPlayer(24, FLOOR - 8);
  let shots = 0;
  for (let tick = 0; tick < 22; tick++) {
    e.setPlayerInput(player, {
      bits: PI_PRIMARY, aimX: COLS - 3, aimY: FLOOR - 4, seq: tick + 1,
    });
    e.stepActors();
    shots += drainTypeCount(e, SOUND_EVENT.BLAST_GUN);
  }
  check('starter blast gun fires only once in its 22-tick half-rate window',
    shots === 1);
  e.setPlayerInput(player, {
    bits: PI_PRIMARY, aimX: COLS - 3, aimY: FLOOR - 4, seq: 23,
  });
  e.stepActors();
  shots += drainTypeCount(e, SOUND_EVENT.BLAST_GUN);
  check('starter blast gun fires again on tick 22 while held',
    shots === 2);
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
  check('a successful dynamite throw consumes exactly one satchel charge',
    e.getInventory(player).slots[slot]?.count === 9);
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
  let extendedVictimStaged = false, extendedVictimDistance = 0, healthBeforeExtendedBlast = 0;
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
      if (dynamite.fuse === 1 && !extendedVictimStaged) {
        const victim = e.getPlayer(player);
        const blastX = Math.round(dynamite.x) + 0.5;
        const blastY = Math.round(dynamite.y) + 0.5;
        const onRight = blastX + 25 + victim.w < COLS - 1;
        const victimX = onRight ? blastX + 25 : blastX - 25 - victim.w;
        const victimY = Math.max(1, Math.min(FLOOR - victim.h, blastY - victim.h * 0.5));
        e.setPlayerState(player, {
          ...victim, x: victimX, y: victimY, vx: 0, vy: 0, grounded: false,
        });
        const nearestX = Math.max(victimX, Math.min(blastX, victimX + victim.w));
        const nearestY = Math.max(victimY, Math.min(blastY, victimY + victim.h));
        extendedVictimDistance = Math.hypot(nearestX - blastX, nearestY - blastY);
        healthBeforeExtendedBlast = victim.health;
        extendedVictimStaged = true;
      }
    }
    if (sawThrow && !dynamite) break;
  }
  check('dynamiteer enters a replicated wind-up state', sawCharge);
  check(`dynamiteer throws a live fused projectile (${firstFuse} -> ${minFuse})`, sawThrow && firstFuse > minFuse && minFuse > 0);
  check('thrown dynamite exposes finite rotation throughout flight', rotationFinite);
  check('dynamite expires into an autonomous explosion', !e.getProjectiles().some((p) => p.kind === PROJECTILE_KIND.DYNAMITE)
    && sounds.has(SOUND_EVENT.FUSE) && sounds.has(SOUND_EVENT.WEAPON_EXPLOSION));
  check('enemy dynamite damages the player', e.getPlayer(player).health < 100 || !e.getPlayer(player).alive);
  check(`enlarged dynamite blast deals heavy damage beyond the old radius (${extendedVictimDistance.toFixed(1)} cells)`,
    extendedVictimStaged && extendedVictimDistance > 22
      && healthBeforeExtendedBlast - e.getPlayer(player).health >= 20);
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
  check('a fired bore beam consumes exactly one cannon charge',
    e.getInventory(player).slots[slot]?.count === 14);
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
      label: 'minigunner', species: CREATURE.MINIGUNNER,
      x: 68, y: FLOOR - 6, projectile: PROJECTILE_KIND.MINIGUN_ROUND,
      sound: SOUND_EVENT.MINIGUN,
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
  check('a launched acid shell consumes exactly one mortar round',
    e.getInventory(player).slots[slot]?.count === 19);
  let shell = e.getProjectiles().find((p) =>
    p.kind === PROJECTILE_KIND.ACID_SHELL && p.owner === player);
  let sawShell = Boolean(shell);
  let sawLargeShell = (shell?.charge ?? 0) > 1.5;
  e.setPlayerInput(player, { bits: 0, aimX: 76, aimY: FLOOR - 1, seq: 2 });
  for (let tick = 0; tick < 90; tick++) {
    e.stepActors();
    shell = e.getProjectiles().find((p) =>
      p.kind === PROJECTILE_KIND.ACID_SHELL && p.owner === player);
    sawShell ||= Boolean(shell);
    sawLargeShell ||= (shell?.charge ?? 0) > 1.5;
    if (sawShell && !e.getProjectiles().some((p) => p.kind === PROJECTILE_KIND.ACID_SHELL)) break;
  }
  const acidAfter = e.getGrid().reduce((n, material) => n + (material === MAT.ACID ? 1 : 0), 0);
  check('acid mortar exposes a larger shell collision/render scale',
    slot >= 0 && sawShell && sawLargeShell);
  check(`captured acid mortar leaves a doubled corrosive pool (${acidBefore} -> ${acidAfter})`,
    acidAfter - acidBefore >= 100);
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
  check('a launched cluster carrier consumes exactly one launcher round',
    e.getInventory(player).slots[slot]?.count === 14);
  const launchedCarrier = e.getProjectiles().find((p) =>
    p.kind === PROJECTILE_KIND.CLUSTER_BOMB && p.charge < 0.5);
  const blastVictim = e.spawnPlayer(145, FLOOR - 8);
  e.setPlayerInput(player, { bits: 0, aimX: 78, aimY: FLOOR - 1, seq: 2 });
  let sawCarrier = Boolean(launchedCarrier), maxBomblets = 0;
  let splitTick = -1, sixteenTogetherTicks = 0;
  let clusterExplosionSounds = 0;
  let firstChildFuses = null, blastVictimStaged = false, blastVictimDistance = 0;
  const childDirections = new Set();
  e.drainSoundEvents();
  for (let tick = 0; tick < 250; tick++) {
    e.stepActors();
    clusterExplosionSounds += drainTypeCount(e, SOUND_EVENT.WEAPON_EXPLOSION);
    const cluster = e.getProjectiles().filter((p) => p.kind === PROJECTILE_KIND.CLUSTER_BOMB);
    sawCarrier ||= cluster.some((p) => p.charge < 0.5);
    const children = cluster.filter((p) => p.charge > 0.5);
    if (children.length && splitTick < 0) splitTick = tick;
    if (children.length === 16 && !firstChildFuses)
      firstChildFuses = children.map((child) => child.fuse);
    if (children.length === 16) sixteenTogetherTicks++;
    maxBomblets = Math.max(maxBomblets, children.length);
    for (const child of children) childDirections.add(Math.round(Math.atan2(child.vy, child.vx) * 10));
    const expiring = children.find((child) => child.fuse === 1);
    if (expiring && !blastVictimStaged) {
      const victim = e.getPlayer(blastVictim);
      const blastX = Math.round(expiring.x) + 0.5;
      const blastY = Math.round(expiring.y) + 0.5;
      const onRight = blastX + 16 + victim.w < COLS - 1;
      const victimX = onRight ? blastX + 16 : blastX - 16 - victim.w;
      const victimY = Math.max(1, Math.min(FLOOR - victim.h, blastY - victim.h * 0.5));
      e.setPlayerState(blastVictim, {
        ...victim, x: victimX, y: victimY, vx: 0, vy: 0, grounded: false,
      });
      const nearestX = Math.max(victimX, Math.min(blastX, victimX + victim.w));
      const nearestY = Math.max(victimY, Math.min(blastY, victimY + victim.h));
      blastVictimDistance = Math.hypot(nearestX - blastX, nearestY - blastY);
      blastVictimStaged = true;
    }
  }
  check('cluster carrier splits on impact before its two-second airburst fallback',
    launchedCarrier && Math.hypot(launchedCarrier.vx, launchedCarrier.vy) < 3
      && launchedCarrier.fuse > 100 && splitTick >= 0 && splitTick < 100);
  check(`captured cluster launcher splits into exactly sixteen live mini-dynamites (max ${maxBomblets})`,
    slot >= 0 && sawCarrier && maxBomblets === 16);
  check(`all sixteen mini-dynamites use distinct 6-22 tick fuses (${firstChildFuses?.join('/')})`,
    firstChildFuses?.length === 16
      && firstChildFuses.every((fuse) => fuse >= 6 && fuse <= 22)
      && new Set(firstChildFuses).size === 16);
  check('all sixteen mini-dynamites scatter broadly and remain visible together',
    childDirections.size >= 12 && sixteenTogetherTicks >= 4);
  check(`double-radius cluster blasts damage beyond the old ten-cell radius (${blastVictimDistance.toFixed(1)} cells)`,
    blastVictimStaged && blastVictimDistance > 10 && e.getPlayer(blastVictim).health < 100);
  check(`each bomblet emits an unsuppressed TNT-palette explosion (${clusterExplosionSounds})`,
    clusterExplosionSounds === 16);
  const stoneAfter = countStone(e.getGrid());
  check(`cluster bomblets leave multiple destructive craters (${stoneBefore} -> ${stoneAfter})`,
    stoneAfter < stoneBefore);
  e.destroy();
}

{
  const e = arena();
  const player = e.spawnPlayer(18, FLOOR - 8);
  const drop = killForWeaponDrop(
    e, CREATURE.MINIGUNNER, ITEM_KIND.MINIGUN,
    72, FLOOR - 6, 'minigunner',
  );
  const slot = collectAndEquipWeapon(e, player, ITEM_KIND.MINIGUN, drop, 'minigun');
  const pose = e.getPlayer(player);
  const guardShoulderX = pose.x + pose.w * 0.5;
  const guardShoulderY = pose.y + pose.h * 0.42;
  const nearWallX = Math.floor(guardShoulderX + 3);
  const nearWallY = Math.floor(guardShoulderY - 0.68);
  e.placeMaterial(nearWallX, nearWallY, 0, MAT.STONE);
  e.syncComponents();
  const nearWallBefore = countStone(e.getGrid());
  e.setPlayerInput(player, {
    bits: PI_PRIMARY, aimX: nearWallX + 20, aimY: guardShoulderY, seq: 1,
  });
  e.stepActors();
  check('a successful minigun shot consumes exactly one round',
    e.getInventory(player).slots[slot]?.count === 249);
  const skippedCover = e.getProjectiles().some((projectile) =>
    projectile.kind === PROJECTILE_KIND.MINIGUN_ROUND
      && projectile.owner === player && projectile.x > nearWallX + 1);
  const nearWallAfter = countStone(e.getGrid());
  const healthAfterGuardShot = e.getPlayer(player).health;
  check('long minigun barrel cannot fire through nearby cover',
    !skippedCover && nearWallAfter < nearWallBefore);
  check('near-cover minigun blast preserves direct owner immunity',
    healthAfterGuardShot === 100);
  e.setPlayerInput(player, { bits: 0, aimX: nearWallX + 20, aimY: guardShoulderY, seq: 2 });
  e.stepActors();
  check('a cooldown tick without a shot consumes no minigun ammo',
    e.getInventory(player).slots[slot]?.count === 249);
  for (let tick = 0; tick < 2; tick++) e.stepActors();
  e.eraseDisc(nearWallX, nearWallY, 5);
  e.syncComponents();
  e.drainSoundEvents();
  const healthBeforeBurst = e.getPlayer(player).health;
  const impactY = Math.floor(pose.y + pose.h * 0.42);
  const wallX = 104;
  for (let y = impactY - 5; y <= impactY + 5; y++)
    for (let x = wallX; x <= wallX + 10; x++) e.placeMaterial(x, y, 0, MAT.STONE);
  e.syncComponents();
  const stoneBefore = countStone(e.getGrid());
  const seenRounds = new Set();
  let weaponExplosionSounds = 0;
  let fastestRound = 0;
  let muzzleError = Infinity;
  const aimX = wallX + 4, aimY = impactY;
  const shoulderX = pose.x + pose.w * 0.5;
  const shoulderY = pose.y + pose.h * 0.42;
  const aimLength = Math.hypot(aimX - shoulderX, aimY - shoulderY);
  const aimDx = (aimX - shoulderX) / aimLength;
  const aimDy = (aimY - shoulderY) / aimLength;
  const expectedMuzzleX = shoulderX + aimDx * 5.49 + aimDy * 0.68;
  const expectedMuzzleY = shoulderY + aimDy * 5.49 - aimDx * 0.68;
  let seq = 0;
  for (let tick = 0; tick < 14; tick++) {
    e.setPlayerInput(player, {
      bits: PI_PRIMARY, aimX, aimY, seq: ++seq,
    });
    e.stepActors();
    weaponExplosionSounds += drainTypeCount(e, SOUND_EVENT.WEAPON_EXPLOSION);
    for (const projectile of e.getProjectiles()) {
      if (projectile.kind !== PROJECTILE_KIND.MINIGUN_ROUND || projectile.owner !== player) continue;
      if (!seenRounds.has(projectile.id)) {
        const launchX = projectile.x - projectile.vx;
        const launchY = projectile.y - projectile.vy;
        muzzleError = Math.min(muzzleError,
          Math.hypot(launchX - expectedMuzzleX, launchY - expectedMuzzleY));
      }
      seenRounds.add(projectile.id);
      fastestRound = Math.max(fastestRound, Math.hypot(projectile.vx, projectile.vy));
    }
  }
  e.setPlayerInput(player, { bits: 0, aimX, aimY, seq: ++seq });
  for (let tick = 0; tick < 12; tick++) {
    e.stepActors();
    weaponExplosionSounds += drainTypeCount(e, SOUND_EVENT.WEAPON_EXPLOSION);
  }
  const carved = stoneBefore - countStone(e.getGrid());
  check(`captured minigun hold-fires an extremely fast burst (${seenRounds.size} rounds)`,
    slot >= 0 && seenRounds.size >= 6 && fastestRound > 14);
  check(`minigun rounds originate at the rendered hand-held muzzle (error ${muzzleError.toFixed(3)})`,
    muzzleError < 0.02);
  check(`minigun rounds make tiny component-safe craters (${carved} stone cells)`,
    carved > 0 && carved < 70);
  check(`every minigun impact emits its own weapon explosion (${weaponExplosionSounds}/${seenRounds.size})`,
    weaponExplosionSounds === seenRounds.size);
  check('captured minigun preserves owner immunity',
    e.getPlayer(player).health === healthBeforeBurst);
  e.destroy();
}

// Captured weapons are one indivisible item whose count is ammunition. Inventory
// moves preserve that count, right-click cannot split it into duplicate guns, and
// another pickup merges its full load into the existing weapon.
{
  const e = arena();
  const player = e.spawnPlayer(18, FLOOR - 8);
  const firstDrop = killForWeaponDrop(
    e, CREATURE.MINIGUNNER, ITEM_KIND.MINIGUN,
    72, FLOOR - 6, 'first ammo-test minigunner',
  );
  const slot = collectAndEquipWeapon(e, player, ITEM_KIND.MINIGUN, firstDrop, 'ammo-test minigun');

  e.inventoryCursorPick(player, slot, true);
  check('right-click carries the whole weapon instead of splitting its ammunition',
    e.getCursor(player)?.itemKind === ITEM_KIND.MINIGUN
      && e.getCursor(player)?.count === 250
      && e.getInventory(player).slots[slot]?.count === 0);
  e.inventoryCursorPick(player, slot, true);
  check('right-click places the whole weapon back into one slot',
    e.getCursor(player) === null
      && e.getInventory(player).slots[slot]?.itemKind === ITEM_KIND.MINIGUN
      && e.getInventory(player).slots[slot]?.count === 250);

  const movedSlot = 8;
  e.inventoryMove(player, slot, movedSlot);
  check('hotbar movement preserves a captured weapon ammo count',
    e.getInventory(player).slots[movedSlot]?.itemKind === ITEM_KIND.MINIGUN
      && e.getInventory(player).slots[movedSlot]?.count === 250);
  e.inventoryMove(player, movedSlot, slot);
  e.setSelectedSlot(player, slot);

  const pose = e.getPlayer(player);
  e.setPlayerInput(player, {
    bits: PI_PRIMARY, aimX: COLS - 3, aimY: pose.y - 12, seq: 1,
  });
  e.stepActors();
  e.setPlayerInput(player, {
    bits: PI_PRIMARY, aimX: COLS - 3, aimY: pose.y - 12, seq: 2,
  });
  e.stepActors();
  check('only the successful shot, not its cooldown tick, spends ammunition',
    e.getInventory(player).slots[slot]?.count === 249);
  e.setPlayerInput(player, { bits: 0, aimX: COLS - 3, aimY: pose.y - 12, seq: 3 });
  e.stepActors();

  const secondDrop = killForWeaponDrop(
    e, CREATURE.MINIGUNNER, ITEM_KIND.MINIGUN,
    150, FLOOR - 6, 'second ammo-test minigunner',
  );
  const beforePickup = e.getPlayer(player);
  e.setPlayerState(player, {
    ...beforePickup,
    x: secondDrop.x - beforePickup.w * 0.5,
    y: Math.min(FLOOR - beforePickup.h, secondDrop.y - beforePickup.h),
    vx: 0,
    vy: 0,
    grounded: true,
  });
  for (let tick = 0; tick < 20; tick++) {
    e.stepActors();
    if (!e.getItems().some((item) => item.itemKind === ITEM_KIND.MINIGUN)) break;
  }
  const merged = e.getInventory(player).slots.filter((item) =>
    item.itemKind === ITEM_KIND.MINIGUN && item.count > 0);
  check('a duplicate minigun pickup adds 250 ammo to the existing weapon',
    merged.length === 1 && merged[0].count === 499);
  e.destroy();
}

// Spending the final automatic round while PRIMARY remains down must not turn
// the newly empty hotbar slot into a bare-hand mining action.
{
  const e = arena();
  const player = e.spawnPlayer(18, FLOOR - 8);
  const drop = killForWeaponDrop(
    e, CREATURE.MINIGUNNER, ITEM_KIND.MINIGUN,
    72, FLOOR - 6, 'empty-latch minigunner',
  );
  const slot = collectAndEquipWeapon(e, player, ITEM_KIND.MINIGUN, drop, 'empty-latch minigun');
  const pose = e.getPlayer(player);
  let shots = 0;
  for (let tick = 0; tick < 520 && e.getInventory(player).slots[slot]?.count > 0; tick++) {
    e.setPlayerInput(player, {
      bits: PI_PRIMARY, aimX: COLS - 3, aimY: pose.y - 14, seq: tick + 1,
    });
    e.stepActors();
    shots += drainTypeCount(e, SOUND_EVENT.MINIGUN);
  }
  check('a full minigun load produces exactly 250 successful shots before emptying',
    shots === 250 && e.getInventory(player).slots[slot]?.count === 0);

  e.setSelectedSlot(player, 7); // slot changes must not bypass the held-trigger latch
  e.setSelectedFootprint(player, 0); // isolate trigger routing from 10x10 mining work scaling
  const mineX = Math.floor(e.getPlayer(player).x + 10);
  const mineY = Math.floor(e.getPlayer(player).y + 3);
  e.placeMaterial(mineX, mineY, 0, MAT.SAND);
  e.setPlayerInput(player, {
    bits: PI_PRIMARY, aimX: mineX, aimY: mineY, seq: 600,
  });
  for (let tick = 0; tick < 40; tick++) e.stepActors();
  check('held fire after the final round cannot become bare-hand mining after a slot change',
    e.getGrid()[mineY * COLS + mineX] === MAT.SAND);
  e.setPlayerInput(player, { bits: 0, aimX: mineX, aimY: mineY, seq: 601 });
  e.stepActors();
  e.setPlayerInput(player, {
    bits: PI_PRIMARY, aimX: mineX, aimY: mineY, seq: 602,
  });
  for (let tick = 0; tick < 64 && e.getGrid()[mineY * COLS + mineX] !== MAT.EMPTY; tick++)
    e.stepActors();
  check('releasing and pressing again restores bare-hand mining',
    e.getGrid()[mineY * COLS + mineX] === MAT.EMPTY);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
