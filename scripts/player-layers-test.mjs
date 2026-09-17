import assert from 'node:assert/strict';
import player from '../src/sand/content/player.js';
import {playerLayerPose,playerLayerPixels,PLAYER_PART_SLOTS} from '../src/sand/content/playerLayers.js';
import {gearPixels} from '../src/sand/content/gearArt.js';
import {EQUIPMENT,GEAR_FAMILY} from '../src/sand/content/equipment.js';

for(const state of ['idle','guard','guard_raise','guard_hit','guard_break','crouch','land']){
 const clip=player.clips[state];
 for(let f=0;f<clip.frames.length;f++){
  const pose=playerLayerPose(state,f,clip.frames.length),boots=pose.filter(p=>p[0]===5);
  assert.equal(boots.length,2);
  assert(boots.every(p=>p[3]===0&&p[2]===40),`${state}: planted boots have flat soles on the same floor`);
  for(let i=0;i<2;i++){
   const thigh=pose.filter(p=>p[0]===3)[i],shin=pose.filter(p=>p[0]===4)[i],boot=boots[i];
   assert(shin[1]>=(thigh[1]+boot[1])/2-.5,`${state}: knee bends forward toward toes`);
  }
 }
}
const nearFoot=f=>playerLayerPose('walk',f,8).filter(p=>p[0]===5)[1];
assert(nearFoot(0)[1]>nearFoot(4)[1]+8,'walk alternates near leg contact positions');
for(const state of ['dash','dodge','run']){
 const pose=playerLayerPose(state,0,player.clips[state].frames.length);
 assert(pose.find(p=>p[0]===0)[1]>pose.find(p=>p[0]===2)[1],`${state}: head leads the hips toward facing`);
}
const swim=Array.from({length:8},(_,f)=>playerLayerPose('swim',f,8));
assert(new Set(swim.map(p=>JSON.stringify(p))).size===8,'swim has eight distinct kick poses');
const feet=swim.map(p=>p.filter(v=>v[0]===5));
assert(feet[2][0][2]<feet[2][1][2]&&feet[6][0][2]>feet[6][1][2],'swim feet kick in opposite phases');
for(const pose of swim){
 const hips=pose.find(p=>p[0]===2),head=pose.find(p=>p[0]===0);
 assert(head[1]>hips[1]+6,'swim torso leans into travel');
 assert(pose.filter(p=>p[0]===5).every(p=>p[1]<hips[1]),'swim feet trail behind the hips');
}
for(const g of EQUIPMENT.filter(g=>g.family===GEAR_FAMILY.ARMOR)){
 const pixels=gearPixels(g.id);
 assert(pixels.filter(c=>c).length>=30,`${g.name}: inventory sprite fills a readable area`);
 const parts=player.layers.sets[g.style].parts.filter((_,i)=>PLAYER_PART_SLOTS[i]===g.slot);
 assert(parts.length&&parts.every(p=>p.pixels.filter(c=>c).length>=6),`${g.name}: filled worn components`);
}
const pose=playerLayerPose('idle',0,6),bare=playerLayerPixels(pose);
for(const slot of [0,1,3,4,5]){
 const styles=Array(6).fill(0);styles[slot]=1;
 assert.notDeepEqual(playerLayerPixels(pose,styles),bare,`Wayfarer slot ${slot} changes its rendered body layer`);
}
for(const [state,clip] of Object.entries(player.clips))assert.equal(player.layers.poses[state].length,clip.frames.length,`${state} shares body and equipment frame count`);
console.log('PASS: human knee direction, flat guard soles, alternating contacts, forward dash, and all 36 armor items have worn and inventory art.');
