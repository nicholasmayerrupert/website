// The continuous Earth expedition: physical jobs, persistent terrain, and scoped repairs.
import { initSandWasm, createEngineWasm, MAT, PLANET } from '../src/sand/wasmBridge/engineFactory.js';
import { GAME_WORLD } from '../src/sand/content/catalog.js';
import { MISSION, MISSION_PHASE, OBJECTIVE_STATE, CREATURE, ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { makeChecker } from './sand-test-util.mjs';
await initSandWasm();
const { check, done } = makeChecker('frontier');
const e = createEngineWasm({ cols: 640, rows: 448, worldSeed: 0x41535452, infinite: true, sinksOn: false, planetId: PLANET.FRONTIER });
e.setSurvivalInventory(true);
e.setCreatureRuntime(true, false);
const player = e.spawnPlayerAtSurface(320);
const at = (x, y, bg = false) => {
  const lx = x - e.getWorldOffsetX(), ly = y - e.getWorldOffsetY();
  if (lx < 0 || lx >= e.cols || ly < 0 || ly >= e.rows) return -1;
  return (bg ? e.getGridBg() : e.getGrid())[ly * e.cols + lx];
};
const move = (x, y) => {
  for (let i = 0; i < 40; i++) {
    const dx = Math.round((x - e.getWorldOffsetX() - 320) / 32) * 32;
    const dy = Math.round((y - e.getWorldOffsetY() - 224) / 32) * 32;
    if (!dx && !dy) break;
    if (dx) e.shiftWorldXY(Math.max(-128, Math.min(128, dx)), 0);
    if (dy) e.shiftWorldXY(0, Math.max(-96, Math.min(96, dy)));
  }
  e.setPlayerState(player, { ...e.getPlayer(player), x: x - e.getWorldOffsetX(), y: y - e.getWorldOffsetY(), vx: 0, vy: 0 });
};
const tick = () => { for (let i = 0; i < 12; i++) e.stepActors(); };
const id = key => GAME_WORLD.quests.findIndex(q => q.key === key);
const objective = key => e.getMission().objectives[id(key)];
check('frontier starts with four independent branches and authored dependencies', e.startMission(MISSION.FRONTIER, player)
  && e.getMission().objectives.filter(o => o.state === OBJECTIVE_STATE.ACTIVE).length === 4
  && objective('homecoming').state === OBJECTIVE_STATE.LOCKED);
const clearBox = actor => {
  const wx = actor.x + e.getWorldOffsetX(), wy = actor.y + e.getWorldOffsetY();
  for (let y = Math.floor(wy); y < Math.ceil(wy + actor.h - 1e-6); y++)
    for (let x = Math.floor(wx); x < Math.ceil(wx + actor.w - 1e-6); x++)
      if (at(x, y) !== MAT.EMPTY) return false;
  return true;
};
check('player starts entirely above the authored floor', clearBox(e.getPlayer(player)));
check('all authored residents spawn with clear body boxes', e.getCreatures().length === 3 && e.getCreatures().every(clearBox));
const crewStart = e.getCreatures().filter(c => c.species !== CREATURE.SURVEYOR);
for (let i = 0; i < 240; i++) e.stepActors();
check('residents can walk around their homes', crewStart.length === 2 && crewStart.every(before => Math.abs(e.getCreatures().find(c => c.id === before.id).x - before.x) > .5));
check('resident walking does not embed them in floors', e.getCreatures().every(clearBox));
const count = material => {
  const inv = e.getInventory(player);
  return inv.slots.reduce((n, slot) => n + (!slot.pool && slot.itemKind === ITEM_KIND.MATERIAL && slot.material === material ? slot.count : 0), 0)
    + inv.pools.flatMap(pool => pool.entries).reduce((n, entry) => n + (entry.material === material ? entry.count : 0), 0);
};
move(96, 5); tick();
check('an empty-handed delivery fails', !e.interactFrontier(player, id('mill-supplies')));
e.addToInventory(player, MAT.IRON_ORE, 31);
move(-64, 5);
check('delivery is rejected away from its recipient', !e.interactFrontier(player, id('mill-supplies')));
move(96, 5); tick();
check('carrying supplies updates progress without silently consuming them', objective('mill-supplies').current === 24 && count(MAT.IRON_ORE) === 31);
check('explicit handoff consumes exactly the request and awards timber', e.interactFrontier(player, id('mill-supplies')) && count(MAT.IRON_ORE) === 7 && count(MAT.PINE_WOOD) === 192);
check('completed handoffs cannot award twice', !e.interactFrontier(player, id('mill-supplies')));
move(400, 3); tick();
check('background guide planks do not complete the bridge', objective('mill-bridge').state === OBJECTIVE_STATE.ACTIVE && objective('mill-bridge').current === 0);
for (let x = 373; x <= 427; x++) e.paintDisc(x - e.getWorldOffsetX(), 15 - e.getWorldOffsetY(), 1, MAT.PINE_WOOD);
e.syncComponents(); tick();
check('a connected timber deck completes construction', objective('mill-bridge').state === OBJECTIVE_STATE.COMPLETE);
move(0, 6);
check('lodge has an open ground floor and a solid foundation', at(-64, 8) === MAT.EMPTY && at(-64, 17) !== MAT.EMPTY);
check('cellar foreground stays clear while background carries masonry', at(-90, 45) === MAT.EMPTY && at(-90, 45, true) !== MAT.EMPTY);
check('station surface is a dry terrace, eastern summit has real verticality', e.worldSurfaceAbsAt(0) === 16 && e.worldSurfaceAbsAt(900) < -180);
move(0, 8);
for (let i = 0; i < 120; i++) e.stepWorld();
check('lodge foundation stays attached under simulation', at(-16, 17) === MAT.SANDSTONE);
check('maintenance restores the authored lodge', e.repairFrontierBase(player));
check('repair places the player above the floor', clearBox(e.getPlayer(player)));
check('repair preserves safe resident placement', e.getCreatures().filter(c => [CREATURE.IRIS_COMMANDER, CREATURE.IRIS_ENGINEER, CREATURE.SURVEYOR].includes(c.species)).every(clearBox));
const initial = e.getMission().objectives;
move(initial[id('windward')].worldX, initial[id('windward')].worldY - 3);
tick();
check('summit survey can complete before the other jobs', objective('windward').state === OBJECTIVE_STATE.COMPLETE && objective('buried-pass').state === OBJECTIVE_STATE.ACTIVE);
move(-480, 378); tick();
check('entering the flooded archive does not complete the drainage job', objective('drowned-archive').state === OBJECTIVE_STATE.ACTIVE);
// Cut a drain through the floor and let the real fluid simulation empty it.
e.eraseDisc(-480 - e.getWorldOffsetX(), 400 - e.getWorldOffsetY(), 15);
for (let turn = 0; turn < 3000; turn++) e.stepWorld();
tick();
check('drained archive console completes the job', objective('drowned-archive').state === OBJECTIVE_STATE.COMPLETE);
const passFloor = e.worldSurfaceAbsAt(-790) + 36;
move(-860, passFloor - 10); tick();
check('going around the railway rockfall alone does not open the pass', objective('buried-pass').state === OBJECTIVE_STATE.ACTIVE);
e.eraseDisc(-800 - e.getWorldOffsetX(), passFloor - 10 - e.getWorldOffsetY(), 19);
tick();
check('a person-sized cut opens the railway and unlocks the cutting yard', objective('buried-pass').state === OBJECTIVE_STATE.COMPLETE && objective('last-shift').state === OBJECTIVE_STATE.ACTIVE);
const encounter = objective('last-shift');
move(encounter.worldX + 55, encounter.worldY - 8); tick();
let foreman = e.getCreatures().find(c => c.id === objective('last-shift').targetActorId);
check('approaching an unlocked encounter spawns its named boss safely', !!foreman && clearBox(foreman) && foreman.species === CREATURE.QUARRY_FOREMAN);
check('reaching the yard does not count as defeating its boss', objective('last-shift').state === OBJECTIVE_STATE.ACTIVE);
if (foreman) {
  const actorId = foreman.id;
  move(0, 6); tick();
  move(encounter.worldX + 55, encounter.worldY - 8); tick();
  check('streaming away and back preserves the boss identity', e.getCreatures().filter(c => c.id === actorId).length === 1 && objective('last-shift').targetActorId === actorId);
  foreman = e.getCreatures().find(c => c.id === actorId);
  e.damageCreatures(foreman.x + foreman.w / 2, foreman.y + foreman.h / 2, 12, 10000); tick();
}
check('defeating the named boss awards its cache and unlocks homecoming', objective('last-shift').state === OBJECTIVE_STATE.COMPLETE && objective('homecoming').state === OBJECTIVE_STATE.ACTIVE);
check('maintenance cannot reset terrain from the field', !e.repairFrontierBase(player));
move(-64, 8); tick();
check('homecoming completes without extraction or swapping the world', e.getMission().phase === MISSION_PHASE.COMPLETE);
// Keep an alteration outside the station, and damage the foreground and background inside it.
move(0, 8);
e.eraseDiscLayer(0, -80 - e.getWorldOffsetX(), 17 - e.getWorldOffsetY(), 7);
e.eraseDiscLayer(1, -80 - e.getWorldOffsetX(), 17 - e.getWorldOffsetY(), 7);
check('base destruction affects both layers', at(-80, 17) === MAT.EMPTY && at(-80, 17, true) === MAT.EMPTY);
check('Osei repairs both layers using component-aware mutations', e.repairFrontierBase(player)
  && at(-80, 17) !== MAT.EMPTY && at(-80, 17, true) !== MAT.EMPTY);
for (let i = 0; i < 3; i++) e.step();
check('repaired structure survives simulation', at(-80, 17) !== MAT.EMPTY);
move(-800, passFloor - 10);
check('repair preserves excavation outside the station', at(-800, passFloor - 10) === MAT.EMPTY);
check('repair preserves expedition progress', e.getMission().phase === MISSION_PHASE.COMPLETE);
e.destroy();
process.exitCode = done() ? 1 : 0;
