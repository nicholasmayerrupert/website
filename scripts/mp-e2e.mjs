// Two-context multiplayer browser test. Boots Vite and the authoritative server,
// opens two pure browser clients, and checks:
//   - both clients see two players + the server's world (matching terrain)
//   - per-player inventory syncs (select + cursor pick are private to each player)
//   - dropped items replicate (a thrown item appears on both clients)
//   - disconnect drops the player for the remaining client
//
// Clients are pumped with tickSteps while real time lets the server advance.
// Detailed diff behavior is covered by net-test.mjs.

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { startSandServer } from './sand-server.mjs';
import { MAT } from '../src/sand/materials.js';
import { ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const WS_PORT = await getAvailablePort();
const REFUSED_PORT = await getAvailablePort();
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const baseURL = `http://localhost:${PORT}/`;
const wsURL = `ws://localhost:${WS_PORT}`;
const ROOM = 'e2e-room';
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const killVite = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-vite.pid, 'SIGKILL');
  } catch { /* gone */ }
};
const waitForServer = () => new Promise((resolve, reject) => {
  let buf = '';
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); resolve(); };
  const fail = (err) => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); killVite(); reject(err); };
  const to = setTimeout(() => fail(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try { if ((await fetch(baseURL)).ok) finish(); } catch {}
  }, 500);
  vite.stdout.on('data', (d) => { buf += d.toString(); if (new RegExp(`localhost:${PORT}`).test(buf)) finish(); });
  vite.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) fail(new Error('dev server: ' + s.trim())); });
});

const srv = await startSandServer({ port: WS_PORT, cols: 256, rows: 160, seed: 0x1234, room: ROOM });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ] });
  const open = async () => {
    const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}game`, { waitUntil: 'load' }); // survival mode (players live at /game)
    await page.waitForFunction(() => window.__sandNet && window.__sandTest && window.__sandTest.getPlayer(), null, { timeout: 30000 });
    return { ctx, page };
  };

  console.log('two-context multiplayer (authoritative server)');
  const a = await open();
  const b = await open();

  // Pause both clients' RAF; drive them deterministically with tickSteps + sleeps.
  await a.page.evaluate(() => window.__sandTest.setPaused(true));
  await b.page.evaluate(() => window.__sandTest.setPaused(true));

  // A refused connection must be a transaction: keep the local player and keep
  // stepping the single-player engine without a page refresh.
  const localBefore = await a.page.evaluate(() => ({ player: window.__sandTest.getPlayer(), count: window.__sandNet.playerCount() }));
  const failedJoin = await a.page.evaluate(async (u) => {
    try { await window.__sandNet.join(u, 'missing'); return false; } catch { return true; }
  }, `ws://localhost:${REFUSED_PORT}`);
  await a.page.evaluate(() => window.__sandNet.tickSteps(4, false));
  const localAfter = await a.page.evaluate(() => ({ player: window.__sandTest.getPlayer(), count: window.__sandNet.playerCount(), status: window.__sandNet.status() }));
  check('unavailable server rejects the join', failedJoin);
  check('failed join keeps the local player', !!localBefore.player && !!localAfter.player && localBefore.player.id === localAfter.player.id && localAfter.count === 1);
  check('failed join clears connected client state', !localAfter.status.connected && localAfter.status.role === null && !localAfter.status.worldReady);

  // Pump BOTH clients (send input + drain inbound) then let the server tick/reply.
  const pump = async (n = 4, ms = 90) => {
    await a.page.evaluate((k) => window.__sandNet.tickSteps(k, false), n);
    await b.page.evaluate((k) => window.__sandNet.tickSteps(k, false), n);
    await sleep(ms);
  };

  // both clients join the authoritative server
  await a.page.evaluate(([u, r]) => window.__sandNet.join(u, r), [wsURL, ROOM]);
  await b.page.evaluate(([u, r]) => window.__sandNet.join(u, r), [wsURL, ROOM]);

  // wait for both to be assigned a player + receive the world.
  let count = 0;
  for (let i = 0; i < 25; i++) {
    await pump();
    count = await a.page.evaluate(() => window.__sandNet.playerCount());
    const wr = await a.page.evaluate(() => window.__sandNet.debug().worldReady);
    if (count >= 2 && wr) break;
  }
  check(`client A sees two players (${count})`, count === 2);
  check('client B sees two players', (await b.page.evaluate(() => window.__sandNet.playerCount())) === 2);
  check('client A has an assigned player', await a.page.evaluate(() => window.__sandNet.ownPlayer() != null));

  // World replication: both clients report their ordinary survival viewport,
  // then converge on the server's shared loaded window instead of staying in
  // its small bootstrap arena.
  let dimsA, dimsB;
  for (let i = 0; i < 30; i++) {
    await pump();
    dimsA = await a.page.evaluate(() => window.__sandTest.info());
    dimsB = await b.page.evaluate(() => window.__sandTest.info());
    if (dimsA.cols === srv.cols && dimsA.rows === srv.rows && dimsB.cols === srv.cols && dimsB.rows === srv.rows) break;
  }
  check(`clients adopted shared survival dims (${dimsA.cols}x${dimsA.rows})`, dimsA.cols === srv.cols && dimsA.rows === srv.rows && dimsB.cols === srv.cols && dimsB.rows === srv.rows);
  check('authority grew beyond its bootstrap arena', srv.cols > 256 || srv.rows > 160);
  const region = [Math.floor(srv.cols / 2) - 20, srv.rows - 16, Math.floor(srv.cols / 2) + 20, srv.rows - 6];
  const solid = (p) => p.evaluate((r) => window.__sandTest.solidCount(r[0], r[1], r[2], r[3]), region);
  const solidA = await solid(a.page), solidB = await solid(b.page);
  check(`both clients render the same server terrain (A ${solidA} ~ B ${solidB})`, solidA > 0 && Math.abs(solidA - solidB) <= 2);

  // The authoritative server arms every joining player in selected slot 0 and
  // grants the universal mining tool in slot 1.
  const hasStarterKit = (page) => page.evaluate(([gunKind, toolKind]) => {
    const inv = window.__sandNet.ownInventory();
    return inv?.selected === 0
      && inv.slots?.[0]?.itemKind === gunKind && inv.slots[0].count === 1
      && inv.slots?.[1]?.itemKind === toolKind && inv.slots[1].isTool && inv.slots[1].count === 1;
  }, [ITEM_KIND.BLAST_GUN, ITEM_KIND.MINING_TOOL]);
  check('client A receives the starter gun + mining tool', await hasStarterKit(a.page));
  check('client B receives the starter gun + mining tool', await hasStarterKit(b.page));

  // Give each authoritative player a distinct stack so the private inventory
  // and cursor replication checks below exercise real state changes.
  const pidA = await a.page.evaluate(() => window.__sandNet.ownPlayer()?.id);
  const pidB = await b.page.evaluate(() => window.__sandNet.ownPlayer()?.id);
  srv.engine.addToInventory(pidA, MAT.STONE, 3);
  srv.engine.addToInventory(pidB, MAT.WOOD, 2);
  for (let i = 0; i < 12; i++) {
    await pump();
    const ready = await a.page.evaluate((stone) => window.__sandNet.ownInventory()?.slots?.some((slot) => slot.material === stone && slot.count === 3), MAT.STONE);
    if (ready) break;
  }

  // per-player inventory sync: A selects slot 3 -> only A's selected changes.
  await a.page.evaluate(() => window.__sandNet.select(3));
  let selA = 0, selB = 0;
  for (let i = 0; i < 12; i++) { await pump(); selA = await a.page.evaluate(() => window.__sandNet.ownInventory()?.selected ?? -1); if (selA === 3) break; }
  selB = await b.page.evaluate(() => window.__sandNet.ownInventory()?.selected ?? -1);
  check(`client A selected slot synced (${selA})`, selA === 3);
  check(`client B selection unaffected (${selB})`, selB === 0);

  // Cursor transport remains correct through the restored inventory HUD: A
  // picks its material stack from slot 2 while both starter-kit items stay put.
  await a.page.evaluate(() => window.__sandNet.pick(2, false));
  let curA = null;
  for (let i = 0; i < 24; i++) { await pump(); curA = await a.page.evaluate(() => window.__sandNet.ownCursor()); if (curA) break; }
  check('client A carries a cursor stack after pick', curA != null);
  check('client A slot 2 emptied after pick', await a.page.evaluate(() => (window.__sandNet.ownInventory()?.slots?.[2]?.count ?? 0) === 0));
  check('client B slot 2 still holds its stack', await b.page.evaluate(() => (window.__sandNet.ownInventory()?.slots?.[2]?.count ?? 0) === 2));

  // item replication: a dropped item spawned on the SERVER (far from both players
  // so it isn't immediately vacuumed) must appear on BOTH clients' item views.
  srv.engine.spawnItem(MAT.STONE, 3, 30, 20, 0, 0);
  let itemsA = 0, itemsB = 0;
  for (let i = 0; i < 15; i++) { await pump(); itemsA = await a.page.evaluate(() => window.__sandNet.items()); itemsB = await b.page.evaluate(() => window.__sandNet.items()); if (itemsA >= 1 && itemsB >= 1) break; }
  check(`server item replicated to client A (${itemsA})`, itemsA >= 1);
  check(`server item replicated to client B (${itemsB})`, itemsB >= 1);

  // Put A near the loaded edge. The server must resize/stream the shared window,
  // send its new world offset to both render mirrors, and preserve A's absolute
  // world position through the local-coordinate re-anchor.
  const beforeWindow = { cols: srv.cols, rows: srv.rows, x: srv.engine.getWorldOffsetX(), y: srv.engine.getWorldOffsetY() };
  const serverPlayer = srv.engine.getPlayer(pidA);
  srv.engine.setPlayerState(pidA, { ...serverPlayer, x: srv.cols + 128 });
  let streamedA, streamedB;
  for (let i = 0; i < 30; i++) {
    await pump();
    streamedA = await a.page.evaluate(() => ({ info: window.__sandTest.info(), offset: window.__sandTest.worldOffset(), player: window.__sandNet.ownPlayer() }));
    streamedB = await b.page.evaluate(() => ({ info: window.__sandTest.info(), offset: window.__sandTest.worldOffset() }));
    const serverNow = srv.engine.getPlayer(pidA);
    const playerCaughtUp = Math.abs(
      streamedA.offset.x + streamedA.player.x - (srv.engine.getWorldOffsetX() + serverNow.x),
    ) < 16;
    if ((streamedA.offset.x !== beforeWindow.x || streamedA.offset.y !== beforeWindow.y || streamedA.info.cols !== beforeWindow.cols || streamedA.info.rows !== beforeWindow.rows) &&
        streamedA.offset.x === streamedB.offset.x && streamedA.offset.y === streamedB.offset.y && streamedA.info.cols === srv.cols && streamedB.info.cols === srv.cols &&
        playerCaughtUp) break;
  }
  const serverAfterStream = srv.engine.getPlayer(pidA);
  const serverWorldX = srv.engine.getWorldOffsetX() + serverAfterStream.x;
  const clientWorldX = streamedA.offset.x + streamedA.player.x;
  check('player traversal moves the multiplayer world window', streamedA.offset.x !== beforeWindow.x || streamedA.offset.y !== beforeWindow.y || streamedA.info.cols !== beforeWindow.cols || streamedA.info.rows !== beforeWindow.rows);
  check('both clients receive the same streamed window', streamedA.offset.x === streamedB.offset.x && streamedA.offset.y === streamedB.offset.y && streamedA.info.cols === streamedB.info.cols && streamedA.info.rows === streamedB.info.rows);
  check(`stream preserves A's world position (${clientWorldX.toFixed(1)} ~= ${serverWorldX.toFixed(1)})`, Math.abs(clientWorldX - serverWorldX) < 16);

  // disconnect A -> the server drops A's player; B converges to one player.
  await a.page.evaluate(() => window.__sandNet.disconnect());
  let bCount = 2;
  for (let i = 0; i < 15; i++) { await b.page.evaluate((k) => window.__sandNet.tickSteps(k, false), 4); await sleep(90); bCount = await b.page.evaluate(() => window.__sandNet.playerCount()); if (bCount === 1) break; }
  check(`server drops the disconnected player (B sees ${bCount})`, bCount === 1);

  await browser.close();
} catch (err) {
  console.error('mp-e2e error:', err.message);
  failures++;
} finally {
  if (browser) await browser.close().catch(() => {});
  await srv.close().catch(() => {});
  killVite();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
