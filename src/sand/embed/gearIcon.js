import { gearPixels } from '../content/gearArt.js';

export function gearIcon(id, size = 32) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('aria-hidden', 'true');
  const pixels = gearPixels(id);
  for (let y=0;y<16;y++) for (let x=0;x<16;) {
    const color=pixels[y*16+x]; let end=x+1;
    while(end<16 && pixels[y*16+end]===color) end++;
    if(color) {
      const rect=document.createElementNS(svg.namespaceURI,'rect');
      rect.setAttribute('x',x);rect.setAttribute('y',y);rect.setAttribute('width',end-x);rect.setAttribute('height',1);
      rect.setAttribute('fill',`rgb(${color&255} ${(color>>>8)&255} ${(color>>>16)&255})`);svg.append(rect);
    }
    x=end;
  }
  return svg;
}
