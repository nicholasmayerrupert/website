import { cutFrame } from './creature-art-pixels.mjs';

// One atlas and one source scale for land, combat, and swimming poses.
export function sampleCreatureAtlas(image, metadata) {
  const { columns, rows, swim = [], count = Math.max(12, ...swim.map(i => i + 1)) } = metadata.atlas;
  if (columns !== 4 || !Number.isInteger(rows) || rows < 3 || rows > 6 ||
      !Number.isInteger(count) || count < 12 || count > columns * rows ||
      swim.some(i => !Number.isInteger(i) || i < 12 || i >= count))
    throw new Error('Invalid creature atlas layout');
  const { rowEdges } = metadata.atlas;
  if (rowEdges && (rowEdges.length !== rows + 1 || rowEdges[0] !== 0 || rowEdges.at(-1) !== image.height ||
      rowEdges.some((edge, i) => !Number.isInteger(edge) || (i > 0 && edge <= rowEdges[i - 1]))))
    throw new Error('Invalid creature atlas row boundaries');
  const movement = metadata.clipFrames?.move ?? [0, 1, 2, 3];
  if (!movement.length || movement.some(i => !Number.isInteger(i) || i < 0 || i >= 4))
    throw new Error('Invalid creature movement frames');
  const source = Array.from({ length: count }, (_, i) => i < 4 && !movement.includes(i)
    ? null : cutFrame(image, i % columns, Math.floor(i / columns), columns, rows, rowEdges));
  const idle = source[4], target = metadata.targetBounds;
  const idleHeight = idle.maxY - idle.minY + 1;
  const scale = metadata.fit === 'height' ? idleHeight / target.height
    : Math.max((idle.maxX - idle.minX + 1) / target.width, idleHeight / target.height);
  if (!(scale > 0)) throw new Error('Invalid creature atlas scale');
  const centerY = target.bottom - (idleHeight / scale - 1) / 2;
  const swimCenterY = swim.length
    ? (Math.min(...swim.map(i => source[i].minY)) + Math.max(...swim.map(i => source[i].maxY))) / 2 : 0;
  const walkFloor = Math.max(...movement.map(i => source[i].maxY));
  const anchors = source.map((f, i) => f && ({
    x: metadata.anchors?.[i]?.x ?? f.width / 2,
    y: metadata.anchors?.[i]?.y ?? (swim.includes(i) ? swimCenterY : metadata.grounded ? (i < 4 ? walkFloor : f.maxY) : (f.minY + f.maxY) / 2),
    targetY: !metadata.grounded || swim.includes(i) ? centerY : target.bottom,
  }));
  // Wide attacks and swimming expand the canvas, without shrinking the idle body.
  const halfWidth = Math.max((metadata.width - 1) / 2, ...source.flatMap((f, i) => f ? [
    (anchors[i].x - f.minX) / scale + 1, (f.maxX - anchors[i].x) / scale + 1,
  ] : []));
  const width = metadata.width + Math.max(0, Math.ceil(halfWidth - (metadata.width - 1) / 2)) * 2;
  const minY = Math.min(...source.flatMap((f, i) => f ? [anchors[i].targetY + (f.minY - anchors[i].y) / scale] : []));
  const maxY = Math.max(...source.flatMap((f, i) => f ? [anchors[i].targetY + (f.maxY - anchors[i].y) / scale] : []));
  const extraTop = Math.max(0, Math.ceil(-minY)), extraBottom = Math.max(0, Math.ceil(maxY - metadata.height + 1));
  const height = metadata.height + extraTop + extraBottom;
  const frames = source.map((f, i) => !f ? [] : Array.from({ length: width * height }, (_, at) => {
    const x = at % width, y = Math.floor(at / width);
    const sx = Math.round(anchors[i].x + (x - (width - 1) / 2) * scale);
    const floorPadding = metadata.grounded && !swim.includes(i) ? extraBottom : 0;
    const sy = Math.round(anchors[i].y + (y - extraTop - floorPadding - anchors[i].targetY) * scale);
    if (sx < 0 || sy < 0 || sx >= f.width || sy >= f.height || f.background[sy * f.width + sx]) return null;
    return f.pixels[sy * f.width + sx];
  }));
  // Authored one-pixel features keep their nearest native-grid location.
  for (const [index, details] of Object.entries(metadata.atlas.pixelDetails ?? {})) {
    const i = Number(index), f = source[i];
    const floorPadding = metadata.grounded && !swim.includes(i) ? extraBottom : 0;
    for (const [sx, sy] of details) {
      if (!f || !Number.isInteger(sx) || !Number.isInteger(sy) || sx < 0 || sy < 0 || sx >= f.width || sy >= f.height)
        throw new Error('Invalid atlas pixel detail');
      const x = Math.round((sx - anchors[i].x) / scale + (width - 1) / 2);
      const y = Math.round((sy - anchors[i].y) / scale + extraTop + floorPadding + anchors[i].targetY);
      if (x < 0 || y < 0 || x >= width || y >= height || f.background[sy * f.width + sx])
        throw new Error('Atlas pixel detail falls outside its opaque sprite');
      frames[i][y * width + x] = f.pixels[sy * f.width + sx];
    }
  }
  return { width, height, frames };
}
