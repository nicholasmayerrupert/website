import world from './world.js';
import sprite from './player.js';
import creatureArt from './creatureArt.js';
import { CREATURE } from '../wasmBridge/abi.generated.js';
import { compileContent } from './compile.js';

export const GAME_CONTENT = compileContent(world, sprite);
export const GAME_WORLD = world;
export const PLAYER_ART = sprite;
export const GAME_SCENES = GAME_CONTENT.scenes;
export const GAME_JOBS = world.quests.map((quest, id) => ({
  ...quest, id,
  reward: quest.reward ? `${quest.reward.name} · ${quest.reward.count}` : 'The valley is yours',
}));

export const CREATURE_HEIGHTS = Object.fromEntries(Object.entries(creatureArt).map(([key, art]) => [CREATURE[key], art.height * art.pixelScale]));
export const PLAYER_PREVIEW = { width: sprite.width, height: sprite.height, palette: sprite.palette, rows: sprite.clips.idle.frames[0] };
export const initGameContent = () => Promise.resolve(GAME_CONTENT);
