// The Earth player journey uses real worker state and real weapon/beam input.
// Actor positioning shortens travel; objective completion is never synthesized.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBrowserCases } from './browser-harness.mjs';
import {
  CREATURE,
  ITEM_KIND,
  MISSION_PHASE,
} from '../src/sand/wasmBridge/abi.generated.js';

const artifacts = resolve(
  process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/earth-polish',
);
mkdirSync(artifacts, { recursive: true });

async function focusGame(page) {
  await page.locator('sand-game').locator('.sg-sim').focus();
}

async function aimAtActor(page, id) {
  const point = await page.evaluate((id) => {
    const actor = window.__sandTest
      .getCreatures()
      .find((c) => c.id === id && c.alive);
    if (!actor) return null;
    const cell = window.__sandTest.cellRect(
      actor.x + actor.w / 2,
      actor.y + actor.h / 2,
    );
    const box = document
      .querySelector('sand-game')
      .shadowRoot.querySelector('canvas')
      .getBoundingClientRect();
    return {
      x: box.x + cell.x / devicePixelRatio,
      y: box.y + cell.y / devicePixelRatio,
    };
  }, id);
  if (point) await page.mouse.move(point.x, point.y);
  return !!point;
}

async function useToolOnActor(page, actor, key) {
  await page.evaluate(
    ({ actor, key }) =>
      window.__sandTest.setPlayerState({
        x: key === '3' ? actor.x + actor.w + 5 : actor.x - 20,
        y: actor.y - 3,
        vx: 0,
        vy: 0,
      }),
    { actor, key },
  );
  await page.waitForTimeout(350);
  await focusGame(page);
  await page.keyboard.press(key);
  await aimAtActor(page, actor.id);
  await page.mouse.down();
  try {
    for (let tick = 0; tick < 80 && (await aimAtActor(page, actor.id)); tick++)
      await page.waitForTimeout(100);
  } finally {
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
}

async function deploy(page) {
  await page.getByRole('button', { name: 'Deploy' }).click({ timeout: 45000 });
  await page.locator('.iris-phase-field').waitFor({ timeout: 45000 });
  await page.waitForFunction(
    () =>
      document.querySelector('sand-game')._game.getMission()?.objectives
        .length && window.__sandTest?.getPlayer(),
  );
}

process.exitCode = await runBrowserCases(
  {
    earth: async ({ page, baseURL, check }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${baseURL}/game`);
      await page.waitForFunction(
        () =>
          document.querySelector('sand-game')?._ready &&
          window.__sandTest?.getPlayer(),
      );
      check(
        'first arrival shows the playable ship without a briefing overlay',
        (await page.locator('sand-game[planet="ship"]').count()) === 1 &&
          (await page.getByRole('dialog').count()) === 0,
      );
      const spawnX = await page.evaluate(() => window.__sandTest.getPlayer().x);
      await page.keyboard.down('d');
      await page.waitForTimeout(350);
      await page.keyboard.up('d');
      check(
        'ship controls work immediately on arrival',
        await page.evaluate(
          (x) => Math.abs(window.__sandTest.getPlayer().x - x) > 1,
          spawnX,
        ),
      );
      await page.screenshot({ path: resolve(artifacts, 'ship.png') });
      await page
        .getByRole('button', { name: 'Earth mission', exact: true })
        .click();
      check(
        'mission selection is a compact panel over the ship',
        (
          await page
            .getByRole('dialog', { name: 'Earth mission' })
            .boundingBox()
        ).width <= 650,
      );
      for (const [width, height] of [
        [1440, 900],
        [900, 650],
        [768, 384],
      ]) {
        await page.setViewportSize({ width, height });
        await page
          .getByRole('button', { name: 'Deploy' })
          .scrollIntoViewIfNeeded();
        const bounds = await page
          .getByRole('button', { name: 'Deploy' })
          .boundingBox();
        check(
          `briefing deployment remains reachable at ${width}×${height}`,
          bounds.x >= 0 &&
            bounds.y >= 0 &&
            bounds.x + bounds.width <= width &&
            bounds.y + bounds.height <= height,
        );
        check(
          `briefing does not overflow horizontally at ${width}×${height}`,
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page
        .locator('.iris-briefing section')
        .evaluate((n) => (n.scrollTop = 0));
      await page.screenshot({ path: resolve(artifacts, 'briefing.png') });
      await page.getByRole('button', { name: 'Close mission' }).click();
      await focusGame(page);
      const shipX = await page.evaluate(() => window.__sandTest.getPlayer().x);
      await page.keyboard.down('d');
      await page.waitForTimeout(350);
      await page.keyboard.up('d');
      check(
        'exploring the ship restores actual player movement',
        await page.evaluate(
          (x) => Math.abs(window.__sandTest.getPlayer().x - x) > 1,
          shipX,
        ),
      );
      for (let step = 0; step < 100; step++) {
        const dx = await page.evaluate((commanderSpecies) => {
          const player = window.__sandTest.getPlayer();
          const commander = window.__sandTest
            .getCreatures()
            .find((c) => c.species === commanderSpecies);
          return commander.x + commander.w / 2 - player.x - player.w / 2;
        }, CREATURE.IRIS_COMMANDER);
        if (Math.abs(dx) < 18) break;
        const key = dx > 0 ? 'd' : 'a';
        await page.keyboard.down(key);
        await page.waitForTimeout(100);
        await page.keyboard.up(key);
      }
      await page.waitForTimeout(150);
      await page.keyboard.press('t');
      await page.getByRole('dialog', { name: 'Conversation' }).waitFor();
      check(
        'T opens a nearby crew conversation through ordinary ship movement',
        true,
      );
      await page
        .getByRole('dialog', { name: 'Conversation' })
        .getByRole('button', { name: 'Earth mission' })
        .click();
      await deploy(page);
      const initial = await page.evaluate(() => ({
        mission: document.querySelector('sand-game')._game.getMission(),
        inventory: document.querySelector('sand-game')._game.getInventory(),
      }));
      check(
        'Earth deployment starts three authoritative objectives with beam on 3',
        initial.mission.objectives.length === 3 &&
          initial.mission.phase === MISSION_PHASE.ACTIVE &&
          initial.inventory.slots[2].itemKind === ITEM_KIND.RESCUE_BEAM,
      );
      await page.screenshot({ path: resolve(artifacts, 'landing.png') });
      await focusGame(page);
      await page.keyboard.press('j');
      await page.getByRole('dialog', { name: 'Quest journal' }).waitFor();
      check(
        'J opens the active quest journal',
        await page
          .getByRole('tabpanel', { name: 'Active' })
          .innerText()
          .then((t) => t.includes('Disable the jammer')),
      );
      await page.getByRole('tab', { name: 'Completed' }).click();
      check(
        'completed tab is empty before the first rescue',
        await page
          .getByRole('tabpanel', { name: 'Completed' })
          .innerText()
          .then((t) => t.includes('No completed quests')),
      );
      await page.getByRole('tab', { name: 'Active' }).click();
      await page.screenshot({ path: resolve(artifacts, 'journal.png') });
      await page.keyboard.press('Escape');
      await page
        .getByRole('dialog', { name: 'Quest journal' })
        .waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Pause expedition' }).click();
      await page.waitForTimeout(150);
      const paused = await page.evaluate(
        () =>
          document.querySelector('sand-game')._game.getMission().elapsedTicks,
      );
      await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange')),
      );
      await page.waitForTimeout(500);
      check(
        'pause survives visibility changes and freezes authority time',
        await page.evaluate(
          (t) =>
            document.querySelector('sand-game')._game.getMission()
              .elapsedTicks === t,
          paused,
        ),
      );
      await page.getByRole('button', { name: 'Sound on', exact: true }).click();
      check(
        'sound setting persists',
        await page.evaluate(
          () => localStorage.getItem('sand-audio-muted') === '1',
        ),
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        (t) =>
          document.querySelector('sand-game')._game.getMission().elapsedTicks >
          t,
        paused,
      );
      check(
        'Escape resumes the expedition',
        (await page
          .getByRole('dialog', { name: 'Expedition paused' })
          .count()) === 0,
      );

      for (let encounter = 0; encounter < 4; encounter++) {
        const actor = await page.evaluate(
          (species) =>
            window.__sandTest
              .getCreatures()
              .find((c) => c.alive && species.includes(c.species)),
          encounter < 3
            ? [CREATURE.DYNAMITEER, CREATURE.MINIGUNNER, CREATURE.BORE_SENTINEL]
            : [CREATURE.SHIELD_ANCHOR],
        );
        check(`encounter ${encounter + 1} has a live target`, !!actor);
        await useToolOnActor(page, actor, '1');
        check(
          `blast gun defeats encounter ${encounter + 1}`,
          !(await page.evaluate(
            (id) =>
              window.__sandTest
                .getCreatures()
                .some((c) => c.id === id && c.alive),
            actor.id,
          )),
        );
      }
      await page.waitForFunction(
        () =>
          document.querySelector('sand-game')._game.getInventory().selected ===
          2,
      );
      check(
        'rescue phase automatically equips the authoritative beam',
        await page.evaluate(
          (kind) => window.__sandTest.getPlayer().heldItemKind === kind,
          ITEM_KIND.RESCUE_BEAM,
        ),
      );
      await page.screenshot({ path: resolve(artifacts, 'refuge.png') });
      for (let researcher = 0; researcher < 3; researcher++) {
        const actor = await page.evaluate(
          (species) =>
            window.__sandTest
              .getCreatures()
              .find((c) => c.alive && c.species === species),
          CREATURE.SURVEYOR,
        );
        if (!actor) break;
        await useToolOnActor(page, actor, '3');
      }
      await page.waitForFunction(
        (phase) =>
          document.querySelector('sand-game')._game.getMission().phase ===
          phase,
        MISSION_PHASE.EXTRACTION,
      );
      check('three real beam rescues activate extraction', true);
      await page.evaluate(() => {
        const game = document.querySelector('sand-game')._game;
        const mission = game.getMission(),
          player = window.__sandTest.getPlayer();
        const offset = window.__sandTest.worldOffset();
        window.__sandTest.setPlayerState({
          x: mission.extractionX - offset.x - player.w / 2,
          y: mission.extractionY - offset.y - player.h / 2,
          vx: 0,
          vy: 0,
        });
      });
      await page
        .getByRole('dialog', { name: 'Expedition complete' })
        .waitFor({ timeout: 30000 });
      check(
        'actual extraction returns to the ship and reports all three rescued',
        (await page.locator('sand-game[planet="ship"]').count()) === 1 &&
          (await page
            .locator('.iris-report')
            .innerText()
            .then(
              (t) => t.includes('3 rescued') && t.includes('Mission complete'),
            )),
      );
      await page.screenshot({ path: resolve(artifacts, 'homecoming.png') });
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.keyboard.press('j');
      await page.getByRole('tab', { name: 'Completed' }).click();
      check(
        'completed journal records the rescued crew',
        await page
          .getByRole('tabpanel', { name: 'Completed' })
          .innerText()
          .then((t) => t.includes('aboard Kestrel')),
      );
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: 'Earth mission', exact: true })
        .click();
      await deploy(page);

      // Exercise failure presentation separately; headless mission tests cover
      // the engine's death/collateral failure rules.
      await page.locator('sand-game').evaluate((host) =>
        host.dispatchEvent(
          new CustomEvent('sand:missionfailed', {
            detail: host._game.getMission(),
            bubbles: true,
            composed: true,
          }),
        ),
      );
      await page
        .getByRole('dialog', { name: 'Expedition interrupted' })
        .waitFor();
      await page.getByRole('button', { name: 'Retry' }).click();
      await page.locator('.iris-phase-field').waitFor({ timeout: 45000 });
      await page.waitForFunction(
        () =>
          document.querySelector('sand-game')._game.getMission()?.objectives
            .length,
      );
      check(
        'retry creates a fresh mission with completed rescues reset',
        await page.evaluate(
          () =>
            document.querySelector('sand-game')._game.getMission().objectives[1]
              .current === 0,
        ),
      );
      await page.getByRole('button', { name: 'Pause expedition' }).click();
      await page.getByRole('button', { name: 'Abandon mission' }).click();
      await page.waitForFunction(
        () => document.querySelector('sand-game[planet="ship"]')?._ready,
      );
      check(
        'abandon returns to a ready ship without runtime errors',
        errors.length === 0,
        errors.join('; '),
      );
    },
  },
  undefined,
  { earth: { viewport: { width: 1440, height: 900 } } },
);
