import { runBrowserCases } from './browser-harness.mjs';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
import { MAT } from '../src/sand/materials.js';
const artifacts = '.sand-artifacts/adventure-tools';
mkdirSync(artifacts, { recursive: true });
process.exitCode = await runBrowserCases({ prompts: async ({ page, baseURL, check }) => {
  await page.goto(baseURL + '/game?nosave', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('sand-game')?._game?.getPlayer(), null, { timeout: 60000 });
  await page.locator('sand-game').evaluate(host => host.shadowRoot.querySelector('.sg-sim').focus());
  for (let i=0;i<40;i++) {
    const delta=await page.evaluate(()=>{
      const g=document.querySelector('sand-game')._game,v=g.getMissionView();
      const actor=g.getTalkableActors().sort((a,b)=>Math.hypot(a.worldX-v.playerWorldX,a.worldY-v.playerWorldY)-Math.hypot(b.worldX-v.playerWorldX,b.worldY-v.playerWorldY))[0];
      return {x:actor.worldX-v.playerWorldX,distance:Math.hypot(actor.worldX-v.playerWorldX,actor.worldY-v.playerWorldY)};
    });
    if(delta.distance<23)break;
    const key=delta.x<0?'a':'d';await page.keyboard.down(key);await page.waitForTimeout(80);await page.keyboard.up(key);
  }
  await page.locator('.sg-talk-button:visible').waitFor();
  for (const size of [{width:1366,height:768},{width:900,height:650}]) {
    await page.setViewportSize(size);await page.waitForTimeout(300);
    const aligned=await page.evaluate(()=>{
      const host=document.querySelector('sand-game'),g=host._game,v=g.getMissionView();
      const actor=g.getTalkableActors().sort((a,b)=>Math.hypot(a.worldX-v.playerWorldX,a.worldY-v.playerWorldY)-Math.hypot(b.worldX-v.playerWorldX,b.worldY-v.playerWorldY))[0];
      const button=[...host.shadowRoot.querySelectorAll('.sg-talk-button')].find(b=>!b.hidden),r=button.getBoundingClientRect();
      const offset=window.__sandTest.worldOffset(),cell=window.__sandTest.cellRect(actor.worldX-offset.x,actor.headWorldY-offset.y),canvas=host.shadowRoot.querySelector('#sand-main').getBoundingClientRect();
      return Math.abs(r.x+r.width/2-(canvas.x+cell.x/devicePixelRatio))<2 && Math.abs(r.bottom+8-(canvas.y+cell.y/devicePixelRatio))<2;
    });
    check(`NPC speech prompt stays centered above its rendered head at ${size.width}px`,aligned);
  }
  await page.screenshot({path:artifacts+'/npc-prompt.png'});
}, tools: async ({ page, baseURL, check }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/game?nosave', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('sand-game')?._game?.getInventory()?.slots?.length, null, { timeout: 60000 });
  await page.locator('sand-game').evaluate(host => host.shadowRoot.querySelector('.sg-sim').focus());
  const point = (dx, dy) => page.evaluate(({ dx, dy }) => {
    const host = document.querySelector('sand-game'), p = host._game.getPlayer();
    const r = window.__sandTest.cellRect(p.x + dx, p.y + (dy ?? p.h + 1));
    const bounds = host.shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    return { x: bounds.x + (r.x + r.size / 2) / devicePixelRatio,
      y: bounds.y + (r.y + r.size / 2) / devicePixelRatio };
  }, { dx, dy });
  const capturePlayer = async name => {
    const clip = await page.evaluate(() => {
      const host = document.querySelector('sand-game'), p = host._game.getPlayer();
      const r = window.__sandTest.cellRect(p.x - 10, p.y - 10);
      const bounds = host.shadowRoot.querySelector('#sand-main').getBoundingClientRect();
      return { x: bounds.x + r.x / devicePixelRatio, y: bounds.y + r.y / devicePixelRatio,
        width: r.size * 24 / devicePixelRatio, height: r.size * 24 / devicePixelRatio };
    });
    await page.screenshot({ path: `${artifacts}/${name}.png`, clip });
  };
  const aim = await point(45, 3);
  await page.mouse.move(aim.x, aim.y);
  const select = definition => page.evaluate(definition => {
    const g = document.querySelector('sand-game')._game;
    g.selectSlot(g.getInventory().slots.findIndex(s => definition === 'pick' ? s.isTool : s.definitionId === definition));
  }, definition);
  await select(300);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().heldDefinition === 300);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().mana < 75);
  await page.mouse.up();
  await page.waitForFunction(() => {
    const host = document.querySelector('sand-game'), p = host._game.getPlayer();
    const meter = host.shadowRoot.querySelector('[aria-label="Mana"]');
    return Number(meter.getAttribute('aria-valuenow')) === p.mana && p.mana < 80;
  });
  check('wand mana drain reaches the visible HUD', await page.locator('.survival-shield > i').evaluateAll(cells => cells.some(cell => parseFloat(cell.style.getPropertyValue('--fill')) < 100)));
  const vitals = await page.evaluate(() => {
    const p = document.querySelector('sand-game')._game.getPlayer();
    return { mana: p.mana, health: p.health };
  });
  await page.waitForFunction(value => {
    const host = document.querySelector('sand-game'), p = host._game.getPlayer();
    return p.mana > value.mana && p.health === value.health && Number(host.shadowRoot.querySelector('[aria-label="Mana"]').getAttribute('aria-valuenow')) === p.mana;
  }, vitals);
  check('mana regeneration refreshes without changing health or equipment', true);
  await page.screenshot({ path: artifacts + '/mana.png' });
  await select(1);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().heldDefinition === 1);
  await page.mouse.down();
  await page.waitForTimeout(170);
  await page.screenshot({ path: artifacts + '/sword.png' });
  await capturePlayer('sword-arm-swing');
  await page.mouse.up();
  await page.waitForFunction(() => {
    const host = document.querySelector('sand-game'), p = host._game.getPlayer();
    return p.stamina < 100 && Number(host.shadowRoot.querySelector('[aria-label="Stamina"]').getAttribute('aria-valuenow')) === p.stamina;
  });
  check('sword stamina cost reaches the HUD', true);
  await page.waitForFunction(() => !document.querySelector('sand-game')._game.getPlayer().actionTicks);
  await page.keyboard.down('f');
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().shieldActive);
  await page.screenshot({ path: artifacts + '/shield.png' });
  await page.keyboard.up('f');
  for (const [name, dx, dy, guarding] of [
    ['right-hand-sword', 35, 3, false], ['left-hand-shield', -35, 3, false],
    ['guard-right', 35, 3, true], ['guard-upper-right', 20, -25, true],
    ['guard-overhead', 2.1, -35, true], ['guard-upper-left', -20, -25, true],
    ['guard-left', -35, 3, true],
  ]) {
    await page.waitForFunction(() => !document.querySelector('sand-game')._game.getPlayer().actionTicks);
    const target = await point(dx, dy);
    await page.mouse.move(target.x, target.y);
    if (guarding) await page.keyboard.down('f');
    await page.waitForFunction(({ guarding, facing }) => {
      const p = document.querySelector('sand-game')._game.getPlayer();
      return p.shieldActive === guarding && p.facing === facing && !p.actionTicks;
    }, { guarding, facing: dx < 2 ? -1 : 1 });
    await capturePlayer(name);
    if (guarding) await page.keyboard.up('f');
  }
  for (const [definition, name] of [[300, 'wand'], ['pick', 'pickaxe']]) {
    await select(definition);
    await page.waitForFunction(definition => {
      const p = document.querySelector('sand-game')._game.getPlayer();
      return !p.actionTicks && (definition === 'pick' ? p.heldItemKind === 1 : p.heldDefinition === definition);
    }, definition);
    for (const [side, dx, dy] of [['right', 35, 3], ['left', -35, 3], ['up', 4, -30]]) {
      const target = await point(dx, dy);
      await page.mouse.move(target.x, target.y);
      await page.waitForFunction(({ dx, dy }) => {
        const p = document.querySelector('sand-game')._game.getPlayer();
        return p.facing === (dx < 2 ? -1 : 1) && (dy >= 0 || p.aimY < p.y - 10);
      }, { dx, dy });
      await capturePlayer(`${name}-arm-${side}`);
    }
  }
  await select('pick');
  await page.waitForFunction(() => !document.querySelector('sand-game')._game.getPlayer().actionTicks);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().heldItemKind === 1);
  const size = () => page.evaluate(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint);
  const originalSize = await size();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 0);
  check('V enables single-pixel size without opening inventory', await page.getByRole('dialog', { name: 'Inventory', exact: true }).count() === 0);
  await page.keyboard.press('v');
  await page.waitForFunction(value => document.querySelector('sand-game')._game.getInventory().selectedFootprint === value, originalSize);
  await page.keyboard.press('[');
  await page.waitForFunction(value => document.querySelector('sand-game')._game.getInventory().selectedFootprint === value - 1, originalSize);
  await page.keyboard.press(']');
  await page.waitForFunction(value => document.querySelector('sand-game')._game.getInventory().selectedFootprint === value, originalSize);
  check('mining controls show radius instead of square dimensions', await page.getByRole('button', { name: 'Choose tool size (Q)' }).textContent() === `Radius ${originalSize} · Q`);
  await select(1);
  await page.waitForFunction(value => document.querySelector('sand-game').shadowRoot.querySelector('[aria-label="Choose tool size (Q)"]').textContent === `Radius ${value} · Q`, originalSize);
  check('placement shares the mining radius', true);
  await select('pick');
  await page.waitForFunction(value => document.querySelector('sand-game').shadowRoot.querySelector('[aria-label="Choose tool size (Q)"]').textContent === `Radius ${value} · Q`, originalSize);
  await page.keyboard.press('q');
  await page.locator('.fp-panel.open').waitFor();
  check('Q opens the size picker directly', await page.getByRole('dialog', { name: 'Inventory', exact: true }).count() === 0);
  await page.locator('.fp-panel').getByRole('button', { name: '1 pixel', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 0);
  await page.keyboard.press(']');
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 1);
  check('choosing a size returns keyboard control to the game', true);
  await page.getByRole('button', { name: 'Toggle single-pixel size (V)', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 0);
  const ground = await point(2, null);
  await page.mouse.move(ground.x, ground.y);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().actionTicks > 0);
  await page.screenshot({ path: artifacts + '/pickaxe.png' });
  await capturePlayer('pickaxe-arm-swing');
  await page.mouse.up();
  await page.evaluate(material => window.__sandTest.addInventory(material, 10), MAT.OAK_SEED);
  await page.waitForFunction(material => document.querySelector('sand-game')._game.getInventory().slots.some(s => s.material === material && s.count > 0), MAT.OAK_SEED);
  await page.evaluate(material => {
    const g = document.querySelector('sand-game')._game;
    g.selectSlot(g.getInventory().slots.findIndex(s => s.material === material && s.count > 0));
    g.setSelectedFootprint(9);
  }, MAT.OAK_SEED);
  await page.waitForFunction(material => {
    const inv = document.querySelector('sand-game')._game.getInventory();
    return inv.slots[inv.selected]?.material === material && inv.selectedFootprint === 9;
  }, MAT.OAK_SEED);
  const seedPoint = await point(18, -12);
  await page.mouse.move(seedPoint.x, seedPoint.y);
  await page.waitForFunction(() => {
    const p = document.querySelector('sand-game')._game.getPlayer();
    return p.aimX > p.x + 12 && p.aimY < p.y - 8;
  });
  await page.evaluate(() => {
    document.querySelector('sand-game')._game.setGameplayPaused(true);
    window.__sandTest.setDayPhase(.5);
  });
  await page.waitForTimeout(300);
  const readPreview = () => page.evaluate(({ x, y }) => {
    const t = window.__sandTest, bounds = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    const [cx, cy] = t.cellAt(x - bounds.x, y - bounds.y), r = t.cellRect(cx - 9, cy - 9);
    t.render(false);
    return Array.from(t.readPixels(Math.round(r.x), Math.round(r.y), Math.round(r.size * 19), Math.round(r.size * 19)));
  }, seedPoint);
  const largeSeedPreview = await readPreview();
  await page.screenshot({ path: artifacts + '/seed-dot.png' });
  await page.evaluate(() => document.querySelector('sand-game')._game.setSelectedFootprint(0));
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 0);
  const precisionSeedPreview = await readPreview();
  check('seed preview stays one cell at every selected radius', largeSeedPreview.every((v, i) => v === precisionSeedPreview[i]));
  await select(1);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().heldDefinition === 1);
  const noPreview = await readPreview();
  check('the seed dot is visible', noPreview.some((v, i) => v !== precisionSeedPreview[i]));
  await page.evaluate(material => window.__sandTest.addInventory(material, 500), MAT.WOOD);
  await page.waitForFunction(material => document.querySelector('sand-game')._game.getInventory().pools.flatMap(p => p.entries).some(s => s.material === material && s.count > 0), MAT.WOOD);
  await page.evaluate(() => {
    const g = document.querySelector('sand-game')._game;
    g.selectSlot(g.getInventory().slots.findIndex(s => s.pool === 1));
    g.setSelectedFootprint(9);
  });
  await page.waitForFunction(() => {
    const inv = document.querySelector('sand-game')._game.getInventory();
    return inv.slots[inv.selected]?.pool === 1 && inv.selectedFootprint === 9;
  });
  const placementPreview = await readPreview();
  const width = Math.sqrt(noPreview.length / 4), cellSize = width / 19;
  const changedCell = (pixels, x, y) => {
    const i = (Math.floor((y + .5) * cellSize) * width + Math.floor((x + .5) * cellSize)) * 4;
    return [0, 1, 2, 3].some(channel => pixels[i + channel] !== noPreview[i + channel]);
  };
  let matches = true;
  for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
    matches &&= changedCell(placementPreview, x, y) === ((x - 9) ** 2 + (y - 9) ** 2 <= 81);
    matches &&= changedCell(precisionSeedPreview, x, y) === (x === 9 && y === 9);
  }
  check('rendered placement is circular and the seed preview is exactly one dot', matches);
  await page.screenshot({ path: artifacts + '/placement-radius.png' });
  await page.evaluate(() => {
    document.querySelector('sand-game')._game.setGameplayPaused(false);
    window.__sandTest.clearDayPhase();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  check('size controls fit on a phone', await page.locator('.fp-controls').evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
  check('size controls leave the movement hint readable', await page.locator('sand-game').evaluate(host => {
    const controls = host.shadowRoot.querySelector('.fp-controls').getBoundingClientRect();
    const hint = host.shadowRoot.querySelector('.ad-trail-hint').getBoundingClientRect();
    return controls.bottom <= hint.top || controls.left >= hint.right;
  }));
  await page.screenshot({ path: artifacts + '/mobile-size.png' });
  check('tools render without browser errors', errors.length === 0, errors.join('; '));
} });
