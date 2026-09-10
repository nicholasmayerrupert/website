import { ARMOR_SETS, EQUIPMENT_BY_ID, GEAR_FAMILY } from './equipment.js';

// Pixel-center rasterization of the shared 16×16 gear silhouettes.
const cache = new Map();
export function gearPixels(id) {
  if (cache.has(id)) return cache.get(id);
  const pixels = new Uint32Array(256), gear = EQUIPMENT_BY_ID[id];
  if (!gear) return pixels;
  const cloth = ARMOR_SETS[gear.style - 1]?.color || '#7d9368';
  const trim = ARMOR_SETS[gear.style - 1]?.trim || '#c4a569';
  const color = hex => {
    const rgb = parseInt(hex.slice(1), 16);
    return (0xff000000 | (rgb & 255) << 16 | (rgb & 0xff00) | (rgb >>> 16)) >>> 0;
  };
  const rect = (x, y, width, height, fill) => {
    for (let yy=y; yy<y+height; yy++) for (let xx=x; xx<x+width; xx++)
      if (xx>=0 && xx<16 && yy>=0 && yy<16) pixels[yy*16+xx]=color(fill);
  };
  const path = (d, fill) => {
    const tokens=d.match(/[a-zA-Z]|-?\d+(?:\.\d+)?/g), edges=[];
    let at=0,x=0,y=0,sx=0,sy=0,command='';
    const line=(nx,ny)=>{edges.push([x,y,nx,ny]);x=nx;y=ny;};
    while(at<tokens.length) {
      if (/[a-zA-Z]/.test(tokens[at])) command=tokens[at++];
      const relative=command===command.toLowerCase(),op=command.toUpperCase();
      if(op==='Z') {line(sx,sy);command='';continue;}
      if(op==='H') {line(Number(tokens[at++])+(relative?x:0),y);continue;}
      if(op==='V') {line(x,Number(tokens[at++])+(relative?y:0));continue;}
      if(op!=='M' && op!=='L') throw new Error(`Unsupported gear path command ${command}`);
      const nx=Number(tokens[at++])+(relative?x:0),ny=Number(tokens[at++])+(relative?y:0);
      if(op==='M') {x=sx=nx;y=sy=ny;command=relative?'l':'L';} else line(nx,ny);
    }
    for(let yy=0;yy<16;yy++)for(let xx=0;xx<16;xx++) {
      const px=xx+.5,py=yy+.5;let winding=0;
      for(const [x0,y0,x1,y1] of edges) {
        const side=(x1-x0)*(py-y0)-(px-x0)*(y1-y0);
        if(y0<=py && y1>py && side>0) winding++;
        if(y0>py && y1<=py && side<0) winding--;
      }
      if(winding) pixels[yy*16+xx]=color(fill);
    }
  };
  if (gear.family === GEAR_FAMILY.TROPHY) {
    const base = gear.color, edge = '#283333', light = '#eee4c6';
    const shapes = {
      fang: 'M4 2h7v4h-1v3H9v2H7v2H4l2-4V6H4Z',
      pelt: 'M3 2h3l2 2 2-2h3v3l-2 2 1 5-3 2H7l-3-2 1-5-2-2Z',
      shell: 'M5 2h6l3 4v5l-4 3H6l-4-3V6Z',
      coin: 'M5 2h6l3 3v6l-3 3H5l-3-3V5Z',
      crystal: 'M8 1l5 4-1 7-4 3-4-3-1-7Z',
      gland: 'M7 1h3v3l3 3v5l-3 3H6l-3-3V8l3-4Z',
      feather: 'M12 1l2 2v5l-3 4H7l-4 3 2-5V6l4-4Z',
      antler: 'M7 15V9L3 7V2l2 3 2 1V1l2 4 1 3 3-3V2l2 4-3 5-2 1v3Z',
      wing: 'M2 2l5 3 7-3v6l-3-1-1 5-3-2-2 4-2-5Z',
      scarab: 'M6 1h4v2l3 2v5l-3 4H6l-3-4V5Z',
    };
    path(shapes[gear.shape] || shapes.crystal, edge);
    path('M6 4h4l2 3-2 5H6L4 8Z', base);
    if (gear.shape === 'fang' || gear.shape === 'feather' || gear.shape === 'antler') path(shapes[gear.shape], base);
    rect(6, 4, 1, 5, light); rect(7, 3, 2, 1, light);
    if (gear.shape === 'scarab') { rect(7, 5, 2, 8, '#d1ac64'); rect(5, 7, 6, 1, '#d1ac64'); }
    if (gear.shape === 'coin') { rect(7, 6, 2, 5, edge); rect(5, 8, 6, 1, edge); }
    if (gear.shape === 'gland') { rect(7, 8, 4, 3, '#e6ab66'); rect(8, 7, 2, 2, '#fff0ba'); }
    if (gear.shape === 'shell' || gear.shape === 'pelt') { rect(7, 6, 2, 5, edge); rect(4, 7, 7, 1, edge); }
  } else if (gear.family === GEAR_FAMILY.UPGRADE) {
    path('M4 1h8v2h2v10h-2v2H4v-2H2V3h2Z', '#7a91aa');
    rect(4, 3, 8, 10, '#293848');
    const tint = ['#f0c77e','#99e0c4','#d6b4f0','#9bc9fa','#dbd49b','#f2a57e','#a7c7e8','#c8b0ea','#a1d9c8'][gear.id-500];
    const symbol = [
      'M5 5h2v2h2V5h2v2H9v2h2v2H9V9H7v2H5V9h2V7H5Z',
      'M5 10V7h3V4h3v2H9v3H7v3H5Z',
      'M8 3h3L9 7h2l-5 6 1-5H5Z',
      'M5 4h2v7H5Z M9 4h2v7H9Z',
      'M4 7h3V4h2v3h3v2H9v3H7V9H4Z',
      'M4 7h4V4l4 4-4 4V9H4Z',
      'M5 3h6v2H9v2h2v3H9v2h2v2H5v-2h2v-2H5V7h2V5H5Z',
      'M5 11V7h3V4h3v2H9v3H7v3Z',
      'M5 4h6v2H9v4h2v2H5v-2h2V6H5Z',
    ][gear.id-500];
    path(symbol, tint); rect(4, 2, 5, 1, '#d4e3e8');
  } else if (gear.family <= GEAR_FAMILY.SPEAR) {
    path('M2 13h2v-2h2V9h2V7h2V5h2V3h2V1h1v4h-2v2h-2v2H9v2H7v2H5v2H2Z', '#d6d9c4');
    path('M2 13h2v-2h2v2H4v2H2Z', '#806143');
    if (gear.family === GEAR_FAMILY.SWORD) path('M4 9h2v2h2v2H6v-2H4Z', '#cba45e');
    if (gear.family === GEAR_FAMILY.AXE) path('M8 3h5v1h2v6h-2V8H9V6H7V4Z', '#8c9a90');
    if (gear.family === GEAR_FAMILY.SPEAR) path('M10 1h5v5h-2V4h-3Z', '#f0e6be');
  } else if (gear.family === GEAR_FAMILY.BOW) {
    path('M4 1h3v1h3v2h2v3h1v3h-1v2h-2v2H7v1H4v-2h3v-1h2v-2h1V6H9V4H7V3H4Z', '#947044');
    rect(4, 2, 1, 12, '#d9cd9d'); rect(2, 7, 12, 1, '#c4a569');
  } else if (gear.family === GEAR_FAMILY.WAND) {
    // A long diagonal handle and a small crystal distinguish wands from runes.
    path('M2 13l9-9 2 2-9 9H2Z', '#49372a');
    path('M3 12l8-8 1 1-8 8Z', '#bc8c56');
    path('M5 10l2-2 2 2-2 2Z', '#e1c58d');
    path('M10 1h4v1h1v4h-1v2h-4V6H8V3h2Z', '#4e625f');
    path('M11 2h3v3l-3 2-2-3Z', ['#ffc477', '#9ce3ed', '#c7e8a2'][gear.style - 1]);
    rect(11, 2, 1, 3, '#fff4d7');
  } else if (gear.family === GEAR_FAMILY.SPELL || gear.family === GEAR_FAMILY.RELIC) {
    path('M6 1h4v1h2v2h1v5h-2v2H5V9H3V4h1V2h2Z', '#b69a56');
    const runeColor = ['#f0ac55', '#9ad4e0', '#c0d9b9', '#d7b187', '#81a970', '#f4e5a1', '#ff91df', '#bb82ff', '#ffca57', '#b5f4ff', '#ff963c'][gear.spell - 1] || '#daca8d';
    if (gear.spell === 10) { rect(7, 2, 2, 8, runeColor); rect(4, 5, 8, 2, runeColor); rect(5, 3, 1, 6, runeColor); rect(10, 3, 1, 6, runeColor); }
    else if (gear.spell === 11) path('M8 2l3 4v3H5V6l2-1Z', runeColor);
    else if (gear.spell === 7) path('M4 3h2v4H4Z M7 2h2v6H7Z M10 3h2v4h-2Z', runeColor);
    else if (gear.spell === 8) {
      path('M6 2h4v1h2v4h-2v2H6V7H4V3h2Z', runeColor);
      rect(6, 4, 4, 3, '#23133b');
    } else if (gear.spell === 9) path('M9 2h2L8 5h3L5 10l2-4H5Z', runeColor);
    else path('M7 2h2v2h2v3H9v2H7V7H5V4h2Z', runeColor);
    rect(7, 3, 1, 3, '#ffefc4');
  } else if (gear.family === GEAR_FAMILY.ARMOR) {
    const shapes = [
      'M5 2h6v1h2v10H3V3h2Z M5 5v6h6V5Z',
      'M5 2h6v2h3v8h-3v3H5v-3H2V4h3Z',
      'M2 4h4v5h1v4H1V7h1Z M10 4h4v3h1v6H9V9h1Z',
      'M4 2h8v12H9V8H7v6H4Z',
      'M3 3h4v9H2v2h6V3Z M10 3h3v9h2v2H9V3Z',
      'M6 1h4l4 13H2Z',
    ];
    path(shapes[gear.slot], cloth); rect(5, 3, 6, 1, trim);
    if (gear.slot === 1) { rect(5, 10, 6, 2, '#483d2d'); rect(7, 10, 2, 2, trim); }
    if (gear.style >= 4 && gear.slot === 0) { rect(4, 6, 8, 2, '#29342c'); rect(7, 3, 2, 10, trim); }
  } else if (gear.family === GEAR_FAMILY.SHIELD) {
    path('M2 2h12v7h-1v2h-2v2H9v2H7v-2H5v-2H3V9H2Z', trim);
    path('M4 4h8v5h-1v2H9v2H7v-2H5V9H4Z', '#51694b');
    rect(7, 4, 2, 8, '#b39759'); rect(5, 7, 6, 2, '#b39759');
  } else if (gear.family === GEAR_FAMILY.CHARM) {
    path('M4 1h8v2h2v6h-2v2h-1v3H5v-3H4V9H2V3h2Z', '#bea568');
    path('M5 2h6v1h2v5h-2v2H5V8H3V3h2Z', '#24382c'); rect(6, 9, 4, 5, '#d4c886'); rect(7, 10, 2, 3, '#80a999');
  } else if (gear.family === GEAR_FAMILY.POTION) {
    rect(6, 1, 4, 3, '#b19360'); rect(5, 4, 6, 2, '#cec5a2');
    path('M5 5h6v2h2v7H3V7h2Z', '#becac0'); rect(4, 9, 8, 4, id === 320 ? '#ad5742' : '#548aa8'); rect(5, 7, 1, 4, '#e9e1b5');
  }
  cache.set(id,pixels);
  return pixels;
}
