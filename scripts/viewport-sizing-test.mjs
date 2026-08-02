import { SIZING } from '../src/sand/game/runtimeConfig.js';
import { chooseStableCssSize, computeViewportSizing, shouldResizeBuffer } from '../src/sand/game/viewportSizing.js';

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
  check(`mobile uses a denser logical viewport (${mobile.viewCols} cols)`, mobile.viewCols >= 116 && mobile.viewCols <= 124);
  // Default desktop zoom is cellPx 5.5 CSS px per cell: 900/5.5 ~= 164 cols.
  check(`desktop defaults near 5.5 CSS px per cell (${desktop.viewCols} cols)`, desktop.viewCols >= 160 && desktop.viewCols <= 168);
}

{
  // Buffer tracks CURRENT zoom (not a fixed min-zoom pin).
  const zOut = 0.5;
  const zIn = 2.9;
  const wide = computeViewportSizing(900, 700, 1, SIZING, zOut);
  const tight = computeViewportSizing(900, 700, 1, SIZING, zIn);
  check(`zoom out shows more cells than zoom in (${wide.viewCols} > ${tight.viewCols})`, wide.viewCols > tight.viewCols && wide.viewRows > tight.viewRows);
  check(`buffer grows when zoomed out (${wide.bufCols} > ${tight.bufCols})`, wide.bufCols > tight.bufCols || wide.worldRows > tight.worldRows);
  check(`zoomed-in window still fits inside its buffer (${tight.viewCols} <= ${tight.bufCols})`, tight.viewCols <= tight.bufCols && tight.viewRows <= tight.worldRows);
  check(`zoomed-out window still fits inside its buffer (${wide.viewCols} <= ${wide.bufCols})`, wide.viewCols <= wide.bufCols && wide.viewRows <= wide.worldRows);
}

{
  // Browser page zoom couples a CSS-px shrink with a dpr grow (cssPx*dpr ~ const).
  // With the load dpr as the baseline, the visible cell window must NOT change.
  const baseDpr = 1;
  const load = computeViewportSizing(1200, 800, baseDpr, SIZING, 1, 1, baseDpr);
  const zoomedIn = computeViewportSizing(1200 / 1.5, 800 / 1.5, baseDpr * 1.5, SIZING, 1, 1, baseDpr);
  const zoomedOut = computeViewportSizing(1200 / 0.8, 800 / 0.8, baseDpr * 0.8, SIZING, 1, 1, baseDpr);
  check(`browser zoom-in keeps the same visible cells (${load.viewCols} == ${zoomedIn.viewCols})`, load.viewCols === zoomedIn.viewCols && load.viewRows === zoomedIn.viewRows);
  check(`browser zoom-out keeps the same visible cells (${load.viewCols} == ${zoomedOut.viewCols})`, load.viewCols === zoomedOut.viewCols && load.viewRows === zoomedOut.viewRows);
}

{
  const prev = chooseStableCssSize(390, 700);
  const small = chooseStableCssSize(390, 735, prev);
  const large = chooseStableCssSize(390, 760, prev);
  check(`small mobile height jitter ignored (${small.height})`, small.height === prev.height);
  check(`large mobile height change accepted (${large.height})`, large.height === 760);
}

{
  // Extreme zoom-out is allowed (no hard maxViewportCells floor).
  const far = computeViewportSizing(900, 700, 1, SIZING, 0.1);
  check(`extreme zoom-out can exceed old maxViewportCells (${far.viewCols * far.viewRows})`, far.viewCols * far.viewRows > SIZING.maxViewportCells);
  check(`fractional cellDev remains supported below one device px (${far.cellDev})`, far.cellDev < 1);
  check(`buffer dimensions stay chunk-aligned (${far.bufCols}x${far.worldRows})`, far.bufCols % SIZING.chunkSize === 0 && far.worldRows % SIZING.chunkSize === 0);
  const fullRunwayRows = Math.ceil(
    Math.max(
      far.viewRows + SIZING.bufferMarginRows * 2,
      far.viewRows * SIZING.worldHeightFactor,
    ) / SIZING.chunkSize,
  ) * SIZING.chunkSize;
  check(`extreme zoom trims off-screen vertical runway (${far.worldRows} < ${fullRunwayRows})`, far.worldRows < fullRunwayRows);
  check('extreme zoom retains the worker stream margin',
    far.worldRows >= far.viewRows + SIZING.minBufferMarginRows * 2);
}

{
  const textureLimit = 2048;
  const capped = computeViewportSizing(2560, 1440, 1, SIZING, 0.05, 0.05, 1, textureLimit);
  check(`GPU-limited zoom keeps both texture dimensions renderable (${capped.bufCols}x${capped.worldRows})`,
    capped.bufCols <= textureLimit && capped.worldRows <= textureLimit);
  check(`GPU-limited zoom has no fixed total-cell ceiling (${capped.bufCols * capped.worldRows})`,
    capped.bufCols * capped.worldRows > 1200000);
  check(`GPU-limited zoom reports its effective floor (${capped.zoom.toFixed(3)} > 0.05)`, capped.zoom > 0.05);
  check('GPU-limited visible window still fits inside the buffer',
    capped.viewCols <= capped.bufCols && capped.viewRows <= capped.worldRows);
}

{
  const weird = computeViewportSizing(1001, 677, 1.25);
  check(`integer cellDev covers width with GL overdraw (${weird.cellDev} px/cell)`, weird.cellDev >= 1 && (weird.viewCols + 2) * weird.cellDev >= weird.canvasW);
  check(`integer cellDev covers height with GL overdraw (${weird.cellDev} px/cell)`, (weird.viewRows + 2) * weird.cellDev >= weird.canvasH);
}

{
  // Hysteresis: small desired changes should not force a resize; view overflow should.
  check('identical dims do not resize', !shouldResizeBuffer(400, 300, 400, 300, 100, 80));
  check('tiny desired change under hysteresis is ignored', !shouldResizeBuffer(400, 300, 400 + 16, 300, 100, 80));
  check('large desired change triggers resize', shouldResizeBuffer(400, 300, 600, 450, 100, 80));
  check('view overflow always triggers grow', shouldResizeBuffer(200, 150, 200, 150, 180, 140));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
