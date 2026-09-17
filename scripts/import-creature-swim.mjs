// Register compact swim strips against the existing sprite size and palette.
import sharp from 'sharp';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cutFrame} from './creature-art-pixels.mjs';
const root=new URL('../src/sand/art/creatures/swim/',import.meta.url);
export async function importCreatureSwim(record,meta){
 const {data,info}=await sharp(fileURLToPath(new URL(meta.file,root))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 for(let i=0;i<data.length;i+=4)if(data[i+3]<128||(data[i]>150&&data[i+2]>150&&data[i+1]<120&&Math.min(data[i],data[i+2])>data[i+1]*1.5)){data[i]=255;data[i+1]=0;data[i+2]=255;data[i+3]=255;}
 // Restore the registered land canvas before recomputing swim padding.
 const padX=(record.width-meta.width)/2,padY=record.height-meta.height;
 if(padX||padY)for(const [name,clip] of Object.entries(record.clips))if(name!=='swim')clip.frames=clip.frames.map(f=>f.slice(padY,padY+meta.height).map(row=>row.slice(padX,padX+meta.width)));
 record.width=meta.width;record.height=meta.height;
 const image={data,width:info.width,height:info.height};
 // Connected silhouettes allow long hands/tails to cross a nominal cell boundary.
 const whole=cutFrame(image,0,0,1,1),labels=new Int32Array(info.width*info.height),groups=[];
 for(let at=0;at<labels.length;at++)if(!whole.background[at]&&!labels[at]){
  const id=groups.length+1,points=[at];labels[at]=id;
  let minX=info.width,maxX=0,minY=info.height,maxY=0;
  for(let i=0;i<points.length;i++){
   const n=points[i],x=n%info.width,y=Math.floor(n/info.width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(const [nx,ny]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(nx>=0&&ny>=0&&nx<info.width&&ny<info.height){const next=ny*info.width+nx;if(!labels[next]&&!whole.background[next]){labels[next]=id;points.push(next);}}
  }
  groups.push({id,points,minX,maxX,minY,maxY});
 }
 const bodies=groups.sort((a,b)=>b.points.length-a.points.length).slice(0,meta.frames).sort((a,b)=>(a.minX+a.maxX)-(b.minX+b.maxX));
 if(bodies.length!==meta.frames)throw Error(`${meta.key}: missing connected sprite`);
 const source=bodies.map(b=>({...whole,background:new Uint8Array(labels.length).fill(1),minX:b.minX,maxX:b.maxX,minY:b.minY,maxY:b.maxY}));
 for(const group of groups){
  const x=(group.minX+group.maxX)/2,y=(group.minY+group.maxY)/2;
  const distances=bodies.map(b=>Math.hypot(Math.max(b.minX-x,0,x-b.maxX),Math.max(b.minY-y,0,y-b.maxY)));
  const i=distances.indexOf(Math.min(...distances));
  if(group.points.length<20)continue;
  for(const at of group.points)source[i].background[at]=0;
  for(const bound of ['minX','minY'])source[i][bound]=Math.min(source[i][bound],group[bound]);
  for(const bound of ['maxX','maxY'])source[i][bound]=Math.max(source[i][bound],group[bound]);
 }
 const points=[];record.clips.idle.frames[0].forEach((row,y)=>[...row].forEach((p,x)=>{if(p!=='.'&&p!=='0')points.push([x,y]);}));
 const bounds={left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
 const extent=Math.max(bounds.right-bounds.left+1,bounds.bottom-bounds.top+1);
 const scale=meta.scale??Math.max(...source.map(f=>Math.max((f.maxX-f.minX+1)/Math.min(record.width-4,extent*1.10),(f.maxY-f.minY+1)/Math.min(record.height-4,extent*1.10))))/(meta.size??1);
 const sourceCenterY=(Math.min(...source.map(f=>f.minY))+Math.max(...source.map(f=>f.maxY)))/2;
 const anchors=source.map((f,i)=>meta.anchors?.[i]||{x:(i+.5)*info.width/meta.frames,y:sourceCenterY});
 const offsets=source.map((f,i)=>meta.offsets?.[i]||[0,0]);
 const left=Math.min(...source.map((f,i)=>(f.minX-anchors[i].x)/scale+offsets[i][0]));
 const right=Math.max(...source.map((f,i)=>(f.maxX-anchors[i].x)/scale+offsets[i][0]));
 const top=Math.min(...source.map((f,i)=>(f.minY-anchors[i].y)/scale+offsets[i][1]));
 const bottom=Math.max(...source.map((f,i)=>(f.maxY-anchors[i].y)/scale+offsets[i][1]));
 const centerY=meta.centerY??Math.min((bounds.top+bounds.bottom)/2,record.height-3-bottom);
 const extraX=Math.max(0,Math.ceil(Math.max(-left,right)+3-(record.width-1)/2));
 const extraY=Math.max(0,Math.ceil(3-centerY-top));
 if(extraX||extraY){
  for(const [name,clip] of Object.entries(record.clips))if(name!=='swim')clip.frames=clip.frames.map(f=>[...Array(extraY).fill('.'.repeat(record.width+extraX*2)),...f.map(row=>'.'.repeat(extraX)+row+'.'.repeat(extraX))]);
  record.width+=extraX*2;record.height+=extraY;
 }
 const cx=(record.width-1)/2,cy=centerY+extraY;
 const symbols=Object.keys(record.palette).filter(c=>c!=='.'&&c!=='0');
 const colors=symbols.map(c=>[1,3,5].map(i=>parseInt(record.palette[c].slice(i,i+2),16))),cache=new Map();
 const nearest=rgb=>{const key=rgb.join(',');if(cache.has(key))return cache.get(key);let best=Infinity,at=0;colors.forEach((c,i)=>{const d=c.reduce((n,v,k)=>n+(v-rgb[k])**2,0);if(d<best){best=d;at=i;}});cache.set(key,symbols[at]);return symbols[at];};
 const frames=source.map((f,i)=>{
  const anchor=anchors[i],offset=offsets[i];
  return Array.from({length:record.height},(_,y)=>Array.from({length:record.width},(_,x)=>{
   const sx=Math.round(anchor.x+(x-cx-offset[0])*scale),sy=Math.round(anchor.y+(y-cy-offset[1])*scale);
   if(sx<0||sy<0||sx>=f.width||sy>=f.height||f.background[sy*f.width+sx])return '.';
   return nearest(f.pixels[sy*f.width+sx]);
  }).join(''));
 });
 if(new Set(frames.map(f=>f.join(''))).size!==meta.frames)throw Error(`${meta.key}: duplicate swim poses`);
 if(frames.some(f=>f.join('').replaceAll('.','').length<30))throw Error(`${meta.key}: empty swim pose`);
 record.clips.swim={ticks:meta.ticks??14,frames};
 return record;
}
export async function importRegisteredSwim(art) {
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
 for(const meta of manifest.creatures)if(art[meta.key])await importCreatureSwim(art[meta.key],meta);
 return art;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const {default:art}=await import('../src/sand/content/creatureArt.js');
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
 const chosen=process.argv.slice(2);
 for(const meta of manifest.creatures){
  if(chosen.length&&!chosen.includes(meta.key))continue;
  if(!existsSync(new URL(meta.file,root)))continue;
  await importCreatureSwim(art[meta.key],meta);console.log(`Imported ${meta.key}: ${meta.frames} swim poses`);
 }
 writeFileSync(new URL('../src/sand/content/creatureArt.js',import.meta.url),'// Editable native-resolution creature clips.\nexport default '+JSON.stringify(art,null,2)+';\n');
}
