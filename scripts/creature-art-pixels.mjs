// Shared chroma-key extraction for generated creature sprite sheets.
export function cutFrame(image, column, row, columns = 4, rows = 3, rowEdges) {
  const left = Math.round(column * image.width / columns), top = rowEdges?.[row] ?? Math.round(row * image.height / rows);
  const width = Math.round((column + 1) * image.width / columns) - left;
  const height = (rowEdges?.[row + 1] ?? Math.round((row + 1) * image.height / rows)) - top;
  const pixels = new Array(width * height), background = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = ((top + y) * image.width + left + x) * 4;
    pixels[y * width + x] = [...image.data.subarray(at, at + 3)];
  }
  const corners = [pixels[0], pixels[width - 1], pixels[(height - 1) * width], pixels.at(-1)];
  const color = [0, 1, 2].map(c => corners.map(p => p[c]).sort((a, b) => a - b)[1]);
  // Chroma key also clears enclosed gaps between legs, wings, and weapons.
  pixels.forEach((rgb, i) => { if (rgb.reduce((n, value, c) => n + (value - color[c]) ** 2, 0) < 380) background[i] = 1; });
  const visited = new Uint8Array(pixels.length), components = [];
  for (let start = 0; start < pixels.length; start++) {
    if (visited[start] || background[start]) continue;
    const component = [start]; visited[start] = 1;
    for (let i = 0; i < component.length; i++) {
      const at = component[i], x = at % width, y = Math.floor(at / width);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!background[next] && !visited[next]) { visited[next] = 1; component.push(next); }
      }
    }
    components.push(component);
  }
  const largest = Math.max(...components.map(c => c.length));
  for (const component of components) {
    const touchesEdge = component.some(at => at < width || at >= width * (height - 1) || at % width === 0 || at % width === width - 1);
    if (component.length < Math.max(20, largest * .002) || (touchesEdge && component.length < largest * .2))
      for (const at of component) background[at] = 1;
  }
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let i = 0; i < pixels.length; i++) if (!background[i]) {
    const x = i % width, y = Math.floor(i / width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) throw new Error(`Empty sheet cell ${column},${row}`);
  return { pixels, background, width, height, minX, maxX, minY, maxY };
}

