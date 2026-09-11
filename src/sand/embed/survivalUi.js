import pixelFontUrl from '../assets/fonts/PixelifySans.ttf?url';

if (![...document.fonts].some(font => font.family === 'Sand Pixel')) {
  const font = new FontFace('Sand Pixel', `url(${pixelFontUrl})`, { weight: '400 700', display: 'swap' });
  document.fonts.add(font);
  font.load().catch(() => {});
}

export { createInventoryHud } from './inventoryHud.js';
export { createAdventureHud } from './adventureHud.js';
export { createSurvivalStatus } from './survivalStatus.js';
export { createFootprintMenu } from './footprintMenu.js';
export { createMissionHud } from './missionHud.js';
export { createTalkHud } from './talkHud.js';
