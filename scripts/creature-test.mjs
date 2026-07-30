// Material-aware creature actor tests: health/hitboxes, aquatic confinement,
// prey tracking, amphibious locomotion, density caps, and streaming coordinates.

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import {
  CREATIVE_KIND, CREATURE, CREATURE_ATTACK_STATE, OFF, PROJECTILE_KIND,
  SOUND_EVENT, STRIDES,
} from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('material-aware creatures');
const COLS = 180, ROWS = 120;
const mk = (opts = {}) => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0xC4EA7, sinksOn: false, infinite: false, ...opts });
const actors = (e, n) => { for (let i = 0; i < n; i++) e.stepActors(); };
const waterBox = (e, x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) e.paintDisc(x, y, 0, MAT.WATER, true);
};
const stoneFloor = (e, top) => {
  for (let y = top; y < ROWS; y++) for (let x = 4; x < COLS - 4; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
};
const byId = (e, id) => e.getCreatures().find((c) => c.id === id);

check('roster includes fauna, combatants, and authored mission actors',
  Object.keys(CREATURE).join(',') === 'MINNOW,PIKE,FOX,HARE,CRAWLER,MOLE,BIRD,DYNAMITEER,BORE_SENTINEL,CAUSTIC_MORTARMAN,CLUSTER_WASP,MINIGUNNER,SURVEYOR,SHIELD_ANCHOR,QUARRY_FOREMAN,REACTOR_WARDEN');

// Retired fauna remain available to direct spawns, but even an ideal habitat
// must not add them to a natural population.
{
  const e = mk();
  waterBox(e, 4, 4, COLS - 4, ROWS - 4);
  e.setCreatureRuntime(true, true);
  e.stepActors();
  const species = e.getCreatures().filter((c) => c.alive).map((c) => c.species);
  check('water habitat does not naturally spawn minnows or pike',
    !species.includes(CREATURE.MINNOW) && !species.includes(CREATURE.PIKE));
  e.destroy();
}

// A bird may be engulfed by newly placed/falling water. Water blocks normal
// flight entry, but a submerged bird must climb back through it instead of
// bouncing forever inside the same wet cells.
{
  const e = mk();
  const bird = e.spawnCreature(CREATURE.BIRD, 70, 42);
  waterBox(e, 55, 30, 90, 70);
  e.setCreatureRuntime(true, false);
  actors(e, 180);
  const escaped = byId(e, bird);
  check(`submerged bird escapes above water (y ${escaped?.y.toFixed(1)})`, escaped && escaped.y + escaped.h < 31);
  e.destroy();
}

// Manual/scripted creatures count toward the population, but are not rejected
// by it. Once they take the active count to the cap, natural spawning pauses.
{
  const e = createEngineWasm({ cols: 448, rows: 320, worldSeed: 0xCA9, sinksOn: false, infinite: true });
  e.setCreativeMaterial(CREATIVE_KIND.CREATURE, CREATURE.BIRD);
  for (let i = 0; i < 10; i++) e.pointerDown(80 + i * 10, 40, 0);
  check('manual spawns can exceed the natural mob cap', e.getCreatures().length === 10);
  e.setCreatureRuntime(true, true);
  e.spawnPlayerAtSurface(224);
  e.stepActors();
  check('high manual population pauses natural spawning', e.getCreatures().length === 10);
  e.destroy();
}

// Direct creation (eggs/scripts) bypasses natural population limits while
// retaining the species' requested habitat check.
{
  const e = mk();
  // Consume the one-time population seed before creating this isolated test
  // pool, so the confinement assertion is not also a predator/prey scenario.
  e.setCreatureRuntime(true, true); e.stepActors();
  waterBox(e, 20, 25, 130, 70);
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(e.spawnCreature(CREATURE.MINNOW, 35 + i * 3, 42));
  const accepted = ids.filter(Boolean);
  check(`manual creation bypasses the natural fish cap (${accepted.length}/12 accepted)`, accepted.length === 12);
  actors(e, 240);
  const grid = e.getGrid();
  const fish = e.getCreatures().filter((c) => accepted.includes(c.id) && c.alive);
  const allWet = fish.every((c) => {
    for (let y = Math.floor(c.y); y < Math.ceil(c.y + c.h); y++) for (let x = Math.floor(c.x); x < Math.ceil(c.x + c.w); x++)
      if (x >= 0 && x < COLS && y >= 0 && y < ROWS && grid[y * COLS + x] !== MAT.WATER) return false;
    return true;
  });
  check(`fish remain inside water after steering (${fish.length} survivors)`, fish.length > 0 && allWet);
  e.destroy();
}

// Pike selects another creature as prey, closes the gap, and damages its health.
{
  const e = mk(); waterBox(e, 10, 20, 150, 80);
  const prey = e.spawnCreature(CREATURE.MINNOW, 90, 45);
  const predator = e.spawnCreature(CREATURE.PIKE, 35, 44);
  e.setCreatureRuntime(true, false);
  const startGap = Math.abs(byId(e, prey).x - byId(e, predator).x);
  let closest = startGap, damaged = false;
  for (let i = 0; i < 300; i++) {
    e.stepActors();
    const a = byId(e, prey), b = byId(e, predator);
    if (!a) { damaged = true; break; }
    if (b) closest = Math.min(closest, Math.abs(a.x - b.x));
    if (a.health < a.maxHealth) damaged = true;
  }
  check(`predator tracks nearest prey (gap ${startGap.toFixed(1)} -> ${closest.toFixed(1)})`, closest < startGap * 0.5);
  check('predator attack reduces prey health', damaged);
  e.destroy();
}

// Fish outside viable water fall under gravity and kick around on the ground
// instead of freezing at their last swimming pose.
{
  const e = mk(); stoneFloor(e, 92);
  waterBox(e, 34, 20, 56, 32);
  const id = e.spawnCreature(CREATURE.MINNOW, 40, 24);
  const start = byId(e, id);
  for (let y = 20; y < 32; y++) for (let x = 34; x < 56; x++) e.eraseDisc(x, y, 0);
  e.setCreatureRuntime(true, false);
  actors(e, 90);
  const landed = byId(e, id);
  check(`beached fish falls normally (${start?.y.toFixed(1)} -> ${landed?.y.toFixed(1)})`,
    landed && landed.y > start.y + 40);
  const landedX = landed?.x ?? 0;
  let kickedUp = false;
  for (let i = 0; i < 120; i++) {
    e.stepActors();
    const fish = byId(e, id);
    if (fish?.vy < -0.2) kickedUp = true;
  }
  const flopped = byId(e, id);
  check('beached fish flops after landing', kickedUp && flopped && Math.abs(flopped.x - landedX) > 0.1);
  e.destroy();
}

// Blocking material inside the AABB causes slow burial damage; ordinary floor
// contact remains harmless because the supporting cells sit below the body.
{
  const e = mk(); stoneFloor(e, 92);
  const buriedId = e.spawnCreature(CREATURE.FOX, 50, 88);
  const standingId = e.spawnCreature(CREATURE.HARE, 100, 89);
  const buriedBefore = byId(e, buriedId).health, standingBefore = byId(e, standingId).health;
  for (let y = 88; y < 92; y++) for (let x = 50; x < 57; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.setCreatureRuntime(true, false);
  actors(e, 120);
  const buried = byId(e, buriedId), standing = byId(e, standingId);
  check(`engulfed creature takes gradual solid damage (${buriedBefore} -> ${buried?.health})`,
    buried && buried.health < buriedBefore && buried.health >= buriedBefore - 5);
  check('standing on solid ground does not cause burial damage', standing?.health === standingBefore);
  e.destroy();
}

// Corrosive material harms entity actors as well as the player. Keep the pool
// static under the actor-only clock so this isolates contact damage from acid
// movement or terrain dissolution.
{
  const e = mk(); stoneFloor(e, 92);
  const id = e.spawnCreature(CREATURE.FOX, 50, 88);
  const before = byId(e, id).health;
  for (let y = 84; y < 92; y++)
    for (let x = 24; x < 116; x++) e.paintDisc(x, y, 0, MAT.ACID, true);
  e.setCreatureRuntime(true, false);
  actors(e, 30);
  const exposed = byId(e, id);
  check(`acid contact now damages creatures (${before} -> ${exposed?.health})`,
    exposed && exposed.health <= before - 24);
  e.destroy();
}

// Hitbox damage changes health and respects the short hurt cooldown.
{
  const e = mk(); waterBox(e, 20, 20, 100, 70);
  const id = e.spawnCreature(CREATURE.PIKE, 50, 40);
  check('pike spawned in its valid material', id > 0);
  const before = byId(e, id).health;
  check('point/radius hit intersects creature AABB', e.damageCreatures(53, 41, 2, 11));
  check(`health reduced (${before} -> ${byId(e, id).health})`, byId(e, id).health === before - 11);
  check('hurt cooldown rejects immediate duplicate hit', !e.damageCreatures(53, 41, 2, 11));
  e.destroy();
}

// The minigunner commits to its charged line for a long burst. Moving after the
// first muzzle flash must not drag the stream along with the player.
{
  const e = mk(); stoneFloor(e, 104);
  const playerId = e.spawnPlayer(28, 96);
  const gunnerId = e.spawnCreature(CREATURE.MINIGUNNER, 90, 98);
  e.setCreatureRuntime(true, false);
  let gunner = null;
  for (let tick = 0; tick < 80; tick++) {
    e.stepActors();
    gunner = byId(e, gunnerId);
    if (gunner?.attackState === CREATURE_ATTACK_STATE.FIRING) break;
  }
  check('minigunner reaches its firing phase', gunner?.attackState === CREATURE_ATTACK_STATE.FIRING);
  const lockedAim = { x: gunner?.aimX, y: gunner?.aimY };
  const player = e.getPlayer(playerId);
  e.setPlayerState(playerId, { ...player, x: 28, y: 26, vx: 0, vy: 0 });

  const rounds = new Set();
  let aimLocked = true, burstSteps = 0, firingPastOldBurst = false;
  for (; burstSteps < 180; burstSteps++) {
    e.stepActors();
    gunner = byId(e, gunnerId);
    for (const projectile of e.getProjectiles()) {
      if (projectile.kind === PROJECTILE_KIND.MINIGUN_ROUND && projectile.owner === -gunnerId)
        rounds.add(projectile.id);
    }
    aimLocked &&= Math.abs((gunner?.aimX ?? Infinity) - lockedAim.x) < 1e-4
      && Math.abs((gunner?.aimY ?? Infinity) - lockedAim.y) < 1e-4;
    if (burstSteps >= 60 && gunner?.attackState === CREATURE_ATTACK_STATE.FIRING)
      firingPastOldBurst = true;
    if (gunner?.attackState !== CREATURE_ATTACK_STATE.FIRING) {
      burstSteps++;
      break;
    }
  }
  check('minigunner aim stays locked after its target dodges', aimLocked);
  check(`minigunner sustains a 150-tick burst (${burstSteps} ticks, ${rounds.size} rounds)`,
    firingPastOldBurst && burstSteps === 150 && rounds.size === 75);
  e.destroy();
}

// Ambient fauna remain available to eggs/scripts, but none enter the natural
// population, even when a normal surface player keeps their habitats loaded.
{
  const e = createEngineWasm({ cols: 448, rows: 320, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true });
  e.setSurvivalInventory(true);
  e.setCreatureRuntime(true, true);
  const playerId = e.spawnPlayerAtSurface(224), player = e.getPlayer(playerId);
  e.stepActors();
  const initial = e.getCreatures();
  const disabledNatural = [
    CREATURE.MINNOW, CREATURE.PIKE, CREATURE.FOX,
    CREATURE.HARE, CREATURE.CRAWLER, CREATURE.MOLE, CREATURE.BIRD,
  ];
  const distFromPlayer = (c) => Math.hypot(c.x + c.w / 2 - (player.x + player.w / 2), c.y + c.h / 2 - (player.y + player.h / 2));
  const spawnMinDistance = [20, 28, 28, 22, 30, 34, 20, 34, 46, 40, 38, 44];
  const tooClose = initial.filter((c) => distFromPlayer(c) + 1e-6 < spawnMinDistance[c.species]);
  check(`habitat-snapped natural spawns preserve player safety distance (${tooClose.length} too close)`, tooClose.length === 0);
  check('retired fauna, including moles, do not spawn naturally',
    !initial.some((c) => disabledNatural.includes(c.species)));
  actors(e, 1800);
  const later = e.getCreatures();
  const count = (species) => later.filter((c) => c.species === species && c.alive).length;
  const active = later.filter((c) => c.alive).length;
  check(`retired natural populations remain absent (${disabledNatural.map((species) => count(species)).join('/')})`,
    disabledNatural.every((species) => count(species) === 0));
  check(`loaded population has a hard mixed-species cap (${active}/8)`, active <= 8);
  e.destroy();
}

// Exercise a spread of world seeds through several recurring spawn attempts so
// the mole exclusion cannot accidentally depend on one terrain layout.
{
  let cleanWorlds = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const e = createEngineWasm({ cols: 448, rows: 320, worldSeed: seed, sinksOn: false, infinite: true });
    e.setSurvivalInventory(true);
    e.setCreatureRuntime(true, true);
    e.spawnPlayerAtSurface(224);
    actors(e, 4800);
    const ids = new Set(e.getCreatures().filter((c) => c.alive).map((c) => c.species));
    const disabled = [
      CREATURE.MINNOW, CREATURE.PIKE, CREATURE.FOX,
      CREATURE.HARE, CREATURE.CRAWLER, CREATURE.MOLE, CREATURE.BIRD,
    ];
    if (disabled.every((id) => !ids.has(id))) cleanWorlds++;
    e.destroy();
  }
  check(`moles and other retired fauna remain absent across world seeds (${cleanWorlds}/8)`,
    cleanWorlds === 8);
}

// A habitat-valid point beyond the real viewport enters immediately. It must
// clear the whole camera rectangle plus the ten-cell spawn safety margin.
{
  let offscreen = null;
  for (let salt = 0; salt < 12 && !offscreen; salt++) {
    const e = attachTestHooks(createEngineWasm({
      cols: 448, rows: 320, worldSeed: 0x0FF5C2E + salt,
      sinksOn: false, infinite: true,
    }));
    e.setViewport(1, 1, 120, 80);
    const playerId = e.spawnPlayerAtSurface(224);
    const player = e.getPlayer(playerId);
    e.cameraSet(
      player.x + player.w * 0.5 - 60 - 24, // deliberately lag left of the player
      player.y + player.h * 0.5 + player.h * 0.5 + 4 - 80 * (2 / 3),
    );
    e.setCreatureRuntime(true, false);
    if (e._spawnNearFocus(CREATURE.DYNAMITEER, salt * 977 + 41)) {
      const candidate = e.getCreatures().find((c) => c.alive);
      if (candidate) {
        const cam = e.getCam();
        const intersectsExpandedView =
          candidate.x < cam.x + 120 + 10 && candidate.x + candidate.w > cam.x - 10 &&
          candidate.y < cam.y + 80 + 10 && candidate.y + candidate.h > cam.y - 10;
        offscreen = {
          clearsView: !intersectsExpandedView,
          spawnProgress: candidate.spawnProgress,
        };
      }
    }
    e.destroy();
  }
  check('natural entry clears the actual lagged camera plus the viewport margin',
    offscreen?.clearsView && offscreen.spawnProgress === 0);
}

// The real 1366px desktop layout shows 248 cells. Armed encounters must first
// try the simulated bands to its left/right instead of falling back to an
// on-screen portal or entering below the camera.
{
  const horizontalSpecies = [
    CREATURE.DYNAMITEER, CREATURE.BORE_SENTINEL, CREATURE.CAUSTIC_MORTARMAN,
    CREATURE.CLUSTER_WASP, CREATURE.MINIGUNNER,
  ];
  const results = [];
  for (const species of horizontalSpecies) {
    const e = attachTestHooks(createEngineWasm({
      cols: 512, rows: 352, worldSeed: 0x0FF5C2E + species,
      sinksOn: false, infinite: true,
    }));
    e.setViewport(1, 1, 248, 140);
    const playerId = e.spawnPlayerAtSurface(256);
    const player = e.getPlayer(playerId);
    e.cameraSet(
      player.x + player.w * 0.5 - 124,
      player.y + player.h * 0.5 + player.h * 0.5 + 4 - 140 * (2 / 3),
    );
    const spawned = e._spawnNearFocus(species, species * 977 + 41);
    const candidate = e.getCreatures().find((c) => c.species === species && c.alive);
    const cam = e.getCam();
    results.push(spawned && candidate && (
      candidate.x + candidate.w <= cam.x - 10 ||
      candidate.x >= cam.x + 248 + 10
    ));
    e.destroy();
  }
  check('armed enemies enter left/right of the real desktop viewport',
    results.every(Boolean));
}

// Cave encounters follow the player's absolute depth. Their habitat search
// must use the loaded deep-cavern window rather than snapping back to the
// shallow cave band below the procedural surface.
{
  const caveSpecies = [CREATURE.BORE_SENTINEL, CREATURE.MINIGUNNER];
  const results = [];
  for (const species of caveSpecies) {
    const e = attachTestHooks(createEngineWasm({
      cols: 512, rows: 352, worldSeed: 0xD33F + species,
      sinksOn: false, infinite: true,
    }));
    for (let shift = 0; shift < 12; shift++) e.shiftWorldXY(0, 128);
    e.setViewport(1, 1, 160, 100);
    e.spawnPlayer(256, 176);
    e.cameraSet(176, 126);
    let spawned = false;
    for (let salt = 0; salt < 64 && !spawned; salt++)
      spawned = e._spawnNearFocus(species, salt * 977 + species);
    const candidate = e.getCreatures().find((c) => c.species === species && c.alive);
    results.push(spawned && candidate &&
      candidate.y >= 2 && candidate.y + candidate.h <= e.rows - 2 &&
      e.getWorldOffsetY() + candidate.y > 1000);
    e.destroy();
  }
  check('cave enemies spawn in habitat inside the loaded deep-cavern window',
    results.every(Boolean));
}

// When the loaded buffer is entirely visible, no off-screen entry exists. The
// natural spawn is then an inert, audible portal for 0.9–1.4 seconds before the
// same reserved actor id materializes.
{
  const e = attachTestHooks(createEngineWasm({
    cols: 448, rows: 320, worldSeed: 0xB4EAC5,
    sinksOn: false, infinite: true,
  }));
  e.setViewport(1, 1, 448, 320);
  e.cameraSet(0, 0);
  e.spawnPlayerAtSurface(224);
  e.setCreatureRuntime(true, false);
  const requested = e._spawnNearFocus(CREATURE.DYNAMITEER, 0x5151);
  const portal = e.getCreatures().find((c) => c.spawnProgress > 0);
  const sounds = e.drainSoundEvents();
  const soundTypes = [];
  for (let i = 0; i < sounds.length; i += STRIDES.soundEvent)
    soundTypes.push(sounds[i + OFF.soundEvent.type]);
  const pendingWasInert = portal &&
    !e.damageCreatures(Math.floor(portal.x + portal.w / 2), Math.floor(portal.y + portal.h / 2), 2, 50) &&
    e.getProjectiles().length === 0;
  let progressMonotonic = true, previousProgress = portal?.spawnProgress || 0;
  let materializedAt = 0, materialized = null;
  for (let tick = 1; tick <= 90; tick++) {
    e.stepActors();
    const state = e.getCreatures().find((c) => c.id === portal?.id);
    if (state?.alive) { materializedAt = tick; materialized = state; break; }
    if (state) {
      progressMonotonic &&= state.spawnProgress + 1e-6 >= previousProgress;
      previousProgress = state.spawnProgress;
    }
  }
  check('visible fallback begins as a replicated inert breach marker',
    requested && portal && !portal.alive && pendingWasInert);
  check('breach warning emits its dedicated semantic cue exactly once',
    soundTypes.filter((type) => type === SOUND_EVENT.SPAWN_BREACH).length === 1);
  check(`breach progresses monotonically and materializes after ${materializedAt} ticks`,
    progressMonotonic && materialized?.id === portal?.id &&
    materialized.spawnProgress === 0 && materializedAt >= 54 && materializedAt <= 84);
  e.destroy();
}

// The encounter director spends one shared threat budget and creates at most
// one reservation per two-second cadence instead of firing five species timers
// together. First-seen ids include portal reservations, so this also covers the
// pending population path.
{
  const e = createEngineWasm({
    cols: 448, rows: 320, worldSeed: 0xD1EC70,
    sinksOn: false, infinite: true,
  });
  e.setViewport(1, 1, 120, 80);
  const playerId = e.spawnPlayerAtSurface(224);
  const player = e.getPlayer(playerId);
  e.cameraSet(player.x + player.w * 0.5 - 60, player.y + player.h * 0.5 - 54);
  e.setSurvivalInventory(true);
  e.setCreatureRuntime(true, true);
  const firstSeen = [], known = new Set();
  let maxPopulation = 0;
  for (let tick = 0; tick < 960; tick++) {
    e.stepActors();
    const population = e.getCreatures().filter((c) => c.alive || c.spawnProgress > 0);
    maxPopulation = Math.max(maxPopulation, population.length);
    for (const c of population) if (!known.has(c.id)) {
      known.add(c.id);
      firstSeen.push(tick);
    }
  }
  const cadenceHeld = firstSeen.every((tick, i) => i === 0 || tick - firstSeen[i - 1] >= 120);
  check(`encounters arrive gradually on the shared cadence (${firstSeen.join(', ')})`,
    firstSeen.length >= 3 && cadenceHeld);
  check(`director reservations preserve the natural population cap (${maxPopulation}/8)`,
    maxPopulation <= 8);
  e.destroy();
}

// Lethal contact enters the explicit death state and immediately allows a
// manual respawn that restores the same input-capable actor identity.
{
  const e = mk(); stoneFloor(e, 92);
  const player = e.spawnPlayer(72, 84);
  e.spawnCreature(CREATURE.FOX, 68, 88);
  e.setCreatureRuntime(true, false);
  let died = false;
  for (let i = 0; i < 2400; i++) {
    e.stepActors();
    const p = e.getPlayer(player);
    if (p?.alive === false) { died = true; break; }
  }
  const ready = e.getPlayer(player)?.respawnReady;
  const respawned = e.respawnPlayer(player);
  const before = e.getPlayer(player)?.x;
  e.setPlayerInput(player, { bits: 2, aimX: 72, aimY: 88, tool: 0, seq: 1 });
  actors(e, 30);
  const after = e.getPlayer(player);
  check('lethal creature damage allows immediate manual respawn', died && ready && respawned && after?.alive);
  check('respawned player still accepts movement input', after && after.x > before);
  e.destroy();
}

// Surface enemy selects the nearest player and applies contact damage.
{
  const e = mk(); stoneFloor(e, 92);
  const fox = e.spawnCreature(CREATURE.FOX, 42, 88);
  const player = e.spawnPlayer(72, 84);
  e.setCreatureRuntime(true, false);
  actors(e, 360);
  check('surface enemy remains active while pursuing', !!byId(e, fox));
  check(`surface enemy damages its player target (health ${e.getPlayer(player)?.health})`, (e.getPlayer(player)?.health ?? 100) < 100);
  e.destroy();
}

// Fox walks on solid terrain, then actively swims when flooded.
{
  const e = mk(); stoneFloor(e, 92);
  const fox = e.spawnCreature(CREATURE.FOX, 42, 88);
  const player = e.spawnPlayer(95, 84);
  e.setCreatureRuntime(true, false);
  actors(e, 80);
  const walked = byId(e, fox);
  check(`walking creature tracks player on land (x ${walked?.x.toFixed(1)})`, walked && walked.x > 45);
  waterBox(e, 20, 68, 125, 92);
  // A submerged land animal now prioritizes a dry bank over this target.
  e.setPlayerState(player, { x: 92, y: 70, vx: 0, vy: 0, facing: -1 });
  let maxSwimSpeed = 0;
  for (let i = 0; i < 80; i++) { e.stepActors(); const c = byId(e, fox); if (c) maxSwimSpeed = Math.max(maxSwimSpeed, Math.hypot(c.vx, c.vy)); }
  check(`walking creature switches to swimming in liquid (speed ${maxSwimSpeed.toFixed(3)})`, maxSwimSpeed > 0.05);
  e.destroy();
}

// Ambient walkers keep a direction long enough to explore, and a land animal
// engulfed by water prioritizes nearby dry footing over aimless swim circles.
{
  const e = mk(); stoneFloor(e, 100);
  const fox = e.spawnCreature(CREATURE.FOX, 75, 96);
  e.setCreatureRuntime(true, false);
  let minX = byId(e, fox).x, maxX = minX;
  for (let i = 0; i < 240; i++) {
    e.stepActors();
    const c = byId(e, fox);
    if (c) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); }
  }
  check(`untargeted land creature explores the floor (span ${(maxX - minX).toFixed(1)})`, maxX - minX > 20);
  e.destroy();
}

{
  const e = mk(); stoneFloor(e, 100);
  const hare = e.spawnCreature(CREATURE.HARE, 72, 97);
  e.spawnPlayer(92, 92);
  e.setCreatureRuntime(true, false);
  actors(e, 90);
  check('passive land creature avoids a nearby player', byId(e, hare)?.x < 65);
  e.destroy();
}

{
  const e = mk(); stoneFloor(e, 100);
  const swimmer = e.spawnCreature(CREATURE.FOX, 75, 96);
  waterBox(e, 40, 68, 120, 100);
  e.setCreatureRuntime(true, false);
  let reachedBank = false;
  for (let i = 0; i < 600; i++) {
    e.stepActors();
    const wetFox = byId(e, swimmer);
    if (wetFox && (wetFox.x < 36 || wetFox.x > 117)) { reachedBank = true; break; }
  }
  check('submerged land creature finds a nearby dry bank', reachedBank);
  e.destroy();
}

// A rising shoreline blocks the front of a wide hitbox before the body becomes
// dry. Habitat seeking must scramble upward instead of pushing forever at it.
{
  const e = mk();
  for (let x = 4; x < COLS - 4; x++) {
    const top = x < 70 ? 100 : Math.max(72, 100 - Math.floor((x - 70) / 2));
    for (let y = top; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  }
  e.finalizeStoneDraft();
  const fox = e.spawnCreature(CREATURE.FOX, 48, 96);
  waterBox(e, 4, 68, 74, 100);
  e.setCreatureRuntime(true, false);
  let climbedBank = false;
  for (let i = 0; i < 900; i++) {
    e.stepActors();
    const c = byId(e, fox);
    if (c && c.x > 78 && c.y + c.h < 99) { climbedBank = true; break; }
  }
  check('submerged land creature climbs a stepped shoreline', climbedBank);
  e.destroy();
}

// Absolute world coordinates survive a streamed window shift without identity loss.
{
  const e = createEngineWasm({ cols: 224, rows: 160, worldSeed: 0x5157, sinksOn: false, infinite: true });
  waterBox(e, 110, 25, 180, 70);
  const ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY();
  const id = e.spawnCreature(CREATURE.MINNOW, ox + 145, oy + 45);
  const x0 = byId(e, id)?.x;
  e.shiftWorldXY(32, 0);
  const c = byId(e, id);
  check('streaming keeps creature identity', c?.id === id);
  check(`absolute pose remaps to new local window (${x0?.toFixed(1)} -> ${c?.x.toFixed(1)})`, c && Math.abs(c.x - (x0 - 32)) < 0.01);
  e.setCreatureRuntime(true, false);
  e.shiftWorldXY(128, 0); e.stepActors();
  e.shiftWorldXY(128, 0); e.stepActors();
  check('off-window creature hibernates out of the active snapshot', !byId(e, id));
  e.shiftWorldXY(-128, 0); e.stepActors();
  e.shiftWorldXY(-128, 0); e.stepActors();
  check('returning to the area restores the same creature', byId(e, id)?.id === id);
  e.destroy();
}

// Once an actor leaves the loaded window, its terrain no longer exists. Save it
// immediately so time spent away cannot alter its pose or health against empty
// off-window cells. Horizontal and vertical streaming share this lifecycle.
{
  const axes = [[128, 0], [0, 128]];
  const results = [];
  for (const [dx, dy] of axes) {
    const e = createEngineWasm({
      cols: 224, rows: 160, worldSeed: 0x51A9 + dx + dy,
      sinksOn: false, infinite: true,
    });
    for (let y = 70; y < 110; y++)
      for (let x = 4; x < 220; x++) e.paintDisc(x, y, 0, MAT.WATER, true);
    const ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY();
    const id = e.spawnCreature(CREATURE.PIKE, ox + 60, oy + 80);
    const before = byId(e, id);
    e.setCreatureRuntime(true, false);
    e.shiftWorldXY(dx, dy);
    e.stepActors();
    const hibernated = !byId(e, id);
    actors(e, 180);
    e.shiftWorldXY(-dx, -dy);
    e.stepActors();
    const restored = byId(e, id);
    results.push(hibernated && restored?.id === id &&
      Math.abs(restored.x - before.x) < 0.5 &&
      Math.abs(restored.y - before.y) < 0.5 &&
      restored.health === before.health);
    e.destroy();
  }
  check('derendered enemies hibernate immediately and restore unchanged on both axes',
    results.every(Boolean));
}

if (done()) process.exit(1);
console.log('creature tests passed');
