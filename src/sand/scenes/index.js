// Scene registry. A scene = a builder (seeds the initial world) plus optional
// emitters (continuous sources). Add a scene by importing it and adding an entry.
// About.jsx picks one by key (default below; `?scene=<key>` overrides).

import { buildCastleScene, castleEmitters } from './castleScene.js';
import { buildLandscapeScene, landscapeEmitters } from './landscapeScene.js';
import { buildNoitaScene, noitaEmitters } from './noitaScene.js';

export const scenes = {
  landscape: { build: buildLandscapeScene, emitters: landscapeEmitters },
  castle: { build: buildCastleScene, emitters: castleEmitters },
  noita: { build: buildNoitaScene, emitters: noitaEmitters },
};

export const DEFAULT_SCENE = 'noita';

// Resolve a scene by key, falling back to the default if unknown/empty.
export function getScene(key) {
  return scenes[key] || scenes[DEFAULT_SCENE];
}
