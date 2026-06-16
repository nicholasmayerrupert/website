// Persistence for the streaming world.
//
// When the sliding window (worldWindow.js) drops a band of columns off one edge,
// that band's current state — materials AND any free rigid bodies sitting in it —
// is saved here, keyed by the band's leftmost WORLD-x. When the window later
// re-exposes those same world columns, the band is restored instead of
// regenerated, so edits (dumped sand, dug holes, dropped cubes) persist across a
// round trip. Untouched-but-visited bands are saved too, but since they match the
// seed a restore and a regenerate look identical.
//
// The store lives for the session (in memory); it resets if the engine is rebuilt
// (e.g. on viewport resize).

export function createChunkStore({ worldRows }) {
  const mats = new Map();      // key -> { width, buf:Uint8Array(width*worldRows) }
  const bodyLists = new Map(); // key -> [{ body, worldPx }]

  // Copy local columns [colStart, colStart+width) of `grid` into the store.
  const saveMaterials = (grid, bufCols, colStart, width, key) => {
    let e = mats.get(key);
    if (!e || e.width !== width) {
      e = { width, buf: new Uint8Array(width * worldRows) };
      mats.set(key, e);
    }
    const buf = e.buf;
    for (let y = 0; y < worldRows; y++) {
      const src = y * bufCols + colStart;
      buf.set(grid.subarray(src, src + width), y * width);
    }
  };

  // Restore a saved band into both buffers at local cols [colStart, ...). Returns
  // false (so the caller generates instead) if nothing is stored for this key.
  const loadMaterials = (grid, next, bufCols, colStart, width, key) => {
    const e = mats.get(key);
    if (!e || e.width !== width) return false;
    const buf = e.buf;
    for (let y = 0; y < worldRows; y++) {
      const dst = y * bufCols + colStart;
      const row = buf.subarray(y * width, (y + 1) * width);
      grid.set(row, dst);
      next.set(row, dst);
    }
    return true;
  };

  const saveBodies = (key, list) => { if (list && list.length) bodyLists.set(key, list); };
  const takeBodies = (key) => {
    const l = bodyLists.get(key);
    if (l) bodyLists.delete(key);
    return l || [];
  };

  return { saveMaterials, loadMaterials, saveBodies, takeBodies };
}
