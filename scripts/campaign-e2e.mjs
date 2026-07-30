// Browser integration for the ship hub and all three planetary deployments.

import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const baseURL = `http://127.0.0.1:${PORT}/game`;
const pngArg = process.argv.indexOf('--png-prefix');
const pngPrefix = pngArg >= 0 ? process.argv[pngArg + 1] : null;
const server = spawn(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  },
);
const killServer = () => {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-server.pid, 'SIGKILL');
    }
  } catch {
    // The dev server is already stopped.
  }
};
const waitForServer = () => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try {
      if ((await fetch(baseURL)).ok) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve();
      }
    } catch {
      // The dev server is still starting.
    }
  }, 300);
});

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const deployments = [
  {
    missionId: 'greenfall-recovery',
    completedMissionIds: [],
    planet: 'earth',
    planetId: 0,
    gravity: 1,
    operation: 'Operation Greenfall',
  },
  {
    missionId: 'silent-quarry',
    completedMissionIds: ['greenfall-recovery'],
    planet: 'moon',
    planetId: 1,
    gravity: 0.33,
    operation: 'Operation Silent Quarry',
  },
  {
    missionId: 'red-furnace',
    completedMissionIds: ['greenfall-recovery', 'silent-quarry'],
    planet: 'mars',
    planetId: 2,
    gravity: 0.76,
    operation: 'Operation Red Furnace',
  },
];

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  console.log('IRIS ship hub');
  await page.goto(baseURL, { waitUntil: 'load' });
  await page.getByText('Field Ship Kestrel').waitFor({ state: 'visible' });
  check('campaign opens aboard Kestrel', await page.getByText('Field Ship Kestrel').isVisible());
  await page.waitForFunction(() => {
    const game = document.querySelector('sand-game')?._game;
    return game?.getPlanetState?.().id === 3 && game?.perfStats?.().creatureCount >= 3;
  }, null, { timeout: 30000 });
  check('Kestrel is a physical ship world with a player and crew',
    await page.locator('sand-game[planet="ship"]').count() === 1 &&
    await page.evaluate(() => document.querySelector('sand-game')._game.perfStats().creatureCount >= 3));
  check('mission console starts closed over the walkable ship',
    await page.locator('#kestrel-mission-console').count() === 0);
  await page.getByRole('button', { name: /Open mission console/i }).click();
  await page.locator('#kestrel-mission-console').waitFor({ state: 'visible' });
  const consoleBounds = await page.locator('#kestrel-mission-console').boundingBox();
  check('mission console stays inside the viewport with deployment always visible',
    !!consoleBounds && consoleBounds.y >= 0 &&
    consoleBounds.y + consoleBounds.height <= 768 &&
    await page.getByRole('button', { name: /Beam down to Earth/i }).isVisible());
  check('Earth, Moon, and Mars are visible on the mission deck',
    await page.getByText('Earth', { exact: true }).count() > 0 &&
    await page.getByText('The Moon', { exact: true }).count() > 0 &&
    await page.getByText('Mars', { exact: true }).count() > 0);
  if (pngPrefix) await page.screenshot({ path: `${pngPrefix}-ship.png`, fullPage: true });

  for (const deployment of deployments) {
    await page.evaluate((save) => {
      localStorage.setItem('sand-campaign-v1', JSON.stringify({
        version: 1,
        completedMissionIds: save.completedMissionIds,
        selectedMissionId: save.missionId,
        preferredLoadouts: {},
        unlockedWeapons: [],
        bestTimes: {},
        interruptedRun: null,
      }));
    }, deployment);
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('button', { name: /Open mission console/i }).click();
    const deployButton = page.getByRole('button', {
      name: new RegExp(`Beam down to ${deployment.planet === 'moon' ? 'The Moon' : deployment.planet}`, 'i'),
    });
    await deployButton.click();
    await page.waitForFunction(() => {
      const host = document.querySelector('sand-game');
      return host?._game?.getMission?.()?.objectives?.length > 0;
    }, null, { timeout: 30000 });

    const result = await page.evaluate(() => {
      const host = document.querySelector('sand-game');
      const mission = host._game.getMission();
      return {
        planetAttribute: host.getAttribute('planet'),
        missionAttribute: host.getAttribute('mission'),
        planetState: host._game.getPlanetState(),
        mission,
        missionHud: host.shadowRoot.querySelector('.sg-mission-hud')?.textContent || '',
        markerCount: host.shadowRoot.querySelectorAll('.sg-mission-marker').length,
        multiplayerCount: host.shadowRoot.querySelectorAll('.mp-wrap').length,
        parallax: !!host.shadowRoot.querySelector('.sand-parallax-bg'),
        inventory: host._game.getInventory(),
      };
    });
    console.log(`\n${deployment.operation}`);
    check('deployment preserves its mission attribute',
      result.missionAttribute === deployment.missionId, result.missionAttribute);
    check('deployment creates the selected planet engine',
      result.planetAttribute === deployment.planet &&
      result.planetState.id === deployment.planetId);
    check('deployment applies the selected gravity',
      Math.abs(result.planetState.gravityScale - deployment.gravity) < 1e-9,
      String(result.planetState.gravityScale));
    check('authority snapshot matches the selected planet',
      result.mission.planetId === deployment.planetId);
    check('mission tracker and objective marker are visible',
      result.missionHud.includes(deployment.operation) && result.markerCount === 1);
    check('campaign loadout and rescue equipment reach the authority inventory',
      result.inventory.slots.some((slot) => slot.itemKind === 10 && slot.count > 0) &&
      result.inventory.slots.some((slot) => slot.itemKind === 0 && slot.count > 0));
    check('campaign deployment uses a planetary backdrop without multiplayer controls',
      result.parallax && result.multiplayerCount === 0);
    if (deployment.planet === 'earth') {
      const panelMutations = await page.evaluate(() => new Promise((resolve) => {
        const panel = document.querySelector('sand-game')?.shadowRoot?.querySelector('.sg-mission-hud');
        let mutations = 0;
        const observer = new MutationObserver((records) => { mutations += records.length; });
        observer.observe(panel, { childList: true, characterData: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(mutations);
        }, 1500);
      }));
      check('idle mission snapshots do not continuously rebuild the status region',
        panelMutations === 0, String(panelMutations));
    }
    if (pngPrefix) {
      await page.screenshot({
        path: `${pngPrefix}-${deployment.planet}.png`,
        fullPage: true,
      });
    }

    await page.getByRole('button', { name: /Abort to Kestrel/i }).click();
    await page.getByText('Field Ship Kestrel').waitFor({ state: 'visible' });
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label') === 'Kestrel mission deck');
    check('returning from deployment restores focus to the mission deck',
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label') === 'Kestrel mission deck'));
  }

  check('ship and deployment flow produces no page exceptions',
    pageErrors.length === 0, pageErrors.join('; '));

  console.log('\nIRIS deployment recovery');
  const recoveryPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await recoveryPage.route('**/sandEngine.wasm', (route) => route.abort());
  await recoveryPage.goto(baseURL, { waitUntil: 'load' });
  await recoveryPage.getByRole('button', { name: /Open mission console/i }).click();
  await recoveryPage.getByRole('button', { name: /Beam down to Earth/i }).click();
  await recoveryPage.getByText('Transporter link failed').waitFor({ state: 'visible' });
  check('WASM initialization failure exposes campaign recovery controls',
    await recoveryPage.getByRole('button', { name: /Retry deployment/i }).isVisible() &&
    await recoveryPage.getByRole('button', { name: /Return to Kestrel/i }).isVisible());
  await recoveryPage.unroute('**/sandEngine.wasm');
  await recoveryPage.getByRole('button', { name: /Retry deployment/i }).click();
  await recoveryPage.waitForFunction(() =>
    document.querySelector('sand-game')?._game?.getMission?.()?.objectives?.length > 0,
  null, { timeout: 30000 });
  check('retry starts a fresh WASM initialization and resumes deployment', true);
  await recoveryPage.close();

  console.log('\nIRIS large-touch mission deck');
  const touchContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(baseURL, { waitUntil: 'load' });
  await touchPage.getByText('Field Ship Kestrel').waitFor({ state: 'visible' });
  check('a coarse pointer does not block the campaign on a large screen',
    await touchPage.evaluate(() => matchMedia('(pointer: coarse)').matches) &&
    await touchPage.getByText('Field Ship Kestrel').isVisible());
  await touchContext.close();
} finally {
  await browser?.close().catch(() => {});
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
