import sources from './playerParts.js';

// Component order is shared by the content packet and player renderer.
export const PLAYER_PART_SLOTS = [0, 1, 3, 3, 3, 4, 1, 2, 2, 5];
const tint = (source, name, rgb) => ({name,parts:source.parts.map(p=>({...p,pixels:p.pixels.map(c=>{
  if (!c) return 0;
  const r=c>>>16&255,g=c>>>8&255,b=c&255;
  // Preserve warm exposed skin and leather; tint the armor's principal material.
  if (p.name==='head' && r>g*1.18 && g>b*1.12) return c;
  return (0xff000000 | Math.min(255,Math.round(r*rgb[0]))<<16 | Math.min(255,Math.round(g*rgb[1]))<<8 | Math.min(255,Math.round(b*rgb[2])))>>>0;
})}))});
export const PLAYER_SETS = [sources[0],sources[1],tint(sources[1],'briarbound',[.78,1.04,.78]),sources[2],sources[3],tint(sources[2],'mistweaver',[.73,1.20,1.15]),tint(sources[3],'oathkeeper',[1.15,1.13,1.03])];
const radians = a=>a*Math.PI/180;
const endpoint = (x,y,length,angle)=>[x-Math.sin(radians(angle))*length,y+Math.cos(radians(angle))*length];

// Poses are authored in source pixels. Equipment uses these same placements.
export function playerLayerPose(state, frame, count) {
  const phase=frame/Math.max(1,count), t=frame/Math.max(1,count-1);
  let hipX=17,hipY=29,lean=0,head=0,near=-4,far=5,kneeNear=0,kneeFar=0,cape=3;
  if (['walk','run','wade'].includes(state)) {
    const stride=[-32,-14,26,10][Math.floor(phase*4)%4]*(state==='run'?1.25:state==='wade'?.65:1);
    near=stride;far=-stride;kneeNear=near>0?-32:0;kneeFar=far>0?-32:0;
    hipY=30;lean=state==='run'?8:0;cape=-stride*.18;
  } else if (state==='rise') { near=-30;far=40;kneeNear=-65;kneeFar=-55; }
  else if (state==='fall'||state==='glide') { near=-18;far=25;kneeFar=-30;cape=-12; }
  else if (['land','crouch','guard','guard_raise','guard_hit','guard_break','charge'].includes(state)) {
    hipY=32;near=-38;far=35;kneeNear=-18;kneeFar=-55;lean=state==='guard_hit'?-12:5;
  } else if (state==='swim') {
    hipX=13;hipY=29;lean=50;head=-35;cape=12+Math.sin(phase*Math.PI*2)*6;
  } else if (state==='dodge'||state==='dash') { hipY=33;lean=32;near=-45;far=45;kneeNear=-15;kneeFar=-65;cape=-30; }
  else if (state==='hurt'||state==='stagger') {lean=-12;head=8;near=-18;far=12;}
  else if (state==='death'||state==='revive') {
    const f=state==='revive'?1-t:t;hipY=29+8*f;hipX=17-6*f;lean=70*f;head=-15*f;near=-50*f;far=55*f;kneeNear=-35*f;kneeFar=-85*f;cape=-25*f;
  } else if (['sword','axe','spear','cast','staff','bow','interact','drink'].includes(state)) {
    lean=['interact','axe'].includes(state)?10:0;near=-14;far=16;kneeFar=-12;
  }
  const neck=endpoint(hipX,hipY,-13,lean), torso=[neck[0],neck[1]];
  const placements=[];
  const put=(part,x,y,angle=0,shade=100)=>placements.push([part,Math.round(x),Math.round(y),Math.round(angle),shade]);
  put(9,torso[0]-2,torso[1]+1,lean+cape);
  const walking=['walk','run','wade'].includes(state);
  const grounded=['idle','walk','run','wade','land','crouch','guard','guard_raise','guard_hit','guard_break','charge','sword','axe','spear','cast','staff','bow','interact','drink','hurt','stagger'].includes(state);
  const contact=Math.floor(phase*4)%4;
  const feet=walking ? [[[25,40],[10,40]],[[19,40],[16,37]],[[11,40],[24,40]],[[18,37],[15,40]]][contact]
    : hipY>=32 ? [[25,40],[11,40]] : [[21,40],[13,40]];
  function leg(x,angle,knee,shade,foot){
    let ankle=grounded ? foot : state==='dash'||state==='dodge' ? [x-5,shade===100?40:38] : state==='swim' ? [x-9+Math.cos(phase*Math.PI*2+(shade===100?0:Math.PI))*1.5,hipY+3+Math.sin(phase*Math.PI*2+(shade===100?0:Math.PI))*4] : endpoint(...endpoint(x,hipY,6,angle),5,angle+knee);
    // Knees bend forward. Grounded feet retain a horizontal sole; swimming toes trail the kick.
    const dx=ankle[0]-x,dy=ankle[1]-hipY,d=Math.max(.01,Math.hypot(dx,dy));
    const bend=Math.sqrt(Math.max(0,36-d*d/4));
    const k=[x+dx/2+dy/d*bend,hipY+dy/2-dx/d*bend];
    const thigh=Math.atan2(-(k[0]-x),k[1]-hipY)*180/Math.PI;
    const shin=Math.atan2(-(ankle[0]-k[0]),ankle[1]-k[1])*180/Math.PI;
    put(3,x,hipY,thigh,shade);put(4,...k,shin,shade);put(5,...ankle,state==='swim'?55:0,shade);
  }
  leg(hipX-2,far,kneeFar,76,feet[1]);leg(hipX+2,near,kneeNear,100,feet[0]);
  put(2,hipX,hipY,state==='swim'?lean:0);put(1,...torso,lean);put(0,neck[0]+1,neck[1],lean+head);
  return placements;
}

// Inverse sampling keeps rotated pieces on the native pixel grid without holes.
export function rasterPlayerPart(part, x, y, angle, emit) {
  const c=Math.cos(radians(angle)),s=Math.sin(radians(angle));
  const corners=[[0,0],[part.width,0],[0,part.height],[part.width,part.height]].map(([u,v])=>{
    u-=part.pivot[0];v-=part.pivot[1];return [x+u*c-v*s,y+u*s+v*c];
  });
  for(let yy=Math.floor(Math.min(...corners.map(p=>p[1])));yy<Math.ceil(Math.max(...corners.map(p=>p[1])));yy++)
    for(let xx=Math.floor(Math.min(...corners.map(p=>p[0])));xx<Math.ceil(Math.max(...corners.map(p=>p[0])));xx++){
      const dx=xx+.5-x,dy=yy+.5-y,u=Math.floor(dx*c+dy*s+part.pivot[0]),v=Math.floor(-dx*s+dy*c+part.pivot[1]);
      if(u>=0&&v>=0&&u<part.width&&v<part.height){const color=part.pixels[v*part.width+u];if(color)emit(xx,yy,color);}
    }
}
export function playerLayerPixels(pose, styles=Array(6).fill(0), width=32,height=44) {
  const pixels=Array(width*height).fill(0);
  for(const [part,x,y,angle,shade] of pose){
    const set=PLAYER_SETS[styles[PLAYER_PART_SLOTS[part]]||0];
    rasterPlayerPart(set.parts[part],x,y,angle,(xx,yy,c)=>{
      if(xx<0||yy<0||xx>=width||yy>=height)return;
      const rgb=[c>>>16&255,c>>>8&255,c&255].map(v=>Math.round(v*shade/100));
      pixels[yy*width+xx]=(0xff000000|rgb[0]<<16|rgb[1]<<8|rgb[2])>>>0;
    });
  }
  return pixels;
}

// Inventory and dropped armor use the same filled component art as the wearer.
export function armorIconPixels(style, slot) {
  const set=PLAYER_SETS[style], pixels=new Uint32Array(256);
  const parts=[[0],[1],[8],[2,3,4],[5],[9]][slot];
  const source=[];
  const layouts=slot===3 ? [[2,7,1],[3,5,5],[3,10,5],[4,5,10],[4,10,10]]
    : parts.map(id=>[id,8,0]);
  for(const [id,x,y] of layouts){
    const p=set.parts[id];
    for(let yy=0;yy<p.height;yy++)for(let xx=0;xx<p.width;xx++){
      const c=p.pixels[yy*p.width+xx];if(c)source.push([x+xx-Math.floor(p.width/2),y+yy,c]);
    }
  }
  const left=Math.min(...source.map(p=>p[0])),right=Math.max(...source.map(p=>p[0]));
  const top=Math.min(...source.map(p=>p[1])),bottom=Math.max(...source.map(p=>p[1]));
  const scale=Math.min(14/(right-left+1),14/(bottom-top+1));
  const ox=(16-(right-left+1)*scale)/2,oy=(16-(bottom-top+1)*scale)/2;
  const samples=new Map(source.map(([x,y,c])=>[`${x},${y}`,c]));
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const sx=left+Math.floor((x+.5-ox)/scale),sy=top+Math.floor((y+.5-oy)/scale);
    const c=samples.get(`${sx},${sy}`);if(!c)continue;
    pixels[y*16+x]=(0xff000000|(c&255)<<16|(c&0xff00)|(c>>>16&255))>>>0;
  }
  return pixels;
}

export function equippedPlayerPreview(styles) {
  const pose=playerLayerPose('idle',0,6);
  pose.splice(1,0,[6,17,22,12,76],[7,16,27,0,76],[8,16,31,0,76]);
  pose.push([6,19,22,0,100],[7,19,27,0,100],[8,19,31,0,100]);
  return playerLayerPixels(pose,styles);
}
