import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';
import { GAME_SCENES } from '../src/sand/content/catalog.js';

const args = process.argv.slice(2);
const scene = args.find(a => !a.startsWith('--')) || 'hearth';
if (args.includes('--list')) {
  for (const s of GAME_SCENES) console.log(`${s.id.padEnd(16)} ${s.name}`);
  process.exit(0);
}
if (!GAME_SCENES.some(s => s.id === scene)) throw new Error(`Unknown scene: ${scene}. Use --list.`);
const show = args.includes('--open');
const artifactDir = resolve('.sand-artifacts/scenes', scene);
mkdirSync(artifactDir, { recursive: true });
const server = await startTestServer();
let browser;
try {
  browser = await chromium.launch({ headless: !show });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.baseURL}/game?studio=${encodeURIComponent(scene)}${show ? '' : '&capture'}`);
  await page.waitForFunction(() => window.__gameStudio?.inspect().player, null, { timeout: 60000 });
  await page.evaluate(id => window.__gameStudio.load(id), scene);
  await page.waitForTimeout(750);
  const state = await page.evaluate(() => window.__gameStudio.inspect());
  await page.screenshot({ path: resolve(artifactDir, 'scene.png') });
  writeFileSync(resolve(artifactDir, 'state.json'), JSON.stringify({ ...state, errors }, null, 2));
  console.log(`${scene}: ${state.player.worldX.toFixed(1)}, ${state.player.worldY.toFixed(1)} · ${state.perf.workerStatus} authority · content ${state.contentHash}`);
  console.log(artifactDir);
  if (errors.length) throw new Error(errors.join('\n'));
  if (show) {
    console.log('Close the browser to end the workbench.');
    await new Promise(resolve => browser.on('disconnected', resolve));
  }
} finally { await browser?.close(); server.close(); }
