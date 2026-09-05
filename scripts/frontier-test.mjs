// The continuous Earth expedition: physical jobs, persistent terrain, and scoped repairs.
import { initSandWasm, createEngineWasm, MAT, PLANET } from '../src/sand/wasmBridge/engineFactory.js';
import { MISSION, MISSION_PHASE, OBJECTIVE_STATE } from '../src/sand/wasmBridge/abi.generated.js';
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
check('frontier starts with three independent jobs and a homecoming', e.startMission(MISSION.FRONTIER, player)
  && e.getMission().objectives.slice(0, 3).every(o => o.state === OBJECTIVE_STATE.ACTIVE)
  && e.getMission().objectives[3].state === OBJECTIVE_STATE.LOCKED);
check('lodge has an open ground floor and a solid foundation', at(-64, 8) === MAT.EMPTY && at(-64, 17) !== MAT.EMPTY);
check('cellar foreground stays clear while background carries masonry', at(-90, 45) === MAT.EMPTY && at(-90, 45, true) !== MAT.EMPTY);
check('station surface is a dry terrace, eastern summit has real verticality', e.worldSurfaceAbsAt(0) === 16 && e.worldSurfaceAbsAt(900) < -180);
move(0, 8);
for (let i = 0; i < 120; i++) e.stepWorld();
check('lodge foundation stays attached under simulation', at(-16, 17) === MAT.SANDSTONE);
check('maintenance restores the authored lodge', e.repairFrontierBase(player));
const initial = e.getMission().objectives;
move(initial[2].worldX, initial[2].worldY - 3);
tick();
check('summit survey can complete before the other jobs', e.getMission().objectives[2].state === OBJECTIVE_STATE.COMPLETE && e.getMission().objectives[0].state === OBJECTIVE_STATE.ACTIVE);
move(-480, 378); tick();
check('entering the flooded archive does not complete the drainage job', e.getMission().objectives[1].state === OBJECTIVE_STATE.ACTIVE);
// Cut a drain through the floor and let the real fluid simulation empty it.
e.eraseDisc(-480 - e.getWorldOffsetX(), 400 - e.getWorldOffsetY(), 15);
for (let turn = 0; turn < 3000; turn++) e.stepWorld();
tick();
check('drained archive console completes the job', e.getMission().objectives[1].state === OBJECTIVE_STATE.COMPLETE);
const passFloor = e.worldSurfaceAbsAt(-790) + 36;
move(-860, passFloor - 10); tick();
check('going around the railway rockfall alone does not open the pass', e.getMission().objectives[0].state === OBJECTIVE_STATE.ACTIVE);
e.eraseDisc(-800 - e.getWorldOffsetX(), passFloor - 10 - e.getWorldOffsetY(), 19);
tick();
check('a person-sized cut opens the railway and unlocks homecoming', e.getMission().objectives[0].state === OBJECTIVE_STATE.COMPLETE && e.getMission().objectives[3].state === OBJECTIVE_STATE.ACTIVE);
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
