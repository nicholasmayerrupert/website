import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, PLANET, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { TC, TT } from '../src/sand/materials.generated.js';
await initSandWasm();
function arena(material=MAT.STONE,footprint=9){
 const e=createEngineWasm({cols:128,rows:100,worldSeed:17,planetId:PLANET.FRONTIER,sinksOn:false});
 e.setSurvivalInventory(true);e.setCreatureRuntime(false,false);
 for(let x=1;x<127;x++)e.paintDisc(x,70,0,MAT.STONE,true);
 for(let y=59;y<68;y++)for(let x=58;x<65;x++)e.paintDisc(x,y,0,material,true);
 e.syncComponents();const id=e.spawnPlayer(50,62);e.setSelectedSlot(id,1);e.setSelectedFootprint(id,footprint);
 const hold=(bits=INPUT.PRIMARY,x=60,y=65)=>e.setPlayerInput(id,{bits,aimX:x,aimY:y});
 const step=(n=1)=>{for(let i=0;i<n;i++)e.stepActors();};
 const count=()=>e.getGrid().filter(m=>m===material).length;
 return {e,id,hold,step,count};
}
function test(name,fn){const a=arena();try{fn(a);console.log('ok:',name);}finally{a.e.destroy();}}
test('windup does no damage; contact applies one discrete hit; release completes the swing',({e,id,hold,step,count})=>{
 const before=count();hold();step();hold(0);step(9);assert.equal(count(),before);assert.equal(e.getPlayerMineProgress(id),0);
 step(2);assert.equal(count(),before);assert.ok(e.getPlayerMineProgress(id)>0);
 step(20);assert.equal(count(),before,'one click cannot silently repeat');
 hold();step(13);assert.ok(count()<before,'the second strike preserves and finishes earlier damage');
});
test('liquids survive the pickaxe and far targets cannot be mined',({e,id,hold,step})=>{
 e.paintDisc(48,65,1,MAT.WATER,true);const water=e.getGrid().filter(m=>m===MAT.WATER).length;
 hold(INPUT.PRIMARY,46,65);step(80);assert.equal(e.getGrid().filter(m=>m===MAT.WATER).length,water);
 hold(INPUT.PRIMARY,20,35);step(50);assert.equal(e.getPlayerMineTarget(id),null);
});
test('foreground blocks access to background walls',({e,id,hold,step})=>{
 for(let y=59;y<68;y++)for(let x=59;x<65;x++)e.paintDiscLayer(1,x,y,0,MAT.WOOD,true);e.syncComponents();const before=Array.from(e.getGridBg());
 hold(INPUT.SECONDARY,60,65);step(80);assert.deepEqual(Array.from(e.getGridBg()),before);assert.equal(e.getPlayerMineTarget(id),null);
});
for(const material of [MAT.DIRT,MAT.STONE,MAT.IRON_ORE]){
 const a=arena(material,0),b=arena(material,9);
 try{for(const t of [a,b]){t.hold();t.step(65);}
 assert.deepEqual(Array.from(a.e.getGrid()),Array.from(b.e.getGrid()));
 assert.ok(a.e.getPlayerMineProgress(a.id)>=0);console.log('ok: building footprint does not change mining',material);
 }finally{a.e.destroy();b.e.destroy();}
}
const soft=arena(MAT.DIRT),stone=arena(MAT.STONE);
try{const s=soft.count(),h=stone.count();soft.hold();stone.hold();soft.step(13);stone.step(13);assert.ok(soft.count()<s);assert.equal(stone.count(),h);console.log('ok: soil breaks in one hit; stone needs multiple hits');}finally{soft.e.destroy();stone.e.destroy();}
const ore=arena(MAT.IRON_ORE);
try{ore.e.setPlayerTool(ore.id,TC.dig,TT.wood);const before=ore.count();ore.hold();ore.step(90);assert.equal(ore.count(),before,'weak tools do not destroy ore without drops');ore.e.setPlayerTool(ore.id,TC.dig,TT.iron);ore.step(100);assert.ok(ore.count()<before);console.log('ok: stronger picks unlock ore without destroying inaccessible resources');}finally{ore.e.destroy();}

test('an exposed background wall can be excavated without changing the foreground',({e,hold,step})=>{
 e.eraseDisc(60,63,5);e.paintDiscLayer(1,58,65,0,MAT.WOOD,true);e.syncComponents();
 const foreground=Array.from(e.getGrid());hold(INPUT.SECONDARY,60,65);step(15);
 assert.equal(e.getGridBg()[65*128+58],MAT.EMPTY);assert.deepEqual(Array.from(e.getGrid()),foreground);
});
test('a strike removes at most one small connected material patch',({e,hold,step,count})=>{
 e.paintDisc(59,65,0,MAT.WOOD,true);e.syncComponents();const before=count();hold();step(35);
 assert.ok(before-count()>0 && before-count()<=13);assert.equal(e.getGrid()[65*128+59],MAT.WOOD);
});

test('the forge offers a stronger craftable pick and enforces its workshop',({e,id})=>{
 const recipe=e.getCraftingRecipes().find(r=>r.id===9);assert.equal(recipe.outputTier,TT.gold);assert.equal(recipe.npcId,4);
 for(const ingredient of recipe.ingredients)e.addToInventory(id,ingredient.value,ingredient.count);
 const before=e.getInventory(id);assert.equal(e.craft(id,9),0);assert.deepEqual(e.getInventory(id),before);
});
