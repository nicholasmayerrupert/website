// Material-aware creature actor tests: health/hitboxes, aquatic confinement,
// prey tracking, amphibious locomotion, density caps, and streaming coordinates.

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATIVE_KIND, CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
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

check('roster includes ambient fauna plus both explosive-survival enemies',
  Object.keys(CREATURE).join(',') === 'MINNOW,PIKE,FOX,HARE,CRAWLER,MOLE,BIRD,DYNAMITEER,BORE_SENTINEL');

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

// Continuous focus spawning: land, cave, and air inhabitants appear near a
// normal surface player on the first actor tick, in their actual habitats.
{
  const e = createEngineWasm({ cols: 448, rows: 320, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true });
  e.setCreatureRuntime(true, true);
  const playerId = e.spawnPlayerAtSurface(224), player = e.getPlayer(playerId);
  e.stepActors();
  const initial = e.getCreatures();
  const fox = initial.find((c) => c.species === CREATURE.FOX);
  const hare = initial.find((c) => c.species === CREATURE.HARE);
  const crawler = initial.find((c) => c.species === CREATURE.CRAWLER);
  const mole = initial.find((c) => c.species === CREATURE.MOLE);
  const bird = initial.find((c) => c.species === CREATURE.BIRD);
  const surfaceAt = (c) => e.worldSurfaceAt(e.getWorldOffsetX() + Math.floor(c.x + c.w / 2));
  const distFromPlayer = (c) => Math.hypot(c.x + c.w / 2 - (player.x + player.w / 2), c.y + c.h / 2 - (player.y + player.h / 2));
  const spawnMinDistance = [20, 28, 28, 22, 30, 34, 20, 34, 46];
  const tooClose = initial.filter((c) => distFromPlayer(c) + 1e-6 < spawnMinDistance[c.species]);
  check(`habitat-snapped natural spawns preserve player safety distance (${tooClose.length} too close)`, tooClose.length === 0);
  check('both land creatures spawn near the visible player', fox && hare && distFromPlayer(hare) <= 72);
  check(`land creature stands on generated terrain (y ${hare?.y.toFixed(1)})`, hare && Math.abs(hare.y + hare.h - surfaceAt(hare)) <= 4);
  check('both cave creatures spawn in loaded underground cavities', crawler && mole &&
    crawler.y > surfaceAt(crawler) + 10 && mole.y > surfaceAt(mole) + 10);
  const birdDistance = bird ? distFromPlayer(bird) : Infinity;
  const birdClearance = bird ? surfaceAt(bird) - (bird.y + bird.h) : -Infinity;
  check(`bird spawns in visible open sky (distance ${birdDistance.toFixed(1)}, clearance ${birdClearance.toFixed(1)})`,
    bird && birdDistance <= 128 && birdClearance > 8);
  const birdStart = bird ? { x: bird.x, y: bird.y, frame: bird.animFrame } : null;
  actors(e, 6);
  const birdAnimated = bird && byId(e, bird.id);
  check('bird wing animation advances', birdAnimated && birdAnimated.animFrame !== birdStart.frame);
  let hareRose = false;
  for (let i = 0; i < 120; i++) { e.stepActors(); const h = hare && byId(e, hare.id); if (h?.vy < -0.1) hareRose = true; }
  check('land hare has an animated hopping locomotion cycle', hareRose);
  const movedBird = bird && byId(e, bird.id);
  check('bird flies through the world', movedBird && Math.hypot(movedBird.x - birdStart.x, movedBird.y - birdStart.y) > 2);
  actors(e, 1800);
  const later = e.getCreatures();
  const count = (species) => later.filter((c) => c.species === species && c.alive).length;
  const active = later.filter((c) => c.alive).length;
  check(`continuous spawning remains capped (fox ${count(CREATURE.FOX)}, hare ${count(CREATURE.HARE)}, crawler ${count(CREATURE.CRAWLER)}, mole ${count(CREATURE.MOLE)}, bird ${count(CREATURE.BIRD)})`,
    count(CREATURE.FOX) <= 1 && count(CREATURE.HARE) <= 2 && count(CREATURE.CRAWLER) <= 1 && count(CREATURE.MOLE) <= 1 && count(CREATURE.BIRD) <= 2);
  check(`loaded population has a hard mixed-species cap (${active}/8)`, active <= 8);
  e.destroy();
}

// Random browser worlds must not produce an empty-looking game. Exercise a
// spread of seeds long enough for several bounded spawn attempts and require
// every newly requested habitat population to establish.
{
  let established = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const e = createEngineWasm({ cols: 448, rows: 320, worldSeed: seed, sinksOn: false, infinite: true });
    e.setCreatureRuntime(true, true);
    e.spawnPlayerAtSurface(224);
    actors(e, 4800);
    const ids = new Set(e.getCreatures().filter((c) => c.alive).map((c) => c.species));
    if ([CREATURE.FOX, CREATURE.HARE, CREATURE.CRAWLER, CREATURE.MOLE, CREATURE.BIRD].every((id) => ids.has(id))) established++;
    e.destroy();
  }
  check(`both land/cave populations and birds establish across world seeds (${established}/8)`, established === 8);
}

// Lethal contact enters the explicit death state. Respawn is rejected during
// the three-second delay, then restores the same input-capable actor identity.
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
  const rejectedEarly = !e.respawnPlayer(player);
  actors(e, 180);
  const ready = e.getPlayer(player)?.respawnReady;
  const respawned = e.respawnPlayer(player);
  const before = e.getPlayer(player)?.x;
  e.setPlayerInput(player, { bits: 2, aimX: 72, aimY: 88, tool: 0, seq: 1 });
  actors(e, 30);
  const after = e.getPlayer(player);
  check('lethal creature damage enters delayed manual death', died && rejectedEarly && ready && respawned && after?.alive);
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

if (done()) process.exit(1);
console.log('creature tests passed');
