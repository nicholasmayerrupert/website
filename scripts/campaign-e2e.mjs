// Continuous Earth journey: ordinary movement, NPC conversations, field journal,
// tracking, scoped repair, and viewport layout use the real authority worker.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBrowserCases } from './browser-harness.mjs';
import { CREATURE, MISSION, PLANET } from '../src/sand/wasmBridge/abi.generated.js';
import { MAT } from '../src/sand/materials.js';
const artifacts = resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/frontier-browser');
mkdirSync(artifacts, { recursive: true });
process.exitCode = await runBrowserCases({
  frontier: async ({ page, baseURL, check }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/game`);
    await page.waitForFunction(() => document.querySelector('sand-game')?._ready && window.__sandTest?.getPlayer(), null, { timeout: 60000 });
    await page.getByRole('button', { name: 'Start exploring' }).click();
    await page.evaluate(() => document.fonts.load('18px "Sand Pixel"'));
    const checkPixelFonts = async (screen) => {
      const missing = await page.evaluate(() => {
        const roots = [document.querySelector('main'), document.querySelector('sand-game').shadowRoot];
        return roots.flatMap(root => [...root.querySelectorAll('*')]).filter(node =>
          node.getBoundingClientRect().width && [...node.childNodes].some(child =>
            child.nodeType === Node.TEXT_NODE && child.textContent.trim())
          && !getComputedStyle(node).fontFamily.includes('Sand Pixel')).map(node => node.className || node.tagName);
      });
      check(`${screen} uses pixel text throughout`, missing.length === 0, missing.join(', '));
    };
    await checkPixelFonts('Game HUD');

    check('expedition has a readable title and an unobstructed canvas', await page.evaluate(() => {
      const heading = document.querySelector('.frontier-header');
      const canvas = document.querySelector('sand-game').shadowRoot.querySelector('canvas');
      return heading?.textContent.includes('ASTER') && canvas.getBoundingClientRect().height > 300;
    }));
    check('arrive in the continuous Earth expedition with three open jobs', await page.evaluate(({ mission, planet }) => {
      const game = document.querySelector('sand-game')._game;
      return game.getMission().missionId === mission && game.getPlanetState().id === planet
        && game.getMission().objectives.filter(o => o.state === 1).length === 3;
    }, { mission: MISSION.FRONTIER, planet: PLANET.FRONTIER }));
    await page.waitForTimeout(450);
    await page.screenshot({ path: resolve(artifacts, 'hearthwood-lodge.png') });
    const startX = await page.evaluate(() => window.__sandTest.getPlayer().x);
    await page.keyboard.down('a'); await page.waitForTimeout(450); await page.keyboard.up('a');
    check('player can walk through the lodge immediately', await page.evaluate(x => window.__sandTest.getPlayer().x < x - 1, startX));
    // Walk to Vale using normal controls, preserving the initial terrain.
    for (let i = 0; i < 100; i++) {
      const dx = await page.evaluate(species => {
        const p = window.__sandTest.getPlayer();
        const c = window.__sandTest.getCreatures().find(c => c.species === species);
        return c ? c.x - p.x : null;
      }, CREATURE.IRIS_COMMANDER);
      if (dx === null) throw new Error('Commander not present');
      if (Math.abs(dx) < 16) break;
      const direction = dx < 0 ? 'a' : 'd';
      await page.keyboard.down(direction); await page.waitForTimeout(100); await page.keyboard.up(direction);
    }
    await page.keyboard.press('t');
    await page.getByRole('dialog', { name: 'Conversation' }).waitFor();
    await checkPixelFonts('Conversation');
    await page.getByRole('dialog', { name: 'Conversation' }).getByRole('button', { name: 'Field journal' }).click();
    await page.getByRole('dialog', { name: 'Field journal' }).waitFor();
    await checkPixelFonts('Journal');
    check('journal uses plain headings and job instructions', await page.getByRole('heading', { name: 'Field journal', exact: true }).count() === 1
      && !(await page.locator('main').innerText()).includes('world worth getting lost'));
    check('commander opens the new field journal', !(await page.locator('main').innerText()).includes('Greenfall'));
    await page.screenshot({ path: resolve(artifacts, 'field-journal.png') });
    await page.getByRole('button', { name: /02 The drowned archive/ }).click();
    await page.getByRole('button', { name: 'Track this destination' }).click();
    check('tracking keeps the same expedition active', await page.locator('sand-game').getAttribute('data-tracked-objective') === '1');
    await page.keyboard.press('j');
    for (const [width, height] of [[1440, 900], [900, 650], [768, 384], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.getByRole('button', { name: 'Track this destination' }).scrollIntoViewIfNeeded();
      const box = await page.getByRole('button', { name: 'Track this destination' }).boundingBox();
      check(`journal action remains reachable at ${width}x${height}`, box.y >= 0 && box.y + box.height <= height && box.x >= 0 && box.x + box.width <= width);
      check(`no horizontal page overflow at ${width}x${height}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.screenshot({ path: resolve(artifacts, 'field-journal-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Close panel' }).click();
    // The maintenance radio is the recovery route when a destroyed floor blocks Osei.
    await page.getByRole('button', { name: 'Pause expedition' }).click();
    await page.getByRole('button', { name: 'Call Osei' }).click();
    await page.getByRole('button', { name: 'Restore Hearthwood Lodge' }).click();
    await page.waitForTimeout(1200);
    check('repair leaves the same mission and all open jobs intact', await page.evaluate(() => document.querySelector('sand-game')._game.getMission().objectives.filter(o => o.state === 1).length === 3));
    check('no browser runtime errors', errors.length === 0, errors.join('; '));
    await page.screenshot({ path: resolve(artifacts, 'lodge-repaired.png') });
    const missionBeforeDeath = await page.evaluate(() => document.querySelector('sand-game')._game.getMission());
    for (const method of ['button', 'keyboard']) {
      // Real authority damage drives the death UI; the world stays paused while
      // actor turns advance so the lava fixture cannot drain between assertions.
      await page.evaluate(lava => {
        const test = window.__sandTest, offset = test.worldOffset();
        test.setPlayerState({ x: -260 - offset.x, y: -offset.y, vx: 0, vy: 0 });
        test.paintWorker(lava, -258 - offset.x, 5 - offset.y, 12);
        test.stepAuthorityActors(240);
      }, MAT.LAVA);
      await page.waitForFunction(() => window.__sandTest.getPlayer()?.alive === false, null, { timeout: 10000 });
      const respawn = page.getByRole('button', { name: 'RESPAWN', exact: true });
      await checkPixelFonts('Death dialog');
      check(`death exposes a visible respawn button (${method})`, await respawn.isVisible());
      check('death does not label the expedition as failed', await page.locator('sand-game').evaluate(host =>
        getComputedStyle(host.shadowRoot.querySelector('.survival-death-card'), '::before').content !== '"MISSION FAILED"'));
      if (method === 'button') await respawn.click();
      else await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__sandTest.getPlayer()?.alive, null, { timeout: 10000 });
      check(`respawn returns the player to the lodge (${method})`, await page.evaluate(() => {
        const p = window.__sandTest.getPlayer(), offset = window.__sandTest.worldOffset();
        return p.health === 100 && Math.abs(p.x + offset.x) < 50;
      }));
      check('respawn preserves the expedition and objective states', await page.evaluate(before => {
        const after = document.querySelector('sand-game')._game.getMission();
        return after.missionId === before.missionId && after.phase === before.phase
          && after.objectives.every((o, i) => o.state === before.objectives[i].state);
      }, missionBeforeDeath));
      check('death screen closes after respawn', !(await respawn.isVisible()));
    }
  },
});
