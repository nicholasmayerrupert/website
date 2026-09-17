import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {cutFrame,makePalette} from './import-creature-art.mjs';
export async function importSkeletonDragonArt(){
 const frames=[];
 for(const name of ['locomotion','attacks']){
  const {data,info}=await sharp(fileURLToPath(new URL(`../src/sand/art/skeleton-dragon/${name}.png`,import.meta.url))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const image={data,width:info.width,height:info.height};
  frames.push(...Array.from({length:12},(_,i)=>cutFrame(image,i%4,Math.floor(i/4))));
 }
 const width=84,height=56,scale=Math.max(...frames.map(f=>Math.max((f.maxX-f.minX+1)/80,(f.maxY-f.minY+1)/52)));
 const walkFloor=Math.max(...frames.slice(0,4).map(f=>f.maxY));
 const native=frames.map((f,index)=>Array.from({length:width*height},(_,i)=>{
  const x=Math.round(f.width/2+(i%width-(width-1)/2)*scale),y=Math.round((index<4?walkFloor:f.maxY)+(Math.floor(i/width)-54)*scale);
  if(x<0||y<0||x>=f.width||y>=f.height||f.background[y*f.width+x])return null;
  return f.pixels[y*f.width+x];
 }));
 const {palette,colors}=makePalette(native),symbols=Object.keys(palette).slice(1),cache=new Map();
 const encoded=native.map(f=>{
  const pixels=f.map(rgb=>{if(!rgb)return '.';const key=rgb.join(',');if(cache.has(key))return cache.get(key);let best=0,d=Infinity;colors.forEach((c,i)=>{const n=c.reduce((v,x,k)=>v+(x-rgb[k])**2,0);if(n<d){d=n;best=i;}});cache.set(key,symbols[best]);return symbols[best];});
  return Array.from({length:height},(_,y)=>pixels.slice(y*width,(y+1)*width).join(''));
 });
 const clip=(ids,ticks)=>({ticks,frames:ids.map(i=>encoded[i])});
 return {width,height,pixelScale:.5,palette,clips:{idle:clip([4],12),move:clip([0,1,2,3],10),windup:clip([12,16,20],9),attack:clip([13,14,17,18],6),recover:clip([15,19,23],7),hurt:clip([8],5),death:clip([9,10,11],7),special:clip([21,22],8)}};
}
