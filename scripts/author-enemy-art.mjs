// Rebuild adventure sprite sets from articulated pixel primitives.
// Source pixels are quarter-cell art; combat boxes live in abi.schema.json.
import { readFileSync, writeFileSync } from 'node:fs';
const output = new URL('../src/sand/content/creatureArt.js', import.meta.url);
const source = readFileSync(output, 'utf8');
const art = JSON.parse(source.slice(source.indexOf('export default ') + 15).trim().replace(/;$/, ''));
const clips = { idle: [6, 12], move: [8, 7], windup: [6, 9], attack: [6, 4], recover: [4, 5], hurt: [3, 5], death: [6, 3], special: [6, 8] };
function canvas(w, h) {
  const a = Array.from({length:h}, () => Array(w).fill('.'));
  const dot=(x,y,c)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&x<w&&y>=0&&y<h)a[y][x]=c;};
  const rect=(x,y,ww,hh,c)=>{for(let j=0;j<hh;j++)for(let i=0;i<ww;i++)dot(x+i,y+j,c);};
  const ellipse=(x,y,rx,ry,c)=>{for(let j=Math.floor(y-ry);j<=y+ry;j++)for(let i=Math.floor(x-rx);i<=x+rx;i++)if(((i-x)/rx)**2+((j-y)/ry)**2<=1)dot(i,j,c);};
  const poly=(p,c)=>{for(let y=0;y<h;y++)for(let x=0;x<w;x++){let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>y)!==(p[j][1]>y)&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])inside=!inside;if(inside)dot(x,y,c);}};
  const line=(x,y,xx,yy,r,c)=>{const n=Math.max(1,Math.ceil(Math.hypot(xx-x,yy-y)*2));for(let i=0;i<=n;i++)ellipse(x+(xx-x)*i/n,y+(yy-y)*i/n,r,r,c);};
  const limb=(x,y,xx,yy,r,shade='b',lit='l')=>{line(x,y,xx,yy,r+1,'o');line(x,y,xx,yy,r,shade);line(x-1,y,xx-1,yy,r*.4,lit);};
  return {a,dot,rect,ellipse,poly,line,limb};
}
function pose(state,f,n) {
  const t=f/(n-1),wave=Math.sin(f/n*Math.PI*2);
  return {state,t, step:state==='move'?wave:0, bob:state==='move'?Math.abs(wave)*1.4:state==='idle'?Math.round(wave*.7):0,
    wind:state==='windup'?t:state==='attack'?1-t:state==='recover'?.3*(1-t):state==='special'?.5+.4*wave:0,
    strike:state==='attack'?Math.sin(t*Math.PI):state==='recover'?.15*(1-t):0, firing:state==='attack',
    hurt:state==='hurt'?Math.sin(t*Math.PI):0,
    special:state==='special'?wave:0};
}
function finish(a,state,t) {
  if(state!=='death'){
    const shift=state==='hurt'?Math.round(Math.sin(t*Math.PI)*3):0;
    return a.map(r=>r.slice(shift).concat(Array(shift).fill('.')).join(''));
  }
  const h=a.length,w=a[0].length,b=Array.from({length:h},()=>Array(w).fill('.'));
  const scale=1-t*.78;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(a[y][x]!=='.') {
    const yy=Math.round(h-3-(h-3-y)*scale),xx=Math.round(x+(y-h*.5)*t*.13);
    if(xx>=0&&xx<w&&yy>=0&&yy<h && !(t>.8&&(x*13+y*7)%11<3))b[yy][xx]=a[y][x];
  }
  return b.map(r=>r.join(''));
}
function giant(p,c) {
  const {poly,ellipse,rect,line,limb,dot}=c;
  const charging=p.state==='windup', attacking=p.state==='attack', recovering=p.state==='recover';
  const pattern=p.pattern??0, breath=p.state==='special';
  const ease=t=>t*t*(3-2*t), release=attacking?ease(Math.min(1,p.t*2.4)):recovering?1-ease(p.t):0;
  const ready=charging?ease(p.t):attacking?1:recovering?1-ease(p.t):0;
  const smash=pattern===1, spear=pattern===2;
  const crouch=(smash?release*7:breath?2:0)+(p.state==='death'?ease(p.t)*5:0);
  const lean=(smash?-ready*3+release*7:spear?-ready*3+release*6:breath?3:ready*-2)-p.hurt*3;
  const X=x=>x+lean,Y=y=>y+p.bob+crouch;
  // Broad planted feet support jointed shins; the forward knee carries the weight.
  for(const [x,sign] of [[22,-1],[39,1]]) {
    const stride=p.step*sign,foot=x+stride*5,knee=x-stride*3,up=Math.max(0,stride)*4;
    limb(x,Y(59),knee,70+crouch*.3,5,sign<0?'d':'b','l');
    limb(knee,70+crouch*.3,foot,80-Math.max(0,stride)*4,4,'d','b');
    poly([[foot-6,78-up],[foot+3,77-up],[foot+9,82-up],[foot+9,85-up],[foot-7,85-up]],'o');
    poly([[foot-5,79-up],[foot+2,79-up],[foot+7,82-up],[foot+7,83-up],[foot-5,83-up]],'b');
    for(let k=0;k<3;k++)rect(foot+1+k*2,82-up,1,2,'l');
    line(knee-3,70,knee+3,69,1,'c');
  }
  const farHand=smash?[X(19)-ready*8+release*15,Y(55)-ready*38+release*58]:spear?[X(12)+ready*32+release*6,Y(53)-ready*10]:[X(12),Y(53)-ready*8];
  limb(X(16),Y(32),X(10),Y(42)-ready*8,6,'d','b');
  limb(X(10),Y(42)-ready*8,...farHand,5,'d','b');ellipse(...farHand,6,6,'o');ellipse(farHand[0],farHand[1]-1,5,5,'d');
  // A tapered torso and hanging pelt leave the waist and legs readable.
  poly([[X(17),Y(27)],[X(43),Y(26)],[X(49),Y(39)],[X(41),Y(57)],[X(23),Y(58)],[X(15),Y(42)]],'o');
  poly([[X(19),Y(29)],[X(42),Y(28)],[X(46),Y(39)],[X(39),Y(55)],[X(25),Y(55)],[X(18),Y(41)]],'b');
  poly([[X(20),Y(31)],[X(32),Y(31)],[X(30),Y(43)],[X(23),Y(46)],[X(19),Y(39)]],'l');
  poly([[X(34),Y(32)],[X(41),Y(30)],[X(45),Y(40)],[X(39),Y(48)],[X(33),Y(43)]],'d');
  line(X(24),Y(45),X(31),Y(46),1,'d');line(X(32),Y(38),X(32),Y(50),.6,'d');
  poly([[X(20),Y(53)],[X(43),Y(53)],[X(45),Y(65)],[X(40),Y(62)],[X(36),Y(68)],[X(31),Y(64)],[X(25),Y(68)],[X(18),Y(64)]],'o');
  for(let k=0;k<8;k++)poly([[X(21+k*3),Y(54)],[X(24+k*3),Y(55)],[X(21+k*3),Y(63+k%3)]],k%2?'f':'l');
  rect(X(21),Y(53),22,3,'r');line(X(22),Y(53),X(41),Y(53),.6,'f');
  poly([[X(32),Y(51)],[X(36),Y(55)],[X(32),Y(60)],[X(28),Y(55)]],'o');
  poly([[X(32),Y(53)],[X(34),Y(55)],[X(32),Y(58)],[X(30),Y(55)]],'c');dot(X(32),Y(54),'e');
  // Layered glacier plates form an asymmetric shoulder mantle.
  for(const [x,y,ww,hh]of [[13,30,10,14],[17,23,10,15],[23,25,9,11],[40,26,10,11],[47,31,8,12]]){
    poly([[X(x-ww/2),Y(y+4)],[X(x-2),Y(y-hh/2)],[X(x+ww/2),Y(y+3)],[X(x+2),Y(y+hh/2)]],'o');
    poly([[X(x-ww/2+2),Y(y+3)],[X(x-2),Y(y-hh/2+2)],[X(x+ww/2-1),Y(y+3)],[X(x+1),Y(y+hh/2-2)]],'c');
    line(X(x-2),Y(y-hh/2+2),X(x-1),Y(y+3),.7,'e');
  }
  const hx=smash?X(47)-ready*7+release*8:spear?X(49)-ready*15+release*19:X(49)-ready*3;
  const hy=smash?Y(54)-ready*42+release*58:spear?Y(54)-ready*18+release*3:Y(54)-ready*10;
  const ex=smash?X(51)-ready*2:X(49),ey=smash?(Y(33)+hy)*.5:Y(43)-ready*6;
  limb(X(45),Y(33),ex,ey,6,'b','l');limb(ex,ey,hx,hy,5,'b','l');
  ellipse(hx,hy,7,7,'o');ellipse(hx,hy-1,6,6,'b');line(hx-3,hy-3,hx+3,hy-3,1,'l');
  for(let k=0;k<3;k++)line(hx-3+k*3,hy+1,hx-3+k*3,hy+4,.6,'d');
  // A low brow, projecting nose and split beard make the face read in profile.
  ellipse(X(32),Y(18),10,12,'o');ellipse(X(32),Y(18),9,11,'b');
  poly([[X(25),Y(12)],[X(35),Y(10)],[X(40),Y(17)],[X(37),Y(24)],[X(26),Y(25)]],'l');
  poly([[X(23),Y(14)],[X(20),Y(4)],[X(27),Y(9)],[X(29),Y(1)],[X(33),Y(9)],[X(40),Y(3)],[X(41),Y(14)]],'o');
  poly([[X(24),Y(12)],[X(23),Y(7)],[X(28),Y(12)],[X(29),Y(4)],[X(33),Y(12)],[X(38),Y(7)],[X(39),Y(13)]],'c');
  line(X(29),Y(5),X(30),Y(10),.6,'e');
  line(X(27),Y(17),X(33),Y(18),1.5,'o');line(X(36),Y(17),X(40),Y(16),1.3,'o');
  rect(X(30),Y(19),3,1,'e');rect(X(38),Y(18),2,1,'e');
  poly([[X(35),Y(19)],[X(44),Y(23)],[X(43),Y(25)],[X(36),Y(24)]],'d');line(X(37),Y(21),X(42),Y(23),.7,'l');
  const open=breath?4:charging&&!smash&&!spear?ready*3:1;
  ellipse(X(38),Y(28),6,open+1,'o');if(breath)ellipse(X(40),Y(28),3,2,'c');
  for(const [x,end]of [[31,37],[40,39]])poly([[X(x-1),Y(27)],[X(x+2),Y(27)],[X(end),Y(34)]],'w');
  poly([[X(24),Y(23)],[X(30),Y(29)],[X(34),Y(32)],[X(31),Y(42)],[X(27),Y(37)],[X(24),Y(39)],[X(21),Y(29)]],'f');
  poly([[X(34),Y(32)],[X(40),Y(32)],[X(38),Y(40)],[X(34),Y(42)]],'f');
  for(let k=0;k<4;k++)line(X(23+k*3),Y(29+k%2*3),X(26+k*2),Y(36+k%2*3),.7,k%2?'w':'b');
  rect(X(27),Y(36),3,2,'r');rect(X(35),Y(38),3,2,'r');
  if(breath)for(let k=0;k<6;k++){const x=X(47+k*2),y=Y(26)+Math.sin(k*2+p.t*6.28)*3;dot(x,y,k%2?'c':'e');}
}
function giantDeath(a,t) {
  const h=a.length,w=a[0].length,b=Array.from({length:h},()=>Array(w).fill('.'));
  // Frost plates fracture into solid chunks that tumble onto the planted feet.
  for(let y=h-1;y>=0;y--)for(let x=0;x<w;x++)if(a[y][x]!=='.') {
    const bx=Math.floor(x/8),by=Math.floor(y/8),hash=(bx*13+by*7)%17;
    const fall=Math.min(1,Math.max(0,(t-hash*.008)/.84));
    const dx=Math.round((hash%7-3)*fall*3),dy=Math.round(Math.max(0,77-by*8)*fall*fall);
    const xx=x+dx,yy=y+dy;
    if(xx<1||xx>=w-1||yy<0||yy>=h-2)continue;
    if(t>.9&&hash%5===0)continue;
    b[yy][xx]=t>.3&&(x%8===0||y%8===0)&&a[y][x]!=='o'?'c':a[y][x];
  }
  return b.map(row=>row.join(''));
}
function mummy(p,c) {
  const {poly,ellipse,rect,line,limb}=c;
  const X=x=>x-p.wind*2+p.strike*3,Y=y=>y+p.bob;
  for(const [x,sign]of[[18,-1],[27,1]]) {
    const foot=x+p.step*sign*3;
    limb(x,38,foot,50-Math.max(0,p.step*sign)*2,2,'d','b');rect(foot-2,50-Math.max(0,p.step*sign)*2,7,3,'o');rect(foot-1,50-Math.max(0,p.step*sign)*2,5,1,'l');
    for(let y=40;y<49;y+=3)line(x-2,y,x+2,y-1,0.6,'l');
  }
  limb(X(17),Y(23),X(11)+p.strike*12,Y(32)-p.wind*8,2,'d','b');
  poly([[X(15),Y(20)],[X(29),Y(20)],[X(31),Y(37)],[27,42],[17,41],[X(14),Y(30)]],'o');
  poly([[X(16),Y(21)],[X(28),Y(21)],[X(29),Y(37)],[26,40],[18,39],[X(16),Y(30)]],'b');
  for(let y=23;y<39;y+=3)line(X(16),Y(y),X(29),Y(y-2),.8,y%2?'l':'d');
  ellipse(X(24),Y(13),7,9,'o');ellipse(X(24),Y(13),6,8,'b');
  for(let y=8;y<22;y+=3)line(X(18),Y(y),X(29),Y(y-2),.7,'l');
  rect(X(20),Y(12),11,3,'o');rect(X(23),Y(13),2,1,'e');rect(X(29),Y(13),2,1,'e');
  rect(X(23),Y(18),5,2,'d');rect(X(24),Y(18),1,1,'w');
  // Lapis funerary collar and a broken cobra circlet.
  poly([[X(15),Y(21)],[X(30),Y(20)],[X(28),Y(26)],[X(23),Y(29)],[X(17),Y(26)]],'r');
  for(let k=0;k<5;k++)line(X(17+k*3),Y(22),X(20+k*2),Y(25),.8,k%2?'c':'a');
  rect(X(18),Y(6),12,2,'r');rect(X(19),Y(6),10,1,'a');line(X(26),Y(6),X(26),Y(2),1,'a');rect(X(26),Y(2),3,2,'c');
  const ex=X(32)+p.wind*2,ey=Y(28)-p.wind*8;
  const hx=X(33)+p.strike*9-p.wind*3,hy=Y(36)-p.wind*17;
  limb(X(29),Y(23),ex,ey,2,'b','l');limb(ex,ey,hx,hy,2,'b','l');
  for(let k=0;k<3;k++)line(hx,hy+k,hx+4,hy+k,0.5,'l');
  // Loose linen strips move separately from the body and arms.
  line(X(16),Y(28),X(8),Y(32)+p.step*2,1,'d');line(X(8),Y(32)+p.step*2,X(6),Y(39)+p.step*3,1,'l');
  line(hx,hy-2,hx-6,hy+5+p.wind*4,.8,'l');
}
function toad(p,c) {
  const {poly,ellipse,rect,line,limb,dot}=c;
  const X=x=>x-p.wind*2+p.strike*3,Y=y=>y+p.bob;
  const puff=p.wind*4;
  for(const [x,sign]of[[12,-1],[40,1]]) {
    limb(X(x),Y(29),x+sign*5+p.step*sign*3,36,4,'d','b');
    for(let k=0;k<3;k++)line(x+sign*5,36,x+sign*9+k*2,39-Math.max(0,p.step*sign)*2,1,'b');
  }
  ellipse(X(28),Y(26),21,13,'o');ellipse(X(27),Y(25),20,12,'d');
  ellipse(X(28),Y(26),17,9,'b');ellipse(X(36),Y(29),12+puff,7+puff*.4,'r');
  ellipse(X(38),Y(28),10+puff,5+puff*.4,'a');
  // Basalt armor islands leave branching molten fissures between them.
  for(let k=0;k<9;k++){
    const x=X(11+k*4),y=Y(18+(k*7)%10);ellipse(x,y,4,3,'o');ellipse(x-1,y-1,3,2,'d');line(x-2,y+3,x+2,y+3,0.7,k%2?'r':'a');
  }
  for(let k=0;k<5;k++)poly([[X(13+k*7),Y(18)],[X(15+k*7),Y(8+k%3*2)],[X(19+k*7),Y(19)]],k%2?'d':'o');
  ellipse(X(41),Y(19),8,7,'o');ellipse(X(41),Y(18),7,6,'b');
  ellipse(X(44),Y(17),4,3,'a');rect(X(44),Y(15),1,5,'o');rect(X(45),Y(16),1,1,'w');
  ellipse(X(43),Y(27),10,2+p.wind*4+p.strike*2,'o');
  if(p.wind>.2||p.strike>.2){ellipse(X(46),Y(28),5,2+p.wind*2,'r');ellipse(X(48),Y(27),3,1+p.wind,'a');}
  for(let k=0;k<4;k++)rect(X(36+k*4),Y(25)-p.wind,1,2,'l');
  limb(X(34),Y(30),X(37)+p.step*2,37-Math.max(0,p.step)*2,3,'d','b');
  for(let k=0;k<3;k++)line(X(37)+p.step*2,37-Math.max(0,p.step)*2,X(39+k*3),39-Math.max(0,p.step)*2,1,'b');
  for(let k=0;k<7;k++)dot(X(15+k*4),Y(24+(k*3)%9),k%2?'r':'a');
}
function dragon(p,c) {
  const {poly,line,rect,dot}=c;
  const walking=p.state==='move',breath=p.state==='special';
  const wave=Math.sin(p.t*Math.PI*2),wind=p.state==='windup'?p.t:p.state==='recover'?(1-p.t)*.3:0;
  const snap=p.state==='attack'?Math.sin(Math.min(1,p.t*2)*Math.PI):0;
  const lean=Math.round(-wind+snap-p.hurt),bob=walking?Math.round(Math.abs(p.step)):p.bob;
  const X=x=>x+lean,Y=y=>y+bob;
  const shape=(points,color)=>poly(points.map(([x,y])=>[X(x),Y(y)]),color);
  // Angular shafts, broad ivory planes and single-pixel joints share the roster's scale.
  const bone=(x,y,xx,yy,far=false,wide=1)=>{
    line(x,y,xx,yy,wide+1,'o');line(x,y,xx,yy,wide,far?'d':'b');
    line(x,y-1,xx,yy-1,wide===1?.4:.5,far?'b':'l');
    rect(x-1,y-1,2,2,far?'d':'l');rect(xx-1,yy-1,2,2,far?'d':'l');
  };
  const link=(a,b,far=false,wide=1)=>bone(X(a[0]),Y(a[1]),X(b[0]),Y(b[1]),far,wide);
  const leg=(front,far)=>{
    const stride=walking?p.step*(front!==far?1:-1):0;
    const hip=front?[54,32]:[34,34];
    const knee=[(front?55:40)+(far?-5:1)+Math.round(stride*2),front?42:43];
    const foot=[(front?61:33)+(far?-5:1)-Math.round(stride*3),53-Math.round(Math.max(0,stride)*3)];
    link(hip,knee,far,1.4);bone(X(knee[0]),Y(knee[1]),foot[0],foot[1]-2,far,1);
    line(foot[0]-2,foot[1],foot[0]+5,foot[1],1,'o');
    rect(foot[0]-1,foot[1]-1,6,1,far?'d':'b');
    for(let toe=0;toe<3;toe++)dot(foot[0]+toe*2+1,foot[1],far?'b':'l');
    dot(X(knee[0]),Y(knee[1]),far?'b':'w');
  };
  leg(false,true);leg(true,true);
  // The far wing stays below the near wing so the open fingers read separately.
  const flare=Math.round(wind*2+(breath?1:0)+wave);
  const shoulder=[48,29],elbow=[42,13-flare],wrist=[28,8-flare];
  link([47,29],[49,12],true);link([49,12],[38,5],true);
  for(const tip of [[34,17],[40,23],[45,28]])link([38,5],tip,true);
  // Scalloped scraps hang between exposed finger bones, leaving the wing mostly hollow.
  shape([[28,8-flare],[14,18],[20,15],[20,24],[27,17],[29,30],[34,23],[39,33],[42,25]],'o');
  shape([[29,12-flare],[22,18],[24,18],[28,15],[31,26],[33,21],[37,27],[38,22]],'m');
  link(shoulder,elbow,false,1.4);link(elbow,wrist,false,1.4);
  for(const [joint,tip]of [[[20,12],[14,18]],[[25,18],[20,26]],[[33,18],[29,31]],[[39,21],[39,33]]]){
    link(wrist,joint);link(joint,tip);
  }
  link(wrist,[25,Math.max(4,6-flare)]);dot(X(25),Y(Math.max(3,5-flare)),'w');
  // The tail is a chain of blocky vertebrae with a hooked, barbed tip.
  const tail=[[33,32],[26,33],[20,32],[14,29],[9,25],[6,21],[5,17+Math.round(wave)]];
  for(let k=tail.length-1;k>0;k--){
    link(tail[k],tail[k-1],false,k<3?1.3:.8);
    const [x,y]=tail[k];shape([[x-2,y],[x-2,y-4],[x+2,y]],k<3?'l':'b');
    dot(X(x+1),Y(y+1),'d');
  }
  // Far ribs show through the empty cage; the ember heart is deliberately small.
  for(let k=0;k<5;k++){
    const x=35+k*4;
    link([x,28],[x-2,34],true,.5);link([x-2,34],[x+1,39],true,.5);
  }
  const heat=breath||wind>.4;
  shape([[44,30],[47,33],[49,29],[50,36],[47,39],[44,36]],'r');
  shape([[46,32],[48,35],[48,38],[46,37]],heat?'e':'a');
  if(heat)dot(X(47),Y(35),'w');
  // The spine rises into an S-shaped neck beneath the narrow horned skull.
  const neckX=-Math.round(wind),neckY=Math.round(snap*7-wind);
  const spine=[[30,32],[34,28],[40,26],[46,26],[51,27],[55,25+neckY*.3],[56+neckX*.5,21+neckY*.6],[60+neckX,18+neckY],[64+neckX,18+neckY]];
  for(let k=0;k<spine.length-1;k++){
    link(spine[k],spine[k+1]);
    const [x,y]=spine[k];
    if(k<6)shape([[x-1,y-1],[x-2,y-5],[x+2,y-2]],'l');
    dot(X(x+1),Y(y),'d');
  }
  for(let k=0;k<5;k++){
    const x=34+k*4,top=28-(k>0&&k<4?1:0),bottom=38+(k>0&&k<4?2:0);
    link([x,top],[x+3,33],false,.7);link([x+3,33],[x+2,bottom],false,.7);
    link([x+2,bottom],[x,bottom+1],false,.5);
  }
  shape([[30,30],[35,29],[38,33],[37,37],[32,38],[29,35]],'o');
  shape([[31,31],[35,31],[36,33],[35,36],[32,36]],'b');dot(X(33),Y(33),'o');
  leg(false,false);leg(true,false);
  // Swept horns and an elongated muzzle distinguish the dragon from a theropod.
  const hx=lean+neckX,hy=bob+neckY;
  const H=([x,y])=>[x+hx,y+hy];
  const head=(points,color)=>poly(points.map(H),color);
  head([[65,16],[57,13],[54,6],[59,10],[67,12],[69,17]],'o');
  head([[64,14],[59,12],[57,9],[61,12],[67,13]],'b');
  head([[70,14],[65,9],[60,8],[62,5],[68,8],[74,14]],'o');
  head([[70,13],[66,10],[63,8],[65,8],[70,10]],'l');
  line(...H([66,11]),...H([71,16]),.7,'b');line(...H([60,12]),...H([65,17]),.7,'b');
  head([[61,17],[64,13],[70,13],[73,17],[80,19],[81,23],[77,26],[68,25],[62,23]],'o');
  head([[63,17],[65,15],[70,15],[72,19],[79,20],[79,23],[75,24],[67,23],[64,21]],'b');
  head([[64,16],[67,14],[70,15],[72,19],[77,20],[70,20],[68,18]],'l');
  head([[64,19],[67,18],[70,20],[68,23],[65,22]],'o');
  line(...H([66,20]),...H([69,20]),.7,'r');dot(...H([68,20]),'e');
  head([[72,21],[75,21],[75,23],[72,23]],'d');dot(...H([78,21]),'o');
  line(...H([64,17]),...H([69,17]),.5,'w');
  // The lower jaw opens during the tell and stream, then closes at bite contact.
  const open=breath?6+Math.round(wave):p.state==='attack'?Math.round(Math.max(0,1-p.t*3)*7):Math.round(1+wind*6);
  const J=([x,y])=>H([x,y+Math.round((x-65)/14*open)]);
  poly([[64,23],[69,25],[79,24],[79,26],[73,28],[66,26],[63,24]].map(J),'o');
  poly([[65,24],[70,26],[78,25],[74,27],[67,25]].map(J),'b');
  for(const x of [69,73,77]){
    head([[x,24],[x+2,24],[x+1,27]],'l');
    poly([[x+1,26],[x+3,26],[x+2,24]].map(J),'l');
  }
  dot(...H([64,23]),'w');
  if(breath){line(...H([68,26]),...H([79,27]),1,'r');line(...H([74,26]),...H([80,27]),.5,'e');}
}

function dragonDeath(a,t) {
  const h=a.length,w=a[0].length,out=Array.from({length:h},()=>Array(w).fill('.'));
  // The skull tips forward while ribs, wing fingers and vertebrae fall into a bone heap.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(a[y][x]!=='.') {
    let xx=x,yy=y;
    if(x>60&&y<34){
      const angle=t*.65,dx=x-70,dy=y-20;
      xx=70+dx*Math.cos(angle)-dy*Math.sin(angle)-t*3;
      yy=20+dx*Math.sin(angle)+dy*Math.cos(angle)+t*27;
    }else{
      yy=h-3-(h-3-y)*(1-t*.91);
      xx=x+Math.sin(Math.floor(x/4)*2.3)*t*3;
      if(t>.5)yy-=Math.sin(Math.floor(x/5)*1.7)*t*2;
    }
    xx=Math.round(xx);yy=Math.round(yy);
    if(xx>=0&&xx<w&&yy>=0&&yy<h)out[yy][xx]=['r','a','e'].includes(a[y][x])&&t>.55?'d':a[y][x];
  }
  return out.map(row=>row.join(''));
}
function resident(p,c,hunter) {
  const {poly,ellipse,rect,line,limb}=c;
  const X=x=>x-p.wind*1.5+p.strike*2,Y=y=>y+p.bob;
  // Cape and quiver move independently of the planted upper body.
  poly([[X(14),Y(17)],[X(23),Y(16)],[X(22)-p.step*2,39],[X(8)-p.step*3,40]],'o');
  poly([[X(15),Y(18)],[X(21),Y(18)],[X(20)-p.step*2,37],[X(10)-p.step*3,37]],'r');
  if(hunter){line(X(11),Y(18),X(13),Y(31),2,'d');for(let k=0;k<3;k++){line(X(9+k*2),Y(12),X(11+k*2),Y(25),.5,'a');rect(X(8+k*2),Y(12),2,3,'l');}}
  for(const [x,sign]of[[17,-1],[24,1]]){
    const foot=x+p.step*sign*3;
    limb(x,32,foot,42-Math.max(0,p.step*sign)*2,2,'d','b');
    rect(foot-2,42-Math.max(0,p.step*sign)*2,7,3,'o');rect(foot-1,42-Math.max(0,p.step*sign)*2,5,1,'d');
  }
  limb(X(14),Y(21),X(10),Y(29),2,'d','b');
  poly([[X(13),Y(18)],[X(27),Y(18)],[X(29),Y(33)],[X(12),Y(33)]],'o');
  poly([[X(15),Y(19)],[X(25),Y(19)],[X(27),Y(31)],[X(14),Y(31)]],'b');
  rect(X(14),Y(29),13,3,'d');rect(X(20),Y(29),3,2,'a');
  if(!hunter){rect(X(16),Y(20),9,6,'l');line(X(19),Y(21),X(19),Y(25),.5,'w');for(let k=0;k<3;k++)line(X(15),Y(33+k*2),X(27),Y(33+k*2),.6,'b');}
  else{line(X(15),Y(18),X(26),Y(29),1,'d');rect(X(14),Y(27),4,4,'a');}
  ellipse(X(21),Y(11),7,8,'o');ellipse(X(22),Y(12),5,6,'s');
  if(hunter){poly([[X(13),Y(15)],[X(13),Y(6)],[X(19),Y(2)],[X(27),Y(5)],[X(28),Y(9)],[X(19),Y(7)],[X(16),Y(14)]],'b');line(X(15),Y(7),X(19),Y(4),1,'l');line(X(16),Y(4),X(11),Y(1),.6,'a');}
  else{poly([[X(13),Y(12)],[X(14),Y(5)],[X(20),Y(3)],[X(27),Y(6)],[X(29),Y(12)]],'b');line(X(15),Y(7),X(24),Y(5),.8,'l');rect(X(22),Y(5),1,7,'a');rect(X(14),Y(11),14,2,'d');}
  rect(X(24),Y(12),2,1,'o');rect(X(25),Y(12),1,1,'w');line(X(23),Y(17),X(26),Y(17),.5,'d');
  const hx=X(29)+p.strike*5,hy=Y(27)-p.wind*9;
  limb(X(26),Y(20),hx,hy,2,'b','l');ellipse(hx,hy,2,2,'s');
  if(hunter){
    const bx=X(34),by=Y(23),draw=(p.firing?Math.max(0,.2-p.t):p.wind)*7;
    line(bx-3,by-11,bx+2,by-6,1,'a');line(bx+2,by-6,bx+3,by+5,1,'a');line(bx+3,by+5,bx-3,by+11,1,'a');
    line(bx-3,by-11,bx-3-draw,by,.4,'w');line(bx-3-draw,by,bx-3,by+11,.4,'w');
    if(!p.firing)line(bx-8-draw,by,bx+7,by,.5,'l');
    limb(X(20),Y(21),bx-3-draw,by,1.5,'b','l');
  }else{
    const bladeX=hx+p.strike*4,bladeY=hy-12+p.strike*9;
    line(hx,hy,bladeX,bladeY,1,'o');line(hx,hy-2,bladeX,bladeY,.6,'w');line(hx-3,hy-2,hx+3,hy-2,.7,'a');
    poly([[X(7),Y(24)],[X(17),Y(24)],[X(17),Y(34)],[X(12),Y(39)],[X(7),Y(34)]],'o');
    poly([[X(8),Y(25)],[X(16),Y(25)],[X(16),Y(33)],[X(12),Y(37)],[X(8),Y(33)]],'a');
    rect(X(10),Y(26),5,7,'r');line(X(12),Y(27),X(12),Y(34),.7,'l');line(X(10),Y(30),X(14),Y(30),.7,'l');
  }
}
const sets = [
 ['BONE_DINOSAUR',84,56,{'.':'#000000',o:'#29272b',d:'#706454',b:'#b7a581',l:'#ded3ac',w:'#f4e8c5',m:'#514049',r:'#9f4633',a:'#d97e43',e:'#f4bc62'},dragon],
 ['FROST_GIANT',64,88,{'.':'#000000',o:'#192934',d:'#3f6474',b:'#759da5',l:'#b3d6d5',w:'#f2f3de',f:'#d0dcca',r:'#6a5747',c:'#54bbd2',e:'#d2ffff'},giant],
 ['MUMMY',48,56,{'.':'#000000',o:'#302c27',d:'#70644c',b:'#ab9870',l:'#d7c69b',w:'#f1e4b8',r:'#7a5334',a:'#d1a44c',c:'#45949d',e:'#baf5dc'},mummy],
 ['LAVA_TOAD',60,44,{'.':'#000000',o:'#29242a',d:'#4b3c41',b:'#7d5550',l:'#c3a385',w:'#fff0b9',r:'#d35c35',a:'#ffb85a'},toad],
 ['VILLAGE_GUARD',44,48,{'.':'#000000',o:'#222b2b',d:'#434b48',b:'#788782',l:'#b4bca6',w:'#e6e2c3',r:'#954e3e',a:'#bd9659',s:'#c59b75'},(p,c)=>resident(p,c,false)],
 ['VILLAGE_HUNTER',48,48,{'.':'#000000',o:'#242e25',d:'#494839',b:'#647b4b',l:'#a2ae75',w:'#e5dab5',r:'#4c6144',a:'#b39158',s:'#bf9470'},(p,c)=>resident(p,c,true)],
];
const only=process.argv.indexOf('--only');
const chosen=only<0?sets:sets.filter(([key])=>key===process.argv[only+1]);
if(!chosen.length)throw new Error('Unknown enemy sprite set');
for(const [key,width,height,palette,draw] of chosen) {
  const record={width,height,pixelScale:key==='BONE_DINOSAUR'?.5:.25,palette,clips:{}};
  for(const [state,[n,ticks]]of Object.entries(clips)) {
    const grouped=key==='FROST_GIANT'&&['windup','attack','recover'].includes(state);
    record.clips[state]={ticks,frames:Array.from({length:grouped?n*3:n},(_,f)=>{
    const c=canvas(width,height),p=pose(state,grouped?f%n:f,n);
    if(grouped)p.pattern=Math.floor(f/n);
    draw(p,c);
    if(key==='BONE_DINOSAUR'){
      if(state==='death')return dragonDeath(c.a,p.t);
      return c.a.map(row=>row.join(''));
    }
    if(state==='death'&&key==='FROST_GIANT')return giantDeath(c.a,p.t);
    return finish(c.a,state,p.t);
  })};
  }
  art[key]=record;
}
writeFileSync(output, '// Editable native-resolution creature clips.\nexport default '+JSON.stringify(art,null,2)+';\n');
console.log(`Authored ${chosen.length} species with eight articulated clips each.`);
