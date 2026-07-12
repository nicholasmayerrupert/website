// Material-aware creature actor tests: health/hitboxes, aquatic confinement,
// prey tracking, amphibious locomotion, density caps, and streaming coordinates.

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
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

// Water-only locomotion and local population cap.
{
  const e = mk();
  // Consume the one-time population seed before creating this isolated test
  // pool, so the confinement assertion is not also a predator/prey scenario.
  e.setSurvivalInventory(true); e.stepActors();
  waterBox(e, 20, 25, 130, 70);
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(e.spawnCreature(CREATURE.MINNOW, 35 + i * 3, 42));
  const accepted = ids.filter(Boolean);
  check(`density cap rejects excess fish (${accepted.length}/12 accepted)`, accepted.length === 3);
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
  e.setSurvivalInventory(true);
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
  e.setSurvivalInventory(true);
  const playerId = e.spawnPlayerAtSurface(224), player = e.getPlayer(playerId);
  e.stepActors();
  const initial = e.getCreatures();
  const hare = initial.find((c) => c.species === CREATURE.HARE);
  const crawler = initial.find((c) => c.species === CREATURE.CRAWLER);
  const bird = initial.find((c) => c.species === CREATURE.BIRD);
  const surfaceAt = (c) => e.worldSurfaceAt(e.getWorldOffsetX() + Math.floor(c.x + c.w / 2));
  const distFromPlayer = (c) => Math.hypot(c.x + c.w / 2 - (player.x + player.w / 2), c.y + c.h / 2 - (player.y + player.h / 2));
  check('land creature spawns immediately near the visible player', hare && distFromPlayer(hare) <= 72);
  check(`land creature stands on generated terrain (y ${hare?.y.toFixed(1)})`, hare && Math.abs(hare.y + hare.h - surfaceAt(hare)) <= 4);
  check('cave creature spawns in a loaded underground cavity', crawler && crawler.y > surfaceAt(crawler) + 10);
  check('bird spawns immediately in visible open sky', bird && distFromPlayer(bird) <= 78 && bird.y + bird.h < surfaceAt(bird) - 8);
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
  check(`continuous spawning remains capped (newt ${count(CREATURE.NEWT)}, hare ${count(CREATURE.HARE)}, crawler ${count(CREATURE.CRAWLER)}, bird ${count(CREATURE.BIRD)})`,
    count(CREATURE.NEWT) <= 2 && count(CREATURE.HARE) <= 3 && count(CREATURE.CRAWLER) <= 2 && count(CREATURE.BIRD) <= 3);
  check(`loaded population has a hard mixed-species cap (${active}/12)`, active <= 12);
  e.destroy();
}

// Random browser worlds must not produce an empty-looking game. Exercise a
// spread of seeds long enough for several bounded spawn attempts and require
// every newly requested habitat population to establish.
{
  let established = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const e = createEngineWasm({ cols: 448, rows: 320, worldSeed: seed, sinksOn: false, infinite: true });
    e.setSurvivalInventory(true);
    e.spawnPlayerAtSurface(224);
    actors(e, 4800);
    const ids = new Set(e.getCreatures().filter((c) => c.alive).map((c) => c.species));
    if ([CREATURE.HARE, CREATURE.CRAWLER, CREATURE.BIRD].every((id) => ids.has(id))) established++;
    e.destroy();
  }
  check(`land/cave/air populations establish across world seeds (${established}/8)`, established === 8);
}

// Lethal contact damage must never leave the player silently disabled. The
// current death policy immediately returns them to the surface with spawn
// protection, preserving their inventory and input-capable actor identity.
{
  const e = mk(); stoneFloor(e, 92);
  const player = e.spawnPlayer(72, 84);
  e.spawnCreature(CREATURE.NEWT, 68, 89);
  e.setSurvivalInventory(true);
  let respawned = false;
  for (let i = 0; i < 2400; i++) {
    e.stepActors();
    const p = e.getPlayer(player);
    if (p?.health === 100 && i > 300 && p.y < 84) { respawned = true; break; }
  }
  const before = e.getPlayer(player)?.x;
  e.setPlayerInput(player, { bits: 2, aimX: 72, aimY: 88, tool: 0, seq: 1 });
  actors(e, 30);
  const after = e.getPlayer(player);
  check('lethal creature damage automatically returns the player to play', respawned && after?.alive);
  check('respawned player still accepts movement input', after && after.x > before);
  e.destroy();
}

// Surface enemy selects the nearest player and applies contact damage.
{
  const e = mk(); stoneFloor(e, 92);
  const newt = e.spawnCreature(CREATURE.NEWT, 42, 89);
  const player = e.spawnPlayer(72, 84);
  e.setSurvivalInventory(true);
  actors(e, 360);
  check('surface enemy remains active while pursuing', !!byId(e, newt));
  check(`surface enemy damages its player target (health ${e.getPlayer(player)?.health})`, (e.getPlayer(player)?.health ?? 100) < 100);
  e.destroy();
}

// Amphibious newt walks on solid terrain, then gains vertical swim steering when flooded.
{
  const e = mk(); stoneFloor(e, 92);
  const newt = e.spawnCreature(CREATURE.NEWT, 42, 89);
  const player = e.spawnPlayer(95, 84);
  e.setSurvivalInventory(true);
  actors(e, 80);
  const walked = byId(e, newt);
  check(`walking creature tracks player on land (x ${walked?.x.toFixed(1)})`, walked && walked.x > 45);
  waterBox(e, 20, 68, 125, 92);
  // Put the target higher in the pool so vertical steering is unambiguous.
  e.setPlayerState(player, { x: 92, y: 70, vx: 0, vy: 0, facing: -1 });
  let maxSwimVy = 0;
  for (let i = 0; i < 80; i++) { e.stepActors(); const c = byId(e, newt); if (c) maxSwimVy = Math.max(maxSwimVy, Math.abs(c.vy)); }
  check(`walking creature switches to swimming in liquid (|vy| ${maxSwimVy.toFixed(3)})`, maxSwimVy > 0.05);
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
  e.setSurvivalInventory(true);
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
