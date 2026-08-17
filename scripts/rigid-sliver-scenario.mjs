import { MAT } from '../src/sand/materials.js';

export const SLIVER_ERASER_TOOL = 11;

const layerGrid = (engine, layer) => (
  layer ? engine.getGridBg() : engine.getGrid()
);

// Fixture cells are composed in the raw grids before one component sync.
export const seedStaticRectLayer = (
  engine, layer, x0, y0, x1, y1, material,
) => {
  const grid = layerGrid(engine, layer);
  const left = Math.max(1, x0);
  const right = Math.min(engine.cols - 2, x1);
  const top = Math.max(1, y0);
  const bottom = Math.min(engine.rows - 1, y1);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++)
      grid[y * engine.cols + x] = material;
};

export const seedStaticDiscLayer = (
  engine, layer, cx, cy, radius, material,
) => {
  const grid = layerGrid(engine, layer);
  const left = Math.max(1, cx - radius);
  const right = Math.min(engine.cols - 2, cx + radius);
  const top = Math.max(1, cy - radius);
  const bottom = Math.min(engine.rows - 1, cy + radius);
  const radius2 = radius * radius;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius2)
        grid[y * engine.cols + x] = material;
    }
  }
};

export function buildCrossLayerSliverScene(engine, {
  left,
  right,
  top,
  bottom,
  floorY,
  sourceX,
  sourceY,
  cutSpacing = 10,
  backgroundCutOffset = 0,
} = {}) {
  engine.setBgEnabled(true);
  for (const layer of [0, 1]) {
    seedStaticRectLayer(engine, layer, 0, floorY, engine.cols - 1,
      engine.rows - 1, MAT.STONE);
    seedStaticRectLayer(engine, layer, left, top, right, bottom,
      layer ? MAT.BRICK : MAT.STONE);
    seedStaticRectLayer(engine, layer, left, bottom + 1, left + 2, floorY - 1,
      MAT.STONE);
    seedStaticRectLayer(engine, layer, right - 2, bottom + 1, right, floorY - 1,
      MAT.STONE);
  }
  seedStaticRectLayer(engine, 0, sourceX, sourceY, sourceX, floorY - 1,
    MAT.STONE);
  seedStaticDiscLayer(engine, 0, sourceX, sourceY, 10, MAT.NEUTRONIUM);
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);

  engine.setTool(SLIVER_ERASER_TOOL);
  let nowMs = 1_000;
  const eraseStroke = (layer, x) => {
    const button = layer ? 2 : 0;
    engine.pointerDown(x, top - 4, button);
    engine.applyTool(x, top - 4, nowMs += 25, true, true);
    engine.applyTool(x, bottom + 4, nowMs += 25, true, true);
    engine.pointerUp(button);
    engine.pointerButtons(0);
  };
  let strokes = 0;
  for (let x = left + cutSpacing; x <= right - cutSpacing;
    x += cutSpacing) {
    eraseStroke(0, x);
    eraseStroke(1, x + backgroundCutOffset);
    strokes += 2;
  }
  return { strokes };
}
