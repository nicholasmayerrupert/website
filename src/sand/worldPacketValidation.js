import { isMaterialId } from './materials.generated.js';

const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const readU32 = (bytes, offset) => (
  bytes[offset]
  | (bytes[offset + 1] << 8)
  | (bytes[offset + 2] << 16)
  | (bytes[offset + 3] << 24)
) >>> 0;

export const isValidMaterialId = isMaterialId;

export const maxWorldRleBytes = (cells) => cells * 22;
export const maxWorldDiffBytes = (cells) => cells * 22 + 4;

function scanWorldRle(bytes, cells, withHash) {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(cells) || cells <= 0) return false;
  let offset = 0;
  let hash = 0x811c9dc5;
  for (let layer = 0; layer < 2; layer++) {
    let filled = 0;
    while (filled < cells) {
      if (offset + 5 > bytes.length) return false;
      const run = readU32(bytes, offset);
      const material = bytes[offset + 4];
      offset += 5;
      if (run === 0 || run > cells - filled || !isValidMaterialId(material)) return false;
      if (withHash) {
        for (let i = 0; i < run; i++)
          hash = Math.imul((hash ^ material) >>> 0, 0x01000193) >>> 0;
      }
      filled += run;
    }
  }
  for (let layer = 0; layer < 2; layer++) {
    let filled = 0;
    while (filled < cells) {
      if (offset + 6 > bytes.length) return false;
      const run = readU32(bytes, offset);
      const texel = readU16(bytes, offset + 4);
      if (!run || run > cells - filled || (texel >= 1024 && texel !== 0xffff)) return false;
      filled += run;
      offset += 6;
    }
  }
  if (offset !== bytes.length) return false;
  return withHash ? hash : true;
}

export function isValidWorldRle(bytes, cells) {
  return scanWorldRle(bytes, cells, false) === true;
}

export function worldRleHash(bytes, cells) {
  const result = scanWorldRle(bytes, cells, true);
  return result === false ? null : result;
}

export function isValidWorldDiff(bytes, cols, rows) {
  if (!(bytes instanceof Uint8Array)
      || !Number.isInteger(cols) || !Number.isInteger(rows)
      || cols <= 0 || rows <= 0 || cols > 0xffff || rows > 0xffff) return false;
  let offset = 0;
  for (let layer = 0; layer < 2; layer++) {
    if (offset + 2 > bytes.length) return false;
    const rects = readU16(bytes, offset);
    offset += 2;
    for (let rect = 0; rect < rects; rect++) {
      if (offset + 8 > bytes.length) return false;
      const x0 = readU16(bytes, offset);
      const y0 = readU16(bytes, offset + 2);
      const x1 = readU16(bytes, offset + 4);
      const y1 = readU16(bytes, offset + 6);
      offset += 8;
      if (x1 < x0 || y1 < y0 || x1 > cols || y1 > rows) return false;
      const area = (x1 - x0) * (y1 - y0);
      if (area * 3 > bytes.length - offset) return false;
      for (let i = 0; i < area; i++) {
        if (!isValidMaterialId(bytes[offset + i])) return false;
      }
      for (let i = 0; i < area; i++) {
        const texel = readU16(bytes, offset + area + i * 2);
        if (texel >= 1024 && texel !== 0xffff) return false;
      }
      offset += area * 3;
    }
  }
  return offset === bytes.length;
}
