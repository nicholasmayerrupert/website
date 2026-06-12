// Dev-only helper: renders the project card artwork to PNGs for visual review.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ChessArt, GrabbyArt, WildfireArt, LifeArt } from '../src/ProjectArt';

const comps = { chess: ChessArt, grabby: GrabbyArt, wildfire: WildfireArt, life: LifeArt };
const outDir = path.join(__dirname, 'art-preview');
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  for (const [name, C] of Object.entries(comps)) {
    let svg = renderToStaticMarkup(React.createElement(C));
    svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" ');
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `${name}.png`));
    console.log(`rendered ${name}.png`);
  }
}
main();
