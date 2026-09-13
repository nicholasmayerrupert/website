import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import createModule from '../src/sand3d/wasm/voxelDemo.js';

const e=await createModule({wasmBinary:readFileSync('src/sand3d/wasm/voxelDemo.wasm')});
const put=(x,y,z,m)=>e._demo_edit((x+.5)/16,(y+.5)/16,(z+.5)/16,m);
const get=(x,y,z)=>e._demo_cell((x+.5)/16,(y+.5)/16,(z+.5)/16);
const stats=()=>Array.from(e.HEAPF32.subarray(e._demo_stats()/4,e._demo_stats()/4+36));
const step=n=>{for(let i=0;i<n;++i)e._demo_step(1/60);};
assert.equal(e._demo_create(0),1);
try {
  // A fresh-world pillar extends above the current 16 m simulation window.
  // Its only support is cut inside the window; every part must become physical.
  e._demo_camera(0,8,8,0,0);
  for(let y=0;y<224;++y)for(let z=80;z<83;++z)for(let x=16;x<19;++x)put(x,y,z,4);
  step(2);assert.equal(stats()[1],0,'the complete pillar is supported by the quarry floor');
  e._demo_camera(0,4,8,0,0);
  for(let y=16;y<24;++y)for(let z=80;z<83;++z)for(let x=16;x<19;++x)put(x,y,z,0);
  step(2);
  assert.equal(get(17,28,81),0,'cut pillar leaves static terrain even when its top is unloaded');
  assert.equal(stats()[11],200*9,'all resident and saved pillar voxels become rigid bodies');
  assert.equal(stats()[1],4,'the tall detached component is partitioned into bounded physical volumes');
  const topBodies=stats()[11],startY=stats()[12];step(30);
  assert.ok(stats()[12]<startY-.2,'detached geometry actually falls');
  e._demo_pause(1);e._demo_camera(0,12,8,0,0);
  assert.equal(get(17,220,81),0,'streaming in the pillar top cannot resurrect static voxels');
  assert.equal(stats()[11],topBodies,'streaming preserves the detached body geometry');

  // A solid component can also cross the bottom of the resident window. Its
  // support is verified against persistent terrain, not the window rectangle.
  e._demo_reset();e._demo_pause(0);
  for(let z=62;z<70;++z)for(let y=-48;y<0;++y)for(let x=-4;x<4;++x)
    if(x===-4||x===3||z===62||z===69||y===-48)put(x,y,z,0);
  e._demo_camera(0,6,8,0,0);put(0,-1,65,0);step(2);
  assert.equal(get(0,-20,65),0,'a completely excavated underground island detaches');
  assert.ok(stats()[11]>100,'the island retains its physical voxels');

  // Exhaustion must not commit an irreversible support cut and leave an orphan.
  e._demo_reset();e._demo_tool(4);
  for(let i=0;i<32;++i)e._demo_use();
  assert.equal(stats()[1],32);
  for(let z=60;z<72;++z)for(let y=-12;y<4;++y)for(let x=-6;x<6;++x)
    if(x< -4||x>=4||z<62||z>=70||y< -10||y>=0)put(x,y,z,0);
  step(2);
  assert.equal(get(0,-11,65),3,'capacity-limited removal restores the island foundation');
  assert.equal(stats()[1],32);assert.ok(stats()[13]>0,'capacity limit is reported');
  assert.ok(stats().every(Number.isFinite));
  console.log('3D detachment checks passed: cross-window support, full geometry transfer, gravity, persistence, underground islands, and atomic capacity limits.');
}finally{e._demo_destroy();}
