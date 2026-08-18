import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { buildEntries } from '../src/sand/embed/toolPalette.js';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const baseURL = `http://localhost:${PORT}`;
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const server = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: 'ignore', detached: true,
});
const killServer = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGTERM');
  } catch {}
};

async function waitForServer() {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try { if ((await fetch(baseURL)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('dev server timeout');
}

let browser, mobileContext;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('browser:', msg.text()); });
  page.on('pageerror', (error) => console.error('pageerror:', error));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest && window.__sandPerf, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__sandPerf().worldTps > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const perf = window.__sandPerf();
    return (perf.workerStatus === 'live' || perf.workerStatus === 'live-no-diffs')
      && perf.workerProgressAgeMs < 2000;
  }, null, { timeout: 30000 });
  check('worker client receives sparse liveness turn progress',
    await page.evaluate(() => {
      const perf = window.__sandPerf();
      return (perf.workerStatus === 'live' || perf.workerStatus === 'live-no-diffs')
        && perf.workerProgressAgeMs < 2000;
    }));
  const mirrorFailure = await page.evaluate(() => {
    const perf = window.__sandPerf();
    window.__sandTest.failNextMirrorApply();
    window.__sandTest.paintWorker(1, 120, 35, 5);
    return {
      errors: perf.mirrorPacketErrors,
      worldTick: perf.worldTick,
      mirrorTick: perf.mirrorWorldTick,
    };
  });
  await page.waitForFunction((before) => {
    const perf = window.__sandPerf();
    return perf.mirrorPacketErrors > before.errors
      && perf.worldTick > before.worldTick
      && perf.mirrorWorldTick > before.mirrorTick
      && !perf.workerAwaitingAck
      && (perf.workerStatus === 'live' || perf.workerStatus === 'live-no-diffs');
  }, mirrorFailure, { timeout: 30000 });
  check('a mirror apply exception releases the worker ACK gate and resynchronizes',
    await page.evaluate((before) => {
      const perf = window.__sandPerf();
      return perf.mirrorPacketErrors === before.errors + 1
        && perf.lastMirrorPacketError === 'forced mirror packet failure'
        && perf.worldTick > before.worldTick
        && perf.mirrorWorldTick > before.mirrorTick;
    }, mirrorFailure));
  const keyboardOwnership = await page.evaluate(() => {
    const root = document.querySelector('sand-game').shadowRoot;
    const sim = root.querySelector('.sg-sim');
    const paletteToggle = root.querySelector('.sg-expand');
    paletteToggle.focus({ preventScroll: true });
    const visibleWasd = new KeyboardEvent('keydown', {
      key: 'd', bubbles: true, composed: true, cancelable: true,
    });
    paletteToggle.dispatchEvent(visibleWasd);
    paletteToggle.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true, composed: true }));
    const unfocusedArrow = new KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true, composed: true, cancelable: true,
    });
    paletteToggle.dispatchEvent(unfocusedArrow);
    sim.focus({ preventScroll: true });
    const focusedArrow = new KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true, composed: true, cancelable: true,
    });
    sim.dispatchEvent(focusedArrow);
    sim.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true, composed: true }));
    return {
      visibleWasd: visibleWasd.defaultPrevented,
      unfocusedArrow: unfocusedArrow.defaultPrevented,
      focusedArrow: focusedArrow.defaultPrevented,
      tabIndex: sim.tabIndex,
    };
  });
  check('visible creative WASD survives palette focus while page arrows still need surface focus',
    keyboardOwnership.visibleWasd && !keyboardOwnership.unfocusedArrow &&
      keyboardOwnership.focusedArrow && keyboardOwnership.tabIndex === 0);
  const auxiliaryEdges = await page.evaluate(async () => {
    const sim = document.querySelector('sand-game').shadowRoot.querySelector('.sg-sim');
    const rect = sim.getBoundingClientRect();
    const before = window.__sandPerf().workerEdges;
    sim.dispatchEvent(new PointerEvent('pointerup', {
      button: 1, buttons: 0, clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2, bubbles: true, composed: true, cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    return [before, window.__sandPerf().workerEdges];
  });
  check('auxiliary pointer release does not alter creative draft edges', auxiliaryEdges[0] === auxiliaryEdges[1], auxiliaryEdges.join(' -> '));

  // L freezes the authority on an exact tick and emits a portable input replay.
  // Running that capsule rebuilds the authority from its recorded seed and
  // verifies the reproduced grid/topology totals before normal stepping resumes.
  await page.evaluate(() => {
    const sim = document.querySelector('sand-game').shadowRoot.querySelector('.sg-sim');
    sim.focus({ preventScroll: true });
  });
  await page.keyboard.press('l');
  await page.waitForFunction(() => document.querySelector('sand-game').shadowRoot
    .querySelector('textarea[aria-label="Replay capsule text"]')?.value
    .startsWith('SAND-REPLAY-1:'), null, { timeout: 30000 });
  const replayTick = await page.evaluate(() => window.__sandPerf().worldTick);
  await page.evaluate(() => {
    const root = document.querySelector('sand-game').shadowRoot;
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent === 'Run replay').click();
  });
  await page.waitForFunction(() => document.querySelector('sand-game').shadowRoot
    .querySelector('[aria-label="Deterministic replay capsule"]')?.textContent
    .includes('Replay verified:'), null, { timeout: 120000 });
  check('L capsule deterministically rebuilds the captured authority state', true);
  await page.evaluate(() => {
    const root = document.querySelector('sand-game').shadowRoot;
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent === 'Resume & close').click();
  });
  await page.waitForFunction((tick) => window.__sandPerf().worldTick > tick,
    replayTick, { timeout: 30000 });
  check('replayed authority resumes after the panel closes', true);

  await page.evaluate(() => window.__sandTest.retryAuthority());
  await page.waitForFunction(() => {
    const perf = window.__sandPerf();
    return perf.workerControls > 0 && perf.worldTick > 2;
  }, null, { timeout: 30000 });
  check('a ready authority retry resumes control and world stepping',
    await page.evaluate(() => {
      const perf = window.__sandPerf();
      return perf.workerControls > 0 && perf.worldTick > 2;
    }));
  const retryResize = await page.evaluate(() => {
    const test = window.__sandTest;
    const beforeCols = test.info().cols;
    test.retryAuthority();
    document.querySelector('sand-game')._game.zoomOut();
    return beforeCols;
  });
  await page.waitForFunction((beforeCols) => {
    const perf = window.__sandPerf();
    return window.__sandTest.info().cols > beforeCols
      && !perf.workerResizePending && perf.workerControls > 0 && perf.worldTick > 2;
  }, retryResize, { timeout: 30000 });
  check('a resize issued during authority retry accepts its requested world',
    await page.evaluate((beforeCols) => {
      const perf = window.__sandPerf();
      return window.__sandTest.info().cols > beforeCols
        && !perf.workerResizePending && perf.workerControls > 0 && perf.worldTick > 2;
    }, retryResize));
  await page.evaluate(() => {
    window.__sandTest.retryAuthority();
    window.__sandTest.setPaused(true);
  });
  await page.waitForFunction(() => {
    const perf = window.__sandPerf();
    return perf.mirrorPacketType === 'full' && perf.worldTick === 0
      && perf.workerControls === 0;
  }, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__sandPerf().workerStatus === 'paused',
    null, { timeout: 30000 });
  const pausedTick = await page.evaluate(() => window.__sandPerf().worldTick);
  await page.waitForTimeout(300);
  const pausedTickAfterRetry = await page.evaluate(() => window.__sandPerf().worldTick);
  check('authority retry preserves an active simulation pause',
    pausedTickAfterRetry === pausedTick, `${pausedTick} -> ${pausedTickAfterRetry}`);
  await page.evaluate(() => window.__sandTest.setPaused(false));
  await page.waitForFunction((tick) => {
    const perf = window.__sandPerf();
    return perf.workerControls > 0 && perf.worldTick > tick
      && (perf.workerStatus === 'live' || perf.workerStatus === 'live-no-diffs');
  }, pausedTick, { timeout: 30000 });

  // Runtime tool/material configuration sent during worker initialization is
  // applied before the replacement starts stepping.
  await page.evaluate(() => {
    window.__sandTest.retryAuthority();
    window.__sandTest.setCreativeMaterial(0, 1); // SAND
  });
  await page.waitForFunction(() => {
    const perf = window.__sandPerf();
    return perf.workerControls > 0 && perf.worldTick > 2;
  }, null, { timeout: 30000 });
  const configuredPaint = await page.evaluate(() => {
    const t = window.__sandTest;
    const rect = document.querySelector('sand-game').shadowRoot
      .querySelector('#sand-main').getBoundingClientRect();
    const px = Math.floor(rect.width * 0.5);
    const py = Math.floor(rect.height * 0.14);
    return {
      x: rect.left + px,
      y: rect.top + py,
      before: t.materialCountBoth(1),
    };
  });
  // Paint/erase are continuous tools. Hold across an authority turn so this
  // assertion tests startup config replay rather than press/release coalescing.
  await page.mouse.move(configuredPaint.x, configuredPaint.y);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(250);
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction((before) => window.__sandTest.materialCountBoth(1) > before,
    configuredPaint.before, { timeout: 10000 });
  check('authority retry preserves the selected creative material',
    await page.evaluate((before) => window.__sandTest.materialCountBoth(1) > before,
      configuredPaint.before));
  await page.evaluate(() => window.__sandTest.setCreativeMaterial(3, 0)); // CUBE
  await page.waitForTimeout(50);
  const desktopAudioUi = await page.locator('sand-game').evaluate((host) => ({
    buttons: host.shadowRoot.querySelectorAll('.sg-sound').length,
    enabled: host._game.getAudioState().enabled,
    hints: [...host.shadowRoot.querySelectorAll('.sg-control-hint')].map((hint) => hint.textContent),
  }));
  check('desktop exposes block controls beside one enabled sound control',
    desktopAudioUi.buttons === 1 && desktopAudioUi.enabled &&
      desktopAudioUi.hints.join('|') === 'WASDMOVE|LMBPLACE FOREGROUND|RMBPLACE BACKGROUND', desktopAudioUi.hints.join(', '));
  const countRaf = (ms) => page.evaluate((duration) => new Promise((resolve) => {
    let n = 0;
    const started = performance.now();
    const frame = () => {
      n++;
      if (performance.now() - started >= duration) resolve(n);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), ms);

  // Paint into an empty upper-view region through real DOM input; the worker is
  // the only code allowed to mutate the creative world.
  const target = await page.evaluate(() => {
    const t = window.__sandTest;
    t.setPlayMode(false);
    t.setDrawMode(true);
    const info = t.info();
    const rect = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    const localX = Math.floor(rect.width * 0.5);
    const localY = Math.floor(rect.height * 0.18);
    const [cx, cy] = t.cellAt(localX, localY);
    return { x: rect.left + localX, y: rect.top + localY, cx, cy, before: t.materialCountBoth(1) };
  });
  const defaultRigidBefore = await page.evaluate(() => window.__sandTest.materialCount(13));
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((before) => window.__sandTest.materialCount(13) > before,
    defaultRigidBefore, { timeout: 10000 }).catch(() => {});
  const defaultRigidAfter = await page.evaluate(() => window.__sandTest.materialCount(13));
  check('default creative cube survives worker initialization', defaultRigidAfter > defaultRigidBefore, `${defaultRigidBefore} -> ${defaultRigidAfter}`);

  // Creature eggs are actor tools, not grid writes. Select one through the real
  // palette and click the canvas; the main actor-owning mirror must receive it
  // even though ordinary creative tools remain worker-owned.
  const foxBefore = await page.evaluate(() => window.__sandTest.getCreatures().filter((c) => c.species === 2).length);
  const game = page.locator('sand-game');
  await game.locator('.sg-expand').click();
  const stableOption = await game.locator('.sg-opt').first().elementHandle();
  const mainLabels = await game.locator('.sg-opt:not([hidden]) .sg-name').allTextContents();
  check('creative Main folder begins with the eleven featured picks',
    mainLabels.slice(0, 11).join(',') === 'cube,eraser,rigid,neutronium,stone,water,acid,lava,tnt,seed,sand',
    mainLabels.slice(0, 11).join(','));
  const expectedMainLabels = buildEntries().map((entry) => entry.label);
  check('creative Main folder contains the complete catalog',
    mainLabels.join('\n') === expectedMainLabels.join('\n'),
    `${mainLabels.length}/${expectedMainLabels.length} entries`);
  const expectedEggLabels = buildEntries()
    .filter((entry) => entry.egg)
    .map((entry) => entry.label);
  check('creative Main folder keeps the enabled spawn eggs at the bottom',
    mainLabels.slice(-expectedEggLabels.length).join(',') === expectedEggLabels.join(','),
    mainLabels.slice(-expectedEggLabels.length).join(','));
  check('creative picker exposes all seven material folders', await game.locator('.sg-section').count() === 7);
  await game.locator('.sg-section', { hasText: 'Terrain' }).click();
  const terrainLabels = await game.locator('.sg-opt:not([hidden]) .sg-name').allTextContents();
  check('folder selection shows its catalog while keeping featured entries available there',
    terrainLabels.includes('sand') && terrainLabels.includes('stone') && terrainLabels.includes('copper_ore')
      && !terrainLabels.includes('cube') && !terrainLabels.includes('water'));
  await game.locator('.sg-section', { hasText: 'Flora' }).click();
  const seedIconUrls = await game.locator('.sg-opt:not([hidden])').evaluateAll((options) => options
    .filter((option) => / Seed$/.test(option.querySelector('.sg-name')?.textContent || ''))
    .map((option) => option.querySelector('canvas').toDataURL()));
  check('all seven species seeds render as distinct pixel icons',
    seedIconUrls.length === 7 && new Set(seedIconUrls).size === 7, `${new Set(seedIconUrls).size}/${seedIconUrls.length}`);
  await game.locator('.sg-section', { hasText: 'Main' }).click();
  await game.locator('.sg-search').fill('fox spawn egg');
  await game.locator('.sg-opt', { hasText: 'Fox Spawn Egg' }).click();
  check('desktop material picker stays open after selection',
    await game.locator('.sg-palette').evaluate((palette) => palette.classList.contains('expanded')));
  check('desktop material selection preserves existing option nodes',
    await stableOption.evaluate((option) => option.isConnected));
  await game.locator('.sg-palette').evaluate((palette) => {
    palette.__sandSawClosing = false;
    const observer = new MutationObserver(() => {
      if (palette.classList.contains('closing')) {
        palette.__sandSawClosing = true;
        observer.disconnect();
      }
    });
    observer.observe(palette, { attributes: true, attributeFilter: ['class'] });
  });
  await game.locator('.sg-expand').click();
  await game.locator('.sg-dropdown').waitFor({ state: 'detached' });
  check('desktop material picker runs its closing animation',
    await game.locator('.sg-palette').evaluate((palette) => palette.__sandSawClosing));
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((n) => window.__sandTest.getCreatures().filter((c) => c.species === 2).length > n, foxBefore);
  const foxAfter = await page.evaluate(() => {
    const foxes = window.__sandTest.getCreatures().filter((c) => c.species === 2);
    return { count: foxes.length, creature: foxes[foxes.length - 1] };
  });
  check('creative palette egg click spawns a visible actor', foxAfter.count === foxBefore + 1, `${foxBefore} -> ${foxAfter.count}`);
  check('creative eggs do not enable natural population spawning',
    await page.evaluate(() => window.__sandTest.getCreatures().length) === 1);

  await page.evaluate(() => window.__sandTest.setCreativeMaterial(0, 1)); // SAND
  await page.mouse.move(target.x, target.y);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(350);
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction(() => window.__sandPerf().workerEdges >= 6);
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => window.__sandTest.materialCountBoth(1));
  check('worker-owned creative paint reaches the render mirror', after > target.before, `${target.before} -> ${after}`);
  if (after <= target.before) console.log('  worker input debug', await page.evaluate(() => window.__sandPerf()));
  await page.mouse.move(target.x + 80, target.y);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(250);
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction((before) => window.__sandTest.materialCountBoth(1) > before,
    after, { timeout: 10000 }).catch(() => {});
  const continued = await page.evaluate(() => window.__sandTest.materialCountBoth(1));
  check('world accepts new work after a replication packet is consumed', continued > after, `${after} -> ${continued}`);
  const clocks = await page.evaluate(() => { const p = window.__sandPerf(); return [p.mirrorWorldTick, p.worldTick]; });
  check('render mirror uses a worker-derived world clock for live lighting',
    clocks[0] > 0 && clocks[1] >= clocks[0], `${clocks[0]} / ${clocks[1]}`);
  await page.waitForFunction(({ id, x, y }) => {
    const creature = window.__sandTest.getCreatures().find((candidate) => candidate.id === id);
    return creature && Math.hypot(creature.x - x, creature.y - y) > 0.1;
  }, {
    id: foxAfter.creature.id,
    x: foxAfter.creature.x,
    y: foxAfter.creature.y,
  }, { timeout: 10_000 });
  const movedFox = await page.evaluate((id) => window.__sandTest.getCreatures().find((c) => c.id === id), foxAfter.creature.id);
  check('egg-spawned creature keeps simulating after selecting another tool',
    movedFox && Math.hypot(movedFox.x - foxAfter.creature.x, movedFox.y - foxAfter.creature.y) > 0.1);

  // Component drafts are non-grid state, so verify their explicit preview mirror
  // and the worker-owned finalize edge separately.
  const stoneBefore = await page.evaluate(() => {
    window.__sandTest.setCreativeMaterial(0, 3); // STONE
    return window.__sandTest.materialCount(3);
  });
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(target.x + 24, target.y, { steps: 6 });
  await page.waitForTimeout(250);
  const draftCount = await page.evaluate(() => window.__sandTest.draftCount());
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction((before) => window.__sandTest.materialCount(3) > before,
    stoneBefore, { timeout: 10000 }).catch(() => {});
  const stoneAfter = await page.evaluate(() => window.__sandTest.materialCount(3));
  check('worker draft preview is mirrored to WebGL state', draftCount > 0, `${draftCount} cells`);
  check('worker release finalizes the connected component', stoneAfter > stoneBefore, `${stoneBefore} -> ${stoneAfter}`);

  const cubeStoneBefore = await page.evaluate(() => {
    window.__sandTest.setCreativeMaterial(3, 0); // CUBE
    return window.__sandTest.materialCount(3); // last body-capable selection was STONE
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((before) => window.__sandTest.materialCount(3) > before,
    cubeStoneBefore, { timeout: 10000 }).catch(() => {});
  const cubeStoneAfter = await page.evaluate(() => window.__sandTest.materialCount(3));
  check('worker cube placement reaches the render mirror', cubeStoneAfter > cubeStoneBefore, `${cubeStoneBefore} -> ${cubeStoneAfter}`);

  // Put the camera at the loaded-window edge and verify the worker streams and
  // re-anchors the main mirror without changing the absolute camera location.
  const stream0 = await page.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    t.setCam(info.cols - info.viewCols - 2, cam.y);
    const moved = t.getCam();
    return { offX: off.x, absX: off.x + moved.x };
  });
  await page.waitForFunction((oldX) => window.__sandTest.worldOffset().x !== oldX, stream0.offX, { timeout: 10000 });
  const stream1 = await page.evaluate(() => {
    const t = window.__sandTest, off = t.worldOffset(), cam = t.getCam(), perf = window.__sandPerf();
    return {
      offX: off.x, absX: off.x + cam.x,
      shiftPackets: perf.mirrorShiftPackets,
      shiftBytes: perf.mirrorShiftPacketBytes,
    };
  });
  check('worker owns horizontal streaming', stream1.offX !== stream0.offX, `${stream0.offX} -> ${stream1.offX}`);
  check('stream band preserves absolute camera position', Math.abs(stream1.absX - stream0.absX) < 2, `${stream0.absX.toFixed(1)} -> ${stream1.absX.toFixed(1)}`);
  check('streaming applies a mirror-shift packet',
    stream1.shiftPackets > 0 && stream1.shiftBytes > 4,
    `${stream1.shiftPackets} packet(s), ${stream1.shiftBytes} bytes`);

  const streamV0 = await page.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    t.setCam(cam.x, info.rows - info.viewRows - 2);
    const moved = t.getCam();
    return { offY: off.y, absY: off.y + moved.y, shiftPackets: window.__sandPerf().mirrorShiftPackets };
  });
  await page.waitForFunction((oldY) => window.__sandTest.worldOffset().y !== oldY,
    streamV0.offY, { timeout: 10000 });
  const streamV1 = await page.evaluate(() => {
    const t = window.__sandTest, off = t.worldOffset(), cam = t.getCam(), perf = window.__sandPerf();
    return { offY: off.y, absY: off.y + cam.y, shiftPackets: perf.mirrorShiftPackets };
  });
  check('worker owns vertical streaming', streamV1.offY !== streamV0.offY,
    `${streamV0.offY} -> ${streamV1.offY}`);
  check('vertical stream band preserves absolute camera position',
    Math.abs(streamV1.absY - streamV0.absY) < 2 && streamV1.shiftPackets > streamV0.shiftPackets,
    `${streamV0.absY.toFixed(1)} -> ${streamV1.absY.toFixed(1)}`);

  // Runtime/browser zoom can fire several fits before the debounced worker
  // resize. A larger control viewport must never make the old worker stream on
  // every turn or let its snapshot displace the preserved world-space center.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest && window.__sandPerf && window.__sandPerf().worldTps > 0, null, { timeout: 30000 });
  await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  const zoomCenter0 = await page.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    return { x: off.x + cam.x + info.viewCols / 2, y: off.y + cam.y + info.viewRows / 2 };
  });
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('-');
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(1200);
  const zoomCenter1 = await page.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    return { x: off.x + cam.x + info.viewCols / 2, y: off.y + cam.y + info.viewRows / 2 };
  });
  check('rapid zoom keeps the worker mirror on the same world center',
    Math.abs(zoomCenter1.x - zoomCenter0.x) < 2 && Math.abs(zoomCenter1.y - zoomCenter0.y) < 2,
    `${zoomCenter0.x.toFixed(1)},${zoomCenter0.y.toFixed(1)} -> ${zoomCenter1.x.toFixed(1)},${zoomCenter1.y.toFixed(1)}`);

  // Once zoom makes the loaded window larger than the fixed live simulation
  // focus, a stream packet carries the shifted dirty focus/band instead of both
  // complete grids.
  await page.waitForFunction(() => !window.__sandTest.info().workerResizePending,
    null, { timeout: 10000 });
  const zoomStream0 = await page.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    t.setCam(info.cols - info.viewCols - 2, cam.y);
    const moved = t.getCam();
    return { offX: off.x, absX: off.x + moved.x };
  });
  await page.waitForFunction((oldX) => window.__sandTest.worldOffset().x !== oldX,
    zoomStream0.offX, { timeout: 10000 });
  const zoomStream1 = await page.evaluate(() => {
    const t = window.__sandTest, off = t.worldOffset(), cam = t.getCam(), perf = window.__sandPerf();
    return {
      absX: off.x + cam.x,
      shiftBytes: perf.mirrorShiftPacketBytes,
      fullBytes: t.info().cols * t.info().rows * 2,
    };
  });
  check('zoomed-out streaming applies a partial mirror-shift packet',
    zoomStream1.shiftBytes > 4 && zoomStream1.shiftBytes < zoomStream1.fullBytes &&
      Math.abs(zoomStream1.absX - zoomStream0.absX) < 2,
    `${zoomStream1.shiftBytes}/${zoomStream1.fullBytes} bytes`);

  // Force each worker world turn over budget. The main thread should continue
  // receiving ~60 RAF callbacks and pan the camera on its actor clock while the
  // worker naturally drops below 60 TPS.
  // Reload to isolate scheduling from the intentionally active sand scene above;
  // the delay hook itself consumes no CPU and represents an over-budget world turn.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest && window.__sandPerf && window.__sandPerf().worldTps > 0, null, { timeout: 30000 });
  await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  const stressPaint = await page.evaluate(() => {
    const test = window.__sandTest;
    test.setPlayMode(false);
    test.setDrawMode(true);
    test.setCreativeMaterial(0, 1); // SAND keeps the cellular clock active.
    const rect = document.querySelector('sand-game').shadowRoot
      .querySelector('#sand-main').getBoundingClientRect();
    return {
      x: rect.left + Math.floor(rect.width * 0.5),
      y: rect.top + Math.floor(rect.height * 0.14),
      sand: test.materialCountBoth(1),
      edges: window.__sandPerf().workerEdges,
    };
  });
  const baselineRafFrames = await countRaf(1000);
  await page.mouse.move(stressPaint.x, stressPaint.y);
  await page.mouse.down({ button: 'left' });
  await page.waitForFunction(({ sand, edges }) =>
    window.__sandTest.materialCountBoth(1) > sand && window.__sandPerf().workerEdges > edges,
    stressPaint, { timeout: 10000 });
  const pairedStart = await page.evaluate(() => {
    window.__sandTest.setWorldDelay(22);
    const perf = window.__sandPerf();
    return { actorTick: perf.actorTick, worldTick: perf.worldTick };
  });
  const cam0 = await page.evaluate(() => window.__sandTest.getCam().x);
  const rafFrames = await countRaf(2000);
  await page.keyboard.down('d');
  await page.waitForTimeout(750);
  await page.keyboard.up('d');
  const result = await page.evaluate(() => ({ perf: window.__sandPerf(), camX: window.__sandTest.getCam().x }));
  await page.mouse.up({ button: 'left' });
  const rafHz = rafFrames / 2;
  // The one-second baseline and two-second stress windows produce the same raw
  // frame count at exactly half cadence. Permit one boundary callback of
  // quantization at the very low rates seen on a loaded headless test host.
  const minStressRafFrames = Math.max(4, baselineRafFrames - 1);
  const actorDelta = result.perf.actorTick - pairedStart.actorTick;
  const worldDelta = result.perf.worldTick - pairedStart.worldTick;
  check('main-thread RAF remains independent of the slow world',
    rafFrames >= minStressRafFrames,
    `${baselineRafFrames.toFixed(1)} -> ${rafHz.toFixed(1)} Hz; ` +
      `${rafFrames}/${minStressRafFrames} stress frames; ` +
      `apply ${result.perf.mirrorApplyMs?.toFixed(1)}ms, ` +
      `render ${result.perf.renderMs?.toFixed(1)}ms, packet ${result.perf.mirrorPacketBytes}`);
  check('stress hook reduced worker world TPS', result.perf.worldTps < 55, `${result.perf.worldTps.toFixed(1)} TPS`);
  check('slow authority keeps actor and world ticks paired',
    actorDelta > 0 && actorDelta === worldDelta,
    `+${actorDelta} / +${worldDelta}`);
  check('creative camera keeps moving while world is slow', result.camX > cam0 + 5, `${cam0.toFixed(1)} -> ${result.camX.toFixed(1)}`);
  await page.evaluate(() => window.__sandTest.setWorldDelay(0));

  // Mobile taps use the compact FG/BG control beside zoom to choose whether
  // they behave like left-click or right-click. Exercise real touch pointers so
  // desktop mouse semantics cannot accidentally satisfy this check.
  mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    reducedMotion: 'no-preference',
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(baseURL, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__sandTest && window.__sandPerf && window.__sandPerf().worldTps > 0, null, { timeout: 30000 });
  const mobileGame = mobile.locator('sand-game');
  const restingUi = await mobileGame.evaluate((host) => {
    const root = host.shadowRoot;
    const visible = (selector) => getComputedStyle(root.querySelector(selector)).display !== 'none';
    return {
      start: visible('.sg-start'), palette: visible('.sg-palette'),
      joystick: visible('.sg-stick'), controls: visible('.sg-zoom'),
      soundButtons: root.querySelectorAll('.sg-sound').length,
      audioEnabled: host._game.getAudioState().enabled,
    };
  });
  check('mobile creative rests behind only the START control',
    restingUi.start && !restingUi.palette && !restingUi.joystick && !restingUi.controls);
  check('mobile navbar is visible before START', await mobile.locator('[data-site-navbar]').isVisible());
  check('resting mobile creative has no mute UI and audio is disabled',
    restingUi.soundButtons === 0 && !restingUi.audioEnabled);
  await mobileGame.locator('.sg-start').tap();
  const startedUi = await mobileGame.evaluate((host) => {
    const root = host.shadowRoot;
    const visible = (selector) => getComputedStyle(root.querySelector(selector)).display !== 'none';
    return {
      start: visible('.sg-start'), palette: visible('.sg-palette'),
      joystick: visible('.sg-stick'), controls: visible('.sg-zoom'),
      audioEnabled: host._game.getAudioState().enabled,
    };
  });
  check('START reveals the full mobile creative controls',
    !startedUi.start && startedUi.palette && startedUi.joystick && startedUi.controls && startedUi.audioEnabled);
  check('START hides the mobile navbar', !(await mobile.locator('[data-site-navbar]').isVisible()));

  // Reproduce the real failure: move to a buffer corner, then start a second
  // zoom after the first mirror resize but before its authority resize settles.
  // The returned full snapshot must use the visible world center, not the
  // authority engine's otherwise-unused startup camera.
  const mobileZoomBase = await mobile.evaluate(() => {
    const t = window.__sandTest, info = t.info();
    t.setPlayMode(false);
    t.setDrawMode(true);
    t.setCreativeMaterial(3, 0); // default RIGID cube
    t.setCam(info.cols - info.viewCols - 1, info.rows - info.viewRows - 1);
    t.flushAuthorityControl();
    const cam = t.getCam(), off = t.worldOffset();
    return {
      cols: info.cols, viewCols: info.viewCols,
      centerX: off.x + cam.x + info.viewCols / 2,
      centerY: off.y + cam.y + info.viewRows / 2,
    };
  });
  await mobileGame.locator('.sg-zoom-out').tap();
  await mobile.waitForTimeout(130);
  await mobileGame.locator('.sg-zoom-out').tap();
  await mobile.waitForFunction((base) => {
    const info = window.__sandTest.info();
    return info.viewCols >= base.viewCols * 1.25 && !window.__sandPerf().workerResizePending;
  }, mobileZoomBase, { timeout: 30000 });
  const mobileZoomed = await mobile.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    return {
      centerX: off.x + cam.x + info.viewCols / 2,
      centerY: off.y + cam.y + info.viewRows / 2,
    };
  });
  check('second mobile zoom-out preserves the camera world center',
    Math.abs(mobileZoomed.centerX - mobileZoomBase.centerX) < 1 &&
      Math.abs(mobileZoomed.centerY - mobileZoomBase.centerY) < 1,
    `${mobileZoomBase.centerX},${mobileZoomBase.centerY} -> ${mobileZoomed.centerX},${mobileZoomed.centerY}`);

  // Place at one screen point, move the camera, and tap that same point again.
  // Both real touch placements must land in their distinct world-X bands.
  await mobile.evaluate(() => {
    const t = window.__sandTest, cam = t.getCam();
    t.setCam(cam.x, 0); // expose empty sky so both free cubes can spawn
    t.flushAuthorityControl();
  });
  await mobile.waitForTimeout(700);
  const mobileCanvas = await mobileGame.locator('#sand-main').boundingBox();
  const tapX = mobileCanvas.x + mobileCanvas.width * 0.58;
  const tapY = mobileCanvas.y + mobileCanvas.height * 0.22;
  const worldAimAtTap = () => mobile.evaluate(([x, y]) => {
    const t = window.__sandTest;
    const rect = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    const [localX, localY] = t.cellAt(x - rect.left, y - rect.top);
    const off = t.worldOffset();
    return { x: off.x + localX, y: off.y + localY };
  }, [tapX, tapY]);
  const rigidBandCount = (worldX) => mobile.evaluate((x) => {
    const t = window.__sandTest, info = t.info(), off = t.worldOffset();
    const localX = Math.floor(x - off.x);
    return t.materialCount(13, localX - 25, 0, localX + 26, info.rows);
  }, worldX);
  const aim1 = await worldAimAtTap();
  const before1 = await rigidBandCount(aim1.x);
  await mobile.touchscreen.tap(tapX, tapY);
  await mobile.waitForFunction(({ worldX, before }) => {
    const t = window.__sandTest, info = t.info(), off = t.worldOffset();
    const localX = Math.floor(worldX - off.x);
    return t.materialCount(13, localX - 25, 0, localX + 26, info.rows) > before;
  }, { worldX: aim1.x, before: before1 }, { timeout: 15000 }).catch(() => {});
  const after1 = await rigidBandCount(aim1.x);
  await mobile.evaluate(() => {
    const t = window.__sandTest, cam = t.getCam();
    t.setCam(cam.x + 70, cam.y);
  });
  await mobile.waitForTimeout(700);
  const aim2 = await worldAimAtTap();
  const before2 = await rigidBandCount(aim2.x);
  await mobile.touchscreen.tap(tapX, tapY);
  await mobile.waitForFunction(({ worldX, before }) => {
    const t = window.__sandTest, info = t.info(), off = t.worldOffset();
    const localX = Math.floor(worldX - off.x);
    return t.materialCount(13, localX - 25, 0, localX + 26, info.rows) > before;
  }, { worldX: aim2.x, before: before2 }, { timeout: 15000 }).catch(() => {});
  const after2 = await rigidBandCount(aim2.x);
  check('mobile placement follows the moved camera after zoom-out',
    aim2.x > aim1.x + 50 && after1 > before1 && after2 > before2,
    `aim ${aim1.x} -> ${aim2.x}; cells ${before1}->${after1}, ${before2}->${after2}`);

  for (let i = 0; i < 2; i++) {
    await mobileGame.locator('.sg-zoom-in').tap();
    await mobile.waitForTimeout(130);
  }
  await mobile.waitForFunction((base) => window.__sandTest.info().cols <= base.cols && !window.__sandPerf().workerResizePending,
    mobileZoomBase, { timeout: 30000 });
  const cubePaletteWidth = await mobileGame.locator('.sg-palette').evaluate((palette) => palette.getBoundingClientRect().width);
  await mobileGame.locator('.sg-expand').tap();
  const selectorFocus = await mobileGame.evaluate((host) => {
    const root = host.shadowRoot;
    const search = root.querySelector('.sg-search');
    return {
      autoFocused: root.activeElement === search,
      fontSize: parseFloat(getComputedStyle(search).fontSize),
      scale: window.visualViewport?.scale || 1,
    };
  });
  check('opening the mobile material selector does not focus or zoom the page',
    !selectorFocus.autoFocused && selectorFocus.fontSize >= 16 && Math.abs(selectorFocus.scale - 1) < 0.01,
    `focus ${selectorFocus.autoFocused}, ${selectorFocus.fontSize}px, scale ${selectorFocus.scale}`);
  await mobileGame.locator('.sg-section', { hasText: 'Flora' }).tap();
  await mobileGame.locator('.sg-opt', { hasText: 'mycelium_spore' }).tap();
  await mobileGame.locator('.sg-list').waitFor({ state: 'detached' });
  await mobileGame.locator('.sg-current .sg-name.scrolling').waitFor();
  const longNameUi = await mobileGame.locator('.sg-palette').evaluate((palette) => {
    const name = palette.querySelector('.sg-current .sg-name');
    const track = name.querySelector('.sg-name-track');
    return {
      width: palette.getBoundingClientRect().width,
      overflows: track.scrollWidth > name.clientWidth,
      scrolling: name.classList.contains('scrolling'),
    };
  });
  check('long mobile material names keep the Cube control width', Math.abs(longNameUi.width - cubePaletteWidth) < 1,
    `${cubePaletteWidth.toFixed(0)} -> ${longNameUi.width.toFixed(0)}`);
  check('long selected material name pans inside its fixed viewport', longNameUi.overflows && longNameUi.scrolling);
  const controls = await mobileGame.locator('.sg-zoom').evaluate((wrap) => {
    const zoomIn = wrap.querySelector('.sg-zoom-in').getBoundingClientRect();
    const zoomOut = wrap.querySelector('.sg-zoom-out').getBoundingClientRect();
    const layer = wrap.querySelector('.sg-layer').getBoundingClientRect();
    const draw = wrap.querySelector('.sg-draw').getBoundingClientRect();
    return {
      grid: layer.left >= zoomIn.right + 5 && draw.left >= zoomOut.right + 5 &&
        zoomOut.top >= zoomIn.bottom + 5 && draw.top >= layer.bottom + 5,
      layerLabel: wrap.querySelector('.sg-layer').textContent.trim(),
      drawLabel: wrap.querySelector('.sg-draw').textContent.trim(),
    };
  });
  check('mobile utility controls form the compact 2x2 grid',
    controls.grid && controls.layerLabel === 'FG' && controls.drawLabel === '↕SCROLL');
  const mobileTarget = await mobile.evaluate(() => {
    window.__sandTest.setCreativeMaterial(0, 3); // STONE
    const rect = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.58, y: rect.top + rect.height * 0.18,
      fg: window.__sandTest.materialCount(3), bg: window.__sandTest.materialCountBg(3),
    };
  });

  // A pointer edge can reach the authority worker before the next RAF control
  // sample. Hold the main thread after dispatching touch-down so the worker is
  // forced to pair that new edge with the old control sample. The draft must
  // begin only at the new contact, never interpolate back to the stale point.
  await mobile.evaluate(({ oldX, oldY, newX, newY }) => {
    const t = window.__sandTest;
    const canvas = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main');
    const fire = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, composed: true, cancelable: true, pointerType: 'touch',
      pointerId: 91, isPrimary: true, button: 0, buttons, clientX: x, clientY: y,
    }));
    fire('pointermove', oldX, oldY, 0);
    t.flushAuthorityControl();
    fire('pointerdown', newX, newY, 1);
    const until = performance.now() + 180;
    while (performance.now() < until) { /* keep RAF from refreshing control */ }
  }, {
    oldX: mobileTarget.x - 110, oldY: mobileTarget.y + 170,
    newX: mobileTarget.x + 70, newY: mobileTarget.y,
  });
  await mobile.waitForFunction(() => window.__sandTest.draftCount() > 0, null, { timeout: 5000 }).catch(() => {});
  const freshTouchDraftCount = await mobile.evaluate(() => window.__sandTest.draftCount());
  await mobile.evaluate(({ x, y }) => {
    const canvas = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main');
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, composed: true, cancelable: true, pointerType: 'touch',
      pointerId: 91, isPrimary: true, button: 0, buttons: 0, clientX: x, clientY: y,
    }));
  }, { x: mobileTarget.x + 70, y: mobileTarget.y });
  await mobile.waitForTimeout(250);
  check('a fresh mobile touch does not connect to the previous pointer position',
    freshTouchDraftCount > 0 && freshTouchDraftCount < 100,
    `${freshTouchDraftCount} draft cells`);

  const afterFreshTouch = await mobile.evaluate(() => ({
    fg: window.__sandTest.materialCount(3), bg: window.__sandTest.materialCountBg(3),
  }));
  await mobile.touchscreen.tap(mobileTarget.x, mobileTarget.y);
  await mobile.waitForFunction((before) => window.__sandTest.materialCount(3) > before, afterFreshTouch.fg);
  let foregroundTap = await mobile.evaluate(() => ({ fg: window.__sandTest.materialCount(3), bg: window.__sandTest.materialCountBg(3) }));
  check('mobile FG tap writes to the foreground', foregroundTap.fg > afterFreshTouch.fg && foregroundTap.bg === afterFreshTouch.bg);

  // A count can become observable before the final mirror packet for the same
  // component. Let the two layer totals stop changing before using them as the
  // baseline for the background-only tap.
  let stableSamples = 0;
  for (let i = 0; i < 12 && stableSamples < 3; i++) {
    await mobile.waitForTimeout(250);
    const next = await mobile.evaluate(() => ({ fg: window.__sandTest.materialCount(3), bg: window.__sandTest.materialCountBg(3) }));
    stableSamples = next.fg === foregroundTap.fg && next.bg === foregroundTap.bg ? stableSamples + 1 : 0;
    foregroundTap = next;
  }

  await mobileGame.locator('.sg-layer').tap();
  const layerState = await mobileGame.locator('.sg-layer').evaluate((button) => ({
    text: button.textContent.trim(), pressed: button.getAttribute('aria-pressed'),
  }));
  await mobile.touchscreen.tap(mobileTarget.x + 34, mobileTarget.y);
  await mobile.waitForFunction((before) => window.__sandTest.materialCountBg(3) > before, foregroundTap.bg);
  const backgroundTap = await mobile.evaluate(() => ({ fg: window.__sandTest.materialCount(3), bg: window.__sandTest.materialCountBg(3) }));
  check('mobile layer toggle reports the background state', layerState.text === 'BG' && layerState.pressed === 'true');
  const foregroundDelta = backgroundTap.fg - foregroundTap.fg;
  const backgroundDelta = backgroundTap.bg - foregroundTap.bg;
  check('mobile BG tap writes to the background',
    backgroundDelta > 0 && foregroundDelta < backgroundDelta,
    `fg ${foregroundTap.fg} -> ${backgroundTap.fg}, bg ${foregroundTap.bg} -> ${backgroundTap.bg}`);

  await mobileGame.locator('.sg-expand').tap();
  const openUi = await mobileGame.evaluate((host) => {
    const root = host.shadowRoot;
    const list = root.querySelector('.sg-list');
    return {
      joystickVisible: getComputedStyle(root.querySelector('.sg-stick')).display !== 'none',
      controlsVisible: getComputedStyle(root.querySelector('.sg-zoom')).display !== 'none',
      scrollable: list.scrollHeight > list.clientHeight,
    };
  });
  check('expanded mobile palette keeps joystick and left controls visible', openUi.joystickVisible && openUi.controlsVisible);
  check('expanded mobile material list has scrollable overflow', openUi.scrollable);

  const listBox = await mobileGame.locator('.sg-list').boundingBox();
  const cdp = await mobileContext.newCDPSession(mobile);
  const touchX = listBox.x + listBox.width / 2;
  const touchStartY = listBox.y + listBox.height * 0.78;
  const touchPoint = (y) => ({ x: touchX, y, radiusX: 2, radiusY: 2, force: 1, id: 7 });
  // Dispatch a paced, real touch sequence so Chromium's native pan recognizer
  // owns the scroll; an instantaneous synthetic gesture is unreliable under
  // software-rendered headless runs.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [touchPoint(touchStartY)],
  });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [touchPoint(touchStartY - i * 14)],
    });
    await mobile.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(250);
  const scrollTop = await mobileGame.locator('.sg-list').evaluate((list) => list.scrollTop);
  check('mobile swipe scrolls the material list', scrollTop > 20, `scrollTop ${scrollTop.toFixed(0)}`);

  await mobileGame.locator('.sg-section', { hasText: 'Fluids' }).tap();
  await mobileGame.locator('.sg-opt', { hasText: 'water' }).first().tap();
  await mobileGame.locator('.sg-list').waitFor({ state: 'detached' });
  const closedUi = await mobileGame.evaluate((host) => {
    const root = host.shadowRoot;
    return {
      joystickVisible: getComputedStyle(root.querySelector('.sg-stick')).display !== 'none',
      controlsVisible: getComputedStyle(root.querySelector('.sg-zoom')).display !== 'none',
    };
  });
  check('mobile controls remain visible after selecting a material', closedUi.joystickVisible && closedUi.controlsVisible);
  await mobileGame.locator('.sg-draw').tap();
  const returnedUi = await mobileGame.evaluate((host) => {
    const root = host.shadowRoot;
    const visible = (selector) => getComputedStyle(root.querySelector(selector)).display !== 'none';
    return {
      start: visible('.sg-start'), palette: visible('.sg-palette'),
      joystick: visible('.sg-stick'), controls: visible('.sg-zoom'),
      audioEnabled: host._game.getAudioState().enabled,
    };
  });
  check('SCROLL returns mobile creative to the START-only state',
    returnedUi.start && !returnedUi.palette && !returnedUi.joystick && !returnedUi.controls && !returnedUi.audioEnabled,
    JSON.stringify(returnedUi));
  await mobileContext.close();
  mobileContext = null;
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await mobileContext?.close().catch(() => {});
  await browser?.close();
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
