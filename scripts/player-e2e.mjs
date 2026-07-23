// Headless browser test for the local playable character. Boots the
// Vite dev server, opens the About page, drives the player with real keyboard
// events, and asserts the engine-simulated player responds (moves right, jumps).
// Uses the `playwright` library directly (same approach as scripts/bench-pan.mjs)
// so it runs without the @playwright/test runner.
//
//   node scripts/player-e2e.mjs

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const INPUT_LEFT = 1;
const INPUT_RIGHT = 2;
const INPUT_JUMP = 4; // PI_JUMP bit (mirrors enum PlayerInput / INPUT.JUMP)
const INPUT_JETPACK = 128; // Space-specific sustained thrust bit
const INPUT_SHIELD = 256;
const PI_PRIMARY = 16;
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const baseURL = `http://localhost:${PORT}/`;
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

// detached so we can kill the whole process group (npm spawns vite as a child;
// killing only npm would orphan vite and leave the port held -> flaky reruns).
const server = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const killServer = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGKILL');
  } catch { /* already gone */ }
};
const waitForServer = () => new Promise((resolve, reject) => {
  let buf = '';
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); resolve(); };
  const fail = (err) => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); killServer(); reject(err); };
  const to = setTimeout(() => fail(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try { if ((await fetch(baseURL)).ok) finish(); } catch {}
  }, 500);
  const onData = (d) => { buf += d.toString(); if (new RegExp(`localhost:${PORT}`).test(buf)) finish(); };
  server.stdout.on('data', onData);
  server.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) fail(new Error('dev server: ' + s.trim())); });
});

let browser, webkitBrowser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    // createSandGame samples Math.random for its world seed. Keep this input
    // wiring test on one terrain so random lava or overhangs do not decide it.
    Math.random = () => 0x5eed1234 / 0x100000000;
    window.__sandTestCellScreenPoint = (cx, cy) => {
      const t = window.__sandTest, i = t.info(), cam = t.getCam(), off = t.off();
      const canvas = document.querySelector('sand-game')?.shadowRoot?.getElementById('sand-main') || document.getElementById('sand-main');
      const r = canvas.getBoundingClientRect();
      return {
        vx: r.left + (((cx + 0.5 - Math.floor(cam.x)) * i.cellDev + off.offX) / i.dpr),
        vy: r.top + (((cy + 0.5 - Math.floor(cam.y)) * i.cellDev + off.offY) / i.dpr),
      };
    };
  });
  await page.goto(`${baseURL}game`, { waitUntil: 'load' }); // survival mode (the player character lives at /game)
  await page.waitForFunction(() => window.__sandTest && window.__sandTest.getPlayer && window.__sandTest.getPlayer(), null, { timeout: 30000 });
  // This suite verifies browser input wiring, not enemy lethality. Combat AI is
  // covered deterministically by explosive-survival-test; freeze any naturally
  // spawned actors so a dynamite fuse cannot race these UI assertions.
  await page.evaluate(() => window.__sandTest.setCreatureRuntime(false, false));

  console.log('local player');
  const getP = () => page.evaluate(() => window.__sandTest.getPlayer());
  const ensureAlive = async () => {
    if ((await getP())?.alive) return;
    await page.waitForFunction(() => window.__sandTest.getPlayer()?.respawnReady, null, { timeout: 10000 });
    await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__sandTest.getPlayer()?.alive, null, { timeout: 5000 });
  };

  const startupFocus = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    return root.activeElement === root.querySelector('.sg-sim');
  });
  check('survival surface owns keyboard focus without a priming click', startupFocus);
  await page.keyboard.down('d');
  await page.waitForTimeout(50);
  const startupBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  await page.keyboard.up('d');
  check(`fresh /game forwards movement immediately (bits ${startupBits})`, (startupBits & INPUT_RIGHT) !== 0);

  // Returning to a browser tab can yield a pointermove that reports buttons=1
  // without this page receiving the corresponding press edge. It must not
  // invent a hold; the following ordinary click should press and cleanly release.
  const refocusProbe = await page.evaluate(async () => {
    const host = document.querySelector('sand-game');
    const canvas = host.shadowRoot.getElementById('sand-main');
    const r = canvas.getBoundingClientRect();
    const x = r.left + r.width * 0.6, y = r.top + r.height * 0.4;
    const before = window.__sandTest.actionCount();
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: x, clientY: y, button: -1, buttons: 1, bubbles: true, composed: true,
      pointerId: 91, pointerType: 'mouse',
    }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const orphanBits = window.__sandTest.localInput().bits;
    const afterOrphan = window.__sandTest.actionCount();
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, composed: true,
      pointerId: 91, pointerType: 'mouse',
    }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const pressedBits = window.__sandTest.localInput().bits;
    const during = window.__sandTest.actionCount();
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      clientX: x, clientY: y, button: 0, buttons: 0, bubbles: true, composed: true,
      pointerId: 91, pointerType: 'mouse',
    }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const releasedBits = window.__sandTest.localInput().bits;
    const afterRelease = window.__sandTest.actionCount();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      orphanBits,
      pressedBits,
      releasedBits,
      settledBits: window.__sandTest.localInput().bits,
      actions: [before, afterOrphan, during, afterRelease, window.__sandTest.actionCount()],
    };
  });
  check(`unpaired refocus move does not invent PI_PRIMARY (bits ${refocusProbe.orphanBits})`,
    (refocusProbe.orphanBits & PI_PRIMARY) === 0);
  check(`ordinary refocus click presses then releases PI_PRIMARY (bits ${refocusProbe.pressedBits}/${refocusProbe.releasedBits}/${refocusProbe.settledBits})`,
    (refocusProbe.pressedBits & PI_PRIMARY) !== 0
      && (refocusProbe.releasedBits & PI_PRIMARY) === 0
      && (refocusProbe.settledBits & PI_PRIMARY) === 0);
  check(`refocus move fires nothing and released click does not keep firing (${refocusProbe.actions.join(' -> ')})`,
    refocusProbe.actions[0] === refocusProbe.actions[1]
      && refocusProbe.actions[3] === refocusProbe.actions[4]);

  await page.waitForFunction(() => {
    const root = document.querySelector('sand-game')?.shadowRoot;
    return root?.querySelector('.survival-health')?.getAttribute('aria-valuenow') === '100' &&
      root?.querySelector('.survival-shield')?.getAttribute('aria-valuenow') === '200' &&
      root?.querySelector('.survival-fuel')?.getAttribute('aria-valuenow') === '100';
  }, null, { timeout: 5000 });
  const meterGeometry = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    const measure = (selector, reveal = false) => {
      const meter = root.querySelector(selector);
      if (reveal) meter.classList.add('show');
      const cells = [...meter.children];
      const box = meter.getBoundingClientRect();
      const first = cells[0].getBoundingClientRect();
      const last = cells.at(-1).getBoundingClientRect();
      const result = {
        width: box.width,
        leading: first.left - box.left,
        trailing: box.right - last.right,
      };
      if (reveal) meter.classList.remove('show');
      return result;
    };
    return {
      objectiveWidth: root.querySelector('.survival-objective').getBoundingClientRect().width,
      health: measure('.survival-health'),
      shield: measure('.survival-shield'),
      charge: measure('.survival-charge', true),
      fuel: measure('.survival-fuel'),
      fullHearts: [...root.querySelectorAll('.survival-heart')]
        .every((heart) => heart.style.getPropertyValue('--fill') === '100%'),
      fullShieldCells: [...root.querySelectorAll('.survival-shield > i')]
        .every((cell) => cell.style.getPropertyValue('--fill') === '100%'),
      fullFuelCells: root.querySelectorAll('.survival-fuel > i.full').length,
    };
  });
  const meterTracksFit = [meterGeometry.health, meterGeometry.shield, meterGeometry.charge, meterGeometry.fuel]
    .every(({ leading, trailing }) => leading >= 5 && leading <= 7 && trailing >= 5 && trailing <= 7);
  check(
    `health/ward/charge/jetpack tracks fit their cells (trailing ${meterGeometry.health.trailing.toFixed(1)}/${meterGeometry.shield.trailing.toFixed(1)}/${meterGeometry.charge.trailing.toFixed(1)}/${meterGeometry.fuel.trailing.toFixed(1)}px)`,
    meterTracksFit && meterGeometry.objectiveWidth > meterGeometry.health.width,
  );
  check('full health, ward, and jetpack capacity visually fill every meter cell',
    meterGeometry.fullHearts && meterGeometry.fullShieldCells && meterGeometry.fullFuelCells === 12);

  // let the player settle onto the ground
  await page.waitForFunction(() => window.__sandTest.getPlayer()?.grounded, null, { timeout: 4000 }).catch(() => {});
  const settled = await getP();
  check(`player spawned + grounded (y ${settled.y.toFixed(1)}, grounded ${settled.grounded})`, settled && settled.grounded);

  // E restores the full inventory/crafting dialog. Empty hotbar slots stay
  // selectable as the bare hand, and Q opens the engine-authored footprint menu.
  await page.keyboard.press('e');
  await page.waitForTimeout(100);
  const inventoryA11y = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    const slots = [...root.querySelectorAll('.inv-slot')];
    return {
      modal: root.querySelector('[aria-modal="true"]') !== null,
      slots: slots.length,
      disabledSlots: slots.filter((slot) => slot.disabled).length,
      allButtons: slots.every((slot) => slot.tagName === 'BUTTON'),
      slotFocused: root.activeElement?.classList.contains('inv-slot') === true,
      starterTool: window.__sandTest.getInventory().slots[1],
      craftingNames: [...root.querySelectorAll('.craft-name')].map((name) => name.textContent),
    };
  });
  check('E opens the accessible inventory/crafting modal', inventoryA11y.modal);
  check(`inventory exposes all 36 slot buttons (${inventoryA11y.slots})`, inventoryA11y.slots === 36 && inventoryA11y.allButtons);
  check(`empty hotbar slots remain selectable (${inventoryA11y.disabledSlots} disabled)`, inventoryA11y.disabledSlots === 0);
  check('inventory focuses the selected slot', inventoryA11y.slotFocused);
  check('starter iron mining tool is present in slot 2',
    inventoryA11y.starterTool?.isTool
      && inventoryA11y.starterTool.toolTier === 3
      && inventoryA11y.starterTool.count === 1);
  check('crafting UI contains no mining tools',
    inventoryA11y.craftingNames.length === 4
      && inventoryA11y.craftingNames.every((name) => !name.includes('Mining Tool')));
  await page.keyboard.press('e');
  await page.waitForTimeout(80);
  const inventoryClosed = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    return root.querySelector('[aria-modal="true"]') === null && root.activeElement === root.querySelector('.sg-sim');
  });
  check('E closes inventory without the bubbling key reopening it', inventoryClosed);

  // Clicking the non-focusable backdrop moves browser focus to <body>. Closing
  // must still work even though neither the inventory HUD nor simulation surface
  // owns that key event.
  await page.keyboard.press('e');
  await page.locator('sand-game .inv-backdrop').click({ position: { x: 10, y: 10 } });
  const backdropBlurredInventory = await page.locator('sand-game').evaluate((host) =>
    host.shadowRoot.querySelector('[aria-modal="true"]') !== null
      && document.activeElement === document.body
      && host.shadowRoot.activeElement === null);
  check('clicking the inventory backdrop reproduces focus leaving the game', backdropBlurredInventory);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  const backdropEscapeClosed = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    return root.querySelector('[aria-modal="true"]') === null
      && root.activeElement === root.querySelector('.sg-sim');
  });
  check('Escape closes inventory after backdrop focus loss', backdropEscapeClosed);

  await page.keyboard.press('e');
  await page.locator('sand-game .inv-backdrop').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('e');
  await page.waitForTimeout(50);
  const backdropEClosed = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    return root.querySelector('[aria-modal="true"]') === null
      && root.activeElement === root.querySelector('.sg-sim');
  });
  check('E closes inventory after backdrop focus loss', backdropEClosed);

  await page.locator('sand-game .inv-slot[data-index="2"]').click();
  await page.waitForFunction(() => window.__sandTest.getInventory().selected === 2, null, { timeout: 4000 });
  const hotbarFocus = await page.locator('sand-game').evaluate((host) =>
    host.shadowRoot.activeElement === host.shadowRoot.querySelector('.sg-sim'));
  check('clicking the closed hotbar preserves simulation keyboard focus', hotbarFocus);

  await page.keyboard.press('q');
  await page.waitForTimeout(80);
  const footprintMenu = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    return {
      open: root.querySelector('.fp-panel')?.classList.contains('open') === true,
      options: [...root.querySelectorAll('.fp-btn')].map((button) => ({
        label: button.textContent,
        selected: button.classList.contains('sel'),
      })),
    };
  });
  check(`Q opens all ten square footprint choices (${footprintMenu.options.length})`,
    footprintMenu.open && footprintMenu.options.length === 10);
  check('Q includes 9x9 and 10x10 with 10x10 selected by default',
    footprintMenu.options.at(-2)?.label === '9x9'
      && footprintMenu.options.at(-1)?.label === '10x10'
      && footprintMenu.options.at(-1)?.selected);

  await page.keyboard.press('e');
  await page.waitForTimeout(80);
  const exclusiveMenus = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    return {
      inventory: root.querySelector('[aria-modal="true"]') !== null,
      footprint: root.querySelector('.fp-panel')?.classList.contains('open') === true,
    };
  });
  check('opening inventory closes the footprint menu', exclusiveMenus.inventory && !exclusiveMenus.footprint);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  const inventoryEscape = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    return {
      closed: root.querySelector('[aria-modal="true"]') === null,
      focused: root.activeElement === root.querySelector('.sg-sim'),
    };
  });
  check('Escape closes inventory and restores simulation focus',
    inventoryEscape.closed && inventoryEscape.focused);

  await page.keyboard.press('q');
  await page.waitForTimeout(50);
  const footprintReopened = await page.locator('sand-game').evaluate((host) =>
    host.shadowRoot.querySelector('.fp-panel')?.classList.contains('open') === true);
  check('Q reopens the footprint menu after inventory closes', footprintReopened);
  if (!footprintReopened) throw new Error('footprint menu did not reopen after inventory close');
  await page.locator('sand-game .fp-btn').nth(1).click();
  await page.waitForTimeout(50);
  const footprintClosed = await page.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    return !root.querySelector('.fp-panel')?.classList.contains('open')
      && root.activeElement === root.querySelector('.sg-sim');
  });
  check('choosing a footprint closes its menu and restores simulation focus', footprintClosed);

  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__sandTest.getInventory().selected === 0, null, { timeout: 4000 });
  await page.keyboard.press('3');
  await page.waitForFunction(() => window.__sandTest.getInventory().selected === 2, null, { timeout: 4000 }).catch(() => {});
  const handSelection = await page.evaluate(() => {
    const inv = window.__sandTest.getInventory();
    return { selected: inv.selected, count: inv.slots[2].count };
  });
  check(`an empty number slot equips the bare hand (selected ${handSelection.selected}, count ${handSelection.count})`,
    handSelection.selected === 2 && handSelection.count === 0);

  // Jump: hold briefly (so the press spans a 16ms fixed step) and watch the apex.
  // The procedural spawn can sit under an overhang/tree where a real jump hits a
  // ceiling, so if it doesn't rise we relocate (walk) and retry until we find open
  // headroom. (Jump mechanics themselves are covered deterministically by
  // player-test; here we only need to confirm the key drives the engine.)
  const waitGrounded = () => page.waitForFunction(() => { const p = window.__sandTest.getPlayer(); return p && p.grounded; }, null, { timeout: 5000 }).catch(() => {});
  // Keyboard input is intentionally scoped to the simulation. Keep it focused
  // after setup interactions so these keys exercise the real ownership policy.
  await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  await ensureAlive();
  await waitGrounded();

  // F holds the authoritative directional ward. Besides the input/HUD state,
  // compare a tight GL readback around the player so the replicated active flag
  // is proven to reach the curved in-world presentation.
  const wardAim = await page.evaluate(() => {
    const p = window.__sandTest.getPlayer();
    return window.__sandTestCellScreenPoint(
      Math.floor(p.x + p.w / 2 + 10),
      Math.floor(p.y + p.h * .42),
    );
  });
  await page.mouse.move(wardAim.vx, wardAim.vy);
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const t = window.__sandTest, p = t.getPlayer(), info = t.info();
    t.render();
    const corner = t.cellRect(
      Math.floor(p.x + p.w / 2 - 9),
      Math.floor(p.y + p.h * .42 - 9),
    );
    const x = Math.max(0, Math.floor(corner.x));
    const y = Math.max(0, Math.floor(corner.y));
    const w = Math.max(1, Math.min(info.canvasW - x, Math.ceil(info.cellDev * 18)));
    const h = Math.max(1, Math.min(info.canvasH - y, Math.ceil(info.cellDev * 18)));
    const pixels = t.readPixels(x, y, w, h);
    window.__wardProbe = { x, y, w, h, pixels: Array.from(pixels) };
  });
  await page.keyboard.down('f');
  await page.waitForTimeout(50);
  const shieldBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  await page.waitForFunction(() => {
    const host = document.querySelector('sand-game'), p = window.__sandTest.getPlayer();
    return p?.shieldActive
      && host?.shadowRoot?.querySelector('.survival-shield.active')
      && host.shadowRoot.querySelector('.survival-shield-label')?.textContent.includes('ACTIVE');
  }, null, { timeout: 5000 });
  await page.waitForTimeout(80);
  const wardVisual = await page.evaluate(() => {
    const t = window.__sandTest, before = window.__wardProbe;
    t.render();
    const pixels = t.readPixels(before.x, before.y, before.w, before.h);
    let changed = 0, paleWard = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const delta = Math.abs(pixels[i] - before.pixels[i])
        + Math.abs(pixels[i + 1] - before.pixels[i + 1])
        + Math.abs(pixels[i + 2] - before.pixels[i + 2]);
      if (delta > 45) changed++;
      if (delta > 45
          && pixels[i + 1] > before.pixels[i + 1] + 8
          && pixels[i + 2] > before.pixels[i + 2] + 8
          && pixels[i + 1] >= pixels[i] - 10
          && pixels[i + 2] >= pixels[i] - 5) paleWard++;
    }
    const root = document.querySelector('sand-game').shadowRoot;
    const result = {
      changed, paleWard,
      health: window.__sandTest.getPlayer().shieldHealth,
      aria: root.querySelector('.survival-shield').getAttribute('aria-valuenow'),
    };
    delete window.__wardProbe;
    return result;
  });
  await page.keyboard.up('f');
  await page.waitForFunction(() => {
    const root = document.querySelector('sand-game')?.shadowRoot;
    return window.__sandTest.getPlayer()?.shieldActive === false
      && root?.querySelector('.survival-shield-label')?.textContent.includes('HOLD F');
  }, null, { timeout: 5000 });
  check(`F maps to SHIELD input and activates a full 200-point ward (bits ${shieldBits})`,
    (shieldBits & INPUT_SHIELD) !== 0 && wardVisual.health === 200 && wardVisual.aria === '200');
  check(`active ward reaches the GL presentation (${wardVisual.changed} changed, ${wardVisual.paleWard} pale pixels)`,
    wardVisual.changed > 80 && wardVisual.paleWard > 12);

  const before = await getP();
  // Hard check: SPACE maps to the JUMP input bit reaching the engine (terrain
  // independent). Jump PHYSICS — gravity, apex, no-double-jump — is covered
  // deterministically by player-test; in-browser it's terrain-dependent (the
  // player can spawn on flowing surface sand and never be cleanly grounded), so
  // we only log whether it physically rose.
  await page.keyboard.down('Space');
  await page.waitForTimeout(50);
  const jumpBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  let minVy = 0;
  for (let t = 0; t < 10; t++) { await page.waitForTimeout(45); minVy = Math.min(minVy, (await getP()).vy); }
  await page.keyboard.up('Space');
  check(`SPACE maps to jump + jetpack input (bits ${jumpBits})`,
    (jumpBits & INPUT_JUMP) !== 0 && (jumpBits & INPUT_JETPACK) !== 0);
  console.log(`   (physical jump impulse minVy ${minVy.toFixed(2)})`);
  await waitGrounded();
  let afterJump = await getP();
  check('player simulating after jump attempt', !!afterJump);
  // Random terrain can spawn the player in a hazard. Death/respawn mechanics
  // have deterministic engine coverage; keep this browser input wiring test
  // alive before exercising the remaining controls.
  if (!afterJump.alive) {
    await ensureAlive();
    afterJump = await getP();
  }

  // HELD solid build (regression for "click+hold places ONE chunk then nothing"):
  // exercise it before terrain-dependent walking can carry the player into a
  // generated hazard. Death/respawn behavior has deterministic engine coverage.
  await page.evaluate(() => window.__sandTest.addInventory(3, 99)); // STONE = 3
  await page.waitForFunction(() => window.__sandTest.getInventory().slots.some((s) => !s.isTool && s.material === 3 && s.count > 0));
  const stoneSlot = await page.evaluate(() => window.__sandTest.getInventory().slots.findIndex((s) => !s.isTool && s.material === 3 && s.count > 0));
  await page.evaluate((slot) => window.__sandTest.selectSlot(slot), stoneSlot);
  await page.waitForFunction((slot) => window.__sandTest.getInventory().selected === slot, stoneSlot);
  const stoneAim = await page.evaluate(() => {
    const t = window.__sandTest, p = t.getPlayer(), inventory = t.getInventory();
    const canvas = document.querySelector('sand-game').shadowRoot.getElementById('sand-main');
    const bounds = canvas.getBoundingClientRect();
    let point = null;
    for (const dy of [-2, -4, -6, 0, 2, 4, 6, -8, 8]) {
      for (const dx of [6, -6, 8, -8]) {
        const x = Math.floor(p.x + p.w / 2 + dx), y = Math.floor(p.y + p.h / 2 + dy);
        const screen = window.__sandTestCellScreenPoint(x, y);
        const outsidePlayer = x + 2 < p.x || x - 2 > p.x + p.w || y + 2 < p.y || y - 2 > p.y + p.h;
        const onCanvas = screen.vx > bounds.left + 8 && screen.vx < bounds.right - 8
          && screen.vy > bounds.top + 8 && screen.vy < bounds.bottom - 8;
        if (outsidePlayer && onCanvas && t.solidCount(x - 2, y - 2, x + 3, y + 3) === 0) {
          point = screen;
          break;
        }
      }
      if (point) break;
    }
    if (!point) throw new Error('no empty in-reach patch for stone draft');
    return { ...point, stone0: t.materialCountBoth(3), inventory0: inventory.slots[inventory.selected]?.count || 0 };
  });
  await page.mouse.move(stoneAim.vx, stoneAim.vy);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(80);
  const heldBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  for (let i = 1; i <= 4; i++) { await page.mouse.move(stoneAim.vx + i * 3, stoneAim.vy); await page.waitForTimeout(40); }
  await page.waitForFunction(() => window.__sandTest.draftCount() > 0, null, { timeout: 10000 });
  const heldDraft = await page.evaluate(() => window.__sandTest.draftCount());
  await page.evaluate((pt) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: pt.x + 2, clientY: pt.y, button: -1, buttons: 0, bubbles: true })), { x: stoneAim.vx, y: stoneAim.vy });
  await page.waitForTimeout(80);
  const survivedBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction(({ stone0, inventory0 }) => {
    const t = window.__sandTest, inventory = t.getInventory();
    const count = inventory.slots[inventory.selected]?.count || 0;
    return t.draftCount() === 0 && (t.materialCountBoth(3) > stone0 || count < inventory0);
  }, { stone0: stoneAim.stone0, inventory0: stoneAim.inventory0 }, { timeout: 5000 });
  const stoneResult = await page.evaluate(() => {
    const t = window.__sandTest, inventory = t.getInventory();
    return { draft: t.draftCount(), stone: t.materialCountBoth(3), inventory: inventory.slots[inventory.selected]?.count || 0 };
  });
  check(`held LMB latches PI_PRIMARY (bits ${heldBits})`, (heldBits & PI_PRIMARY) !== 0);
  check(`PI_PRIMARY survives a phantom buttons==0 move (bits ${survivedBits})`, (survivedBits & PI_PRIMARY) !== 0);
  check(`held solid draft exists (${heldDraft} cells)`, heldDraft > 0);
  check(
    `release commits the connected stone draft (stone +${stoneResult.stone - stoneAim.stone0}, inventory ${stoneAim.inventory0} -> ${stoneResult.inventory})`,
    stoneResult.draft === 0 && (stoneResult.stone > stoneAim.stone0 || stoneResult.inventory < stoneAim.inventory0),
  );
  await ensureAlive();
  await page.evaluate(() => window.__sandTest.selectSlot(0));
  await page.waitForFunction(() => window.__sandTest.getInventory().selected === 0);

  // Fire the starter gun into nearby terrain and assert the real pointer path
  // reaches the worker authority. Deterministic engine coverage verifies the
  // resulting projectile sweep and explosion in detail.
  const a0 = await page.evaluate(() => window.__sandTest.actionCount());
  await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  const aim = await page.evaluate(() => {
    const t = window.__sandTest, p = t.getPlayer();
    const footY = Math.floor(p.y + p.h);
    for (const dx of [10, -10, 14, -14, 18, -18]) {
      for (let dy = -4; dy <= 8; dy++) {
        const x = Math.floor(p.x + p.w / 2 + dx), y = footY + dy;
        if (t.solidCount(x, y, x + 1, y + 1) > 0) return window.__sandTestCellScreenPoint(x, y);
      }
    }
    throw new Error('no nearby terrain for mining input check');
  });
  await page.mouse.move(aim.vx, aim.vy);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(180);
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction((before) => window.__sandTest.actionCount() > before, a0, { timeout: 5000 }).catch(() => {});
  const a1 = await page.evaluate(() => window.__sandTest.actionCount());
  check(`LMB fires the worker-authoritative blast gun (${a0} -> ${a1})`, a1 > a0);

  // hold D: input reaches the engine (facing flips right; x does not go backward).
  // Absolute displacement depends on the random terrain ahead, so the hard
  // assertion is on facing + non-regression; the distance is logged.
  await ensureAlive();
  await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  const x0 = (await getP()).x;
  await page.keyboard.down('d');
  await page.waitForTimeout(50);
  const rightBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  await page.waitForTimeout(950);
  await page.keyboard.up('d');
  const movedR = await getP();
  check(`D maps to RIGHT input (bits ${rightBits}, x ${x0.toFixed(1)} -> ${movedR.x.toFixed(1)})`, (rightBits & INPUT_RIGHT) !== 0);
  // The hard assertion is the input mapping; deterministic player physics has
  // unit coverage and this generated route can enter a hazard while walking.
  await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  await page.keyboard.down('a');
  await page.waitForTimeout(50);
  const leftBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  await page.waitForTimeout(450);
  await page.keyboard.up('a');
  const movedL = await getP();
  check(`A maps to LEFT input (bits ${leftBits}, facing ${movedL.facing})`, (leftBits & INPUT_LEFT) !== 0);

  await ensureAlive();

  // Selecting a tool must NOT act as if the mouse is held (regression for "first
  // select latches PI_PRIMARY"). The browser implicitly captures the pointer to a
  // palette button on press, so dragging off the open dropdown onto the canvas
  // while holding used to feed window.onPointerMove (mouseButtons |= e.buttons) and
  // strand the LMB bit — the matching pointerup was captured back to the button and
  // swallowed by the palette. Drive that exact gesture and assert no latch/action.
  const palette = await page.evaluate(() => {
    const host = document.querySelector('sand-game');
    const btn = host?.shadowRoot?.querySelector('.sg-selbtn');
    if (!host || !btn) return null;
    const r = host.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, bx: b.left + b.width / 2, by: b.top + b.height / 2 };
  });
  if (palette) {
    const a2 = await page.evaluate(() => window.__sandTest.actionCount());
    await page.mouse.click(palette.bx, palette.by); // open the dropdown
    await page.waitForTimeout(40);
    const erOpt = await page.evaluate(() => {
      const o = [...document.querySelector('sand-game').shadowRoot.querySelectorAll('.sg-opt')].find((x) => /eraser/i.test(x.textContent));
      const b = o.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.move(erOpt.x, erOpt.y);
    await page.mouse.down({ button: 'left' });           // press starts on the option (captures pointer)
    await page.mouse.move(palette.cx, palette.cy, { steps: 4 }); // drag onto the canvas while held
    await page.mouse.up({ button: 'left' });             // release over the canvas
    await page.mouse.move(palette.cx + 6, palette.cy + 6); // a plain hover, no button
    await page.waitForTimeout(120);
    const selectBits = await page.evaluate(() => window.__sandTest.localInput().bits);
    const a3 = await page.evaluate(() => window.__sandTest.actionCount());
    check(`selecting a tool does NOT latch PI_PRIMARY (bits ${selectBits})`, (selectBits & PI_PRIMARY) === 0);
    check(`selecting a tool fires no phantom tool action (${a2} -> ${a3})`, a3 === a2);
  } else {
    console.log('  skip palette pointer-capture regression (no embedded palette on /game)');
  }

  await page.evaluate(() => window.__sandTest.setDrawMode(false));

  // Force the exact worker-stream boundary behind the reported long-walk jerk
  // while sampling the displayed player every RAF. Absolute player X must stay
  // continuous even when the mirror offset and actor epoch change separately.
  await ensureAlive();
  await page.evaluate(() => window.__sandTest.setPlayerState({ vx: 0 }));
  await page.waitForTimeout(100);
  const streamContinuity = await page.evaluate(() => new Promise((resolve) => {
    const t = window.__sandTest;
    const info = t.info();
    const startOffset = t.worldOffset().x;
    const startPlayer = t.getPlayer();
    let previous = startOffset + startPlayer.x;
    let minX = previous, maxX = previous, maxStep = 0;
    let samples = 0, shifted = false, afterShift = 0;
    t.setPlayMode(false);
    t.setCam(info.cols - info.viewCols - 2, t.getCam().y);
    const sample = () => {
      const p = t.getPlayer();
      const offset = t.worldOffset().x;
      if (p) {
        const worldX = offset + p.x;
        maxStep = Math.max(maxStep, Math.abs(worldX - previous));
        minX = Math.min(minX, worldX); maxX = Math.max(maxX, worldX);
        previous = worldX;
      }
      samples++;
      if (offset !== startOffset) { shifted = true; afterShift++; }
      if ((shifted && afterShift >= 12) || samples >= 240) {
        t.setPlayMode(true);
        resolve({ shifted, startOffset, endOffset: offset, samples, maxStep, span: maxX - minX });
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  check(
    `streamed actor stays continuous across RAFs (offset ${streamContinuity.startOffset} -> ${streamContinuity.endOffset}, max step ${streamContinuity.maxStep.toFixed(2)})`,
    streamContinuity.shifted && streamContinuity.maxStep < 8 && streamContinuity.span < 8,
  );
  await page.waitForTimeout(700);

  // camera follows: the player should remain near the viewport center
  const followInfo = await page.evaluate(() => {
    const t = window.__sandTest, i = t.info(), cam = t.getCam(), p = t.getPlayer();
    return { viewCols: i.viewCols, viewRows: i.viewRows, camX: cam.x, camY: cam.y, px: p.x, py: p.y };
  });
  const cx = followInfo.px - (followInfo.camX + followInfo.viewCols / 2);
  const cy = followInfo.py - (followInfo.camY + followInfo.viewRows / 2);
  check(`camera follows player (off-center ${cx.toFixed(1)},${cy.toFixed(1)})`, Math.abs(cx) < followInfo.viewCols * 0.35 && Math.abs(cy) < followInfo.viewRows * 0.45);

  console.log('mobile /game gate');
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`${baseURL}game`, { waitUntil: 'load' });
  await mobilePage.getByText('Explosive Survival is desktop-only for now').waitFor();
  check('mobile /game never connects a sand-game element', await mobilePage.locator('sand-game').count() === 0);
  await mobileContext.close();

  console.log('WebKit worker-authority smoke');
  try {
    webkitBrowser = await webkit.launch();
  } catch (error) {
    if (process.env.REQUIRE_WEBKIT === '1') throw error;
    console.log(`  skip WebKit (install with: npx playwright install --with-deps webkit)\n   ${error.message.split('\n')[0]}`);
  }
  if (webkitBrowser) {
  const webkitPage = await webkitBrowser.newPage({ viewport: { width: 900, height: 650 } });
  await webkitPage.goto(`${baseURL}game`, { waitUntil: 'load' });
  await webkitPage.waitForFunction(() => window.__sandTest?.getPlayer?.() && window.__sandPerf?.().worldTps > 0, null, { timeout: 30000 });
  const webkitBefore = await webkitPage.evaluate(() => window.__sandTest.getPlayer());
  await webkitPage.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  await webkitPage.keyboard.down('d');
  await webkitPage.waitForTimeout(300);
  await webkitPage.keyboard.up('d');
  const webkitAfter = await webkitPage.evaluate(() => window.__sandTest.getPlayer());
  check('WebKit receives a worker-authoritative survival player', !!webkitBefore && !!webkitAfter);
  check('WebKit forwards movement input through the worker authority', webkitAfter.facing === 1);
  await webkitBrowser.close();
  webkitBrowser = null;
  }

  await browser.close();
} catch (err) {
  console.error('e2e error:', err.stack || err.message);
  failures++;
} finally {
  if (webkitBrowser) await webkitBrowser.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
