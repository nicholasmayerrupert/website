import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, PLANET, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { MISSION, BED_RESULT, CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import { GAME_WORLD } from '../src/sand/content/catalog.js';
await initSandWasm();
const options = { cols:640, rows:448, worldSeed:GAME_WORLD.seed, infinite:true, sinksOn:false, planetId:PLANET.FRONTIER };
const e = attachTestHooks(createEngineWasm(options));
try {
  e.setCreatureRuntime(true,false); e.setSurvivalInventory(true);
  const id=e.spawnPlayerAtSurface(320);e.startMission(MISSION.FRONTIER,id);
  const ticks=n=>{for(let i=0;i<n;i++)e.stepActors();}; ticks(61);
  const bed=e.getBeds()[0]; assert.ok(bed);
  const home=e.getPlayer(id), ox=e.getWorldOffsetX(),oy=e.getWorldOffsetY();
  const move=()=>{e.setPlayerState(id,{...e.getPlayer(id),x:bed.worldX-2-ox,y:bed.worldY-4-oy,vx:0,vy:0});e.setPlayerInput(id,{bits:0,aimX:0,aimY:0});};
  assert.equal(e.useBed(id,bed.id),BED_RESULT.TOO_FAR);
  move();e.setDayPhase(.3);
  assert.equal(e.useBed(id,bed.id),BED_RESULT.DAYTIME);
  assert.equal(e.getPlayer(id).respawnBed,bed.id);
  const saved=e.writeCheckpoint();const restored=createEngineWasm(options);
  try { assert.ok(restored.readCheckpoint(saved));assert.equal(restored.getPlayer(id).respawnBed,bed.id); } finally {restored.destroy();}
  e.setDayPhase(.9);assert.equal(e.useBed(id,bed.id),BED_RESULT.SLEEPING);
  ticks(30);assert.equal(e.getPlayer(id).sleepingBed,bed.id);assert.equal(e.getBeds().find(b=>b.id===bed.id).sleeper,-id);
  const asleep=createEngineWasm(options);
  try { assert.ok(asleep.readCheckpoint(e.writeCheckpoint()));assert.equal(asleep.getPlayer(id).sleepingBed,bed.id);asleep.stepActors();assert.equal(asleep.getBeds().find(b=>b.id===bed.id).sleeper,-id); } finally {asleep.destroy();}
  e.useBed(id,0);assert.equal(e.getPlayer(id).sleepingBed,0);assert.equal(e.getDayClock().phase,.9);
  assert.equal(e.useBed(id,bed.id),BED_RESULT.SLEEPING);ticks(121);
  assert.equal(e.getPlayer(id).sleepingBed,0);assert.ok(e.getDayClock().phase>.2&&e.getDayClock().phase<.22);assert.equal(e.getDayClock().held,false);
  console.log('ok: day spawn, persistent bed choice, occupied player bed, leave, sleep to dawn');
  e.setDayPhase(.9);ticks(1000);assert.ok(e.getBeds().find(b=>b.id===bed.id).sleeper>0);
  assert.equal(e.useBed(id,bed.id),BED_RESULT.OCCUPIED);
  e.setDayPhase(.3);ticks(1);move();e.setDayPhase(.9);
  assert.equal(e.useBed(id,bed.id),BED_RESULT.SLEEPING);
  const monster=e.spawnScriptedCreature(CREATURE.CRAWLER,bed.worldX+16,bed.worldY-4);assert.ok(monster);ticks(1);
  assert.equal(e.getPlayer(id).sleepingBed,0);assert.equal(e.getPlayer(id).bedStatus,BED_RESULT.UNSAFE);
  assert.equal(e.useBed(id,bed.id),BED_RESULT.UNSAFE);
  console.log('ok: resident occupancy and monsters prevent/interrupt sleep');
  e.setCreatureRuntime(false,false);
  for(let i=0;i<12&&e.getPlayer(id).alive;i++){e._damagePlayer(id,1000);ticks(121);}
  assert.equal(e.getPlayer(id).alive,false);
  for(let i=0;i<3;i++)e.shiftWorldXY(320,0);
  assert.ok(e.respawnPlayer(id));assert.equal(e.getPlayer(id).alive,false);
  for(let i=0;i<3;i++)e.shiftWorldXY(-320,0);ticks(1);assert.equal(e.getPlayer(id).alive,true);
  assert.ok(Math.hypot(e.getPlayer(id).x+ox-bed.worldX,e.getPlayer(id).y+oy-bed.worldY)<24);
  const bx=Math.floor(bed.worldX)-ox,by=Math.floor(bed.worldY)-oy;
  e.paintDisc(bx,by,5,MAT.STONE,true);e.syncComponents();
  for(let i=0;i<12&&e.getPlayer(id).alive;i++){e._damagePlayer(id,1000);ticks(121);}
  assert.equal(e.getPlayer(id).alive,false);assert.ok(e.respawnPlayer(id));
  assert.equal(e.getPlayer(id).respawnBed,0);assert.equal(e.getPlayer(id).bedStatus,BED_RESULT.SPAWN_LOST);
  assert.ok(Math.hypot(e.getPlayer(id).x-home.x,e.getPlayer(id).y-home.y)<24);
  console.log('ok: bed respawn and obstructed-bed fallback');
} finally {e.destroy();}
