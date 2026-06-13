import { MAT } from '../engine.js';

// Emitters: continuous material sources. pos is fractional (0..1) of the grid.
export const castleEmitters = [
  { material: MAT.SAND, rateMs: 120, pos: { x: 0.12, y: 0.14 }, r: 2 },
  { material: MAT.WATER, rateMs: 90, pos: { x: 0.88, y: 0.14 }, r: 2 },
];

// A scene seeds the initial world. The engine calls this once at startup with:
//   cols, rows            grid dimensions
//   rand()                float in [0, 1)
//   MAT                   material id enum
//   put(x, y, material)             set a single cell      (available, unused here)
//   rect(x0, y0, w, h, material)    fill a rectangle
// Stone/plant components are registered automatically afterward, so just place
// materials. To add a new scene, copy this file and wire it in src/About.jsx.
// See AGENTS.md > "Creating or changing a scene".
export function buildCastleScene({ cols, rows, MAT, rand, rect }) {
  const dot = (x, y, material) => rect(x, y, 1, 1, material);
  const line = (x0, y0, x1, y1, material) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      dot(
        Math.round(x0 + (x1 - x0) * t),
        Math.round(y0 + (y1 - y0) * t),
        material
      );
    }
  };
  const crenels = (x0, x1, y) => {
    for (let x = x0; x <= x1; x += 4) rect(x, y, 2, 2, MAT.STONE);
  };
  const triangleRoof = (cx, baseY, halfW, h) => {
    for (let dy = 0; dy < h; dy++) {
      const span = Math.max(1, Math.floor(halfW * (h - dy) / h));
      rect(cx - span, baseY - dy, span * 2 + 1, 1, MAT.WOOD);
    }
  };
  const arch = (cx, baseY, halfW, h, material) => {
    for (let y = 0; y < h; y++) {
      const topT = y / Math.max(1, h - 1);
      const inset = Math.floor((1 - Math.sin(topT * Math.PI * 0.5)) * halfW);
      rect(cx - halfW + inset, baseY - h + y, (halfW - inset) * 2 + 1, 1, material);
    }
  };
  const tree = (x, baseY, h, canopyW) => {
    const trunkW = Math.max(1, Math.floor(canopyW * 0.18));
    rect(x, baseY - h, trunkW, h, MAT.WOOD);
    line(x, baseY - Math.floor(h * 0.50), x - Math.floor(canopyW * 0.34), baseY - Math.floor(h * 0.70), MAT.WOOD);
    line(x + trunkW - 1, baseY - Math.floor(h * 0.58), x + Math.floor(canopyW * 0.34), baseY - Math.floor(h * 0.78), MAT.WOOD);
    line(x, baseY, x - Math.floor(canopyW * 0.26), baseY + 1, MAT.WOOD);
    line(x + trunkW - 1, baseY, x + Math.floor(canopyW * 0.26), baseY + 1, MAT.WOOD);
    const blobs = [
      [-0.32, -0.62, 0.58, 0.26],
      [0.18, -0.70, 0.54, 0.28],
      [-0.06, -0.88, 0.48, 0.24],
      [-0.46, -0.80, 0.34, 0.20],
      [0.42, -0.88, 0.32, 0.20],
    ];
    for (const [ox, oy, ww, hh] of blobs) {
      rect(
        x + Math.floor(canopyW * ox),
        baseY + Math.floor(h * oy),
        Math.max(3, Math.floor(canopyW * ww)),
        Math.max(2, Math.floor(h * hh)),
        MAT.PLANT
      );
    }
    for (let i = 0; i < Math.max(3, Math.floor(canopyW * 0.45)); i++) {
      const leafX = x - Math.floor(canopyW * 0.48) + Math.floor(rand() * canopyW);
      const leafY = baseY - h - Math.floor(h * (0.58 + rand() * 0.42));
      dot(leafX, leafY, rand() < 0.12 ? MAT.FIRE : MAT.PLANT);
    }
  };
  const cypress = (x, baseY, h) => {
    rect(x, baseY - h, 1, h, MAT.WOOD);
    for (let dy = 0; dy < h; dy += 3) {
      const t = dy / Math.max(1, h - 1);
      const half = Math.max(1, Math.floor((1 - t) * h * 0.16));
      rect(x - half, baseY - dy - 2, half * 2 + 1, 2, MAT.PLANT);
    }
  };
  const tower = (x, y, w, h, roofH) => {
    rect(x, y, w, h, MAT.STONE);
    rect(x + 1, y + 1, Math.max(1, w - 2), 1, MAT.SAND);
    for (let yy = y + 4; yy < y + h - 2; yy += 6) {
      rect(x + Math.floor(w / 2) - 1, yy, 2, 3, MAT.WATER);
    }
    for (let yy = y + 5; yy < y + h - 2; yy += 8) {
      dot(x + 1, yy, MAT.SAND);
      dot(x + w - 2, yy + 1, MAT.SAND);
    }
    crenels(x, x + w - 2, y - 2);
    triangleRoof(x + Math.floor(w / 2), y - 2, Math.floor(w * 0.76), roofH);
  };

  const groundTop = Math.max(18, rows - Math.max(5, Math.floor(rows * 0.16)));
  const hillTop = Math.max(8, groundTop - Math.floor(rows * 0.12));
  for (let y = groundTop; y < rows - 1; y++) {
    const t = (y - groundTop) / Math.max(1, rows - groundTop - 2);
    for (let x = 1; x < cols - 1; x++) {
      if (rand() < 0.62 + t * 0.25) rect(x, y, 1, 1, MAT.SAND);
    }
  }
  for (let x = 1; x < cols - 1; x++) {
    const ridge =
      groundTop -
      Math.floor(Math.sin((x / cols) * Math.PI) * rows * 0.10) -
      Math.floor(Math.sin((x / cols) * Math.PI * 3.1) * rows * 0.025);
    for (let y = Math.max(hillTop, ridge); y < groundTop; y++) {
      if (rand() < 0.42 + ((y - ridge) / Math.max(1, groundTop - ridge)) * 0.42) {
        dot(x, y, rand() < 0.22 ? MAT.PLANT : MAT.SAND);
      }
    }
  }

  const moatY = Math.min(rows - 3, groundTop + 1);
  const moatH = Math.max(2, Math.floor(rows * 0.06));
  rect(1, moatY, cols - 2, moatH, MAT.WATER);
  rect(1, moatY - 1, cols - 2, 1, MAT.SAND);
  rect(1, moatY + moatH, cols - 2, 1, MAT.SAND);

  const center = Math.floor(cols / 2);
  const wallW = Math.max(34, Math.min(Math.floor(cols * 0.62), cols - 12));
  const wallH = Math.max(7, Math.min(Math.floor(rows * 0.22), rows - 14));
  const wallX = Math.max(4, center - Math.floor(wallW / 2));
  const wallY = Math.max(6, groundTop - wallH);
  const towerW = Math.max(7, Math.floor(wallW * 0.14));
  const towerH = wallH + Math.max(5, Math.floor(rows * 0.12));
  const towerY = Math.max(3, groundTop - towerH);
  const leftTowerX = Math.max(2, wallX - Math.floor(towerW * 0.55));
  const rightTowerX = Math.min(cols - towerW - 2, wallX + wallW - Math.floor(towerW * 0.45));

  rect(wallX, wallY, wallW, wallH, MAT.STONE);
  rect(wallX + 2, wallY + 2, wallW - 4, 1, MAT.SAND);
  rect(wallX + 2, wallY + wallH - 4, wallW - 4, 1, MAT.SAND);
  for (let x = wallX + 2; x < wallX + wallW - 2; x += 4) {
    rect(x, wallY + 3, 1, wallH - 5, MAT.STONE);
    dot(x + 1, wallY + Math.floor(wallH * 0.44), MAT.SAND);
    if (rand() < 0.5) dot(x, wallY + Math.floor(wallH * 0.68), MAT.FIRE);
  }
  for (let x = wallX + 5; x < wallX + wallW - 4; x += 10) {
    arch(x, wallY + wallH - 1, 2, Math.max(4, Math.floor(wallH * 0.45)), MAT.WOOD);
  }
  crenels(wallX + 1, wallX + wallW - 3, wallY - 2);
  tower(leftTowerX, towerY, towerW, towerH, Math.max(4, Math.floor(rows * 0.055)));
  tower(rightTowerX, towerY, towerW, towerH, Math.max(4, Math.floor(rows * 0.055)));

  const midTowerW = Math.max(5, Math.floor(towerW * 0.72));
  const midTowerH = Math.max(8, Math.floor(towerH * 0.62));
  tower(wallX + Math.floor(wallW * 0.23), wallY - Math.floor(midTowerH * 0.32), midTowerW, midTowerH, Math.max(3, Math.floor(rows * 0.04)));
  tower(wallX + Math.floor(wallW * 0.70), wallY - Math.floor(midTowerH * 0.32), midTowerW, midTowerH, Math.max(3, Math.floor(rows * 0.04)));

  const keepW = Math.max(13, Math.floor(wallW * 0.30));
  const keepH = Math.max(13, Math.floor(rows * 0.30));
  const keepX = center - Math.floor(keepW / 2);
  const keepY = Math.max(3, wallY - keepH + 3);
  rect(keepX, keepY, keepW, keepH, MAT.STONE);
  rect(keepX + 1, keepY + 1, Math.max(1, keepW - 2), 1, MAT.SAND);
  rect(keepX + 1, keepY + Math.floor(keepH * 0.54), Math.max(1, keepW - 2), 1, MAT.SAND);
  rect(keepX + 2, keepY + Math.floor(keepH * 0.27), Math.max(1, keepW - 4), 1, MAT.SAND);
  rect(keepX + Math.floor(keepW * 0.22), keepY + 2, 1, keepH - 4, MAT.STONE);
  rect(keepX + Math.floor(keepW * 0.78), keepY + 2, 1, keepH - 4, MAT.STONE);
  crenels(keepX + 1, keepX + keepW - 3, keepY - 2);
  triangleRoof(center, keepY - 2, Math.floor(keepW * 0.78), Math.max(5, Math.floor(rows * 0.085)));

  const upperW = Math.max(7, Math.floor(keepW * 0.48));
  const upperH = Math.max(7, Math.floor(keepH * 0.44));
  const upperX = center - Math.floor(upperW / 2);
  const upperY = Math.max(2, keepY - upperH + 4);
  rect(upperX, upperY, upperW, upperH, MAT.STONE);
  rect(upperX + 1, upperY + Math.floor(upperH * 0.45), Math.max(1, upperW - 2), 1, MAT.SAND);
  crenels(upperX + 1, upperX + upperW - 3, upperY - 2);
  triangleRoof(center, upperY - 2, Math.floor(upperW * 0.80), Math.max(4, Math.floor(rows * 0.06)));

  const spireH = Math.max(7, Math.floor(rows * 0.12));
  for (const spireX of [upperX - 3, center, upperX + upperW + 2]) {
    rect(spireX, upperY - spireH + 2, 2, spireH, MAT.STONE);
    triangleRoof(spireX + 1, upperY - spireH + 1, 3, Math.max(4, Math.floor(rows * 0.045)));
    dot(spireX + 1, upperY - Math.floor(spireH * 0.52), MAT.FIRE);
  }

  for (const buttressX of [keepX - 2, keepX + keepW + 1, wallX + 2, wallX + wallW - 3]) {
    line(buttressX, groundTop - 1, buttressX + (buttressX < center ? 3 : -3), wallY + 2, MAT.STONE);
    line(buttressX + (buttressX < center ? 1 : -1), groundTop - 1, buttressX + (buttressX < center ? 4 : -4), wallY + 2, MAT.STONE);
  }

  const doorW = Math.max(4, Math.floor(wallW * 0.12));
  const doorH = Math.max(5, Math.floor(wallH * 0.58));
  const doorX = center - Math.floor(doorW / 2);
  const doorY = groundTop - doorH - 1;
  arch(center, groundTop - 1, Math.floor(doorW / 2), doorH, MAT.WOOD);
  rect(doorX + 1, doorY + 2, Math.max(1, doorW - 2), 1, MAT.SAND);
  dot(doorX + 1, doorY + Math.floor(doorH * 0.55), MAT.FIRE);
  dot(doorX + doorW - 2, doorY + Math.floor(doorH * 0.55), MAT.FIRE);

  const bridgeY = moatY;
  rect(doorX - 2, bridgeY, doorW + 4, moatH, MAT.WOOD);
  for (let x = doorX - 2; x <= doorX + doorW + 1; x += 3) rect(x, bridgeY, 1, moatH, MAT.SAND);
  line(doorX - 2, bridgeY - 1, wallX + 2, wallY + wallH - 2, MAT.WOOD);
  line(doorX + doorW + 1, bridgeY - 1, wallX + wallW - 3, wallY + wallH - 2, MAT.WOOD);

  const windowW = 2;
  const windowH = Math.max(2, Math.floor(rows * 0.045));
  for (const x of [keepX + 2, keepX + keepW - 4]) {
    rect(x, keepY + Math.floor(keepH * 0.35), windowW, windowH, MAT.WATER);
    rect(x, keepY + Math.floor(keepH * 0.68), windowW, windowH, MAT.FIRE);
  }
  rect(center - 1, keepY + Math.floor(keepH * 0.18), 2, windowH, MAT.FIRE);
  rect(center - 1, upperY + Math.floor(upperH * 0.32), 2, windowH, MAT.WATER);
  for (let x = upperX + 2; x < upperX + upperW - 2; x += 4) {
    dot(x, upperY + Math.floor(upperH * 0.70), MAT.FIRE);
  }

  const flagY = Math.max(1, keepY - Math.max(8, Math.floor(rows * 0.12)));
  rect(center, flagY, 1, keepY - flagY, MAT.WOOD);
  rect(center + 1, flagY, Math.max(4, Math.floor(wallW * 0.10)), 3, MAT.PLANT);
  rect(center + Math.max(4, Math.floor(wallW * 0.10)), flagY + 2, 2, 1, MAT.PLANT);

  for (let i = 0; i < 18; i++) {
    const x = Math.floor(cols * (0.08 + rand() * 0.84));
    if (x > wallX - 4 && x < wallX + wallW + 4) continue;
    const y = moatY - 2 - Math.floor(rand() * Math.max(2, rows * 0.04));
    dot(x, y, rand() < 0.7 ? MAT.PLANT : MAT.FIRE);
  }

  for (const treeX of [Math.floor(cols * 0.08), Math.floor(cols * 0.15), Math.floor(cols * 0.23), Math.floor(cols * 0.77), Math.floor(cols * 0.85), Math.floor(cols * 0.93)]) {
    tree(
      treeX,
      groundTop - 1 - Math.floor(rand() * Math.max(2, rows * 0.04)),
      Math.max(5, Math.floor(rows * (0.13 + rand() * 0.05))),
      Math.max(6, Math.floor(cols * 0.055))
    );
  }
  for (const treeX of [Math.floor(cols * 0.04), Math.floor(cols * 0.30), Math.floor(cols * 0.70), Math.floor(cols * 0.97)]) {
    cypress(
      treeX,
      groundTop - 1 - Math.floor(rand() * Math.max(2, rows * 0.03)),
      Math.max(7, Math.floor(rows * (0.17 + rand() * 0.06)))
    );
  }

  for (let x = wallX + 3; x < wallX + wallW - 3; x += 6) {
    dot(x, wallY - 4, MAT.FIRE);
    rect(x, wallY - 3, 1, 2, MAT.WOOD);
  }
}
