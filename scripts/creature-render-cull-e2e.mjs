import { runBrowserCases } from './browser-harness.mjs';

process.exitCode = await runBrowserCases({ 'creature-render-cull': async ({ page, baseURL, check }) => {
  await page.route('**/creature-render-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
  }));
  await page.goto(`${baseURL}/creature-render-fixture`);
  const results = await page.evaluate(async () => {
    const [{ initSandWasm, createEngineWasm }, { CREATURE, CREATURE_ATTACK_STATE, OFF, PLANET, STRIDES }] = await Promise.all([
      import('/src/sand/wasmBridge/engineFactory.js'),
      import('/src/sand/wasmBridge/abi.generated.js'),
    ]);
    await initSandWasm();
    const engines = [], canvases = [], results = [];
    const make = (planetId, width, height, camera) => {
      const engine = createEngineWasm({ cols: 320, rows: 256, infinite: false, sinksOn: false,
        storageRole: 'presentation', worldSeed: 7, planetId });
      engines.push(engine);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height; document.body.append(canvas); canvases.push(canvas);
      engine.glInit(canvas); engine.glResize(width, height);
      engine.setViewport(1, 1, width, height); engine.cameraSet(camera, camera);
      engine.glSetFlags(false, false, true); engine.setSkyLight(255); engine.syncActorTick(20);
      engine.glSetPlayers(true, new Float32Array(0), 0); engine.glSetItems(new Float32Array(0));
      engine.glSetProjectiles(new Float32Array(0));
      return engine;
    };
    const c = CREATURE, a = CREATURE_ATTACK_STATE;
    const cases = [
      ['center sprite', c.IRIS_ENGINEER, 110, 105, {}],
      ['left-edge sprite', c.IRIS_ENGINEER, 62, 105, {}],
      ['right-edge sprite', c.IRIS_ENGINEER, 189, 105, {}],
      ['top-edge sprite', c.IRIS_ENGINEER, 110, 65, {}],
      ['bottom-edge sprite', c.IRIS_ENGINEER, 110, 160, {}],
      ['offscreen idle sprite', c.ROOT_KNIGHT, 30, 100, {}],
      ['portal reaches viewport', c.ROOT_KNIGHT, 53, 100, { spawnProgress: .3 }],
      ['shelter reaches viewport', c.IRIS_ENGINEER, 60, 100, { shelterCharge: 1 }],
      ['rescue ascent', c.SURVEYOR, 110, 164, { rescueProgress: 1.7 }],
      ['rescue sparks', c.SURVEYOR, 110, 166, { rescueProgress: .7 }],
      ['health bar', c.ROOT_KNIGHT, 110, 166, { health: 20 }],
      ['charge path from offscreen', c.BONE_GUARD, 35, 110, { attackState: a.CHARGING }],
      ['shockwave from offscreen', c.HOLLOW_BELLKEEPER, 32, 100, { attackState: a.FIRING, attackPattern: 0, attackProgress: .3 }],
      ['aimed spell from offscreen', c.MIRE_MATRON, 30, 105, { attackState: a.FIRING, attackPattern: 1 }],
      ['bore from offscreen', c.BORE_SENTINEL, 30, 105, { attackState: a.FIRING }],
      ['mortar from offscreen', c.CAUSTIC_MORTARMAN, 30, 105, { attackState: a.CHARGING }],
      ['cluster from offscreen', c.CLUSTER_WASP, 30, 105, { attackState: a.CHARGING }],
      ['weapon reaches viewport', c.MINIGUNNER, 59, 105, { attackState: a.FIRING }],
    ];
    try {
      for (const planet of [PLANET.FRONTIER, PLANET.EARTH]) {
        const clipped = make(planet, 128, 96, 64), reference = make(planet, 256, 224, 0);
        reference.glSetCreatures(new Float32Array(0)); reference.glRenderFrame(true);
        const blank = reference.glReadPixels(64, 64, 128, 96);
        for (const [name, species, x, y, state] of cases) {
          if (!Number.isInteger(species)) throw new Error(`Missing creature for ${name}`);
          const data = new Float32Array(STRIDES.creatureSnapshot);
          const actor = { id: 1, species, x, y, w: 8, h: 12, facing: 1, health: 100,
            maxHealth: 100, alive: 1, aimX: 115, aimY: 110, attackProgress: .5, ...state };
          for (const [key, value] of Object.entries(actor)) data[OFF.creatureSnapshot[key]] = value;
          clipped.glSetCreatures(data); reference.glSetCreatures(data);
          clipped.glRenderFrame(true); reference.glRenderFrame(true);
          const actual = clipped.glReadPixels(0, 0, 128, 96), expected = reference.glReadPixels(64, 64, 128, 96);
          let different = 0, visible = 0;
          for (let i = 0; i < actual.length; i++) {
            if (actual[i] !== expected[i]) different++;
            if (expected[i] !== blank[i]) visible++;
          }
          results.push({ name, planet, different, visible });
        }
      }
    } finally { for (const engine of engines) engine.destroy(); for (const canvas of canvases) canvas.remove(); }
    return results;
  });
  for (const result of results) {
    check(`${result.name} matches unclipped reference on planet ${result.planet}`,
      result.different === 0, `${result.different} differing channels`);
    if (result.name === 'center sprite') check(`reference sprite is visible on planet ${result.planet}`, result.visible > 0);
  }
} });
