// Material geometry for the Oldroot Mine and Cinder Works. The generated
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

function mine() {
  const d=drawing(),{rect,poly,line,ellipse,text,lantern}=d;
  // A cutaway hillside: rock encloses two hand-hewn levels and a sloping adit.
  rect('EMPTY',-30,-140,330,-1,'both');
  poly('STONE',[[-314,-59],[-302,-76],[-106,-76],[-58,-63],[-36,-45],[-36,12],[-314,12]],'both');
  poly('DEEPSTONE',[[-300,-45],[-284,-57],[-114,-57],[-63,-47],[-34,-34],[-34,-1],[-300,-1]]);
  poly('EMPTY',[[-300,-43],[-284,-55],[-114,-55],[-63,-45],[-30,-32],[-30,-1],[-300,-1]],'fg');
  rect('STONE',-309,36,70,107,'both');
  poly('DEEPSTONE',[[-296,61],[-282,45],[-239,43],[-197,49],[-126,51],[-112,58],[60,58],[60,95],[-296,95]]);
  poly('EMPTY',[[-296,63],[-282,47],[-239,45],[-197,51],[-126,53],[-112,60],[60,60],[60,94],[-296,94]],'fg');
  // The inclined working joins both levels; shallow stone steps carry the player.
  poly('DEEPSTONE',[[-163,57],[-100,-1],[-48,-1],[-48,1],[-140,95],[-171,95]]);
  poly('EMPTY',[[-163,57],[-100,-2],[-48,-2],[-48,0],[-140,94],[-171,94]],'fg');
  for(let i=0;i<47;i++)rect('STONE',-50-i*2,i*2,-48-i*2,i*2+1,'both');
  // Quiet geological bedding and small fractures keep the galleries irregular.
  for(const [x,y,w] of [[-289,-31,28],[-249,-44,31],[-219,-19,18],[-152,-39,25],[-282,65,31],[-243,53,23],[-196,77,28],[-91,74,28],[-22,68,24]]) {
    poly('SLATE',[[x,y],[x+8,y-3],[x+w,y-2],[x+w-5,y],[x+9,y+1]]);
    line('STONE',x+3,y+5,x+12,y+7);
  }
  // Oak pit props, wedged cap beams, pegs, and diagonal knee braces.
  function frame(x,top,bottom,width=40) {
    for(const px of [x,x+width]) {
      rect('OAK_WOOD',px,top,px+4,bottom);
      rect('PINE_WOOD',px+1,top+2,px+1,bottom-2);
      rect('STONE',px-2,bottom-2,px+6,bottom+3);
      rect('IRON_ORE',px,top+5,px+4,top+6);
    }
    rect('OAK_WOOD',x-3,top-4,x+width+7,top+1);
    rect('PINE_WOOD',x-1,top-3,x+width+5,top-3);
    line('OAK_WOOD',x+4,top+14,x+17,top+1,3);
    line('OAK_WOOD',x+width,top+14,x+width-13,top+1,3);
    rect('COPPER_ORE',x+2,top-1,x+2,top-1);
    rect('COPPER_ORE',x+width+2,top-1,x+width+2,top-1);
  }
  for(const x of [-286,-230,-172,-114])frame(x,-45,-1);
  for(const x of [-278,-218,-94,-34])frame(x,62,94,40);
  // Exposed seams are foreground ore and can be harvested with ordinary tools.
  function seam(material,points) {poly('SLATE',points,'both');poly(material,points.map(([x,y],i)=>[x+(i%2?0:2),y+1]),'fg');}
  seam('IRON_ORE',[[-295,-7],[-290,-21],[-283,-26],[-274,-19],[-265,-13],[-256,-8],[-259,-1],[-295,-1]]);
  seam('IRON_ORE',[[-256,-52],[-246,-57],[-230,-55],[-225,-49],[-241,-47]]);
  seam('COAL_ORE',[[-132,-2],[-129,-12],[-120,-21],[-111,-17],[-102,-8],[-104,-1]]);
  seam('GOLD_ORE',[[-294,84],[-287,74],[-279,72],[-272,77],[-263,83],[-259,94],[-294,94]]);
  seam('COPPER_ORE',[[-205,52],[-198,55],[-186,54],[-174,57],[-172,62],[-190,62],[-205,58]]);
  // The collapsed upper working seals the old iron face from floor to roof.
  poly('STONE',[[-200,-54],[-184,-55],[-174,-42],[-177,-29],[-164,-12],[-166,-1],[-206,-1],[-201,-18],[-209,-33]],'fg');
  poly('SANDSTONE',[[-199,-40],[-187,-47],[-177,-36],[-185,-27],[-198,-30]],'fg');
  poly('SLATE',[[-204,-15],[-191,-25],[-179,-18],[-169,-2],[-204,-2]],'fg');
  line('STONE',-197,-12,-182,-6,3,'fg');
  // The mouth has battered stone cheeks and massive pegged timber, under turf.
  poly('STONE',[[-68,5],[-69,-42],[-60,-62],[-48,-70],[-33,-66],[-23,-52],[-23,5]]);
  poly('DEEPSTONE',[[-56,0],[-56,-42],[-49,-52],[-37,-53],[-28,-39],[-28,0]]);
  rect('OAK_WOOD',-62,-54,-57,1);rect('OAK_WOOD',-28,-54,-23,1);
  rect('OAK_WOOD',-69,-59,-17,-52,'both');
  line('PINE_WOOD',-67,-58,-20,-58,2);
  line('OAK_WOOD',-56,-39,-43,-52,4);line('OAK_WOOD',-29,-39,-42,-52,4);
  for(const x of [-61,-27]){rect('IRON_ORE',x,-48,x+3,-46);rect('IRON_ORE',x,-14,x+3,-12);}
  poly('MOSS',[[-71,-62],[-63,-69],[-44,-74],[-26,-66],[-18,-60],[-30,-61],[-47,-67],[-60,-64]]);
  for(const [x,y] of [[-66,-61],[-33,-67],[-23,-61]])rect('MOSS',x,y,x+2,y+9);
  // Split-log threshold and the footpath lead into a small working yard.
  rect('STONE',-47,0,331,7,'both');
  rect('SHALE',-44,0,326,1,'both');
  rect('OAK_WOOD',-46,-1,-20,1,'both');
  for(const x of [-42,-33,-24])rect('PINE_WOOD',x,-1,x+1,-1,'both');
  // A hand-wound shaft hoist: shingled headframe, wooden drum and rope bucket.
  rect('DEEPSTONE',29,1,61,96);rect('EMPTY',31,0,58,94,'fg');
  for(const x of [25,61]){rect('STONE',x-5,0,x+8,12,'both');rect('OAK_WOOD',x,-83,x+5,-1);rect('PINE_WOOD',x+1,-81,x+1,-5);}
  rect('OAK_WOOD',22,-84,70,-78);
  line('OAK_WOOD',29,-48,60,-77,4);line('OAK_WOOD',61,-48,31,-77,4);
  poly('SLATE',[[16,-84],[31,-100],[61,-100],[77,-84],[77,-80],[16,-80]],'both');
  line('PALESTONE',19,-85,33,-98);line('PINE_WOOD',33,-99,60,-99);
  for(let x=30;x<63;x+=9)line('STONE',x,-95,x+9,-84);
  rect('OAK_WOOD',12,-34,81,-31);rect('IRON_ORE',15,-33,78,-32);
  ellipse('OAK_WOOD',43,-33,14,11);rect('PINE_WOOD',33,-42,54,-24);
  for(let x=34;x<55;x+=3)rect('SANDSTONE',x,-42,x,-24);
  ellipse('OAK_WOOD',65,-33,15,15);ellipse('EMPTY',65,-33,10,10);
  for(const [dx,dy] of [[13,0],[0,13],[-9,9],[9,9]])line('OAK_WOOD',65-dx,-33-dy,65+dx,-33+dy,2);
  ellipse('IRON_ORE',65,-33,3,3);line('OAK_WOOD',77,-32,83,-25,3);
  line('SANDSTONE',42,-77,42,46);ellipse('OAK_WOOD',43,-76,5,5);
  ellipse('IRON_ORE',43,-76,2,2);
  poly('OAK_WOOD',[[34,47],[51,47],[49,64],[36,64]]);rect('IRON_ORE',34,48,51,49);rect('IRON_ORE',36,61,49,62);
  line('IRON_ORE',35,47,42,41);line('IRON_ORE',50,47,42,41);
  // Pegged ladder and intermediate timber shelves make the shallow shaft legible.
  for(const x of [52,59])rect('OAK_WOOD',x,7,x,92);
  for(let y=11;y<91;y+=6)rect('PINE_WOOD',52,y,59,y);
  rect('OAK_WOOD',58,35,62,37,'both');rect('OAK_WOOD',29,72,34,74,'both');
  // Low sorting shelter: uneven slate, oak trusses, wattle panels, ore bins.
  rect('SANDSTONE',124,-50,257,-2);
  for(let x=130;x<=250;x+=12)rect('PINE_WOOD',x,-47,x,-17);
  rect('OAK_WOOD',120,-54,261,-49);
  poly('SLATE',[[111,-54],[127,-76],[247,-72],[271,-53],[269,-49],[110,-50]],'both');
  for(let x=128;x<=239;x+=16)line('STONE',x,-73,x+17,-55);
  line('PALESTONE',114,-54,129,-73);line('OAK_WOOD',127,-75,246,-71,2);
  for(const x of [121,184,257]) {
    rect('OAK_WOOD',x,-50,x+5,0);rect('PINE_WOOD',x+1,-48,x+1,-4);
    line('OAK_WOOD',x+4,-35,x+16,-49,3);line('OAK_WOOD',x,-35,x-12,-49,3);
    rect('STONE',x-2,-3,x+7,3,'both');
  }
  rect('DEEPSTONE',130,-38,160,-18);rect('OAK_WOOD',128,-40,163,-37);text('ORE',137,-33,'SANDSTONE');
  rect('OAK_WOOD',132,-16,176,-12);rect('OAK_WOOD',135,-12,138,-1);rect('OAK_WOOD',170,-12,173,-1);
  poly('IRON_ORE',[[137,-17],[142,-24],[148,-25],[155,-19],[161,-26],[168,-23],[173,-17]]);
  for(const [x,m] of [[202,'IRON_ORE'],[230,'COPPER_ORE']]) {
    poly(m,[[x,-13],[x+4,-21],[x+10,-23],[x+17,-16],[x+22,-13]]);
    rect('OAK_WOOD',x-2,-13,x+24,-2);
    for(let px=x;px<x+24;px+=6)rect('PINE_WOOD',px,-12,px,-3);
    rect('IRON_ORE',x-2,-11,x+24,-10);rect('IRON_ORE',x-2,-4,x+24,-3);
  }
  // A stacked timber crib, a two-handled barrow, and hand tools tell the work.
  for(const [x,y] of [[282,-5],[295,-5],[308,-5],[288,-15],[301,-15]]) {
    rect('OAK_WOOD',x-5,y-4,x+5,y+4);ellipse('PINE_WOOD',x,y,5,5);ellipse('OAK_WOOD',x,y,2,2);
  }
  ellipse('OAK_WOOD',94,-5,5,5);ellipse('IRON_ORE',94,-5,2,2);
  poly('OAK_WOOD',[[79,-21],[102,-21],[99,-10],[84,-10]]);line('OAK_WOOD',79,-14,72,-8,2);
  line('PINE_WOOD',100,-14,112,-19,2);
  line('OAK_WOOD',167,-26,177,-7,2);line('IRON_ORE',163,-27,174,-30,2);
  rect('OAK_WOOD',249,-35,250,-12);poly('IRON_ORE',[[245,-14],[254,-14],[253,-7],[247,-7]]);
  // Modest timber sign and lantern pools guide the way from yard to gold face.
  rect('OAK_WOOD',-15,-44,16,-30);rect('PINE_WOOD',-15,-44,16,-43);
  text('OLDROOT',-13,-41,'SANDSTONE');text('MINE',-9,-35,'SANDSTONE');
  rect('OAK_WOOD',-3,-30,0,-1);
  for(const [x,y,top] of [[-267,-25,-43],[-215,-26,-43],[-151,-24,-43],[-42,-32,-52],[-104,21,4],[-137,52,35],[-265,78,61],[-188,77,61],[-74,79,62],[16,-16,-33],[179,-27,-49],[251,-25,-49]])lantern(x,y,top);
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

const mineSite=world.sites.find(s=>s.id==='mine');
Object.assign(mineSite,{
  id:'mine',name:'Oldroot Mine',
  description:'An oak-braced hillside mine, with a hand-wound hoist, lamplit galleries and a weathered ore-sorting shelter.',
  anchors:{gallery:[-242,-10],mouth:[-39,-10],shaft:[44,-10],gold:[-268,83],yard:[159,-10]},
  preview:{at:[mineSite.origin[0]-40,mineSite.origin[1]-10],dayPhase:.35,zoomSteps:-3},
  placement:{footprint:[-360,340],ground:0,search:1024,blend:96,
    terrain:[[-360,0],[-326,-67],[-276,-139],[-224,-157],[-158,-134],[-99,-104],[-62,-81],[-18,0],[340,0]]},
  operations:mine(),
});
const forge=world.sites.find(s=>s.id==='foundry');
Object.assign(forge,{
  name:'The Cinder Works',description:'A barrel-roofed brick forge, banded chimney, copper pressure vessel and open crane yard.',
  anchors:{...forge.anchors,brann:[-151,-10]},
  preview:{at:[forge.origin[0]-30,forge.origin[1]-12],dayPhase:.45,zoomSteps:-1},
  placement:{...forge.placement,footprint:[-178,183]},operations:foundry(),
});
const pass=world.quests.find(q=>q.key==='buried-pass');
Object.assign(pass,{
  title:'The sealed gallery',target:'mine.gallery',radius:72,
  condition:{kind:'passage',bounds:[mineSite.origin[0]-196,mineSite.origin[1]-48,mineSite.origin[0]-176,mineSite.origin[1]],surfaceAt:mineSite.surfaceAt},
  place:'West · Oldroot Mine',summary:'Reopen the collapsed iron gallery at Oldroot Mine.',
  description:'Oldroot once supplied the valley with iron, coal and a little gold. A roof fall has sealed its upper working. Iven will trade a Stonebreak rune for a passage back to the old iron face.',
  hint:'Enter beneath the timber lintel and follow the lanterns left. Clear a person-high gap through the fallen stone between the oak pit props.',
});
Object.assign(world.quests.find(q=>q.key==='iron-promise'),{
  after:['buried-pass'],place:'Oldroot Mine → Brann’s forge',
  summary:'Bring Brann 48 iron ore from the reopened workings.',
  description:'With Oldroot’s gallery open, Brann can forge shields for the valley again. Work the exposed iron seams beyond the rockfall and bring him 48 iron ore.',
  hint:'Rust-red iron is exposed at the far end of the upper gallery. Return to Brann and hand over the ore.',
});
Object.assign(world.quests.find(q=>q.key==='golden-thread'),{
  after:['buried-pass'],place:'Oldroot Mine → Hearthwood',
  summary:'Recover 12 gold ore for Iven’s falling charm.',
  description:'Iven remembers a golden seam below Oldroot’s iron working. Now the gallery is open, follow the stepped incline to the lower lanterns. Bring him 12 gold ore for a charm that softens a fall.',
  hint:'The stone steps descend beside the mine mouth. Gold glints in the left wall of the lower gallery; bring 12 ore back to Iven.',
});
Object.assign(world.quests.find(q=>q.key==='miras-lantern'),{
  description:'Mira needs 20 coal to keep her reading lantern lit. Oldroot’s near working has a dark seam before the collapse, reachable even while the iron gallery is sealed.',
  hint:'Look for the black seam just inside Oldroot Mine, above the steps. Bring 20 coal back to Mira.',
});
world.residents.find(n=>n.id===7).dialogue.variants=[
  {quest:'golden-thread',state:'complete',text:'Oldroot’s gold has a little sunlight in it still. Keep the charm close on the high paths. I have copper wares whenever you need them.'},
  {quest:'buried-pass',state:'complete',text:'Lamplight in the old working again! Brann needs its iron, and there is gold below: take the stone steps down, then follow the lower lanterns left. Bring me twelve gold ore and I will bind you a falling charm.'},
  {quest:'buried-pass',state:'active',text:'West of Hearthwood is Oldroot Mine. The hand winch is still standing, but fallen stone seals the iron gallery. Follow the upper lanterns left and open a person-high passage. I have a Stonebreak rune for whoever gets the old working open.'},
];
world.quests.find(q=>q.key==='last-shift').place='Far west · The Cinder Works';
const mineCaches=[[-247,-7],[-239,87],[-166,87],[146,-7],[287,-7]];
const mineNames=['Ironworker’s coffer','Deep seam coffer','Pit-prop supplies','Ore sorter’s coffer','Timber-yard stores'];
world.chests.filter(c=>c.anchor.startsWith('mine.')).forEach((c,i)=>{
  c.anchor='mine.gallery';c.offset=mineCaches[i].map((v,axis)=>v-mineSite.anchors.gallery[axis]);c.name=mineNames[i];
});
const forgeCaches=[[-153,-7],[-73,-7],[-30,-7],[48,-7],[169,-7]];
world.chests.filter(c=>c.anchor==='foundry.foreman').forEach((c,i)=>{c.offset=forgeCaches[i].map((v,axis)=>v-forge.anchors.foreman[axis]);});
writeFileSync(new URL('../src/sand/content/world.js',import.meta.url),'// Authored places and stories for the Hollow Bell chapter.\nexport default '+formatWorldContent(world)+';\n');
console.log(`Authored ${mineSite.operations.length} mine and ${forge.operations.length} foundry operations.`);
