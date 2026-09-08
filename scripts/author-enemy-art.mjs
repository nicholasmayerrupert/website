// Rebuild the five adventure sprite sets from articulated pixel primitives.
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
  return {t, step:state==='move'?wave:0, bob:state==='move'?Math.abs(wave)*1.4:state==='idle'?Math.round(wave*.7):0,
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
  const lift=p.bob, lean=-p.wind*3+p.strike*4-p.hurt*3;
  const X=x=>x+lean,Y=y=>y+lift;
  // Articulated feet, fur breeches, and the far arm sit behind the chest.
  for(const [x,sign] of [[24,-1],[40,1]]) {
    const foot=x+p.step*sign*4;
    limb(x,64,foot,79-Math.max(0,p.step*sign)*3,5,'d','b');
    ellipse(foot+2,81-Math.max(0,p.step*sign)*3,8,3,'o');
    ellipse(foot+3,80-Math.max(0,p.step*sign)*3,6,2,'b');
    for(let k=0;k<3;k++)rect(foot+k*2,81-Math.max(0,p.step*sign)*3,1,2,'w');
  }
  limb(X(18),Y(35),X(12)-p.wind*3,Y(55)-p.wind*12,7,'d','b');
  poly([[X(19),Y(49)],[X(46),Y(49)],[43,69],[36,65],[31,70],[23,65],[17,68]],'o');
  poly([[X(21),Y(48)],[X(44),Y(48)],[41,64],[35,61],[30,66],[23,61],[20,64]],'f');
  for(let k=0;k<7;k++)line(22+k*3,53,20+k*3,62+k%3,1,k%2?'d':'l');
  ellipse(X(32),Y(39),17,20,'o');ellipse(X(32),Y(38),16,18,'b');
  ellipse(X(29),Y(36),12,14,'l');ellipse(X(41),Y(43),7,12,'d');
  // Rime plates, collar fringe, and a carved glacier-heart clasp.
  poly([[X(15),Y(31)],[X(17),Y(20)],[X(22),Y(25)],[X(25),Y(16)],[X(29),Y(26)],[X(34),Y(20)],[X(40),Y(30)],[X(49),Y(26)],[X(51),Y(40)],[X(43),Y(34)],[X(34),Y(32)],[X(23),Y(35)]],'f');
  for(let k=0;k<9;k++)line(X(17+k*3),Y(28+k%3),X(18+k*3),Y(33+k%4),1,k%2?'w':'l');
  rect(X(19),Y(52),28,4,'o');rect(X(20),Y(52),26,2,'r');
  poly([[X(33),Y(47)],[X(38),Y(53)],[X(33),Y(60)],[X(28),Y(53)]],'o');
  poly([[X(33),Y(49)],[X(36),Y(53)],[X(33),Y(57)],[X(30),Y(53)]],'c');line(X(33),Y(50),X(33),Y(54),1,'e');
  // Bald glacial crown, long brow, tusks and braided snow beard.
  ellipse(X(33),Y(19),11,12,'o');ellipse(X(33),Y(19),10,11,'l');
  poly([[X(24),Y(13)],[X(22),Y(5)],[X(28),Y(10)],[X(30),Y(2)],[X(34),Y(10)],[X(39),Y(4)],[X(42),Y(14)]],'o');
  poly([[X(25),Y(12)],[X(24),Y(7)],[X(29),Y(12)],[X(30),Y(5)],[X(34),Y(13)],[X(39),Y(7)],[X(40),Y(14)]],'c');
  line(X(28),Y(17),X(40),Y(17),2,'d');rect(X(31),Y(18),3,2,'e');rect(X(39),Y(18),2,2,'e');
  poly([[X(36),Y(19)],[X(43),Y(22)],[X(37),Y(24)]],'b');
  ellipse(X(37),Y(27),6,2+p.wind*2,'o');
  line(X(32),Y(25),X(32),Y(30),1,'w');line(X(41),Y(25),X(40),Y(30),1,'w');
  poly([[X(24),Y(23)],[X(31),Y(28)],[X(40),Y(29)],[X(38),Y(36)],[X(33),Y(39)],[X(25),Y(34)]],'f');
  for(let k=0;k<4;k++)line(X(26+k*3),Y(29),X(27+k*2),Y(35+k%2),1,k%2?'w':'b');
  rect(X(30),Y(34),4,2,'r');
  const handX=X(49)+p.strike*7,handY=Y(55)-p.wind*15;
  limb(X(45),Y(35),handX,handY,7,'b','l');ellipse(handX+1,handY+2,7,7,'o');ellipse(handX+1,handY+1,6,6,'b');
  for(let k=0;k<3;k++)line(handX-3+k*3,handY+2,handX-3+k*3,handY+5,1,'d');
  for(let k=0;k<7;k++)dot(X(20+k*4),Y(39+(k*7)%10),k%2?'c':'w');
  if(p.wind>.3)for(let k=0;k<5;k++){const x=X(46)+k*2,y=Y(24)+Math.sin(k*3+p.wind*5)*4;line(x-1,y,x+1,y,0.6,'e');line(x,y-1,x,y+1,0.6,'c');}
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
 ['FROST_GIANT',64,88,{'.':'#000000',o:'#192934',d:'#3f6474',b:'#759da5',l:'#b3d6d5',w:'#f2f3de',f:'#d0dcca',r:'#6a5747',c:'#54bbd2',e:'#d2ffff'},giant],
 ['MUMMY',48,56,{'.':'#000000',o:'#302c27',d:'#70644c',b:'#ab9870',l:'#d7c69b',w:'#f1e4b8',r:'#7a5334',a:'#d1a44c',c:'#45949d',e:'#baf5dc'},mummy],
 ['LAVA_TOAD',60,44,{'.':'#000000',o:'#29242a',d:'#4b3c41',b:'#7d5550',l:'#c3a385',w:'#fff0b9',r:'#d35c35',a:'#ffb85a'},toad],
 ['VILLAGE_GUARD',44,48,{'.':'#000000',o:'#222b2b',d:'#434b48',b:'#788782',l:'#b4bca6',w:'#e6e2c3',r:'#954e3e',a:'#bd9659',s:'#c59b75'},(p,c)=>resident(p,c,false)],
 ['VILLAGE_HUNTER',48,48,{'.':'#000000',o:'#242e25',d:'#494839',b:'#647b4b',l:'#a2ae75',w:'#e5dab5',r:'#4c6144',a:'#b39158',s:'#bf9470'},(p,c)=>resident(p,c,true)],
];
for(const [key,width,height,palette,draw] of sets) {
  const record={width,height,pixelScale:.25,palette,clips:{}};
  for(const [state,[n,ticks]]of Object.entries(clips))record.clips[state]={ticks,frames:Array.from({length:n},(_,f)=>{
    const c=canvas(width,height),p=pose(state,f,n);draw(p,c);return finish(c.a,state,p.t);
  })};
  art[key]=record;
}
writeFileSync(output, '// Editable native-resolution creature clips.\nexport default '+JSON.stringify(art,null,2)+';\n');
console.log(`Authored ${sets.length} species with eight articulated clips each.`);
