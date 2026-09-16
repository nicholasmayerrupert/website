// Material geometry for the western railway and Cinder Works. The generated
// operations remain ordinary editable content in the world workbench.
import { writeFileSync } from 'node:fs';
import world from '../src/sand/content/world.js';
import { formatWorldContent } from './game-content-format.mjs';

const glyphs = {
  A:['010','101','111','101','101'], B:['110','101','110','101','110'],
  C:['011','100','100','100','011'], D:['110','101','101','101','110'],
  E:['111','100','110','100','111'], F:['111','100','110','100','100'],
  G:['011','100','101','101','011'], H:['101','101','111','101','101'],
  I:['111','010','010','010','111'], J:['001','001','001','101','010'],
  K:['101','101','110','101','101'], L:['100','100','100','100','111'],
  M:['10001','11011','10101','10001','10001'], N:['1001','1101','1011','1001','1001'],
  O:['010','101','101','101','010'], P:['110','101','110','100','100'],
  R:['110','101','110','101','101'], S:['011','100','010','001','110'],
  T:['111','010','010','010','010'], U:['101','101','101','101','111'],
  V:['101','101','101','101','010'], W:['10001','10001','10101','10101','01010'],
  Y:['101','101','010','010','010'], '0':['111','101','101','101','111'],
  '1':['010','110','010','010','111'], '2':['110','001','010','100','111'],
  '3':['110','001','010','001','110'], '6':['011','100','111','101','111'],
  '7':['111','001','010','010','010'], '9':['111','101','111','001','110'],
};

function drawing() {
  const ops = [];
  const rect = (material,x1,y1,x2,y2,layer='bg') => ops.push({layer,material,rect:[x1,y1,x2,y2].map(Math.round)});
  const poly = (material,points,layer='bg') => ops.push({layer,material,polygon:points.map(p=>p.map(Math.round))});
  const line = (material,x1,y1,x2,y2,width=1,layer='bg') => {
    const n=Math.max(Math.abs(x2-x1),Math.abs(y2-y1)), r=Math.floor(width/2);
    for(let i=0;i<=n;i++) { const t=n?i/n:0,x=Math.round(x1+(x2-x1)*t),y=Math.round(y1+(y2-y1)*t); rect(material,x-r,y-r,x+width-r-1,y+width-r-1,layer); }
  };
  const ellipse = (material,cx,cy,rx,ry,layer='bg') => {
    const points=Array.from({length:32},(_,i)=>[cx+Math.cos(i*Math.PI/16)*rx,cy+Math.sin(i*Math.PI/16)*ry]);
    poly(material,points,layer);
  };
  const arch = (material,left,top,right,bottom,layer='bg') => {
    const radius=(right-left)/2,cx=(left+right)/2;
    poly(material,[[left,bottom],[left,top+radius],...Array.from({length:17},(_,i)=>[cx-Math.cos(i*Math.PI/16)*radius,top+radius-Math.sin(i*Math.PI/16)*radius]),[right,bottom]],layer);
  };
  const text = (value,x,y,material='PALESTONE') => {
    for(const ch of value) {
      if(ch===' ') {x+=3;continue;}
      const g=glyphs[ch];if(!g)throw new Error(`Missing glyph ${ch}`);
      for(let row=0;row<g.length;row++)for(let col=0;col<g[row].length;col++)if(g[row][col]==='1')rect(material,x+col,y+row,x+col,y+row);
      x+=g[0].length+1;
    }
  };
  const lantern = (x,y,ceiling) => {rect('IRON_ORE',x,ceiling,x,y-6);ops.push({use:'hanging-lantern',at:[x,y]});};
  const bolts = (x1,y,x2,step=12) => {for(let x=x1;x<=x2;x+=step)rect('COPPER_ORE',x,y,x,y);};
  return {ops,rect,poly,line,ellipse,arch,text,lantern,bolts};
}

function railway() {
  const d=drawing(),{rect,poly,line,ellipse,arch,text,lantern,bolts}=d;
  // Open-air station, native hillside tunnel, and a gorge beneath the viaduct.
  rect('EMPTY',-192,-172,295,-1,'both');
  rect('EMPTY',296,-90,590,-1,'both');
  rect('EMPTY',-550,-80,-507,-1,'both');
  rect('EMPTY',-197,-80,-193,-1,'both');
  // A tunnel bored through the terrain profile; the exterior keeps native soil.
  rect('STONE',-506,-58,-198,8,'both');
  rect('EMPTY',-510,-48,-194,0,'fg');
  rect('DEEPSTONE',-506,-48,-198,0);
  for(let x=-492;x<=-215;x+=38) {
    rect('BRICK',x,-49,x+3,0);
    poly('BRICK',[[x,-49],[x+8,-55],[x+29,-55],[x+35,-49],[x+35,0],[x+32,0],[x+32,-46],[x+27,-51],[x+9,-51],[x+4,-46],[x+4,0],[x,0]]);
    rect('IRON_ORE',x+1,-39,x+34,-38);
    bolts(x+3,-39,x+31,9);
  }
  rect('COPPER_ORE',-503,-43,-201,-43);
  for(const x of [-471,-395,-281,-220])lantern(x,-31,-48);
  // Side-view voussoirs and battered masonry identify both tunnel mouths.
  for(const x of [-506,-201]) {
    poly('PALESTONE',[[x-9,6],[x-8,-40],[x-4,-54],[x+3,-60],[x+9,-57],[x+10,6]],'bg');
    rect('SLATE',x-6,-45,x-3,2);
    for(let y=-50;y<0;y+=7)rect('STONE',x-7,y,x+7,y);
    rect('PALESTONE',x-14,-60,x+12,-56,'both');
    rect('PALESTONE',x-15,0,x+14,5,'both');
  }
  // Track bed: sleepers sit below a thin continuous rail; the web is riveted.
  rect('SHALE',-548,2,598,8,'both');
  for(let x=-544;x<=592;x+=10)rect('OAK_WOOD',x,1,x+4,4,'both');
  rect('IRON_ORE',-550,0,600,1,'both');
  rect('SLATE',-549,0,599,0);
  for(let x=-535;x<590;x+=40){rect('IRON_ORE',x,2,x+7,3);bolts(x+1,2,x+6,4);}
  // The rockfall spans the bore and remains the physical excavation objective.
  poly('STONE',[[-359,-51],[-339,-49],[-329,-32],[-332,-19],[-320,0],[-368,0],[-359,-15]],'fg');
  poly('SANDSTONE',[[-353,-40],[-342,-43],[-334,-32],[-342,-25],[-354,-28]],'fg');
  poly('SLATE',[[-364,-10],[-351,-18],[-342,-7],[-335,-1],[-370,-1]],'fg');
  // Westbound semaphore, mile post, and points lever.
  function signal(x,flipped=false) {
    rect('PALESTONE',x-4,-3,x+5,0,'both');rect('IRON_ORE',x,-69,x+2,-4);
    rect('PALESTONE',x,-65,x,-6);rect('IRON_ORE',x-3,-65,x+6,-59);
    const dir=flipped?-1:1;
    line('BRICK',x+1,-63,x+dir*23,-63,4);rect('PALESTONE',x+dir*18-1,-65,x+dir*18+1,-61);
    ellipse('COPPER_ORE',x+1,-62,4,5);rect('LIGHT',x+1,-63,x+1,-62,'both');
    for(let y=-55;y<-5;y+=6)rect('IRON_ORE',x+5,y,x+10,y);
    rect('IRON_ORE',x+10,-57,x+10,-4);
  }
  signal(-174);signal(278,true);signal(579);
  rect('PALESTONE',-528,-12,-523,-1);text('7',-527,-10,'DEEPSTONE');
  rect('IRON_ORE',257,-5,269,-2);line('IRON_ORE',263,-5,270,-17,2);ellipse('COPPER_ORE',270,-18,3,3);
  // Station house: slate hipped roof, warm stone quoins, a clock tower.
  rect('BRICK',-155,-69,-39,-1);
  rect('PALESTONE',-158,-5,-36,-1);
  poly('SLATE',[[-165,-68],[-142,-91],[-62,-91],[-29,-68],[-29,-65],[-165,-65]],'both');
  line('PALESTONE',-161,-68,-142,-88);line('COPPER_ORE',-141,-89,-64,-89);
  for(let x=-140;x<=-62;x+=13)line('IRON_ORE',x,-88,x-8,-69);
  for(const x of [-155,-43]){rect('PALESTONE',x,-64,x+3,-6);for(let y=-60;y<-8;y+=9)rect('STONE',x,y,x+3,y+2);}
  for(const x of [-140,-61]){
    arch('PALESTONE',x,-52,x+15,-22);arch('GLASS',x+2,-49,x+13,-23);
    rect('OAK_WOOD',x+7,-43,x+8,-23);rect('OAK_WOOD',x+2,-34,x+13,-33);
    rect('PALESTONE',x-2,-22,x+17,-20);
  }
  arch('PALESTONE',-108,-37,-84,0);arch('DEEPSTONE',-105,-34,-87,0);
  rect('OAK_WOOD',-104,-9,-88,-1);rect('IRON_ORE',-112,-58,-78,-47);text('WESTERN',-109,-55);
  lantern(-97,-42,-48);lantern(-142,-17,-23);
  // Tower rises through the house roof; clock face uses actual cell geometry.
  rect('BRICK',-118,-132,-77,-75);rect('PALESTONE',-121,-101,-74,-97);
  rect('PALESTONE',-120,-132,-75,-129);rect('PALESTONE',-118,-125,-115,-104);rect('PALESTONE',-80,-125,-77,-104);
  poly('SLATE',[[-125,-132],[-112,-147],[-97,-151],[-82,-147],[-70,-132],[-70,-129],[-125,-129]],'both');
  line('COPPER_ORE',-97,-158,-97,-151,2);ellipse('GOLD_ORE',-97,-158,2,2);
  ellipse('IRON_ORE',-97,-116,14,14);ellipse('COPPER_ORE',-97,-116,12,12);ellipse('PALESTONE',-97,-116,10,10);
  line('IRON_ORE',-97,-116,-97,-123,1);line('IRON_ORE',-97,-116,-91,-112,1);ellipse('IRON_ORE',-97,-116,2,2);
  for(const [x,y]of[[-97,-125],[-88,-116],[-97,-107],[-106,-116]])rect('DEEPSTONE',x,y,x,y);
  rect('LIGHT',-97,-125,-97,-125,'both');
  // Open platform canopy, with curved iron brackets and a clerestory ridge.
  poly('SLATE',[[-32,-76],[-15,-87],[155,-87],[187,-75],[187,-72],[-32,-72]],'both');
  rect('COPPER_ORE',-20,-76,177,-74);rect('PALESTONE',-11,-87,153,-86);
  for(const x of [-24,68,177]) {
    rect('IRON_ORE',x,-73,x+2,-2);rect('COPPER_ORE',x,-72,x,-3);
    rect('PALESTONE',x-3,-5,x+5,-1);
    poly('IRON_ORE',[[x-16,-73],[x-13,-69],[x-5,-65],[x,-57],[x+2,-57],[x+7,-65],[x+15,-70],[x+17,-73],[x+13,-73],[x+5,-69],[x+1,-62],[x-3,-68],[x-12,-73]]);
  }
  for(const x of [0,50,102,158])lantern(x,-53,-74);
  rect('IRON_ORE',34,-75,34,-72);rect('IRON_ORE',93,-75,93,-72);rect('OAK_WOOD',28,-72,101,-64);text('ASTER JUNCTION',32,-70);
  // Benches and a luggage trolley stay in the background, leaving a clear walk.
  rect('OAK_WOOD',-66,-12,-39,-9);rect('OAK_WOOD',-66,-20,-39,-17);
  rect('IRON_ORE',-63,-9,-62,-2);rect('IRON_ORE',-43,-9,-42,-2);
  rect('IRON_ORE',222,-10,248,-8);ellipse('IRON_ORE',227,-5,3,3);ellipse('IRON_ORE',242,-5,3,3);
  rect('OAK_WOOD',226,-23,236,-11);rect('COPPER_ORE',238,-18,246,-11);rect('PALESTONE',230,-22,231,-12);
  // Water tank: curved stave barrel, hoop bands, braced trestle and filling arm.
  for(const x of [199,229])rect('OAK_WOOD',x,-77,x+3,-1);
  line('OAK_WOOD',199,-68,231,-8,3);line('OAK_WOOD',231,-68,200,-8,3);
  ellipse('IRON_ORE',216,-101,23,6);rect('OAK_WOOD',193,-102,239,-77);ellipse('OAK_WOOD',216,-77,23,5);
  for(let x=197;x<239;x+=6)rect('PINE_WOOD',x,-100,x,-79);
  for(const y of [-98,-80]){rect('IRON_ORE',192,y,240,y+2);bolts(195,y,237,7);}
  ellipse('SLATE',216,-103,25,5);rect('COPPER_ORE',195,-106,236,-105);
  rect('IRON_ORE',237,-95,243,-91);rect('IRON_ORE',241,-94,244,-49);rect('IRON_ORE',180,-52,243,-49);
  rect('COPPER_ORE',181,-51,241,-51);rect('IRON_ORE',179,-51,182,-43);
  // Steam locomotive, left-facing: smokebox, boiler bands, cab, running board.
  poly('IRON_ORE',[[7,-24],[13,-38],[28,-43],[77,-43],[85,-35],[85,-21],[10,-21]]);
  poly('SLATE',[[17,-35],[28,-39],[73,-39],[79,-34],[79,-27],[17,-27]]);
  rect('PALESTONE',29,-40,74,-39);
  for(const x of [32,53,74]){rect('COPPER_ORE',x,-41,x+2,-23);rect('PALESTONE',x,-40,x,-26);}
  ellipse('IRON_ORE',14,-31,8,12);ellipse('SLATE',12,-31,5,8);
  ellipse('COPPER_ORE',9,-35,4,4);rect('LIGHT',7,-36,7,-34,'both');
  poly('IRON_ORE',[[23,-40],[23,-51],[18,-55],[18,-59],[33,-59],[33,-55],[29,-51],[29,-40]]);
  rect('COPPER_ORE',18,-59,33,-57);ellipse('COPPER_ORE',57,-45,7,6);rect('IRON_ORE',49,-43,65,-41);
  rect('IRON_ORE',79,-55,108,-20);rect('OAK_WOOD',81,-51,105,-23);
  rect('IRON_ORE',80,-56,109,-53);poly('SLATE',[[76,-57],[79,-62],[106,-62],[112,-57],[112,-54],[76,-54]]);
  rect('GLASS',83,-50,91,-37);rect('GLASS',95,-50,104,-37);rect('COPPER_ORE',93,-50,94,-23);
  rect('LIGHT',98,-47,99,-46,'both');rect('IRON_ORE',80,-27,108,-24);
  rect('IRON_ORE',9,-21,111,-17);rect('COPPER_ORE',11,-21,109,-20);bolts(14,-18,109,9);
  poly('IRON_ORE',[[7,-18],[-3,-5],[12,-5],[17,-18]]);
  for(let x=0;x<13;x+=4)line('PALESTONE',x+5,-16,x,-6);
  function wheel(x,y,r) {
    ellipse('IRON_ORE',x,y,r,r);ellipse('COPPER_ORE',x,y,r-2,r-2);ellipse('DEEPSTONE',x,y,r-4,r-4);
    for(let a=0;a<Math.PI*2;a+=Math.PI/3)line('IRON_ORE',x,y,x+Math.cos(a)*(r-3),y+Math.sin(a)*(r-3));
    ellipse('PALESTONE',x,y,2,2);
  }
  for(const x of [34,57,80])wheel(x,-10,10);wheel(101,-7,6);
  line('PALESTONE',28,-10,85,-10,2);line('COPPER_ORE',35,-11,64,-16,2);line('IRON_ORE',17,-22,32,-11,2);
  for(const x of [28,83,110]){rect('COPPER_ORE',x-1,-22,x+1,-19);rect('LIGHT',x,-21,x,-20,'both');}
  rect('COPPER_ORE',85,-34,106,-29);text('07',89,-34,'PALESTONE');
  // Coal tender and an ochre goods wagon; couplers connect every vehicle.
  rect('IRON_ORE',111,-10,119,-8);rect('IRON_ORE',117,-28,162,-12);
  rect('OAK_WOOD',120,-26,159,-15);rect('IRON_ORE',118,-30,161,-27);
  poly('COAL_ORE',[[121,-29],[123,-35],[129,-32],[136,-39],[143,-36],[149,-37],[159,-30]]);
  rect('COPPER_ORE',120,-24,159,-24);wheel(126,-7,6);wheel(153,-7,6);
  rect('IRON_ORE',162,-10,170,-8);rect('IRON_ORE',169,-16,213,-12);
  poly('OAK_WOOD',[[171,-16],[171,-43],[176,-47],[205,-47],[211,-43],[211,-16]]);
  poly('SLATE',[[168,-44],[175,-50],[205,-50],[215,-44],[215,-41],[168,-41]]);
  rect('PINE_WOOD',186,-39,200,-18);rect('IRON_ORE',192,-39,193,-18);
  for(const x of [172,183,203,210])rect('IRON_ORE',x,-41,x,-17);
  line('IRON_ORE',173,-39,182,-19);line('IRON_ORE',204,-39,209,-19);
  rect('PALESTONE',188,-32,197,-27);text('R',191,-32,'DEEPSTONE');
  wheel(179,-7,6);wheel(205,-7,6);
  // Arch rings and piers span the native gorge without cutting its floor.
  rect('SLATE',298,6,592,20,'both');
  for(const [left,right] of [[311,366],[380,435],[449,504],[518,575]]) {
    const cx=(left+right)/2,r=(right-left)/2,cy=20+r;
    const arc=radius=>Array.from({length:25},(_,i)=>[cx-Math.cos(i*Math.PI/24)*radius,cy-Math.sin(i*Math.PI/24)*radius]);
    poly('BRICK',[[left,20],[right,20],...arc(r).toReversed()],'both');
    poly('BRICK',[...arc(r),...arc(r-7).toReversed()],'both');
    poly('PALESTONE',[...arc(r-1),...arc(r-3).toReversed()],'both');
    rect('BRICK',left-6,20,left+1,112,'both');rect('BRICK',right-1,20,right+7,112,'both');
    for(let a=Math.PI+.15;a<2*Math.PI-.1;a+=Math.PI/8)line('STONE',cx+Math.cos(a)*(r-7),cy+Math.sin(a)*(r-7),cx+Math.cos(a)*r,cy+Math.sin(a)*r,1,'both');
    rect('PALESTONE',cx-2,18,cx+2,25,'both');
  }
  rect('SLATE',296,5,594,9,'both');rect('IRON_ORE',296,10,594,11,'both');
  for(const x of [300,370,439,508,582]) {rect('PALESTONE',x,18,x+5,105,'both');rect('STONE',x-2,104,x+7,112,'both');}
  // Fine wrought railing leaves the train silhouette and the ravine readable.
  rect('IRON_ORE',297,-13,593,-12);rect('IRON_ORE',297,-4,593,-4);
  for(let x=298;x<594;x+=12){rect('IRON_ORE',x,-12,x,-1);rect('COPPER_ORE',x,-14,x,-13);}
  for(const x of [307,438,585])lantern(x,-29,-42);
  for(const x of [307,438,585]){rect('IRON_ORE',x+6,-44,x+7,0);line('IRON_ORE',x+6,-43,x-2,-43,2);}
  // Drainage channel beneath the central arches, contained within the gorge.
  rect('WATER',401,88,477,96,'fg');
  // Telegraph wire, poles and insulators make the line continue past the yard.
  for(const x of [-530,-160,290,598]) {
    rect('OAK_WOOD',x,-86,x+2,-1);rect('OAK_WOOD',x-9,-80,x+11,-78);
    for(const dx of [-7,0,8])rect('GLASS',x+dx,-84,x+dx+2,-81);
  }
  for(const [a,b] of [[-160,290],[290,598]]) {
    for(let i=0;i<24;i++){const t=i/24,u=(i+1)/24;line('IRON_ORE',a+(b-a)*t,-83+Math.sin(t*Math.PI)*10,a+(b-a)*u,-83+Math.sin(u*Math.PI)*10);}
  }
  return d.ops;
}

function foundry() {
  const d=drawing(),{rect,poly,line,ellipse,arch,text,lantern,bolts}=d;
  rect('EMPTY',-177,-185,181,-1,'both');
  rect('STONE',-172,0,177,7,'both');rect('PALESTONE',-160,0,167,1,'both');
  // Masonry hall and a barrel roof, with a raised ventilator along its crown.
  rect('BRICK',-145,-63,33,-1);
  const outer=[[-153,-58],[-145,-75],[-128,-91],[-107,-103],[-78,-110],[-44,-110],[-15,-103],[9,-89],[30,-72],[40,-58]];
  poly('BRICK',[...outer,[40,0],[-153,0]]);
  poly('SLATE',[...outer,...outer.toReversed().map(([x,y])=>[x,y+5])],'both');
  for(let i=0;i<outer.length-1;i++)line('COPPER_ORE',outer[i][0],outer[i][1]+1,outer[i+1][0],outer[i+1][1]+1);
  for(const [x,y]of[[-136,-82],[-116,-97],[-89,-108],[-61,-110],[-30,-108],[-3,-97],[20,-81]])line('IRON_ORE',x,y,x+3,y+5,2);
  rect('IRON_ORE',-94,-120,-33,-108);rect('DEEPSTONE',-89,-118,-38,-111);
  for(let x=-86;x<-37;x+=6)rect('COPPER_ORE',x,-117,x+1,-111);
  poly('SLATE',[[-101,-120],[-88,-128],[-40,-128],[-26,-120],[-26,-117],[-101,-117]],'both');
  rect('PALESTONE',-87,-128,-40,-127);
  // Banded chimney, integrated into the furnace stack rather than floating.
  poly('BRICK',[[-144,-1],[-142,-97],[-136,-162],[-117,-162],[-112,-95],[-108,-1]],'both');
  poly('PALESTONE',[[-141,-97],[-135,-159],[-132,-159],[-137,-96]]);
  for(const y of [-151,-127,-98]){rect('IRON_ORE',-140,y,-114,y+2);bolts(-136,y+1,-119,8);}
  rect('PALESTONE',-142,-166,-111,-162,'both');rect('BRICK',-145,-171,-108,-167,'both');
  rect('DEEPSTONE',-138,-171,-115,-170);rect('PALESTONE',-144,-169,-109,-168);
  // Buttresses, dark mortar courses and three recessed architectural bays.
  for(const x of [-145,-84,-13,30]){
    rect('PALESTONE',x,-60,x+3,-1);rect('STONE',x-2,-5,x+5,-1);
    rect('PALESTONE',x-2,-63,x+5,-60);
  }
  rect('SLATE',-144,-60,34,-58);rect('PALESTONE',-145,-56,35,-55);
  for(const [l,r]of[[-108,-90],[-69,-30],[4,22]]) {
    arch('PALESTONE',l-2,-50,r+2,-18);arch('DEEPSTONE',l,-47,r,-18);
    if(l!==-69){arch('GLASS',l+2,-44,r-2,-21);rect('IRON_ORE',(l+r)/2,-40,(l+r)/2,-22);rect('IRON_ORE',l+2,-30,r-2,-30);}
  }
  // A round glazed oculus and radial metal frame break up the brick facade.
  ellipse('PALESTONE',-52,-81,19,19);ellipse('IRON_ORE',-52,-81,16,16);ellipse('GLASS',-52,-81,14,14);
  for(let a=0;a<Math.PI*2;a+=Math.PI/4)line('IRON_ORE',-52,-81,-52+Math.cos(a)*14,-81+Math.sin(a)*14);
  ellipse('COPPER_ORE',-52,-81,4,4);
  rect('IRON_ORE',-96,-65,-10,-54);text('CINDER WORKS',-77,-62);
  // Furnace breast, firebrick arch, banked coals and an iron flue.
  poly('BRICK',[[-115,-1],[-115,-24],[-108,-42],[-102,-48],[-92,-48],[-86,-41],[-81,-23],[-81,-1]]);
  arch('PALESTONE',-110,-29,-85,-2);arch('DEEPSTONE',-107,-26,-88,-2);
  rect('COPPER_ORE',-106,-7,-89,-3);poly('GOLD_ORE',[[-105,-6],[-103,-13],[-100,-9],[-98,-18],[-95,-10],[-92,-14],[-89,-6]]);
  rect('LIGHT',-100,-9,-98,-6,'both');rect('LIGHT',-94,-8,-93,-6,'both');
  rect('IRON_ORE',-111,-3,-84,0);for(let x=-106;x<=-89;x+=4)rect('IRON_ORE',x,-10,x,-3);
  rect('IRON_ORE',-102,-54,-95,-43);rect('COPPER_ORE',-100,-53,-99,-43);
  // Bellows, curved copper pressure vessel, pipes and a pressure gauge.
  poly('OAK_WOOD',[[-80,-14],[-62,-24],[-62,-7],[-80,-10]]);line('IRON_ORE',-78,-13,-62,-23,2);line('IRON_ORE',-78,-10,-62,-7,2);
  for(let x=-75;x<-63;x+=4)rect('IRON_ORE',x,-15,x,-9);
  rect('IRON_ORE',3,-10,28,-3);ellipse('COPPER_ORE',15,-23,14,23);ellipse('IRON_ORE',15,-23,11,20);ellipse('COPPER_ORE',14,-24,9,18);
  rect('PALESTONE',8,-37,9,-15);for(const y of [-34,-15]){rect('IRON_ORE',3,y,27,y+2);bolts(5,y,25,6);}
  line('COPPER_ORE',15,-45,15,-51,3);line('COPPER_ORE',15,-51,-19,-51,3);line('COPPER_ORE',-19,-51,-19,-20,3);
  ellipse('IRON_ORE',-18,-35,6,6);ellipse('PALESTONE',-18,-35,4,4);line('IRON_ORE',-18,-35,-16,-38);
  // Anvil, tools and workshop furniture are individually readable silhouettes.
  rect('OAK_WOOD',-63,-12,-41,-2);rect('IRON_ORE',-58,-17,-47,-12);
  poly('IRON_ORE',[[-65,-23],[-39,-23],[-43,-18],[-51,-17],[-51,-13],[-57,-13],[-57,-18],[-62,-19]]);
  rect('PALESTONE',-62,-23,-41,-23);line('OAK_WOOD',-37,-6,-32,-22,2);rect('IRON_ORE',-36,-24,-29,-21);
  rect('IRON_ORE',-132,-33,-116,-32);for(const x of [-130,-124,-118]){rect('IRON_ORE',x,-33,x,-21);rect('COPPER_ORE',x-1,-22,x+1,-20);}
  // The yard is open to the sky, with a cantilever jib and a hanging crucible.
  rect('IRON_ORE',56,-95,61,0);rect('COPPER_ORE',56,-94,56,-1);
  rect('IRON_ORE',54,-96,146,-90);line('IRON_ORE',59,-58,128,-92,3);
  for(let x=62;x<140;x+=13){line('PALESTONE',x,-95,x+6,-91);line('IRON_ORE',x+6,-91,x+12,-95);}
  bolts(58,-92,144,11);rect('IRON_ORE',128,-91,132,-51);
  ellipse('IRON_ORE',130,-51,6,6);ellipse('COPPER_ORE',130,-51,3,3);
  line('IRON_ORE',129,-45,116,-29,2);line('IRON_ORE',131,-45,144,-29,2);
  poly('IRON_ORE',[[112,-30],[147,-30],[142,-15],[138,-11],[121,-11],[116,-15]]);
  poly('COPPER_ORE',[[116,-28],[143,-28],[139,-16],[121,-16]]);rect('PALESTONE',115,-30,145,-29);
  rect('IRON_ORE',51,-5,67,-1,'both');
  // Exposed flywheel beside the belt-driven cutting bench.
  ellipse('IRON_ORE',89,-22,22,22);ellipse('COPPER_ORE',89,-22,19,19);ellipse('DEEPSTONE',89,-22,16,16);
  for(let a=0;a<Math.PI*2;a+=Math.PI/4)line('IRON_ORE',89,-22,89+Math.cos(a)*19,-22+Math.sin(a)*19,2);
  ellipse('COPPER_ORE',89,-22,6,6);ellipse('PALESTONE',89,-22,2,2);
  line('IRON_ORE',88,-43,53,-52,2);line('IRON_ORE',73,-7,42,-28,2);
  rect('OAK_WOOD',147,-18,172,-15);rect('IRON_ORE',149,-15,151,-1);rect('IRON_ORE',167,-15,169,-1);
  ellipse('IRON_ORE',159,-21,9,9);ellipse('PALESTONE',159,-21,6,6);ellipse('COPPER_ORE',159,-21,2,2);
  for(let a=0;a<Math.PI*2;a+=Math.PI/6)rect('IRON_ORE',159+Math.cos(a)*9,-21+Math.sin(a)*9,160+Math.cos(a)*9,-20+Math.sin(a)*9);
  // Coal bunker, cooling ingots and iron hoops add workshop scale.
  rect('IRON_ORE',39,-13,48,-1);poly('COAL_ORE',[[36,-2],[36,-10],[40,-18],[47,-15],[51,-9],[51,-2]]);
  for(const [x,y]of[[65,-5],[71,-5],[68,-8]])poly('IRON_ORE',[[x,y],[x+4,y],[x+5,y+2],[x-1,y+2]]);
  for(const [x,y,ceiling]of[[-93,-38,-60],[-48,-34,-55],[-4,-36,-57],[32,-37,-57],[69,-66,-92],[145,-39,-90]])lantern(x,y,ceiling);
  rect('LIGHT',-52,-81,-52,-81,'both');
  return d.ops;
}

const rail=world.sites.find(s=>s.id==='railway');
Object.assign(rail,{
  name:'Aster Junction',
  description:'A mountain railway: the western bore, a sleeping steam train, and a four-arch viaduct over the gorge.',
  anchors:{instrument:[-396,-10],station:[-96,-10],viaduct:[438,-10]},
  preview:{at:[rail.origin[0]+15,rail.origin[1]-12],dayPhase:.45,zoomSteps:-2},
  placement:{footprint:[-550,600],ground:0,search:1024,blend:96,
    terrain:[[-550,0],[-510,-14],[-457,-76],[-360,-112],[-282,-104],[-218,-43],[-178,0],[296,0],[345,77],[416,101],[499,94],[552,62],[600,0]]},
  operations:railway(),
});
const forge=world.sites.find(s=>s.id==='foundry');
Object.assign(forge,{
  name:'The Cinder Works',description:'A barrel-roofed brick forge, banded chimney, copper pressure vessel and open crane yard.',
  anchors:{...forge.anchors,brann:[-151,-10]},
  preview:{at:[forge.origin[0]-30,forge.origin[1]-12],dayPhase:.45,zoomSteps:-1},
  placement:{...forge.placement,footprint:[-178,183]},operations:foundry(),
});
const pass=world.quests.find(q=>q.key==='buried-pass');
pass.condition.bounds=[rail.origin[0]-352,rail.origin[1]-48,rail.origin[0]-332,rail.origin[1]];
pass.place='Aster Junction · The western bore';
pass.summary='Clear the rockfall blocking the western railway.';
pass.description='The mountain line once carried ore and travelers through Aster Junction. Open an actor-height passage through the collapsed western bore.';
pass.hint='Follow the rails into the hillside. Dig through the fallen stone between the brick tunnel ribs.';
world.quests.find(q=>q.key==='last-shift').place='Far west · The Cinder Works';
for(const [site,positions] of [[rail,[[-443,-7],[-401,-7],[-150,-7],[240,-16],[562,-7]]],[forge,[[-153,-7],[-73,-7],[-30,-7],[48,-7],[169,-7]]]]) {
  const anchorName=site===rail?'instrument':'foreman',anchor=site.anchors[anchorName];
  world.chests.filter(c=>c.anchor===`${site.id}.${anchorName}`).forEach((c,i)=>{c.offset=[positions[i][0]-anchor[0],positions[i][1]-anchor[1]];});
}
writeFileSync(new URL('../src/sand/content/world.js',import.meta.url),'// Authored places and stories for the Hollow Bell chapter.\nexport default '+formatWorldContent(world)+';\n');
console.log(`Authored ${rail.operations.length} railway and ${forge.operations.length} foundry operations.`);
