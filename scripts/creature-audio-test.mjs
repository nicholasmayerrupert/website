import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { initSandWasm, createEngineWasm, PLANET, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE, SOUND_EVENT as S, OFF, STRIDES, CREATURE_ATTACK_STATE as A } from '../src/sand/wasmBridge/abi.generated.js';
import { CREATURE_VOICES, creatureSoundSpec } from '../src/sand/audio/creatureVoices.js';
import { AUDIO_ASSET_URLS } from '../src/sand/audio/audioAssets.js';
const descriptors=JSON.parse(readFileSync(new URL('../src/sand/abi.schema.json',import.meta.url))).enums.CreatureSpecies.descriptors;
const manifest=JSON.parse(readFileSync(new URL('../src/sand/audio/assets/creatures/manifest.json',import.meta.url)));
assert.deepEqual(Object.keys(CREATURE_VOICES).map(Number),Object.values(CREATURE));
assert.equal(new Set(Object.values(CREATURE_VOICES).map(v=>JSON.stringify(v))).size,Object.keys(CREATURE).length);
for(const asset of manifest){assert.ok(asset.duration>.035&&asset.duration<4);assert.ok(asset.peakDb<=-3.9);assert.ok(asset.rmsDb>-40);assert.ok(existsSync(new URL(AUDIO_ASSET_URLS[asset.key])));}
for(const species of Object.values(CREATURE))for(const type of [S.CREATURE,S.CREATURE_CALL,S.CREATURE_ALERT,S.CREATURE_ATTACK,S.CREATURE_DEATH]){
 const v=creatureSoundSpec(species,type);assert.ok(v?.samples.length);assert.ok(v.gain>0&&v.gain<.6);
 for(const key of v.samples)assert.ok(AUDIO_ASSET_URLS[key],`${species}: missing ${key}`);
}
assert.equal(creatureSoundSpec(999,S.CREATURE),null);assert.equal(creatureSoundSpec(0,S.EXPLOSION),null);
console.log(`ok: all ${descriptors.length} species have complete, distinct voice profiles and ${manifest.length} level-matched recordings`);
await initSandWasm();
const events=e=>{
 const data=e.drainSoundEvents(),out=[];for(let i=0;i<data.length;i+=STRIDES.soundEvent)out.push({type:data[i+OFF.soundEvent.type],species:data[i+OFF.soundEvent.material]});return out;
};
for(const d of descriptors){
 const e=createEngineWasm({cols:192,rows:144,sinksOn:false,worldSeed:72,planetId:PLANET.FRONTIER});
 try{
  e.setCreatureRuntime(false,false);
  if(d.render.humanNpc){for(let x=0;x<192;x++)for(let y=96;y<144;y++)e.paintDisc(x,y,0,MAT.STONE,true);e.syncComponents();}
  const id=e.spawnScriptedCreature(d.id,60,55);e.drainSoundEvents();
  const c=e.getCreatures().find(c=>c.id===id);assert.ok(c,`${d.name} spawned`);
  assert.ok(e.damageCreatures(Math.floor(c.x+c.w*.5),Math.floor(c.y+c.h*.5),2,1),`${d.name} accepts a point hit`);assert.ok(events(e).some(v=>v.type===S.CREATURE&&v.species===d.id),`${d.name} hurt carries its own species`);
  const data=e.getCreatureSnapshotData().slice(),o=OFF.creatureSnapshot;data[o.health]=0;data[o.hurtCooldown]=0;
  e.setMirrorCreatures(data,0,0);e.setCreatureRuntime(true,false);e.stepActors();
  const deaths=events(e).filter(v=>v.type===S.CREATURE_DEATH&&v.species===d.id);
  assert.equal(deaths.length,d.protection==='CPROT_NONE'?1:0,`${d.name} has one death cue or remains protected`);
  e.stepActors();assert.ok(!events(e).some(v=>v.type===S.CREATURE_DEATH),'a corpse never repeats its death cue');
 }finally{e.destroy();}
}
console.log('ok: every species routes hurt and death through the authority, and protected residents stay protected');
for(const species of [CREATURE.FOX,CREATURE.FROST_GIANT,CREATURE.BONE_DINOSAUR,CREATURE.MUMMY]){
 const e=createEngineWasm({cols:192,rows:144,sinksOn:false,worldSeed:72,planetId:PLANET.FRONTIER});
 try{
  e.setCreatureRuntime(false,false);for(let x=0;x<192;x++)for(let y=120;y<144;y++)e.paintDisc(x,y,0,MAT.STONE,true);e.syncComponents();
  e.spawnPlayer(95,112);e.spawnScriptedCreature(species,70,120-descriptors[species].stats.h);
  const data=e.getCreatureSnapshotData().slice(),o=OFF.creatureSnapshot;data[o.attackState]=A.CHARGING;data[o.attackProgress]=0;data[o.aimX]=96;data[o.aimY]=115;
  e.setMirrorCreatures(data,0,0);e.setCreatureRuntime(true,false);e.drainSoundEvents();let attacks=0;
  for(let i=0;i<85;i++){e.stepActors();attacks+=events(e).filter(v=>v.type===S.CREATURE_ATTACK&&v.species===species).length;}
  assert.equal(attacks,1,`${species}: one voice for a sustained or physical attack`);
 }finally{e.destroy();}
}
console.log('ok: attacks announce once, including the entire frost and fire streams');
{
 const e=createEngineWasm({cols:192,rows:144,sinksOn:false,worldSeed:72,storageRole:'presentation'});
 try{e.setCreatureRuntime(true,false);e.spawnScriptedCreature(CREATURE.BIRD,60,55);e.damageCreatures(61,56,2,1);e.stepActors();assert.equal(e.drainSoundEvents().length,0);}
 finally{e.destroy();}
}
console.log('ok: presentation mirrors cannot duplicate creature sounds');
{
 const e=createEngineWasm({cols:192,rows:144,sinksOn:false,worldSeed:72,planetId:PLANET.FRONTIER});
 try{
  e.setCreatureRuntime(false,false);e.spawnScriptedCreature(CREATURE.REACTOR_CORE,60,55);e.setCreatureRuntime(true,false);
  let calls=0;for(let i=0;i<1200;i++){e.stepActors();calls+=events(e).filter(v=>v.type===S.CREATURE_CALL).length;}
  assert.ok(calls>=1&&calls<=2,'idle calls are sparse rather than emitted every frame');
 }finally{e.destroy();}
}
{
 const e=createEngineWasm({cols:192,rows:144,sinksOn:false,worldSeed:72,planetId:PLANET.FRONTIER});
 try{
  e.setCreatureRuntime(false,false);for(let x=0;x<192;x++)for(let y=120;y<144;y++)e.paintDisc(x,y,0,MAT.STONE,true);e.syncComponents();
  e.spawnScriptedCreature(CREATURE.FOX,60,114);e.setCreatureRuntime(true,false);let footsteps=0;
  for(let i=0;i<150;i++){e.stepActors();footsteps+=events(e).filter(v=>v.type===S.CREATURE_MOVE).length;}
  assert.ok(footsteps>=2&&footsteps<=8,'movement cues follow a bounded cadence');
 }finally{e.destroy();}
}
console.log('ok: idle calls and moving footfalls have a restrained authoritative cadence');

