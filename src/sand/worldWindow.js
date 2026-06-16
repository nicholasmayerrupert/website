// Horizontal sliding window for the infinite world.
//
// The simulation buffer is a fixed-width window onto an endless world. When the
// camera nears a horizontal edge the engine calls shiftWorld(): the persistent
// buffers are memmoved, the freshly exposed edge band is generated, live rigid
// bodies and dirty marks are translated, and the component layer is rebuilt to
// match the shifted grid. Vertical is fixed, so only the x axis ever shifts.

// Shift a row-major (bufCols x rows) typed array horizontally by `dx` columns
// (dx>0 moves content LEFT, exposing the right edge), filling vacated cells with
// `fill`. Pure and testable.
export function shiftRowMajor(arr, bufCols, rows, dx, fill) {
  if (dx === 0) return;
  if (dx > 0) {
    for (let y = 0; y < rows; y++) {
      const b = y * bufCols;
      arr.copyWithin(b, b + dx, b + bufCols);
      arr.fill(fill, b + bufCols - dx, b + bufCols);
    }
  } else {
    const s = -dx;
    for (let y = 0; y < rows; y++) {
      const b = y * bufCols;
      arr.copyWithin(b + s, b, b + bufCols - s);
      arr.fill(fill, b, b + s);
    }
  }
}

export function createWorldWindow(S, ext) {
  const {
    bufCols, worldRows,
    compOccStamp, vacatedStamp, rowMarkMin, rowMarkMax,
    generateBand, getWorldOffsetX, setWorldOffsetX,
  } = ext;
  const EMPTY = S.EMPTY;
  const RIGID = S.RIGID;

  // Slide the loaded window by `dx` world-columns (dx>0 reveals the right edge,
  // dx<0 the left). The caller keeps the view fixed by moving the camera by -dx.
  const shiftWorld = (dx) => {
    if (!dx) return;
    const s = Math.abs(dx);
    if (s >= bufCols) return; // camera math keeps dx well under the buffer width
    const grid = S.grid;
    const next = S.next;
    const bodyOwner = S.bodyOwner;
    const rigidWorld = S.rigidWorld;

    // 1) Un-stamp free rigid bodies before the memmove so no stale RIGID raster is
    // dragged along; moveBodies re-rasterizes from each body's float pose.
    for (const k of S.bodyCells) {
      if (grid[k] === RIGID) grid[k] = EMPTY;
      if (next[k] === RIGID) next[k] = EMPTY;
      bodyOwner[k] = -1;
    }
    S.bodyCells = [];

    // 2) Slide the persistent buffers and the per-row dirty marks together.
    shiftRowMajor(grid, bufCols, worldRows, dx, EMPTY);
    shiftRowMajor(next, bufCols, worldRows, dx, EMPTY);
    shiftRowMajor(bodyOwner, bufCols, worldRows, dx, -1);
    for (let y = 0; y < worldRows; y++) {
      if (rowMarkMax[y] < rowMarkMin[y]) continue;
      const mn = rowMarkMin[y] - dx;
      const mx = rowMarkMax[y] - dx;
      if (mx < 0 || mn > bufCols - 1) { rowMarkMin[y] = bufCols; rowMarkMax[y] = -1; continue; }
      rowMarkMin[y] = mn < 0 ? 0 : mn;
      rowMarkMax[y] = mx > bufCols - 1 ? bufCols - 1 : mx;
    }
    // Stamps are absolute-position keyed; clear so shifted cells aren't mistaken
    // for still-occupied. They repopulate over the next step.
    compOccStamp.fill(-1);
    vacatedStamp.fill(-1);

    // 3) Translate live rigid bodies; drop any whose center left the buffer.
    const keep = [];
    for (const b of rigidWorld.bodies) {
      b.px -= dx;
      if (b.px > -b.maxR && b.px < bufCols + b.maxR) keep.push(b);
    }
    rigidWorld.bodies.length = 0;
    for (const b of keep) rigidWorld.bodies.push(b);

    // 4) Generate the newly exposed edge band and advance the world offset.
    const newOffset = getWorldOffsetX() + dx;
    const colStart = dx > 0 ? bufCols - s : 0;
    generateBand({ grid, next, bufCols, colStart, colCount: s, worldOffsetX: newOffset });
    setWorldOffsetX(newOffset);
    // Mark the new band active so it simulates (water settling, etc.).
    for (let y = 0; y < worldRows; y++) {
      if (colStart < rowMarkMin[y]) rowMarkMin[y] = colStart;
      if (colStart + s - 1 > rowMarkMax[y]) rowMarkMax[y] = colStart + s - 1;
    }

    // 5) Rebuild the component layer from the shifted+generated grid. Existing
    // component cell-sets hold pre-shift indices, so they are discarded and
    // re-derived from materials (registerSeededComponents is a full flood-fill).
    S.stoneComponents = [];
    S.plantComponents = [];
    S.iceComponents = [];
    S.registerSeededComponents();
  };

  return { shiftWorld };
}
