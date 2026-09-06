// Explore standable positions using the production player's collision and jumps.
// No jetpack, mining, free-flight flood fill, or alternate physics model is used.
import { INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT_CLASS, MC } from '../src/sand/materials.generated.js';

export function moveWorldWindow(e, x, y) {
  const ox = Math.floor((x - e.cols / 2) / 32) * 32;
  const oy = Math.floor((y - e.rows / 2) / 32) * 32;
  while (e.getWorldOffsetX() !== ox)
    e.shiftWorldXY(Math.max(32 - e.cols, Math.min(e.cols - 32, ox - e.getWorldOffsetX())), 0);
  while (e.getWorldOffsetY() !== oy)
    e.shiftWorldXY(0, Math.max(32 - e.rows, Math.min(e.rows - 32, oy - e.getWorldOffsetY())));
}

export function navigationGraph(e, bounds, start, limit = 4000) {
  const ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY(), grid = e.getGrid();
  const { w, h } = e.getPlayerSize();
  const solid = (x, y) => x < 0 || x >= e.cols || y < 0 || y >= e.rows
    || ![MC.NONE, MC.GAS, MC.LIQUID].includes(MAT_CLASS[grid[y * e.cols + x]]);
  const clear = (x, y) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++)
      if (solid(x + dx, y + dy)) return false;
    return true;
  };
  const nodes = [], lookup = new Map(), queue = [], back = [];
  function add(x, y, from = -1) {
    x = Math.round(x);
    // Grounded includes the engine's sub-cell landing tolerance. Canonicalize
    // to the supporting row instead of rejecting a player just above the floor.
    y = [Math.round(y), Math.ceil(y)].find(py => clear(x, py)
      && Array.from({ length: w }, (_, dx) => solid(x + dx, py + h)).some(Boolean));
    if (y === undefined || x + ox < bounds.left || x + ox + w > bounds.right
      || y + oy < bounds.top || y + oy + h > bounds.bottom) return -1;
    const key = y * e.cols + x;
    let index = lookup.get(key);
    if (index === undefined) {
      index = nodes.length;
      lookup.set(key, index); nodes.push({ x: x + ox, y: y + oy, feet: y + oy + h });
      back.push([]); queue.push(index);
    }
    if (from >= 0 && from !== index) back[index].push(from);
    return index;
  }
  const id = e.spawnPlayer(start[0] - ox, start[1] - oy - h);
  let root = -1;
  // Settle onto the real starting floor; spawn never carves a doorway for us.
  e.setPlayerState(id, { x: start[0] - ox, y: start[1] - oy - h, jetpackFuel: 0 });
  e.setPlayerInput(id, { bits: 0 });
  for (let t = 0; t < 90; t++) {
    e.stepPlayerOnly(id);
    const p = e.getPlayer(id);
    if (p.grounded) { root = add(p.x, p.y); if (root >= 0) break; }
  }
  const actions = [];
  for (const dir of [-1, 1]) for (const travel of [8, 16, 28]) actions.push([dir, false, travel]);
  for (const dir of [-1, 1]) for (const travel of [8, 16, 28, 52]) actions.push([dir, true, travel]);
  actions.push([0, true, 0]);
  // Rising inside a well before moving sideways avoids its overhead floor.
  for (const dir of [-1, 1]) for (const delay of [8, 16]) for (const travel of [8, 16])
    actions.push([dir, true, travel, delay]);
  const ticks = Math.ceil(70 / e.getGravityScale());
  for (let at = 0; at < queue.length && nodes.length < limit; at++) {
    const from = queue[at], node = nodes[from];
    for (const [dir, jump, travel, delay = 0] of actions) {
      e.setPlayerState(id, { x: node.x - ox, y: node.y - oy, vx: 0, vy: 0,
        grounded: true, jumpReady: true, jetpackFuel: 0 });
      for (let t = 0; t < ticks; t++) {
        const moving = t >= delay && t < delay + travel;
        e.setPlayerInput(id, { bits: (moving ? (dir < 0 ? INPUT.LEFT : INPUT.RIGHT) : 0)
          | (jump && t === 0 ? INPUT.JUMP : 0) });
        e.stepPlayerOnly(id);
        const p = e.getPlayer(id);
        if (!p?.alive) break;
        if (p.grounded && (!jump || t > 3)) {
          add(p.x, p.y, from);
          if (jump || t >= travel) break;
        }
      }
    }
  }
  // Returning to the entrance means the same small standing area, rather than
  // requiring a jump to land on precisely one sub-cell coordinate.
  const returns = new Set();
  if (root >= 0) {
    const q = [];
    for (let i = 0; i < nodes.length; i++) {
      if (Math.abs(nodes[i].x - nodes[root].x) <= 6
        && Math.abs(nodes[i].feet - nodes[root].feet) <= 3) { q.push(i); returns.add(i); }
    }
    for (let at = 0; at < q.length; at++) for (const prev of back[q[at]]) {
      if (!returns.has(prev)) { returns.add(prev); q.push(prev); }
    }
  }
  e.removePlayer(id);
  return { nodes, returns, root, truncated: nodes.length >= limit,
    reaches: (x, feet, radius = 7) => nodes.some((p, i) => returns.has(i)
      && Math.abs(p.x + w / 2 - x) <= radius && Math.abs(p.feet - feet) <= 3) };
}

// Find an actual standing position near an entrance without clearing any cells.
export function entranceStart(e, x, nominalFeet) {
  const ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY();
  const grid = e.getGrid(), { w, h } = e.getPlayerSize();
  const blocks = (wx, wy) => ![MC.NONE, MC.GAS, MC.LIQUID].includes(
    MAT_CLASS[grid[(wy - oy) * e.cols + wx - ox]]);
  for (let feet = nominalFeet - 16; feet <= nominalFeet + 28; feet++) {
    let clear = true, support = false;
    for (let dx = 0; dx < w; dx++) {
      support ||= blocks(x + dx, feet);
      for (let dy = 1; dy <= h; dy++) clear &&= !blocks(x + dx, feet - dy);
    }
    if (clear && support) return [x, feet];
  }
  return [x, nominalFeet];
}

export function indoorPlatforms(e, bounds, accepts) {
  const ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY();
  const grid = e.getGrid(), { w, h } = e.getPlayerSize();
  const blocks = (x, y) => ![MC.NONE, MC.GAS, MC.LIQUID].includes(
    MAT_CLASS[grid[(y - oy) * e.cols + x - ox]]);
  const platforms = [];
  for (let feet = bounds.top + h; feet < bounds.bottom; feet++) {
    let first = null;
    const flush = end => {
      if (first !== null && end - first >= 8) platforms.push({ left: first, right: end - 1, feet });
      first = null;
    };
    for (let x = bounds.left + 2; x < bounds.right - w; x++) {
      let standing = true;
      for (let dx = 0; dx < w; dx++) {
        standing &&= blocks(x + dx, feet);
        for (let dy = 1; dy <= h; dy++) standing &&= !blocks(x + dx, feet - dy);
      }
      if (standing && accepts(e.worldContextAt(x + w / 2, feet - h / 2))) first ??= x;
      else flush(x);
    }
    flush(bounds.right - w);
  }
  return platforms;
}

export function reachesPlatform(graph, platform) {
  return graph.nodes.some((p, i) => graph.returns.has(i)
    && p.x >= platform.left - 3 && p.x <= platform.right + 3
    && Math.abs(p.feet - platform.feet) <= 2);
}
