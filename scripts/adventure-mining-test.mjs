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
 const before=count();hold();step();hold(0);step(7);assert.equal(count(),before);assert.equal(e.getPlayerMineProgress(id),0);
 step(2);assert.equal(count(),before);assert.ok(e.getPlayerMineProgress(id)>0);
 step(20);assert.equal(count(),before,'one click cannot silently repeat');
 hold();step(13);assert.ok(count()<before,'the second strike preserves and finishes earlier damage');
});
test('the pickaxe collects liquids and cannot mine far targets',({e,id,hold,step})=>{
 e.paintDisc(48,65,1,MAT.WATER,true);const water=e.getGrid().filter(m=>m===MAT.WATER).length;
 hold(INPUT.PRIMARY,46,65);step(80);assert.ok(e.getGrid().filter(m=>m===MAT.WATER).length<water);
 assert.ok(e.getInventory(id).pools.flatMap(p=>p.entries).some(s=>s.material===MAT.WATER&&s.count>0),'water reaches the inventory');
 hold(INPUT.PRIMARY,20,35);step(50);assert.equal(e.getPlayerMineTarget(id),null);
});
test('background walls can be mined through foreground terrain',({e,hold,step})=>{
 for(let y=59;y<68;y++)for(let x=59;x<65;x++)e.paintDiscLayer(1,x,y,0,MAT.WOOD,true);e.syncComponents();const before=Array.from(e.getGrid());
 hold(INPUT.SECONDARY,60,65);step(80);assert.ok(e.getGridBg().filter(m=>m===MAT.WOOD).length<54);assert.deepEqual(Array.from(e.getGrid()),before);
});
for(const material of [MAT.DIRT,MAT.STONE,MAT.IRON_ORE]){
 const a=arena(material,0),b=arena(material,9);
 const before=a.count();
 try{for(const t of [a,b]){t.hold();t.step(65);}
 assert.ok(a.count()<before,'precision mining still clears material');
 assert.ok(b.count()<a.count(),'larger mining sizes clear more material');
 console.log('ok: selected size controls mining area',material);
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
test('a swing clears a broad connected patch and preserves other materials',({e,hold,step,count})=>{
 e.paintDisc(59,65,0,MAT.WOOD,true);e.syncComponents();const before=count();hold();step(37);hold(0);
 assert.ok(before-count()>30, `cleared ${before-count()} stone cells`);assert.equal(e.getGrid()[65*128+59],MAT.WOOD);
});

test('the forge offers a stronger craftable pick and enforces its workshop',({e,id})=>{
 const recipe=e.getCraftingRecipes().find(r=>r.id===9);assert.equal(recipe.outputTier,TT.gold);assert.equal(recipe.npcId,4);
 for(const ingredient of recipe.ingredients)e.addToInventory(id,ingredient.value,ingredient.count);
 const before=e.getInventory(id);assert.equal(e.craft(id,9),0);assert.deepEqual(e.getInventory(id),before);
});

{
 const a=arena(MAT.DIRT,0);
 try { const before=a.count();a.hold();a.step();a.hold(0);a.step(35);
 assert.equal(before-a.count(),1,'one precision swing removes exactly one cell');
 console.log('ok: single-pixel mining');
 } finally {a.e.destroy();}
}
test('switching to precision cancels the pending large strike',({e,id,hold,step,count})=>{
 const before=count();hold();step(3);e.setSelectedFootprint(id,0);hold(0);step(35);
 assert.equal(count(),before,'the cancelled large strike cannot land');
 hold();step(40);hold(0);assert.equal(before-count(),1);
});
test('single-pixel placement creates exactly one component-backed cell',({e,id,hold,step})=>{
 e.addToInventory(id,MAT.WOOD,50);
 const slot=e.getInventory(id).slots.findIndex(s=>s.material===MAT.WOOD&&s.count>0);assert.ok(slot>=0);
 e.setSelectedSlot(id,slot);e.setSelectedFootprint(id,0);
 hold(INPUT.PRIMARY,45,60);step();hold(0,45,60);step(2);
 assert.equal(e.getGrid().filter(m=>m===MAT.WOOD).length,1);
});

for (const layer of [0,1]) for (const aimX of [43,44,46,50,54,58,60,61]) {
 test(`diagonal surface strike lands on its previewed cell (layer ${layer}, aim ${aimX})`,({e,id,hold,step})=>{
  e.eraseDisc(61,63,6);
  if(layer)for(let x=1;x<127;x++)e.paintDiscLayer(1,x,70,0,MAT.STONE,true);
  e.syncComponents();e.setSelectedFootprint(id,0);
  hold(layer?INPUT.SECONDARY:INPUT.PRIMARY,aimX,72);step();
  const target=e.getPlayerMineTarget(id);assert.ok(target,'surface is in reach');
  const grid=()=>layer?e.getGridBg():e.getGrid();
  const before=Array.from(grid());
  hold(0,100,40);step(9);
  assert.ok(e.getPlayerMineProgress(id)>0,'contact damages the locked cell even after aim moves');
  assert.deepEqual(Array.from(grid()),before,'the first stone strike only damages');
  step(20);hold(layer?INPUT.SECONDARY:INPUT.PRIMARY,aimX,72);step(10);
  assert.equal(grid()[target.y*128+target.x],MAT.EMPTY,'the second strike finishes the same cell');
 });
}

test('mining reaches twelve cells but cannot start beyond that',({e,id,hold,step})=>{
 e.eraseDisc(61,63,6);e.paintDisc(63,65,0,MAT.STONE,true);e.syncComponents();
 e.setSelectedFootprint(id,0);hold(INPUT.PRIMARY,63.5,65.5);step(10);
 assert.deepEqual(e.getPlayerMineTarget(id),{x:63,y:65});
 assert.ok(e.getPlayerMineProgress(id)>0,'the extended reach also lands at impact');
 hold(0);step(25);e.eraseDisc(63,65,0);e.paintDisc(65,65,0,MAT.STONE,true);e.syncComponents();
 hold(INPUT.PRIMARY,65.5,65.5);step(10);assert.equal(e.getPlayerMineTarget(id),null);
});

for (const obstruction of ['wall','distance']) {
 test(`a pending mining strike respects a new ${obstruction}`,({e,id,hold,step})=>{
  hold();step();assert.ok(e.getPlayerMineTarget(id));
  if(obstruction==='wall') {e.paintDisc(55,65,1,MAT.WOOD,true);e.syncComponents();}
  else e.setPlayerState(id,{...e.getPlayer(id),x:25});
  hold(0);step(9);assert.equal(e.getPlayerMineProgress(id),0);
 });
}

for (const radius of [1,2,4]) {
 const a=arena(MAT.DIRT,radius);
 try {
  const before=Array.from(a.e.getGrid());a.hold();a.step();
  const target=a.e.getPlayerMineTarget(a.id);assert.ok(target);
  a.hold(0);a.step(35);
  const after=a.e.getGrid();
  for(let k=0;k<before.length;k++)if(before[k]===MAT.DIRT){
   const x=k%128,y=Math.floor(k/128),inside=(x-target.x)**2+(y-target.y)**2<=radius**2;
   assert.equal(after[k],inside?MAT.EMPTY:MAT.DIRT,`radius ${radius} at ${x},${y}`);
  }
  console.log('ok: mining carves the exact circular radius',radius);
 } finally {a.e.destroy();}
}

for (const layer of [0,1]) for (const material of [MAT.WOOD,MAT.SAND,MAT.WATER]) {
 test(`placement uses the selected circular radius (layer ${layer}, material ${material})`,({e,id,hold,step})=>{
  const radius=4,x=40,y=58;
  e.addToInventory(id,material,500);
  const slot=e.getInventory(id).slots.findIndex(s=>s.material===material&&s.count>0);assert.ok(slot>=0);
  e.setSelectedSlot(id,slot);e.setSelectedFootprint(id,radius);
  const shape=e.getSurvivalFootprints().find(fp=>fp.id===radius);
  assert.equal(shape.width,9);assert.equal(shape.height,9);assert.equal(shape.cellCount,49);
  const count=e.getInventory(id).slots[slot].count;
  hold(layer?INPUT.SECONDARY:INPUT.PRIMARY,x,y);step();hold(0,x,y);step();
  const grid=layer?e.getGridBg():e.getGrid();
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)
   assert.equal(grid[(y+dy)*128+x+dx],dx*dx+dy*dy<=radius*radius?material:MAT.EMPTY,`offset ${dx},${dy}`);
  assert.equal(count-e.getInventory(id).slots[slot].count,49,'only the circular footprint consumes material');
 });
}
test('seeds place one cell even with the largest selected radius',({e,id,hold,step})=>{
 e.addToInventory(id,MAT.OAK_SEED,10);
 const slot=e.getInventory(id).slots.findIndex(s=>s.material===MAT.OAK_SEED&&s.count>0);assert.ok(slot>=0);
 e.setSelectedSlot(id,slot);e.setSelectedFootprint(id,9);
 hold(INPUT.PRIMARY,40,58);step();hold(0,40,58);step();
 assert.equal(e.getGrid().filter(m=>m===MAT.OAK_SEED).length,1);
});
