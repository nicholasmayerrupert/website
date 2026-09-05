import { GAME_CONTENT, GAME_SCENES, GAME_JOBS } from '../src/sand/content/catalog.js';

console.log(`Game content ${GAME_CONTENT.world.id} · ${GAME_CONTENT.hash.toString(16)}`);
console.log(`${GAME_CONTENT.rectangles.length} stamp rectangles · ${GAME_JOBS.length} quests · ${GAME_CONTENT.packed.byteLength.toLocaleString()} bytes`);
for (const scene of GAME_SCENES) console.log(`  ${scene.id.padEnd(16)} ${scene.name}`);
console.log('Content references, materials, geometry, quest dependencies and pixel frames are valid.');
