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
  const slam=p.state==='attack'?Math.min(1,p.t*2.5):0;
  const lift=p.bob+(p.state==='attack'?slam*3:0), lean=-p.wind*3+p.strike*4-p.hurt*3;
  const breath=p.state==='special';
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
  const handX=X(46)+(p.state==='attack'?slam*5:p.strike*7),
    handY=breath?Y(48):p.state==='attack'?Y(24+slam*50):Y(55)-p.wind*30;
  const elbowX=X(48),elbowY=(Y(35)+handY)*.5;
  // The upper arm and shoulder are behind the chest, collar, and head.
  limb(X(45),Y(35),elbowX,elbowY,7,'b','l');
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
  limb(elbowX,elbowY,handX,handY,6,'b','l');ellipse(handX+1,handY+2,7,7,'o');ellipse(handX+1,handY+1,6,6,'b');
  for(let k=0;k<3;k++)line(handX-3+k*3,handY+2,handX-3+k*3,handY+5,1,'d');
  // Bald glacial crown, long brow, tusks and braided snow beard.
  ellipse(X(33),Y(19),11,12,'o');ellipse(X(33),Y(19),10,11,'l');
  poly([[X(24),Y(13)],[X(22),Y(5)],[X(28),Y(10)],[X(30),Y(2)],[X(34),Y(10)],[X(39),Y(4)],[X(42),Y(14)]],'o');
  poly([[X(25),Y(12)],[X(24),Y(7)],[X(29),Y(12)],[X(30),Y(5)],[X(34),Y(13)],[X(39),Y(7)],[X(40),Y(14)]],'c');
  line(X(28),Y(17),X(40),Y(17),2,'d');rect(X(31),Y(18),3,2,'e');rect(X(39),Y(18),2,2,'e');
  poly([[X(36),Y(19)],[X(43),Y(22)],[X(37),Y(24)]],'b');
  ellipse(X(37),Y(27),6,breath?4:2+p.wind*2,'o');
  if(breath){ellipse(X(39),Y(27),4,2,'d');rect(X(41),Y(26),2,2,'c');}
  line(X(32),Y(25),X(32),Y(30),1,'w');line(X(41),Y(25),X(40),Y(30),1,'w');
  poly([[X(24),Y(23)],[X(31),Y(28)],[X(40),Y(29)],[X(38),Y(36)],[X(33),Y(39)],[X(25),Y(34)]],'f');
  for(let k=0;k<4;k++)line(X(26+k*3),Y(29),X(27+k*2),Y(35+k%2),1,k%2?'w':'b');
  rect(X(30),Y(34),4,2,'r');
  for(let k=0;k<7;k++)dot(X(20+k*4),Y(39+(k*7)%10),k%2?'c':'w');
  if(breath)for(let k=0;k<5;k++){const x=X(46)+k*2,y=Y(24)+Math.sin(k*3+p.wind*5)*4;line(x-1,y,x+1,y,0.6,'e');line(x,y-1,x,y+1,0.6,'c');}
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
function dinosaur(p,c) {
  const {poly,ellipse,line,dot,rect}=c;
  const breath=p.state==='special', walking=p.state==='move';
  const cycle=p.t*Math.PI*2, recoil=p.wind*5, snap=p.state==='attack'?Math.sin(Math.min(1,p.t*1.5)*Math.PI):0;
  const lean=-recoil+snap*9, bob=walking?Math.abs(p.step)*2:p.bob;
  const X=x=>x+lean,Y=y=>y+bob;
  const bone=(x,y,xx,yy,r=2,far=false)=>{
    line(x,y,xx,yy,r+1,'o');line(x,y,xx,yy,r,far?'d':'b');
    line(x-.5,y-1,xx-.5,yy-1,Math.max(.5,r*.38),far?'b':'l');
    for(const [bx,by]of[[x,y],[xx,yy]]){ellipse(bx,by,r+1,r,'o');ellipse(bx,by-1,r,r-1,far?'b':'l');}
  };
  const leg=(far)=>{
    const sign=far?-1:1, stride=walking?p.step*sign:0;
    const hip=X(far?70:77),hy=Y(far?61:62),knee=X(far?73:86)+stride*7,ky=83-Math.max(0,stride)*3;
    const ankle=(far?54:73)-stride*9,ay=102-Math.max(0,stride)*7;
    bone(hip,hy,knee,ky,3,far);bone(knee,ky,ankle,ay,2.3,far);
    bone(knee-3,ky+2,ankle-3,ay-2,.8,far);
    for(let toe=0;toe<3;toe++){
      const tx=ankle+10+toe*3,ty=108-Math.max(0,stride)*7-toe;
      bone(ankle,ay,tx-3,ty,1.2,far);
      poly([[tx-4,ty-2],[tx+3,ty+1],[tx-3,ty+1]],'o');line(tx-3,ty-1,tx+1,ty,.6,far?'d':'w');
    }
    ellipse(knee,ky,3,2,'d');dot(knee-1,ky-1,'w');
  };
  // The far leg and ribs are visible through the open fossil cage.
  leg(true);
  for(let k=0;k<7;k++){
    const x=X(63+k*5),top=Y(43-Math.sin(k/6*Math.PI)*5),bottom=Y(62+Math.sin(k/6*Math.PI)*5);
    line(x,top,x+7,Y(54),1.3,'o');line(x+7,Y(54),x+2,bottom,1.3,'d');
  }
  // A jointed counterweight tail narrows into individual chevrons at its tip.
  const tail=[];
  for(let k=0;k<15;k++){
    const t=k/14,x=X(66-t*59),y=Y(51-t*20+Math.sin(t*4+cycle)*(walking?3:1.4)*t);
    tail.push([x,y]);
  }
  for(let k=14;k>0;k--){
    const [x,y]=tail[k],[xx,yy]=tail[k-1],r=2.9-k*.15;
    bone(x,y,xx,yy,r);
    line(x,y-r,x+1,y-r-3+(k>9?1:0),.7,'l');
    if(k<10)line(x,y+r,x+2,y+r+3,.6,'d');
    dot(x+1,y,'d');
  }
  // The furnace is suspended between the ribs, with sparks escaping upward.
  const heat=breath?1:p.state==='windup'?p.t:.35;
  ellipse(X(85),Y(54),9+heat*2,10,'r');ellipse(X(86),Y(55),7+heat,8,'a');
  poly([[X(79),Y(61)],[X(78),Y(52)],[X(82),Y(55)],[X(83),Y(44-heat*4)],[X(87),Y(54)],[X(86),Y(61)]],'e');
  line(X(82),Y(58),X(84),Y(51),1,'w');
  for(let k=0;k<5;k++){const up=(p.t*14+k*5)%18;dot(X(78+k*3+Math.sin(k+cycle)),Y(45-up),k%2?'a':'e');}
  // Closely spaced vertebrae and neural spines give the back its broken saw edge.
  const spine=[[59,49],[65,43],[72,39],[79,37],[86,36],[93,35],[100,34+snap*7],[105,30+snap*14],[109,26+snap*20],[114,24+snap*26]];
  for(let k=0;k<spine.length;k++){
    const [x,y]=spine[k],next=spine[Math.min(k+1,spine.length-1)];
    bone(X(x),Y(y),X(next[0]),Y(next[1]),2.1);
    poly([[X(x-2),Y(y-2)],[X(x-3),Y(y-9-(k%3))],[X(x+1),Y(y-6)],[X(x+3),Y(y)]],'o');
    line(X(x-1),Y(y-3),X(x-2),Y(y-8),.7,'l');dot(X(x+1),Y(y),'d');
  }
  for(let k=0;k<8;k++){
    const x=X(62+k*4.8),top=Y(44-Math.sin(k/7*Math.PI)*8),wide=6+Math.sin(k/7*Math.PI)*3;
    const bottom=Y(61+Math.sin(k/7*Math.PI)*9);
    line(x,top,x+wide,Y(53),2,'o');line(x+wide,Y(53),x+wide-2,bottom-3,2,'o');line(x+wide-2,bottom-3,x+2,bottom,1.5,'o');
    line(x,top,x+wide,Y(53),1,'l');line(x+wide,Y(53),x+wide-2,bottom-3,1,'b');line(x+wide-2,bottom-3,x+2,bottom,.7,'l');
    dot(x+wide,Y(54+k%3),'d');
  }
  // A perforated pelvis and forked pubis anchor the powerful near thigh.
  poly([[X(58),Y(47)],[X(72),Y(43)],[X(81),Y(49)],[X(77),Y(65)],[X(69),Y(67)],[X(61),Y(57)]],'o');
  poly([[X(60),Y(49)],[X(72),Y(46)],[X(78),Y(50)],[X(74),Y(63)],[X(69),Y(64)],[X(64),Y(56)]],'b');
  line(X(62),Y(49),X(73),Y(47),1,'w');ellipse(X(70),Y(54),4,5,'o');ellipse(X(69),Y(53),2,3,'d');
  bone(X(73),Y(63),X(82),Y(72),1.6);bone(X(74),Y(64),X(71),Y(75),1.2);
  leg(false);
  // Vestigial arms have a distinct elbow, wrist and two long hook claws.
  for(const far of [true,false]){
    const x=X(far?98:94),y=Y(far?46:48),ex=x+5-p.wind*3,ey=y+9;
    const hx=ex+7+snap*4,hy=ey-2-p.wind*3;
    bone(x,y,ex,ey,1.4,far);bone(ex,ey,hx,hy,1,far);
    for(let k=0;k<2;k++){line(hx,hy+k*3,hx+5,hy+1+k*3,1,'o');line(hx+5,hy+1+k*3,hx+3,hy+5+k*3,.7,far?'d':'w');}
  }
  // Skull fenestrae remain transparent-dark between the brow, cheek and muzzle.
  const hx=lean+(breath?0:-p.wind*2+snap*2),hy=bob+(breath?0:-p.wind*3+snap*26);
  const H=(x,y)=>[x+hx,y+hy];
  poly([[109,22],[114,15],[126,14],[133,18],[145,19],[154,24],[157,33],[153,39],[132,40],[121,43],[110,37],[106,29]].map(([x,y])=>H(x,y)),'o');
  poly([[110,23],[115,17],[125,16],[132,20],[144,21],[152,25],[154,32],[150,36],[130,37],[120,40],[112,35],[109,29]].map(([x,y])=>H(x,y)),'b');
  poly([[112,23],[116,18],[125,18],[132,22],[145,23],[151,26],[134,25],[128,24],[122,21]].map(([x,y])=>H(x,y)),'l');
  line(...H(134,25),...H(151,27),.8,'w');
  // Temple, orbital and antorbital windows are different shapes, like real bone.
  poly([[112,26],[117,22],[120,26],[117,33],[112,32]].map(([x,y])=>H(x,y)),'o');
  poly([[122,25],[128,24],[131,29],[127,35],[121,34]].map(([x,y])=>H(x,y)),'o');
  poly([[134,28],[143,29],[146,33],[136,34]].map(([x,y])=>H(x,y)),'d');
  line(...H(123,29),...H(128,28),1.3,'r');line(...H(124,29),...H(128,28),.6,'e');dot(...H(127,28),'w');
  ellipse(...H(150,30),2,1.5,'o');dot(...H(151,29),'d');
  line(...H(120,23),...H(130,25),1.2,'w');line(...H(110,35),...H(122,39),1,'l');
  // Sutures, chipped snout, and asymmetrical horn remnants break the clean edges.
  line(...H(137,21),...H(136,25),.5,'d');line(...H(136,25),...H(140,27),.5,'d');
  poly([[114,18],[110,9],[117,13],[120,18]].map(([x,y])=>H(x,y)),'o');line(...H(114,15),...H(113,11),.8,'l');
  poly([[125,16],[129,8],[132,13],[130,19]].map(([x,y])=>H(x,y)),'o');line(...H(129,15),...H(130,11),.8,'l');
  // The lower jaw rotates around its cheek hinge; the bite closes on the hit frame.
  const open=breath?12+Math.sin(cycle)*1.2:p.state==='attack'?Math.max(0,1-p.t*3)*16:p.state==='windup'?3+p.t*13:3;
  const J=(x,y)=>H(x,y+(x-116)/38*open);
  poly([[114,37],[121,40],[149,39],[153,41],[148,45],[129,46],[118,43],[112,39]].map(([x,y])=>J(x,y)),'o');
  poly([[116,38],[122,42],[149,41],[147,43],[130,44],[119,41]].map(([x,y])=>J(x,y)),'b');
  line(...J(122,43),...J(146,43),.8,'l');ellipse(...H(116,38),2,2,'l');dot(...H(116,38),'d');
  for(let k=0;k<9;k++){
    const x=122+k*3.5,len=3+(k%3===0?2:0);
    poly([H(x,37),H(x+2.5,37),H(x+1,37+len)],'o');line(...H(x+1,38),...H(x+1,36+len),.55,'w');
    if(k<8)poly([J(x+1,41),J(x+3,41),J(x+2,38)],'l');
  }
  if(breath){
    line(...H(124,43),...H(150,47),2,'r');line(...H(131,44),...H(153,47),1.1,'a');line(...H(142,46),...H(155,47),.6,'e');
  }
  // Sparse mineral staining and hairline fractures stay on the bone surfaces.
  for(const [x,y]of[[65,48],[72,46],[88,36],[100,34]]){dot(X(x),Y(y),'d');dot(X(x+1),Y(y+1),'d');}
}

function dinosaurDeath(a,t) {
  const h=a.length,w=a[0].length,out=Array.from({length:h},()=>Array(w).fill('.'));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(a[y][x]!=='.') {
    let xx=x,yy=y;
    if(x>108&&y<63){
      // The skull tumbles as a rigid piece while the rib cage comes apart.
      const angle=t*.55,dx=x-132,dy=y-33;
      xx=132+dx*Math.cos(angle)-dy*Math.sin(angle)-t*8;
      yy=33+dx*Math.sin(angle)+dy*Math.cos(angle)+t*53;
    }else{
      yy=h-5-(h-5-y)*(1-t*.91);
      xx=x+Math.sin(Math.floor(x/6)*2.3)*t*5;
      if(t>.5)yy-=Math.sin(Math.floor(x/7)*1.7)*t*3;
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
 ['BONE_DINOSAUR',168,112,{'.':'#000000',o:'#29252a',d:'#6c584f',b:'#bcaa83',l:'#e4d5aa',w:'#fff0ce',r:'#a93824',a:'#f77829',e:'#ffce65'},dinosaur],
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
  const record={width,height,pixelScale:.25,palette,clips:{}};
  for(const [state,[n,ticks]]of Object.entries(clips))record.clips[state]={ticks,frames:Array.from({length:n},(_,f)=>{
    const c=canvas(width,height),p=pose(state,f,n);draw(p,c);return key==='BONE_DINOSAUR'&&state==='death'?dinosaurDeath(c.a,p.t):finish(c.a,state,p.t);
  })};
  art[key]=record;
}
writeFileSync(output, '// Editable native-resolution creature clips.\nexport default '+JSON.stringify(art,null,2)+';\n');
console.log(`Authored ${chosen.length} species with eight articulated clips each.`);
