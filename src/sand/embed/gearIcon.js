import { ARMOR_SETS, EQUIPMENT_BY_ID } from '../content/equipment.js';

// Small, pixel-aligned inventory silhouettes share the character's cloth and metal palette.
export function gearIcon(id, size = 32) {
  const gear = EQUIPMENT_BY_ID[id];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('aria-hidden', 'true');
  if (!gear) return svg;
  const cloth = ARMOR_SETS[gear.style - 1]?.color || '#7d9368';
  const trim = ARMOR_SETS[gear.style - 1]?.trim || '#c4a569';
  const rect = (x, y, width, height, fill) => {
    const node = document.createElementNS(svg.namespaceURI, 'rect');
    for (const [key, value] of Object.entries({ x, y, width, height, fill })) node.setAttribute(key, value);
    svg.append(node);
  };
  const path = (d, fill) => { const node = document.createElementNS(svg.namespaceURI, 'path'); node.setAttribute('d', d); node.setAttribute('fill', fill); svg.append(node); };
  if (gear.family <= 3) {
    path('M2 13h2v-2h2V9h2V7h2V5h2V3h2V1h1v4h-2v2h-2v2H9v2H7v2H5v2H2Z', '#d6d9c4');
    path('M2 13h2v-2h2v2H4v2H2Z', '#806143');
    if (gear.family === 1) path('M4 9h2v2h2v2H6v-2H4Z', '#cba45e');
    if (gear.family === 2) path('M8 3h5v1h2v6h-2V8H9V6H7V4Z', '#8c9a90');
    if (gear.family === 3) path('M10 1h5v5h-2V4h-3Z', '#f0e6be');
  } else if (gear.family === 4) {
    path('M4 1h3v1h3v2h2v3h1v3h-1v2h-2v2H7v1H4v-2h3v-1h2v-2h1V6H9V4H7V3H4Z', '#947044');
    rect(4, 2, 1, 12, '#d9cd9d'); rect(2, 7, 12, 1, '#c4a569');
  } else if (gear.family === 5 || gear.family === 9 || gear.family === 11) {
    if (gear.family === 5) rect(7, 5, 2, 10, '#8b6540');
    path('M6 1h4v1h2v2h1v5h-2v2H5V9H3V4h1V2h2Z', '#b69a56');
    path('M7 2h2v2h2v3H9v2H7V7H5V4h2Z', ['#f0ac55', '#9ad4e0', '#c0d9b9', '#d7b187', '#81a970', '#f4e5a1'][gear.spell - 1] || '#daca8d');
    rect(7, 3, 1, 3, '#ffefc4');
  } else if (gear.family === 6) {
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
  } else if (gear.family === 7) {
    path('M2 2h12v7h-1v2h-2v2H9v2H7v-2H5v-2H3V9H2Z', trim);
    path('M4 4h8v5h-1v2H9v2H7v-2H5V9H4Z', '#51694b');
    rect(7, 4, 2, 8, '#b39759'); rect(5, 7, 6, 2, '#b39759');
  } else if (gear.family === 8) {
    path('M4 1h8v2h2v6h-2v2h-1v3H5v-3H4V9H2V3h2Z', '#bea568');
    path('M5 2h6v1h2v5h-2v2H5V8H3V3h2Z', '#24382c'); rect(6, 9, 4, 5, '#d4c886'); rect(7, 10, 2, 3, '#80a999');
  } else if (gear.family === 10) {
    rect(6, 1, 4, 3, '#b19360'); rect(5, 4, 6, 2, '#cec5a2');
    path('M5 5h6v2h2v7H3V7h2Z', '#becac0'); rect(4, 9, 8, 4, id === 320 ? '#ad5742' : '#548aa8'); rect(5, 7, 1, 4, '#e9e1b5');
  }
  return svg;
}
