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

async function openCommanderDialogue(page) {
  const talk = page.locator('sand-game')
    .locator('button[aria-label="Talk to Commander Vale"]');
  await page.waitForFunction(() =>
    !!document.querySelector('sand-game')?.shadowRoot?.querySelector('.sg-sim'));
  await page.waitForFunction(() => {
    const game = document.querySelector('sand-game')?._game;
    const view = game?.getMissionView?.();
    return game?.getTalkableActors?.().some(({ species }) => species === 17) &&
      Number.isFinite(view?.playerWorldX);
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const game = document.querySelector('sand-game')._game;
    const commander = game.getTalkableActors().find(({ species }) => species === 17);
    const player = window.__sandTest.getPlayer();
    const offset = window.__sandTest.worldOffset();
    window.__sandTest.setPlayerState({
      x: commander.worldX + 8 - offset.x - player.w * 0.5,
      y: commander.worldY - offset.y - player.h * 0.5,
      vx: 0,
      vy: 0,
    });
  });
  await talk.waitFor({ state: 'visible', timeout: 10000 });
  await talk.evaluate((button) => button.click());
}

async function openMissionConsole(page) {
  await page.locator('sand-game').evaluate((host) => {
    host.dispatchEvent(new CustomEvent('sand:talkaction', {
      detail: { action: 'mission-console' },
      bubbles: true,
      composed: true,
    }));
  });
  await page.locator('#kestrel-mission-console').waitFor({ state: 'visible' });
}

async function waitForShipGameFocus(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector('sand-game[planet="ship"]');
    const surface = host?.shadowRoot?.querySelector('.sg-sim');
    return !!surface && host.shadowRoot.activeElement === surface;
  }, null, { timeout: 30000 });
}

async function movementInputState(page) {
  await page.keyboard.down('a');
  try {
    return await page.evaluate(() => {
      const host = document.querySelector('sand-game[planet="ship"]');
      const surface = host?.shadowRoot?.querySelector('.sg-sim');
      return {
        focused: !!surface && host.shadowRoot.activeElement === surface,
        bits: window.__sandTest?.localInput?.().bits ?? 0,
      };
    });
  } finally {
    await page.keyboard.up('a');
  }
}

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
  await openCommanderDialogue(page);
  await page.waitForTimeout(300);
  const conversationState = await page.evaluate(() => {
    const host = document.querySelector('sand-game');
    const root = host?.shadowRoot;
    const game = host?._game;
    const view = game?.getMissionView?.();
    const commander = game?.getTalkableActors?.()
      .find(({ species }) => species === 17);
    const dialogue = root?.querySelector('.sg-dialogue');
    return {
      visible: !!dialogue && !dialogue.hidden,
      playerWorldX: view?.playerWorldX,
      playerWorldY: view?.playerWorldY,
      commanderWorldX: commander?.worldX,
      commanderWorldY: commander?.worldY,
      distance: commander && view
        ? Math.hypot(
          commander.worldX - view.playerWorldX,
          commander.worldY - view.playerWorldY,
        )
        : null,
    };
  });
  check('NPC conversation remains open while the player stays in talk range',
    conversationState.visible && conversationState.distance <= 28,
    JSON.stringify(conversationState));
  await page.locator('sand-game')
    .locator('button', { hasText: 'End conversation' })
    .click();
  const dialogueFocus = await page.evaluate(() => {
    const root = document.querySelector('sand-game')?.shadowRoot;
    return root?.activeElement === root?.querySelector('.sg-sim');
  });
  await page.keyboard.down('a');
  const dialogueMovementBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  await page.keyboard.up('a');
  check('ending an NPC conversation restores keyboard movement',
    dialogueFocus && (dialogueMovementBits & 1) !== 0,
    `focus ${dialogueFocus}, bits ${dialogueMovementBits}`);
  await page.reload({ waitUntil: 'load' });
  await page.setViewportSize({ width: 768, height: 384 });
  await openMissionConsole(page);
  const consoleBounds = await page.locator('#kestrel-mission-console').boundingBox();
  const consoleHeaderBounds = await page.locator('#kestrel-mission-console header').boundingBox();
  const consoleScrollBounds = await page.locator('[data-mission-console-scroll]').boundingBox();
  const deployBounds = await page.getByRole('button', { name: /Beam down to Earth/i }).boundingBox();
  const closeBounds = await page.getByRole('button', { name: 'Close mission console' }).boundingBox();
  const consoleScale = await page.locator('[data-mission-console-viewport]')
    .evaluate((node) => Number(node.dataset.viewportScale));
  check('high-zoom mission console shrinks entirely inside the viewport',
    !!consoleBounds && consoleBounds.y >= 0 &&
    consoleBounds.y + consoleBounds.height <= 384 &&
    !!consoleHeaderBounds && consoleHeaderBounds.y >= 0 &&
    consoleHeaderBounds.y + consoleHeaderBounds.height <= 384 &&
    !!consoleScrollBounds && consoleScrollBounds.height > 0 &&
    consoleScrollBounds.y + consoleScrollBounds.height <= 384 &&
    !!deployBounds && deployBounds.y >= 0 && deployBounds.y + deployBounds.height <= 384 &&
    !!closeBounds && closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= 384 &&
    consoleScale > 0 && consoleScale < 1,
    JSON.stringify({
      consoleBounds,
      consoleHeaderBounds,
      consoleScrollBounds,
      deployBounds,
      closeBounds,
      consoleScale,
    }));
  check('Earth, Moon, and Mars are visible on the mission deck',
    await page.getByText('Earth', { exact: true }).count() > 0 &&
    await page.getByText('The Moon', { exact: true }).count() > 0 &&
    await page.getByText('Mars', { exact: true }).count() > 0);
  await page.setViewportSize({ width: 784, height: 1015 });
  const zoomedConsoleLayout = await page.locator('[data-mission-console-scroll]')
    .evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const weaponBounds = document.querySelector('#campaign-weapon')?.getBoundingClientRect();
      const panelBounds = [...document.querySelector('[data-mission-console-panels]').children]
        .map((panel) => panel.getBoundingClientRect());
      const panelsBottom = Math.max(...panelBounds.map((panel) => panel.bottom));
      const footer = document.querySelector('[data-mission-console-footer]');
      const footerBounds = footer.getBoundingClientRect();
      const deployBounds = footer.querySelector('button').getBoundingClientRect();
      return {
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        bottom: bounds.bottom,
        weaponBottom: weaponBounds?.bottom,
        panelHeightDifference: Math.abs(panelBounds[0].height - panelBounds[1].height),
        footerGap: footerBounds.top - panelsBottom,
        footerBottom: footerBounds.bottom,
        deployWidthRatio: deployBounds.width / footerBounds.width,
      };
    });
  check('zoomed portrait desktop keeps the complete mission console on screen',
    zoomedConsoleLayout.scrollHeight <= zoomedConsoleLayout.clientHeight &&
    zoomedConsoleLayout.bottom <= 1015 &&
    zoomedConsoleLayout.weaponBottom <= 1015 &&
    zoomedConsoleLayout.panelHeightDifference <= 1 &&
    zoomedConsoleLayout.footerGap >= 7 &&
    zoomedConsoleLayout.footerGap <= 9 &&
    zoomedConsoleLayout.footerBottom <= 1015 &&
    zoomedConsoleLayout.deployWidthRatio >= 0.95,
    JSON.stringify(zoomedConsoleLayout));
  if (pngPrefix) await page.screenshot({ path: `${pngPrefix}-ship.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });

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
    await openMissionConsole(page);
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
    await waitForShipGameFocus(page);
    const returnInput = await movementInputState(page);
    check('returning from deployment restores keyboard movement',
      returnInput.focused && (returnInput.bits & 1) !== 0,
      JSON.stringify(returnInput));
  }

  await openMissionConsole(page);
  await page.getByRole('button', { name: /Beam down to Mars/i }).click();
  await page.getByRole('button', { name: /Abort to Kestrel/i })
    .waitFor({ state: 'visible', timeout: 30000 });
  check('a cached second deployment leaves transporter calibration and becomes playable',
    await page.getByText('Calibrating destination field…').count() === 0);
  await page.getByRole('button', { name: /Abort to Kestrel/i }).click();
  await page.getByText('Field Ship Kestrel').waitFor({ state: 'visible' });

  console.log('\nIRIS mission review and retry');
  await openMissionConsole(page);
  await page.getByRole('button', { name: /Beam down to Mars/i }).click();
  await page.getByRole('button', { name: /Abort to Kestrel/i })
    .waitFor({ state: 'visible', timeout: 30000 });
  await page.evaluate(() => {
    window.__failedDeploymentHost = document.querySelector('sand-game');
    window.__failedDeploymentHost.dispatchEvent(new CustomEvent('sand:missionfailed', {
      detail: { elapsedTicks: 120 },
      bubbles: true,
      composed: true,
    }));
  });
  await page.getByRole('button', { name: /Retry mission/i }).click();
  await page.getByRole('button', { name: /Abort to Kestrel/i })
    .waitFor({ state: 'visible', timeout: 30000 });
  const retryReady = await page.evaluate(() =>
    document.querySelector('sand-game') !== window.__failedDeploymentHost &&
    !!document.querySelector('sand-game')?._game?.getMission?.());
  check('retry after a failed mission mounts a fresh playable deployment', retryReady);

  await page.evaluate(() => {
    document.querySelector('sand-game').dispatchEvent(new CustomEvent('sand:missioncomplete', {
      detail: { elapsedTicks: 600, recoveredWeaponKinds: [] },
      bubbles: true,
      composed: true,
    }));
  });
  await page.getByRole('heading', { name: 'Welcome back aboard' })
    .waitFor({ state: 'visible', timeout: 5000 });
  await page.setViewportSize({ width: 768, height: 384 });
  await page.waitForFunction(() => {
    const heading = [...document.querySelectorAll('h1')]
      .find((node) => node.textContent.includes('Welcome back aboard'));
    const report = heading?.closest('section')?.getBoundingClientRect();
    return !!report && report.top >= 0 && report.bottom <= window.innerHeight;
  });
  const reviewBounds = await page.getByRole('heading', { name: 'Welcome back aboard' })
    .evaluate((heading) => {
      const report = heading.closest('section').getBoundingClientRect();
      const action = heading.closest('section').querySelector('button').getBoundingClientRect();
      return {
        reportTop: report.top,
        reportBottom: report.bottom,
        actionTop: action.top,
        actionBottom: action.bottom,
      };
    });
  check('mission review shrinks to keep its full report and action inside a high-zoom viewport',
    reviewBounds.reportTop >= 0 && reviewBounds.reportBottom <= 384 &&
    reviewBounds.actionTop >= 0 && reviewBounds.actionBottom <= 384,
    JSON.stringify(reviewBounds));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: /Return to mission deck/i }).click();
  await page.getByText('Field Ship Kestrel').waitFor({ state: 'visible' });
  await waitForShipGameFocus(page);
  const beamUpInput = await movementInputState(page);
  check('beaming up after mission completion restores keyboard movement',
    beamUpInput.focused && (beamUpInput.bits & 1) !== 0,
    JSON.stringify(beamUpInput));

  check('ship and deployment flow produces no page exceptions',
    pageErrors.length === 0, pageErrors.join('; '));

  console.log('\nIRIS deployment recovery');
  const recoveryPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await recoveryPage.goto(baseURL, { waitUntil: 'load' });
  await openMissionConsole(recoveryPage);
  await recoveryPage.getByRole('button', { name: /Beam down to Earth/i }).click();
  await recoveryPage.locator('sand-game[planet="earth"]').waitFor({ state: 'attached' });
  await recoveryPage.locator('sand-game[planet="earth"]').evaluate((host) => {
    host.dispatchEvent(new CustomEvent('sand:error', {
      detail: { message: 'test deployment initialization failure' },
      bubbles: true,
      composed: true,
    }));
  });
  await recoveryPage.getByText('Transporter link failed').waitFor({ state: 'visible' });
  check('deployment initialization failure exposes campaign recovery controls',
    await recoveryPage.getByRole('button', { name: /Retry deployment/i }).isVisible() &&
    await recoveryPage.getByRole('button', { name: /Return to Kestrel/i }).isVisible());
  await recoveryPage.getByRole('button', { name: /Retry deployment/i })
    .evaluate((button) => button.click());
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
