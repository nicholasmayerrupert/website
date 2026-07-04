import { SIZING } from '../src/sand/game/runtimeConfig.js';
import { chooseStableCssSize, computeViewportSizing } from '../src/sand/game/viewportSizing.js';

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

console.log('viewport sizing');

{
  const a = computeViewportSizing(900, 700, 1);
  const b = computeViewportSizing(900, 700, 1.25);
  const c = computeViewportSizing(900, 700, 2);
  check(`DPR keeps visible cells stable (${a.viewCols}x${a.viewRows})`, a.viewCols === b.viewCols && b.viewCols === c.viewCols && a.viewRows === b.viewRows && b.viewRows === c.viewRows);
  check(`DPR keeps buffer stable (${a.bufCols}x${a.worldRows})`, a.bufCols === b.bufCols && b.bufCols === c.bufCols && a.worldRows === b.worldRows && b.worldRows === c.worldRows);
  check(`device backing store follows DPR (${a.canvasW}/${b.canvasW}/${c.canvasW})`, a.canvasW < b.canvasW && b.canvasW < c.canvasW);
}

{
  const mobile = computeViewportSizing(390, 700, 3);
  const desktop = computeViewportSizing(900, 700, 1);
  check(`mobile uses a denser logical viewport (${mobile.viewCols} cols)`, mobile.viewCols >= 120 && mobile.viewCols <= 150);
  // Default desktop zoom is SIZING.cellPx (5) CSS px per cell: 900/5 ~= 180 cols.
  check(`desktop defaults near 5 CSS px per cell (${desktop.viewCols} cols)`, desktop.viewCols >= 176 && desktop.viewCols <= 184);
}

{
  // Runtime zoom: the visible window scales with the zoom factor, but the buffer
  // dims stay pinned to the most-zoomed-out factor (minZoom) so the engine never
  // rebuilds on a zoom change.
  const zOut = SIZING.zoomSteps[0];
  const zIn = SIZING.zoomSteps[SIZING.zoomSteps.length - 1];
  const wide = computeViewportSizing(900, 700, 1, SIZING, zOut, zOut);
  const tight = computeViewportSizing(900, 700, 1, SIZING, zIn, zOut);
  check(`zoom in shows fewer cells than zoom out (${tight.viewCols} < ${wide.viewCols})`, tight.viewCols < wide.viewCols && tight.viewRows < wide.viewRows);
  check(`buffer dims are identical across zoom (${tight.bufCols}x${tight.worldRows} == ${wide.bufCols}x${wide.worldRows})`, tight.bufCols === wide.bufCols && tight.worldRows === wide.worldRows);
  check(`zoomed-in window still fits inside the buffer (${tight.viewCols} <= ${tight.bufCols})`, tight.viewCols <= tight.bufCols && tight.viewRows <= tight.worldRows);
}

{
  const prev = chooseStableCssSize(390, 700);
  const small = chooseStableCssSize(390, 735, prev);
  const large = chooseStableCssSize(390, 760, prev);
  check(`small mobile height jitter ignored (${small.height})`, small.height === prev.height);
  check(`large mobile height change accepted (${large.height})`, large.height === 760);
}

{
  const huge = computeViewportSizing(3840, 2160, 2);
  check(`large display viewport stays within budget (${huge.viewCols * huge.viewRows} <= ${SIZING.maxViewportCells})`, huge.viewCols * huge.viewRows <= SIZING.maxViewportCells);
  check(`buffer dimensions stay chunk-aligned (${huge.bufCols}x${huge.worldRows})`, huge.bufCols % SIZING.chunkSize === 0 && huge.worldRows % SIZING.chunkSize === 0);
}

{
  const weird = computeViewportSizing(1001, 677, 1.25);
  check(`integer cellDev covers width with GL overdraw (${weird.cellDev} px/cell)`, (weird.viewCols + 2) * weird.cellDev >= weird.canvasW);
  check(`integer cellDev covers height with GL overdraw (${weird.cellDev} px/cell)`, (weird.viewRows + 2) * weird.cellDev >= weird.canvasH);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
