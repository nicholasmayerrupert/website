import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, PLANET, WORLD_FEATURE } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { GAME_WORLD } from '../src/sand/content/catalog.js';
await initSandWasm();
const e=attachTestHooks(createEngineWasm({cols:640,rows:448,worldSeed:GAME_WORLD.seed,infinite:true,sinksOn:false,planetId:PLANET.FRONTIER}));
try {
  e.setSurvivalInventory(true);e.setCreatureRuntime(true,false);
  for(let i=0;i<6;i++)e.shiftWorldXY(320,0);
  const sites=[1786,1844,1960,2018].map(x=>{
    for(let y=-30;y<0;y++){const c=e.worldContextAt(x,y);if(c.featureKind===WORLD_FEATURE.VILLAGE_BUILDING)return c;}
    throw new Error(`Missing fixture building at ${x}`);
  });
  // Other nearby NPCs must not consume the residents belonging to these homes.
  for(let i=0;i<15;i++)assert.ok(e.spawnScriptedCreature(CREATURE.VILLAGER,2160+i, e.worldSurfaceAbsAt(2160+i)-8));
  const ticks=n=>{for(let i=0;i<n;i++)e.stepActors();};ticks(61);
  const residents=()=>e.getCreatures().filter(c=>c.alive&&[CREATURE.VILLAGER,CREATURE.VILLAGE_GUARD,CREATURE.VILLAGE_HUNTER].includes(c.species));
  const ids=[];
  for(const site of sites){
    const b=site.bounds;
    const inside=residents().filter(c=>{const x=c.x+e.getWorldOffsetX()+c.w/2,y=c.y+e.getWorldOffsetY()+c.h/2;return x>b.left&&x<b.right&&y>b.top&&y<b.bottom;});
    assert.equal(inside.length,1,`Building ${site.featureId} gets one resident with natural spawning disabled and a crowded window`);
    ids.push(inside[0].id);
  }
  assert.ok(ids.every(id=>e.getBeds().some(b=>b.resident===id)),'each inhabited room has a usable bed');
  ticks(180);assert.ok(ids.every(id=>residents().some(c=>c.id===id)));
  for(let i=0;i<3;i++)e.shiftWorldXY(320,0);ticks(61);
  for(let i=0;i<3;i++)e.shiftWorldXY(-320,0);ticks(61);
  for(const id of ids)assert.equal(residents().filter(c=>c.id===id).length,1,'streaming restores the same resident once');
  console.log('ok: every generated home is inhabited, furnished, and restored without duplicates');
} finally {e.destroy();}
