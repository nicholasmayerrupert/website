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
    generateBand, getWorldOffsetX, setWorldOffsetX, chunkStore,
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
    const oldOffset = getWorldOffsetX();
    const newOffset = oldOffset + dx;
    // Local column starts of the band leaving (scrolled off) and the band
    // entering (newly exposed), plus their world-x keys for the store.
    const leaveColStart = dx > 0 ? 0 : bufCols - s;
    const enterColStart = dx > 0 ? bufCols - s : 0;
    const leaveKey = oldOffset + leaveColStart;
    const enterKey = newOffset + enterColStart;

    // 1) Un-stamp free rigid bodies before anything else so no stale RIGID raster
    // is saved or carried through the memmove; moveBodies re-rasterizes from each
    // body's float pose next step.
    for (const k of S.bodyCells) {
      if (grid[k] === RIGID) grid[k] = EMPTY;
      if (next[k] === RIGID) next[k] = EMPTY;
      bodyOwner[k] = -1;
    }
    S.bodyCells = [];

    // 2) Persist the leaving band: pull out the bodies that sit in it, then save
    // its (now RIGID-free) materials. Bodies are stored with absolute world-x so
    // they reappear in the right place on return.
    if (chunkStore) {
      const leaving = [];
      const staying = [];
      for (const b of rigidWorld.bodies) {
        if (b.px >= leaveColStart && b.px < leaveColStart + s) leaving.push({ body: b, worldPx: oldOffset + b.px });
        else staying.push(b);
      }
      if (leaving.length) {
        rigidWorld.bodies.length = 0;
        for (const b of staying) rigidWorld.bodies.push(b);
        chunkStore.saveBodies(leaveKey, leaving);
      }
      chunkStore.saveMaterials(grid, bufCols, leaveColStart, s, leaveKey);
    }

    // 3) Slide the persistent buffers and the per-row dirty marks together.
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

    // 4) Translate the bodies that stayed; drop any that ended up off-buffer.
    const keep = [];
    for (const b of rigidWorld.bodies) {
      b.px -= dx;
      if (b.px > -b.maxR && b.px < bufCols + b.maxR) keep.push(b);
    }
    rigidWorld.bodies.length = 0;
    for (const b of keep) rigidWorld.bodies.push(b);

    // 5) Bring in the newly exposed band: restore it if we've been here before,
    // otherwise generate it. Then advance the offset and restore its bodies.
    const restored = chunkStore && chunkStore.loadMaterials(grid, next, bufCols, enterColStart, s, enterKey);
    if (!restored) generateBand({ grid, next, bufCols, colStart: enterColStart, colCount: s, worldOffsetX: newOffset });
    setWorldOffsetX(newOffset);
    if (chunkStore) {
      for (const e of chunkStore.takeBodies(enterKey)) {
        e.body.px = e.worldPx - newOffset;
        rigidWorld.bodies.push(e.body);
      }
    }
    // Mark the new band active so it simulates (water settling, etc.).
    for (let y = 0; y < worldRows; y++) {
      if (enterColStart < rowMarkMin[y]) rowMarkMin[y] = enterColStart;
      if (enterColStart + s - 1 > rowMarkMax[y]) rowMarkMax[y] = enterColStart + s - 1;
    }

    // 6) Update the component layer incrementally (a full flood-fill rebuild here
    // was the shift hitch). Translate surviving components by the shift — pure
    // arithmetic on their cell indices, dropping cells that scrolled off — then
    // register components for only the freshly exposed band.
    const translate = (list) => {
      const kept = [];
      for (const comp of list) {
        const cells = new Set();
        let yMax = 0;
        for (const k of comp.cells) {
          const nx = (k % bufCols) - dx;
          if (nx < 0 || nx >= bufCols) continue; // scrolled off the buffer
          const nk = k - dx;
          cells.add(nk);
          const y = (nk / bufCols) | 0;
          if (y > yMax) yMax = y;
        }
        if (cells.size === 0) continue; // whole component left the window
        comp.cells = cells;
        comp.yMax = yMax;
        if (comp.cacheDirty !== undefined) comp.cacheDirty = true;
        kept.push(comp);
      }
      return kept;
    };
    S.stoneComponents = translate(S.stoneComponents);
    S.plantComponents = translate(S.plantComponents);
    S.iceComponents = translate(S.iceComponents);
    // Register components for just the new band (additive; existing translated
    // components are skipped via registerSeededComponents' seen-set guard).
    S.registerSeededComponents(enterColStart, enterColStart + s);
  };

  return { shiftWorld };
}
