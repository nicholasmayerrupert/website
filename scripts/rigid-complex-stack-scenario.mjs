export const randomFor = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export const makeShape = (width, height, seed, kind) => {
  const random = randomFor(seed);
  const cells = new Map();
  const put = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < width && y >= 0 && y < height)
      cells.set(`${x},${y}`, [x, y]);
  };
  const disc = (cx, cy, radius) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) put(x, y);
  };
  const line = (x0, y0, x1, y1, radius) => {
    const count = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= count; step++) {
      const t = step / Math.max(1, count);
      disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius);
    }
  };
  const cx = width * (0.42 + random() * 0.16);
  const cy = height * (0.42 + random() * 0.16);
  const rib = 2 + kind % 4;
  disc(cx, cy, 6 + kind % 4);

  if (kind % 4 === 0) {
    // A long cave-like shelf with offset forks and hanging teeth.
    line(4, height * 0.62, width - 5, height * 0.68, rib + 1);
    for (let branch = 0; branch < 15; branch++) {
      const x = 10 + random() * (width - 20);
      const y = branch & 1 ? 5 + random() * cy : cy + random() * (height - cy - 5);
      line(cx, cy, x, y, rib + branch % 3);
    }
  } else if (kind % 4 === 1) {
    // Hollow roof/truss: strongly concave with several long lever arms.
    line(3, height - 6, width - 4, height - 6, rib + 2);
    line(3, height - 6, width * 0.5, 4, rib + 1);
    line(width * 0.5, 4, width - 4, height - 6, rib + 1);
    for (let brace = 0; brace < 7; brace++) {
      const x0 = brace * width / 7;
      const x1 = (brace + 1) * width / 7;
      line(x0, height - 8, x1, height * (0.24 + 0.12 * (brace & 1)), rib);
    }
  } else if (kind % 4 === 2) {
    // Bent, oblong spine with alternating deep hooks.
    let previousX = 4;
    let previousY = height * 0.48;
    for (let segment = 1; segment <= 9; segment++) {
      const x = 4 + segment * (width - 8) / 9;
      const y = height * (0.38 + 0.20 * Math.sin(segment * 1.7 + seed));
      line(previousX, previousY, x, y, rib + 1);
      if (segment % 2 === 0)
        line(x, y, x + (random() - 0.5) * width * 0.12,
          segment % 4 ? 4 : height - 5, rib);
      previousX = x;
      previousY = y;
    }
  } else {
    // A broad ring with broken-looking internal spokes, all still connected.
    line(5, 5, width - 6, 5, rib);
    line(width - 6, 5, width - 6, height - 6, rib);
    line(width - 6, height - 6, 5, height - 6, rib);
    line(5, height - 6, 5, 5, rib);
    for (let spoke = 0; spoke < 10; spoke++) {
      const phase = spoke * Math.PI * 2 / 10 + random() * 0.2;
      line(cx, cy,
        cx + Math.cos(phase) * width * (0.40 + random() * 0.08),
        cy + Math.sin(phase) * height * (0.38 + random() * 0.09), rib);
    }
  }
  const pending = new Set(cells.keys());
  let largest = [];
  while (pending.size) {
    const first = pending.values().next().value;
    pending.delete(first);
    const queue = [cells.get(first)];
    const component = [];
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = queue[index];
      component.push([x, y]);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const key = `${x + ox},${y + oy}`;
          if (!pending.delete(key)) continue;
          queue.push(cells.get(key));
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  return largest;
};

export const makePeerShape = (cells, width, height, seed) => {
  const random = randomFor(seed);
  const result = new Map(cells.map(([x, y]) => [`${x},${y}`, [x, y]]));
  const put = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < width && y >= 0 && y < height)
      result.set(`${x},${y}`, [x, y]);
  };
  const disc = (cx, cy, radius) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) put(x, y);
  };
  const line = (x0, y0, x1, y1, radius) => {
    const count = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= count; step++) {
      const t = step / Math.max(1, count);
      disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius);
    }
  };
  const center = cells.reduce((sum, [x, y]) =>
    [sum[0] + x / cells.length, sum[1] + y / cells.length], [0, 0]);
  for (let branch = 0; branch < 3; branch++) {
    const edgeX = branch === 0 ? width - 3
      : branch === 1 ? 3 : width * (0.25 + random() * 0.5);
    const edgeY = branch === 2 ? 3 : height * (0.2 + random() * 0.6);
    line(center[0], center[1], edgeX, edgeY, 2 + branch);
  }
  return [...result.values()];
};

export const makeComplexStackScenario = (seed, cols = 960) => {
  const random = randomFor(seed ^ 0x9e3779b9);
  const specs = [];
  let y = 20;
  for (let body = 0; body < 12; body++) {
    const width = 420 + Math.floor(random() * 390);
    const height = 62 + Math.floor(random() * 42);
    const cells = makeShape(width, height, seed * 101 + body * 17, body);
    const peerCells = makePeerShape(
      cells, width, height, seed * 131 + body * 23);
    const x = Math.max(4, Math.min(cols - width - 4,
      Math.round((cols - width) * 0.5 + (random() - 0.5) * 170)));
    const kind = body % 3 === 1 ? 'joint' : body % 3 === 2 ? 'bg' : 'fg';
    specs.push({ cells, peerCells, x, y, kind, width, height });
    y += height + 7 + Math.floor(random() * 9);
  }
  return { random, specs };
};
