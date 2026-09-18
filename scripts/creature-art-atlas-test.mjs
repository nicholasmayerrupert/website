import assert from 'node:assert/strict';
import { sampleCreatureAtlas } from './creature-art-atlas.mjs';
import art from '../src/sand/content/creatureArt.js';
import parts from '../src/sand/content/playerParts.js';
import { CREATURE_ATTACK_ANIMATIONS } from '../src/sand/content/creatureAnimations.js';
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { cutFrame } from './creature-art-pixels.mjs';

// Alpha is authoritative: black pixels and detached one-pixel details survive import.
const transparent = { width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4) };
transparent.data.set([0, 0, 0, 255], 0);
transparent.data.set([220, 140, 60, 255], (4 * 8 + 4) * 4);
const extracted = cutFrame(transparent, 0, 0, 1, 1);
assert.equal(extracted.background[0], 0, 'opaque black must not become chroma-key background');
assert.equal(extracted.background[4 * 8 + 4], 0, 'a detached native pixel must not be filtered as a source speck');
assert.equal(extracted.background[1], 1, 'transparent pixels remain empty');

const image = { width: 256, height: 256, data: Buffer.alloc(256 * 256 * 4) };
for (let i = 0; i < image.data.length; i += 4) image.data.set([32, 54, 64, 255], i);
function rect(frame, x, y, width, height) {
  const ox = frame % 4 * 64, oy = Math.floor(frame / 4) * 64;
  for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++)
    image.data.set([200, 130, 60, 255], ((oy + yy) * 256 + ox + xx) * 4);
}
for (let i = 0; i < 15; i++) rect(i, 26, 24, 12, 24);
rect(6, 4, 32, 56, 8);
const metadata = { width: 16, height: 24, pixelScale: .5, grounded: true, fit: 'height', targetBounds: { width: 8, height: 12, bottom: 23 }, atlas: { columns: 4, rows: 4, swim: [12, 13, 14] } };
const result = sampleCreatureAtlas(image, metadata);
const bounds = frame => {
  const points = frame.flatMap((p, i) => p ? [[i % result.width, Math.floor(i / result.width)]] : []);
  return { left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) };
};
const idle = bounds(result.frames[4]), attack = bounds(result.frames[6]);
assert.equal(result.frames.length, 15);
assert(result.width > metadata.width, 'wide attack expands the shared canvas');
assert.equal(idle.bottom - idle.top + 1, 12, 'wide attack must not shrink the standing body');
assert.equal(idle.bottom, result.height - 1, 'standing feet stay on the shared ground baseline');
assert(attack.left > 0 && attack.right < result.width - 1, 'attack fits without clipping');
assert(result.frames.every(frame => frame.length === result.width * result.height));
assert.throws(() => sampleCreatureAtlas(image, { ...metadata, atlas: { columns: 3, rows: 4 } }), /layout/);
image.data.set([0, 0, 0, 255], ((64 + 30) * image.width + 28) * 4);
const isBlack = pixel => pixel?.every(value => value === 0);
assert(!sampleCreatureAtlas(image, metadata).frames[4].some(isBlack), 'fixture detail lies between regular samples');
const detailed = { ...metadata, atlas: { ...metadata.atlas, pixelDetails: { 4: [[28, 30]] } } };
assert(sampleCreatureAtlas(image, detailed).frames[4].some(isBlack), 'authored eye survives native-grid sampling');
assert.throws(() => sampleCreatureAtlas(image, { ...metadata, atlas: { ...metadata.atlas, pixelDetails: { 4: [[999, 0]] } } }), /pixel detail/);
const manifest = JSON.parse(readFileSync(new URL('../src/sand/art/creatures/manifest.json', import.meta.url)));
for (const [key, record] of Object.entries(art)) {
  assert.equal(record.pixelScale, .5, `${key}: roster-wide half-cell native grid`);
  for (const [name, clip] of Object.entries(record.clips)) for (const frame of clip.frames) {
    assert.equal(frame.length, record.height, `${key}/${name}: frame height`);
    assert(frame.every(row => row.length === record.width), `${key}/${name}: frame width`);
    assert(frame.some(row => /[^.]/.test(row)), `${key}/${name}: nonempty pose`);
    assert(frame.every(row => [...row].every(p => Object.hasOwn(record.palette, p))), `${key}/${name}: valid palette`);
  }
  if (key !== 'BONE_DINOSAUR') {
    const source = manifest.creatures[key];
    assert(source?.atlas && source.pixelScale === .5, `${key}: repeatable half-cell atlas import`);
    assert(!source.walkSheet, `${key}: walk belongs to the unified atlas`);
    assert(existsSync(new URL('../src/sand/art/creatures/' + source.sheet, import.meta.url)), `${key}: source exists`);
    const { data, info } = await sharp(fileURLToPath(new URL('../src/sand/art/creatures/' + source.sheet, import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert(info.width <= 512 && info.height <= 512, `${key}: compact source grid`);
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      assert(data[i + 3] === 0 || data[i + 3] === 255, `${key}: hard alpha edges`);
      if (data[i + 3]) colors.add(data.subarray(i, i + 3).toString('hex'));
    }
    assert(colors.size <= 16, `${key}: flat source palette`);
    assert.equal(source.atlas.rowEdges.at(-1), info.height, `${key}: source row boundaries`);
  }
  for (const attack of CREATURE_ATTACK_ANIMATIONS[key] ?? []) for (const range of Object.values(attack).filter(v => typeof v === 'object'))
    assert(range.start + range.count <= record.clips[range.clip].frames.length, `${key}: complete attack range`);
}
for (const key of ['VILLAGER', 'VILLAGE_GUARD', 'VILLAGE_HUNTER', 'IRIS_COMMANDER', 'IRIS_ENGINEER', 'SURVEYOR']) {
  const record = art[key], occupied = record.clips.idle.frames[0].flatMap((row, y) => /[^.]/.test(row) ? [y] : []);
  const standingHeight = (Math.max(...occupied) - Math.min(...occupied) + 1) * record.pixelScale;
  assert.equal(record.pixelScale, .5, `${key}: half-cell native grid`);
  assert(standingHeight >= 10 && standingHeight <= 11, `${key}: adult height comparable to the player`);
}
for (const set of parts) for (const part of set.parts) for (let y = 0; y < part.height; y++) for (let x = 0; x < part.width; x++)
  assert.equal(part.pixels[y * part.width + x], part.pixels[Math.floor(y / 2) * 2 * part.width + Math.floor(x / 2) * 2], `${set.name}/${part.name}: no finer-than-half-cell source texturing`);
console.log('PASS: unified atlas slicing, constant standing height, wide-pose padding, grounded baseline, and layout validation.');
