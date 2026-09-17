import assert from 'node:assert/strict';
import{initSandWasm,createEngineWasm,PLANET,MAT}from'../src/sand/wasmBridge/engineFactory.js';
import{OFF,STRIDES,MISSION}from'../src/sand/wasmBridge/abi.generated.js';
import schema from'../src/sand/abi.schema.json' with {type:'json'};
import art from'../src/sand/content/creatureArt.js';
await initSandWasm();
const e=createEngineWasm({cols:128,rows:128,planetId:PLANET.FRONTIER,infinite:false,sinksOn:false}),o=OFF.creatureSnapshot;
try{
 e.setCreatureRuntime(true,false);e.setSurvivalInventory(true);
 e.startMission(MISSION.FRONTIER,e.spawnPlayer(12,12));
 for(let x=0;x<128;x++)for(let y=40;y<110;y++)e.paintDisc(x,y,0,MAT.WATER,true);
 const defs=schema.enums.CreatureSpecies.descriptors.filter(d=>d.stats.locomotion==='CL_AMPHIBIOUS');
 for(const d of defs){
  const key=d.key.replace('CREATURE_',''),a=art[key],clip=a.clips.swim;
  assert(clip&&clip.frames.length>=2&&clip.frames.length<=4,`${key}: compact swim clip`);
  assert.equal(new Set(clip.frames.map(f=>f.join(''))).size,clip.frames.length,`${key}: distinct swim frames`);
  const r=new Float32Array(STRIDES.creatureSnapshot);
  for(const[k,v]of Object.entries({id:1,species:d.id,x:60,y:60,w:d.stats.w,h:d.stats.h,health:d.stats.maxHealth,maxHealth:d.stats.maxHealth,alive:1,facing:1}))r[o[k]]=v;
  e.setMirrorCreatures(r,0,0);e.stepActors();let snapshot=e.getCreatureSnapshotData().slice();
  assert.equal(snapshot[o.swimming],1,`${key}: submerged physics selects swimming`);
  const checkpoint=e.writeCheckpoint();
  assert(e.readCheckpoint(checkpoint),`${key}: checkpoint restores`);
  assert.equal(e.getCreatureSnapshotData()[o.swimming],1,`${key}: checkpoint restores water presentation`);
  e.setMirrorCreatures(snapshot,0,0);assert.equal(e.getCreatureSnapshotData()[o.swimming],1,`${key}: mirror keeps water state`);
  snapshot[o.y]=12;e.setMirrorCreatures(snapshot,0,0);e.stepActors();
  assert.equal(e.getCreatureSnapshotData()[o.swimming],0,`${key}: exits swim on dry ground`);
 }
 console.log(`PASS: ${defs.length} compact swim clips, submerged physics, snapshot round trips, and dry transitions.`);
}finally{e.destroy();}
