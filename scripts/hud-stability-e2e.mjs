import { runBrowserCases } from './browser-harness.mjs';

process.exitCode = await runBrowserCases({ 'hud-stability': async ({ page, baseURL, check }) => {
  await page.route('**/hud-stability-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body><div id="host" style="width:640px;height:480px;position:relative"></div></body>',
  }));
  await page.goto(`${baseURL}/hud-stability-fixture`);
  const result = await page.evaluate(async () => {
    const [{ createMissionHud, presentMissionSnapshot }, { MISSION, OBJECTIVE_STATE }] = await Promise.all([
      import('/src/sand/embed/missionHud.js'), import('/src/sand/wasmBridge/abi.generated.js'),
    ]);
    const host = document.getElementById('host'), root = host.attachShadow({ mode: 'open' });
    const view = { cameraWorldX: 0, cameraWorldY: 0, viewCols: 128, viewRows: 96, playerWorldX: 0, playerWorldY: 0 };
    const hud = createMissionHud(root, { getMissionView: () => view });
    hud.update(presentMissionSnapshot({ missionId: MISSION.FRONTIER, phase: 1, objectives: [
      { id: 0, state: OBJECTIVE_STATE.ACTIVE, worldX: 200, worldY: 50, current: 0, required: 1 },
      { id: 1, state: OBJECTIVE_STATE.ACTIVE, worldX: 80, worldY: 50, current: 0, required: 1 },
    ] }));
    const frame = () => new Promise(requestAnimationFrame);
    await frame(); await frame();
    const markers = [...root.querySelectorAll('.sg-mission-marker')];
    const text = markers[0].querySelector('.range').firstChild;
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(root.querySelector('.sg-mission-markers'), { childList: true, attributes: true, subtree: true });
    for (let i = 0; i < 5; i++) await frame();
    const idleMutations = mutations;
    view.cameraWorldX = 1; await frame();
    const sameTextNode = markers[0].querySelector('.range').firstChild === text;
    host.dataset.trackedObjective = '1'; await frame();
    const switched = markers[0].hidden && !markers[1].hidden && !!markers[1].querySelector('.range').textContent;
    observer.disconnect(); hud.destroy();
    return { idleMutations, sameTextNode, switched };
  });
  check('stationary mission markers cause no repeated DOM mutations', result.idleMutations === 0);
  check('camera motion preserves an unchanged range text node', result.sameTextNode);
  check('changing the tracked objective reveals and updates its marker', result.switched);

  await page.goto(`${baseURL}/game?nosave`);
  await page.waitForFunction(() => document.querySelector('sand-game')?._game?.getPlayer(), null, { timeout: 60000 });
  const peak = await page.evaluate(async () => {
    window.__sandTest.setPaused(true);
    await new Promise(requestAnimationFrame);
    await new Promise(resolve => requestAnimationFrame(() => {
      const start = performance.now();
      while (performance.now() - start < 140) { /* emulate a visible main-thread hitch */ }
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    return document.querySelector('sand-game')._game.perfStats().peakRafMs;
  });
  check('frame diagnostics retain visible hitches over 100 ms', peak >= 100, `${peak.toFixed(1)} ms`);
} });
