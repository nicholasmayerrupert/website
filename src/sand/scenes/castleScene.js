import { MAT } from '../engine.js';

export const castleEmitters = [
  { material: MAT.SAND, rateMs: 120, pos: { x: 0.12, y: 0.14 }, r: 2 },
  { material: MAT.WATER, rateMs: 90, pos: { x: 0.88, y: 0.14 }, r: 2 },
];

export function buildCastleScene({ cols, rows, MAT, rand, rect }) {
  const crenels = (x0, x1, y) => {
    for (let x = x0; x <= x1; x += 4) rect(x, y, 2, 2, MAT.STONE);
  };
  const triangleRoof = (cx, baseY, halfW, h) => {
    for (let dy = 0; dy < h; dy++) {
      const span = Math.max(1, Math.floor(halfW * (h - dy) / h));
      rect(cx - span, baseY - dy, span * 2 + 1, 1, MAT.WOOD);
    }
  };

  const groundTop = Math.max(18, rows - Math.max(5, Math.floor(rows * 0.16)));
  for (let y = groundTop; y < rows - 1; y++) {
    const t = (y - groundTop) / Math.max(1, rows - groundTop - 2);
    for (let x = 1; x < cols - 1; x++) {
      if (rand() < 0.62 + t * 0.25) rect(x, y, 1, 1, MAT.SAND);
    }
  }

  const moatY = Math.min(rows - 3, groundTop + 1);
  const moatH = Math.max(2, Math.floor(rows * 0.06));
  rect(1, moatY, cols - 2, moatH, MAT.WATER);

  const center = Math.floor(cols / 2);
  const wallW = Math.max(24, Math.min(Math.floor(cols * 0.50), cols - 12));
  const wallH = Math.max(7, Math.min(Math.floor(rows * 0.22), rows - 14));
  const wallX = Math.max(4, center - Math.floor(wallW / 2));
  const wallY = Math.max(6, groundTop - wallH);
  const towerW = Math.max(6, Math.floor(wallW * 0.16));
  const towerH = wallH + Math.max(4, Math.floor(rows * 0.10));
  const towerY = Math.max(3, groundTop - towerH);
  const leftTowerX = Math.max(2, wallX - Math.floor(towerW * 0.55));
  const rightTowerX = Math.min(cols - towerW - 2, wallX + wallW - Math.floor(towerW * 0.45));

  rect(wallX, wallY, wallW, wallH, MAT.STONE);
  crenels(wallX + 1, wallX + wallW - 3, wallY - 2);
  rect(leftTowerX, towerY, towerW, towerH, MAT.STONE);
  rect(rightTowerX, towerY, towerW, towerH, MAT.STONE);
  crenels(leftTowerX, leftTowerX + towerW - 2, towerY - 2);
  crenels(rightTowerX, rightTowerX + towerW - 2, towerY - 2);

  const keepW = Math.max(10, Math.floor(wallW * 0.26));
  const keepH = Math.max(10, Math.floor(rows * 0.26));
  const keepX = center - Math.floor(keepW / 2);
  const keepY = Math.max(3, wallY - keepH + 3);
  rect(keepX, keepY, keepW, keepH, MAT.STONE);
  crenels(keepX + 1, keepX + keepW - 3, keepY - 2);
  triangleRoof(center, keepY - 2, Math.floor(keepW * 0.72), Math.max(4, Math.floor(rows * 0.07)));

  const doorW = Math.max(4, Math.floor(wallW * 0.12));
  const doorH = Math.max(5, Math.floor(wallH * 0.58));
  const doorX = center - Math.floor(doorW / 2);
  const doorY = groundTop - doorH - 1;
  rect(doorX, doorY, doorW, doorH, MAT.WOOD);
  rect(doorX + 1, doorY, Math.max(1, doorW - 2), 1, MAT.EMPTY);

  const bridgeY = moatY;
  rect(doorX - 2, bridgeY, doorW + 4, moatH, MAT.WOOD);
  for (let x = doorX - 2; x <= doorX + doorW + 1; x += 3) rect(x, bridgeY, 1, moatH, MAT.SAND);

  const windowW = 2;
  const windowH = Math.max(2, Math.floor(rows * 0.045));
  for (const x of [leftTowerX + Math.floor(towerW / 2) - 1, rightTowerX + Math.floor(towerW / 2) - 1]) {
    rect(x, towerY + Math.floor(towerH * 0.26), windowW, windowH, MAT.WATER);
    rect(x, towerY + Math.floor(towerH * 0.58), windowW, windowH, MAT.WATER);
  }
  for (const x of [keepX + 2, keepX + keepW - 4]) {
    rect(x, keepY + Math.floor(keepH * 0.35), windowW, windowH, MAT.WATER);
  }
  rect(center - 1, keepY + Math.floor(keepH * 0.18), 2, windowH, MAT.FIRE);

  const flagY = Math.max(1, keepY - Math.max(8, Math.floor(rows * 0.12)));
  rect(center, flagY, 1, keepY - flagY, MAT.WOOD);
  rect(center + 1, flagY, Math.max(4, Math.floor(wallW * 0.10)), 3, MAT.PLANT);
  rect(center + Math.max(4, Math.floor(wallW * 0.10)), flagY + 2, 2, 1, MAT.PLANT);

  const groveY = Math.max(3, groundTop - Math.floor(rows * 0.22));
  for (const treeX of [Math.floor(cols * 0.13), Math.floor(cols * 0.20), Math.floor(cols * 0.82), Math.floor(cols * 0.89)]) {
    rect(treeX, groveY + 4, 2, groundTop - groveY - 3, MAT.WOOD);
    rect(treeX - 3, groveY, 8, 5, MAT.PLANT);
    rect(treeX - 2, groveY - 2, 6, 4, MAT.PLANT);
  }
}
