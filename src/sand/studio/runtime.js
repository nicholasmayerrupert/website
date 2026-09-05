import { GAME_CONTENT, GAME_SCENES } from '../content/catalog.js';
import { ABSOLUTE } from '../content/compile.js';

// Scene setup travels through the authority worker. The inspector reads its
// replicated state, exactly as the production game does.
export function createStudioRuntime(host) {
  let sceneId = 'hearth';
  let paused = false;
  const inspect = () => {
    const test = window.__sandTest;
    const offset = test.worldOffset();
    const player = test.getPlayer();
    return {
      scene: sceneId, contentHash: GAME_CONTENT.hash.toString(16), paused,
      player: player && { ...player, worldX: player.x + offset.x, worldY: player.y + offset.y },
      mission: host._game.getMission(),
      view: host._game.getMissionView(),
      actors: test.getCreatures(), perf: window.__sandPerf(),
    };
  };
  const setPaused = (value) => {
    paused = !!value;
    // Keep RAF alive to apply worker snapshots while the simulation is paused.
    window.__sandTest.setPaused(paused);
  };
  return {
    scenes: GAME_SCENES.map(({ id, name, description }) => ({ id, name, description })),
    inspect,
    pause: () => setPaused(true),
    play: () => setPaused(false),
    step: (ticks = 1) => { setPaused(true); window.__sandTest.stepAuthorityActors(Math.min(240, Math.max(1, ticks | 0))); },
    async load(id) {
      const scene = GAME_SCENES.find(s => s.id === id);
      if (!scene) throw new Error(`Unknown scene ${id}. Available: ${GAME_SCENES.map(s => s.id).join(', ')}`);
      sceneId = id;
      setPaused(false);
      const test = window.__sandTest;
      test.setCreatureRuntime(true, false);
      host._game.resetZoom();
      for (let i = 0; i < Math.abs(scene.zoomSteps); i++)
        host._game[scene.zoomSteps < 0 ? 'zoomOut' : 'zoomIn']();
      test.setDayPhase(scene.dayPhase);
      const x = scene.at[0];
      const y = scene.at[1] + (scene.surface === ABSOLUTE ? 0 : test.surfaceAt(scene.surface));
      // Zoom can resize the loaded window; wait for its debounced operation
      // before positioning through the authority's current coordinate system.
      await new Promise(resolve => setTimeout(resolve, 250));
      test.previewScene(x, y);
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const p = inspect().player;
        if (p && Math.abs(p.worldX - x) < 8 && Math.abs(p.worldY - y) < 32) {
          host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true });
          return inspect();
        }
      }
      throw new Error(`Authority did not enter scene ${id}`);
    },
  };
}
