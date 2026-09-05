import world from './world.js';
import sprite from './player.js';
import { compileContent } from './compile.js';

export const GAME_CONTENT = compileContent(world, sprite);
export const GAME_WORLD = world;
export const PLAYER_ART = sprite;
export const GAME_SCENES = GAME_CONTENT.scenes;
export const GAME_JOBS = world.quests.map((quest, id) => ({
  ...quest, id,
  reward: quest.reward ? `${quest.reward.name} · ${quest.reward.count}` : 'The valley is yours',
}));
