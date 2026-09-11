import process from 'node:process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import { runBrowserCases } from './browser-harness.mjs';

await fs.mkdir('.sand-artifacts/magic', { recursive: true });
const state = (page, predicate) => page.waitForFunction(predicate, null, { timeout: 15000 });
async function open(page, baseURL) {
  await page.goto(baseURL + '/game?nosave', { waitUntil: 'domcontentloaded' });
  await state(page, () => document.querySelector('sand-game')?._game?.getInventory()?.slots?.[2]?.wand);
  await page.getByRole('button', { name: 'Inventory (I)', exact: true }).click();
  await page.getByRole('button', { name: 'Wands', exact: true }).click();
  await page.getByRole('heading', { name: 'Wandcraft', exact: true }).waitFor();
}
process.exitCode = await runBrowserCases({
  desktop: async ({ page, baseURL, check }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await open(page, baseURL);
    await page.getByRole('combobox', { name: 'Wand to edit', exact: true }).click();
    check('only wands appear as editable containers', await page.getByRole('listbox', { name: 'Wand to edit', exact: true }).getByRole('option').count() === 1);
    await page.keyboard.press('Escape');
    await page.locator('.inv-slot[data-index="33"]').hover();
    check('loose runes explain that a wand is required', (await page.getByRole('tooltip').innerText()).includes('Install in a wand spell socket to cast'));
    check('starter wand shows its separate spell and upgrade capacities',
      await page.locator('.wand-socket.spell:visible').count() === 3 && await page.locator('.wand-socket.upgrade:visible').count() === 2);
    await page.locator('.inv-slot[data-index="34"]').click();
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 501);
    await page.getByRole('button', { name: 'Upgrade socket 1: Empty', exact: true }).click();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.upgrades[0] === 501);
    await page.locator('.wand-mana').filter({ hasText: 'Next cast 19' }).waitFor();
    check('socket edit reaches the authority worker and updates the mana cost', await page.locator('.wand-mana').innerText() === 'Your mana 100/100 · Next cast 19');
    await page.locator('.inv-slot[data-index="35"]').click();
    await page.getByRole('button', { name: 'Upgrade socket 2: Empty', exact: true }).click();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.upgrades[1] === 503);
    await page.locator('.wand-mana').filter({ hasText: 'Next cast 22' }).waitFor();
    check('combined upgrades preview the complete cost', (await page.locator('.wand-mana').innerText()).includes('Next cast 22'));
    await page.locator('.ad-wands').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.sand-artifacts/magic/wand-editor-desktop.png' });
    await page.getByRole('button', { name: 'Spell socket 1: Ember', exact: true }).focus();
    await page.keyboard.press('Enter');
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 300);
    await page.getByRole('button', { name: 'Spell socket 2: Empty', exact: true }).focus();
    await page.keyboard.press('Enter');
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.spells[1] === 300);
    check('keyboard moves a spell without losing or duplicating it', await page.evaluate(() => !document.querySelector('sand-game')._game.getCursor()));
    await page.locator('.inv-slot[data-index="2"]').dragTo(page.locator('.inv-slot[data-index="5"]'));
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[5].wand?.upgrades[1] === 503);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('sand-game')._game.selectSlot(5));
    await state(page, () => document.querySelector('sand-game')._game.getPlayer()?.manaCastCost === 22);
    await page.locator('.survival-mana-caption').filter({ hasText: 'Cast 22' }).waitFor();
    await page.mouse.move(600, 230);
    await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
    await state(page, () => document.querySelector('sand-game')._game.getPlayer().mana <= 80);
    check('casting spends the displayed amount from player mana', true);
    const caption = await page.locator('.survival-mana-caption').boundingBox();
    const hotbar = await page.locator('.inv-bar').boundingBox();
    check('mana forecast clears the quickbar', caption.y + caption.height < hotbar.y);
    await page.screenshot({ path: '.sand-artifacts/magic/mana-hud.png' });
    check('browser reports no errors', errors.length === 0, errors.join('; '));
  },
  streams: async ({ page, baseURL, check }) => {
    await page.goto(baseURL + '/game?nosave', { waitUntil: 'domcontentloaded' });
    await state(page, () => window.__sandTest?.getPlayer() && document.querySelector('sand-game')._game.getChests().length);
    await page.evaluate(() => {
      const t = window.__sandTest, game = document.querySelector('sand-game')._game;
      const chest = game.getChests().find(c => c.id === 1);
      t.previewScene(chest.worldX, chest.worldY-5);
      t.setCreatureRuntime(false, false);
      game.interactChest(1);
    });
    await state(page, () => document.querySelector('sand-game')._game.getChestLoot().slots.some(s => s.definitionId === 311));
    await page.evaluate(() => {
      const game = document.querySelector('sand-game')._game;
      game.interactChest(1, game.getChestLoot().slots.findIndex(s => s.definitionId === 311));
    });
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots.some(s => s.definitionId === 311));
    await page.evaluate(() => {
      const game = document.querySelector('sand-game')._game;
      game.cursorPick(game.getInventory().slots.findIndex(s => s.definitionId === 311), false);
      game.wandSocket(2, 0, 0); game.wandSocket(2, 0, 1); game.selectSlot(2);
    });
    await state(page, () => {
      const game = document.querySelector('sand-game')._game, wand = game.getInventory().slots[2].wand;
      return wand.spells[0] === 311 && wand.spells[1] === 300 && !game.getCursor();
    });
    const point = await page.evaluate(() => {
      const t = window.__sandTest, p = t.playerScreen();
      const box = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
      return { x: Math.min(box.right-30, box.x+p.x+180), y: Math.max(box.top+40, box.y+p.y-60) };
    });
    const before = await page.evaluate(() => window.__sandTest.actionCount());
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.waitForFunction(n => window.__sandTest.actionCount() >= n+8, before);
    check('real pointer hold streams the chest rune without cycling', await page.evaluate(() => document.querySelector('sand-game')._game.getInventory().slots[2].wand.next === 1));
    await page.screenshot({ path: '.sand-artifacts/magic/sparks-worker.png' });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const stopped = await page.evaluate(() => window.__sandTest.actionCount());
    await page.waitForTimeout(150);
    check('pointer release stops the authority stream', await page.evaluate(n => window.__sandTest.actionCount() === n, stopped));
    await page.mouse.down();
    await page.waitForFunction(n => window.__sandTest.actionCount() === n+1, stopped);
    await page.waitForTimeout(900);
    check('the next held click casts only Ember', await page.evaluate(n => window.__sandTest.actionCount() === n+1, stopped));
    await page.mouse.up();
  },
  streamRendering: async ({ page, baseURL, check }) => {
    await page.route('**/magic-stream-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#14212a"></body>' }));
    await page.goto(baseURL + '/magic-stream-fixture');
    const frames = await page.evaluate(async () => {
      const [{ initSandWasm, createEngineWasm, MAT, PLANET, INPUT }, { CREATURE, STATUS_EFFECT }] = await Promise.all([
        import('/src/sand/wasmBridge/engineFactory.js'), import('/src/sand/wasmBridge/abi.generated.js'),
      ]);
      await initSandWasm();
      const result = [];
      for (const spell of [311, 309]) {
        const e = createEngineWasm({ cols: 180, rows: 120, worldSeed: 73, sinksOn: false, planetId: PLANET.FRONTIER });
        const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 480; document.body.append(canvas);
        try {
          e.setSurvivalInventory(true); e.setCreatureRuntime(false, false);
          for (let x = 0; x < 180; x++) for (let y = 96; y < 120; y++) e.paintDisc(x,y,0,MAT.STONE,true);
          for (let x = 137; x < 143; x++) for (let y = 65; y < 96; y++) e.paintDisc(x,y,0,MAT.STONE,true);
          e.syncComponents(); const id = e.spawnPlayer(38,88);
          const wand = e.getInventory(id).slots.findIndex(s => s.wand);
          e.addGear(id,spell); const rune = e.getInventory(id).slots.findIndex(s => s.definitionId === spell);
          e.inventoryCursorPick(id,rune,false); e.wandSocket(id,wand,0,0); e.setSelectedSlot(id,wand);
          e.spawnScriptedCreature(CREATURE.BONE_GUARD,spell===311?112:82,90);
          e.setPlayerInput(id,{bits:INPUT.PRIMARY,aimX:135,aimY:92});
          for (let i=0;i<30;i++) e.stepActors();
          e.glInit(canvas); e.glResize(1440,480); e.setViewport(1,10,144,48); e.cameraSet(10,61);
          e.glSetFlags(false,false,true); e.setSkyLight(155);
          e.glSetCreatures(e.getCreatureSnapshotData().slice()); e.glSetProjectiles(e.getProjectileSnapshotData().slice()); e.glRenderFrame(true);
          result.push({spell,image:canvas.toDataURL(),shots:e.getProjectiles().length,shocked:e.getStatusEffects().some(s=>s.effect===STATUS_EFFECT.SHOCKED)});
        } finally { e.destroy(); canvas.remove(); }
      }
      return result;
    });
    for (const frame of frames) {
      check(`spell ${frame.spell} has a visible stream`, frame.spell === 311 ? frame.shots === 1 : frame.shots >= 4);
      if (frame.spell === 311) check('Sparks displays the replicated shock status', frame.shocked);
      await fs.writeFile(`.sand-artifacts/magic/stream-${frame.spell}.png`, Buffer.from(frame.image.split(',')[1], 'base64'));
    }
  },
  mirrorStreams: async ({ page, baseURL, check }) => {
    await page.route('**/magic-mirror-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto(baseURL + '/magic-mirror-fixture');
    const frames = await page.evaluate(async () => {
      const { initSandWasm, createEngineWasm, MAT, PLANET, INPUT } = await import('/src/sand/wasmBridge/engineFactory.js');
      await initSandWasm();
      const result = [];
      for (const spell of [311, 309]) {
        const e = createEngineWasm({ cols: 180, rows: 120, worldSeed: 73, sinksOn: false, planetId: PLANET.FRONTIER });
        const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 900; document.body.append(canvas);
        try {
          e.setSurvivalInventory(true); e.setCreatureRuntime(false, false);
          for (let x = 0; x < 180; x++) for (let y = 96; y < 120; y++) e.paintDisc(x,y,0,MAT.STONE,true);
          for (let x = 72; x < 78; x++) for (let y = 1; y < 96; y++) e.paintDisc(x,y,0,MAT.STONE,true);
          e.syncComponents(); const id = e.spawnPlayer(30,88);
          const wand = e.getInventory(id).slots.findIndex(s => s.wand);
          for (const [definition, kind] of [[spell,0],[501,1]]) {
            e.addGear(id,definition);
            const slot = e.getInventory(id).slots.findIndex(s => s.definitionId === definition);
            e.inventoryCursorPick(id,slot,false); e.wandSocket(id,wand,kind,0);
            if (e.getCursor(id)) {
              const empty = e.getInventory(id).slots.findIndex((s,i) => i >= 9 && !s.count);
              e.inventoryCursorPick(id,empty,false);
            }
          }
          e.setSelectedSlot(id,wand); e.setPlayerInput(id,{bits:INPUT.PRIMARY,aimX:130,aimY:25});
          for (let i=0;i<42;i++) e.stepActors();
          e.glInit(canvas); e.glResize(1000,900); e.setViewport(1,10,100,90); e.cameraSet(0,10);
          e.glSetFlags(false,false,true); e.setSkyLight(155);
          e.glSetProjectiles(e.getProjectileSnapshotData().slice()); e.glRenderFrame(true);
          result.push({spell,image:canvas.toDataURL(),reflected:e.getProjectiles().filter(p=>p.vx<0).length});
        } finally { e.destroy(); canvas.remove(); }
      }
      return result;
    });
    for (const frame of frames) {
      check(`spell ${frame.spell} sustains its mirror reflection`, frame.reflected >= (frame.spell === 311 ? 1 : 3));
      await fs.writeFile(`.sand-artifacts/magic/mirror-${frame.spell}.png`, Buffer.from(frame.image.split(',')[1], 'base64'));
    }
  },
  wandOrigins: async ({ page, baseURL, check }) => {
    await page.route('**/wand-origin-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#17211b;color:#ddd;font:14px monospace"></body>' }));
    await page.goto(baseURL + '/wand-origin-fixture');
    const results = await page.evaluate(async () => {
      const { initSandWasm, createEngineWasm, PLANET, INPUT } = await import('/src/sand/wasmBridge/engineFactory.js');
      await initSandWasm();
      const e = createEngineWasm({ cols: 160, rows: 120, infinite: false, worldSeed: 7, sinksOn: false, planetId: PLANET.FRONTIER });
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600; document.body.append(canvas);
      const results = [];
      try {
        e.setSurvivalInventory(true); e.setCreatureRuntime(false, false);
        const id = e.spawnPlayer(60,40), slot = e.getInventory(id).slots.findIndex(s => s.wand);
        e.addGear(id,311); e.inventoryCursorPick(id,e.getInventory(id).slots.findIndex(s => s.definitionId === 311),false);
        e.wandSocket(id,slot,0,0); e.setSelectedSlot(id,slot);
        e.glInit(canvas); e.glResize(800,600); e.setViewport(1,10,80,60); e.cameraSet(20,10); e.setSkyLight(255); e.glSetFlags(false,false,true);
        const near = (pixels,x,y,color) => {
          const sx = (x-20)*10, sy = (y-10)*10;
          for (let py=Math.floor(sy-9);py<=sy+9;py++) for(let px=Math.floor(sx-9);px<=sx+9;px++) {
            if ((px-sx)**2+(py-sy)**2>81) continue;
            const i=(py*800+px)*4;
            if (color(pixels[i],pixels[i+1],pixels[i+2])) return true;
          }
          return false;
        };
        for (const [name,aimX,aimY,facing] of [['right',150,44,1],['left',0,44,-1],['up-right',62,-60,1],['up-left',62,-60,-1],['down-right',62,110,1],['down-left',62,110,-1]]) {
          e.setPlayerInput(id,{bits:0,aimX,aimY}); for(let i=0;i<4;i++)e.stepActors();
          e.setPlayerState(id,{x:60,y:40,facing});
          e.setPlayerInput(id,{bits:INPUT.PRIMARY,aimX,aimY}); e.stepActors();
          const beam=e.getProjectiles().at(-1);
          e.glSetProjectiles(new Float32Array(0));e.glRenderFrame(true);
          const pixels=e.glReadPixels(0,0,800,600);
          results.push({name:`${name}: spell begins beside the rendered crystal`,ok:near(pixels,beam.x,beam.y,(r,g,b)=>r>140&&g>85&&b<180&&r>g*1.1)});
          results.push({name:`${name}: spell is clear of the torso`,ok:Math.hypot(beam.x-62,beam.y-(40+8*.42))>3.5});
          e.glSetProjectiles(e.getProjectileSnapshotData());e.glRenderFrame(true);
          const image=new Image();image.src=canvas.toDataURL();image.style.cssText='width:400px;height:300px;image-rendering:pixelated';image.alt=name;document.body.append(image);
          if(name==='right') {
            e.setPlayerState(id,{x:60,y:37,facing:1});e.glRenderFrame(true);
            results.push({name:'moving caster: continuous arc stays attached between authority pulses',ok:near(e.glReadPixels(0,0,800,600),beam.x,beam.y-3,(r,g,b)=>r>150&&g>200&&b>230)});
          }
        }
        canvas.remove();
      } finally {e.destroy();}
      return results;
    });
    await page.screenshot({path:'.sand-artifacts/magic/wand-origins.png',fullPage:true});
    for(const result of results)check(result.name,result.ok);
  },
  touch: async ({ page, baseURL, check }) => {
    await open(page, baseURL);
    await page.locator('.ad-wands').scrollIntoViewIfNeeded();
    const sockets = await page.locator('.wand-socket.spell:visible').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; }));
    check('mobile spell order reads left to right with usable touch targets', sockets.every((box, index) => box.width >= 44 && box.height >= 44 && box.y === sockets[0].y && (!index || box.x > sockets[index - 1].x)));
    check('mobile wand editor fits inside the inventory', await page.locator('.ad-inventory').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.getByRole('button', { name: 'Spell socket 1: Ember', exact: true }).tap();
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 300);
    await page.getByRole('button', { name: 'Spell socket 2: Empty', exact: true }).tap();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.spells[1] === 300);
    check('touch can move a spell between sockets', true);
    await page.getByRole('button', { name: 'Pack', exact: true }).tap();
    await page.locator('.inv-slot[data-index="34"]').tap();
    await page.getByRole('button', { name: 'Pick up', exact: true }).tap();
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 501);
    await page.getByRole('button', { name: 'Wands', exact: true }).tap();
    await page.getByRole('button', { name: 'Upgrade socket 1: Empty', exact: true }).tap();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.upgrades[0] === 501);
    check('touch carries a rune from the pack across sections into a wand', true);
    await page.getByRole('button', { name: 'Spell socket 2: Ember', exact: true }).waitFor();
    await page.screenshot({ path: '.sand-artifacts/magic/wand-editor-mobile.png' });
  },
}, undefined, { touch: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } });
