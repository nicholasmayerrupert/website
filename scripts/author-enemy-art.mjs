// Rebuild creatures from the registered compact sprite sources.
import { readFileSync, writeFileSync } from 'node:fs';
import { importCreatureArt } from './import-creature-art.mjs';
import { importCinderjawDragonArt } from './import-cinderjaw-dragon-art.mjs';
import { importRegisteredSwim } from './import-creature-swim.mjs';
const output = new URL('../src/sand/content/creatureArt.js', import.meta.url);
const source = readFileSync(output, 'utf8');
const art = JSON.parse(source.slice(source.indexOf('export default ') + 15).trim().replace(/;$/, ''));
const only = process.argv.indexOf('--only');
const keys = only < 0 ? Object.keys(art) : [process.argv[only + 1]];
for (const key of keys) {
  if (!art[key]) throw new Error(`Unknown creature ${key}`);
  art[key] = key === 'CINDERJAW_DRAGON' ? await importCinderjawDragonArt() : (await importCreatureArt([key]))[key];
}
await importRegisteredSwim(art);
writeFileSync(output, '// Editable native-resolution creature clips.\nexport default ' + JSON.stringify(art, null, 2) + ';\n');
console.log(`Imported ${keys.length} creatures.`);
