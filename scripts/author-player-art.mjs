// Bake the default body for pixel editing; armor and arms share its authored poses.
import {writeFileSync} from 'node:fs';
import player from '../src/sand/content/player.js';
import {playerLayerPose,playerLayerPixels,PLAYER_SETS,PLAYER_PART_SLOTS} from '../src/sand/content/playerLayers.js';
import {makePalette} from './import-creature-art.mjs';
const poses={},rgba={};
for(const [state,clip] of Object.entries(player.clips)){
 poses[state]=clip.frames.map((_,i)=>playerLayerPose(state,i,clip.frames.length));
 rgba[state]=poses[state].map(p=>playerLayerPixels(p));
}
const rgb=c=>c?[c>>>16&255,c>>>8&255,c&255]:null;
const {palette,colors}=makePalette(Object.values(rgba).flat().map(f=>f.map(rgb)));
const symbols=Object.keys(palette).slice(1), cache=new Map();
const nearest=c=>{if(!c)return '.';if(cache.has(c))return cache.get(c);let best=0,d=Infinity;colors.forEach((v,i)=>{const n=v.reduce((s,x,k)=>s+(x-rgb(c)[k])**2,0);if(n<d){d=n;best=i;}});cache.set(c,symbols[best]);return symbols[best];};
const clips=Object.fromEntries(Object.entries(player.clips).map(([state,c])=>[state,{...c,frames:rgba[state].map(f=>Array.from({length:44},(_,y)=>f.slice(y*32,(y+1)*32).map(nearest).join('')))}]));
const limbs=Object.fromEntries(Object.entries({outline:0xff18221d,sleeve:0xff52674a,skin:0xffb77d54,hand:0xffe2ad7b}).map(([k,c])=>[k,nearest(c)]));
writeFileSync('src/sand/content/player.js','// Authored component poses baked by scripts/author-player-art.mjs.\nexport default '+JSON.stringify({...player,palette,limbs,clips,layers:{slots:PLAYER_PART_SLOTS,sets:PLAYER_SETS,poses}},null,2)+';\n');
console.log('Baked all player states and registered seven equipment appearances.');
