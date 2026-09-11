// Export the actual source pixels at integer scale, repeated across tile seams.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import art from '../src/sand/content/materialArt.js';

const directory = resolve('.sand-artifacts/material-art');
mkdirSync(directory, { recursive: true });
const html = `<!doctype html><html><meta charset="utf-8"><title>Material studies</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#191d23;color:#e2ded1;font:13px system-ui;padding:32px}
h1{font:32px Georgia;margin:0 0 10px}header p{color:#9da9ad;max-width:850px;line-height:1.5;margin-bottom:26px}
.sheet{display:grid;grid-template-columns:repeat(7,160px);gap:16px;width:max-content;margin-bottom:28px}
article{width:160px}canvas{display:block;width:160px;height:160px;image-rendering:pixelated;border:0}
h2{font-size:11px;letter-spacing:.05em;text-transform:uppercase;margin:10px 0 7px}
.palette{display:flex;height:6px;margin-bottom:8px}.palette i{flex:1}
article p{color:#9da9ad;font-size:10px;line-height:1.4;margin:0;min-height:43px}
</style><header><h1>Material studies / continuous surfaces</h1><p>70 hand-authored 32 × 32 tiles. Each swatch repeats the source 2½ times at 2× pixel scale, revealing horizontal and vertical joins. Upper-left light, restrained highlights, deliberate clusters. Runtime adds terrain lighting, optical transparency, and procedural liquid currents and surface highlights.</p></header>
<main></main><script>
const art=${JSON.stringify(art)};
const entries=Object.entries(art), main=document.querySelector('main');
for(let start=0;start<entries.length;start+=35){
 const sheet=document.createElement('section');sheet.className='sheet';main.append(sheet);
 for(const [name,tile] of entries.slice(start,start+35)){
  const card=document.createElement('article'),canvas=document.createElement('canvas');canvas.width=canvas.height=80;
  const ctx=canvas.getContext('2d');for(let y=0;y<80;y++)for(let x=0;x<80;x++){ctx.fillStyle=tile.palette[Number(tile.rows[y%32][x%32])];ctx.fillRect(x,y,1,1)}
  const title=document.createElement('h2');title.textContent=name.replaceAll('_',' ');
  const palette=document.createElement('div');palette.className='palette';for(const color of tile.palette){const swatch=document.createElement('i');swatch.style.background=color;palette.append(swatch)}
  const note=document.createElement('p');note.textContent=tile.note;card.append(canvas,title,palette,note);sheet.append(card);
 }
}
</script></html>`;
writeFileSync(resolve(directory, 'index.html'), html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1500 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const sheets = await page.locator('.sheet').all();
  for (let i = 0; i < sheets.length; i++) await sheets[i].screenshot({ path: resolve(directory, `materials-${i + 1}.png`) });
} finally { await browser.close(); }
console.log(directory);
