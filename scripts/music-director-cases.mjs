import { createMusicDirector, scoreThreat } from '../src/sand/audio/musicDirector.js';
import { CREATURE_SPECIES_DEFS, OFF, STRIDES } from '../src/sand/wasmBridge/abi.generated.js';

export async function testMusicDirector(check) {
  const player = { id: 1, x: 0, y: 0, alive: true, health: 100 };
  const creature = (key, { x = 20, alive = 1, attackState = 0, npcId = 0 } = {}) => {
    const values = new Float32Array(STRIDES.creatureSnapshot);
    const O = OFF.creatureSnapshot;
    values[O.species] = CREATURE_SPECIES_DEFS.find(species => species.key === key).id;
    values[O.x] = x; values[O.alive] = alive; values[O.health] = 100;
    values[O.attackState] = attackState; values[O.npcId] = npcId;
    return values;
  };
  check('music ignores wildlife, villagers, and friendly NPCs',
    !scoreThreat(player, creature('fox')).threat
      && !scoreThreat(player, creature('villager')).threat
      && !scoreThreat(player, creature('bone_guard', { npcId: 1 })).threat);
  check('music identifies nearby hostiles and active ranged attacks',
    scoreThreat(player, creature('bone_guard')).threat
      && scoreThreat(player, creature('fen_wisp', { x: 80, attackState: 1 })).threat);
  check('music ignores dead and distant enemies',
    !scoreThreat(player, creature('bone_guard', { alive: 0 })).threat
      && !scoreThreat(player, creature('bone_guard', { x: 120, attackState: 1 })).threat
      && !scoreThreat({ ...player, alive: false }, creature('bone_guard')).threat);
  check('boss encounters select the heavier score',
    scoreThreat(player, creature('hollow_bellkeeper')).boss);

  const makeHarness = ({ failFirst = false, denyFirst = false, defer = false } = {}) => {
    const media = [], nodes = [];
    const node = () => {
      const n = { disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
      nodes.push(n); return n;
    };
    const context = {
      currentTime: 0,
      createMediaElementSource: node,
      createGain() { return { ...node(), gain: { value: 0, setValueAtTime() {},
        linearRampToValueAtTime() {}, cancelAndHoldAtTime() {} } }; },
    };
    let complete;
    const director = createMusicDirector(context, {}, { createMedia() {
      const element = { paused: true, currentTime: 0, duration: 120,
        play() {
          this.paused = false;
          if (failFirst && media.length === 1) return Promise.reject(new Error('Missing track'));
          if (denyFirst && media.length === 1)
            return Promise.reject(Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' }));
          return defer ? new Promise(resolve => { complete = resolve; }) : Promise.resolve();
        },
        pause() { this.paused = true; },
        removeAttribute() { this.src = ''; }, load() {},
      };
      media.push(element); return element;
    } });
    return { context, director, media, nodes, finish: () => complete() };
  };
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  const { context, director, media } = makeHarness();
  director.update();
  check('the score loads no media before activation', media.length === 0);
  director.setAudible(true); await settle();
  check('the original main theme opens the exploration sequence', director.state.track === 'hearth');
  context.currentTime = 1;
  director.update({ threat: true }); await settle();
  check('confirmed combat starts its own arrangement promptly', director.state.track === 'embers');
  context.currentTime = 4;
  director.update({ threat: true, boss: true }); await settle();
  check('a boss escalates to the seven-beat arrangement', director.state.track === 'bell');
  context.currentTime = 12;
  director.update();
  check('combat holds across gaps between attacks', director.state.track === 'bell');
  context.currentTime = 19;
  director.update(); await settle();
  check('danger clearing returns to a different exploration piece', director.state.track === 'canopy');
  context.currentTime = 23;
  director.update();
  check('crossfades retire the old media stream', media.filter(element => !!element.src).length === 1);
  const playing = media.at(-1);
  playing.currentTime = 25;
  director.setAudible(false);
  check('mute and visibility suspension pause streaming', playing.paused && !director.state.playing);
  director.setAudible(true); await settle();
  check('resuming preserves the musical position', !playing.paused && playing.currentTime === 25);
  playing.currentTime = 118;
  context.currentTime = 40;
  director.update(); await settle();
  check('a completed cue advances through the exploration repertoire', director.state.track === 'hollows');
  director.destroy();
  check('destroy releases every media stream', media.every(element => !element.src && element.paused));

  const failure = makeHarness({ failFirst: true });
  failure.director.setAudible(true); await settle();
  failure.director.update(); await settle();
  check('an unavailable composition falls through to another cue', failure.director.state.track === 'canopy');
  failure.director.destroy();
  const denied = makeHarness({ denyFirst: true });
  denied.director.setAudible(true); await settle();
  for (let i = 0; i < 10; i++) denied.director.update();
  check('autoplay denial waits for activation without repeatedly creating streams', denied.media.length === 1);
  denied.director.activate(); await settle();
  check('user activation retries a browser-blocked track', denied.director.state.track === 'hearth');
  denied.media.at(-1).onerror(new Error('Stream failed'));
  denied.director.update(); await settle();
  check('an error during playback also advances to an available composition', denied.director.state.track === 'canopy');
  denied.director.destroy();
  const pending = makeHarness({ defer: true });
  pending.director.setAudible(true);
  pending.director.destroy(); pending.finish(); await settle();
  check('late media readiness cannot restart a destroyed score',
    !pending.director.state.playing && pending.media.every(element => !element.src));
}
