import { MAT } from '../src/sand/materials.js';

export const SLIVER_ERASER_TOOL = 11;

const paintRectLayer = (engine, layer, x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDiscLayer(layer, x, y, 0, material, true);
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
    paintRectLayer(engine, layer, 0, floorY, engine.cols - 1,
      engine.rows - 1, MAT.STONE);
    paintRectLayer(engine, layer, left, top, right, bottom,
      layer ? MAT.BRICK : MAT.STONE);
    paintRectLayer(engine, layer, left, bottom + 1, left + 2, floorY - 1,
      MAT.STONE);
    paintRectLayer(engine, layer, right - 2, bottom + 1, right, floorY - 1,
      MAT.STONE);
  }
  paintRectLayer(engine, 0, sourceX, sourceY, sourceX, floorY - 1,
    MAT.STONE);
  engine.paintDiscLayer(0, sourceX, sourceY, 10, MAT.NEUTRONIUM, true);
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

