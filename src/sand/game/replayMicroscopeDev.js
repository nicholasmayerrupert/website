import { decodeReplayCapsule } from './replayCapsule.js';

const DEFAULT_OVERLAYS = [
  'bodies', 'contacts', 'velocity', 'labels', 'status', 'selection', 'cells',
];

const bodyRef = (value) => {
  if (!value && value !== 0) return null;
  if (typeof value === 'object')
    return { layer: value.layer | 0, id: value.id | 0 };
  const match = String(value).match(/^(\d+):(-?\d+)$/);
  if (!match) throw new Error('Body references use layer:id, for example 0:936.');
  return { layer: Number(match[1]), id: Number(match[2]) };
};

const sameBody = (body, ref) => !!body && !!ref
  && body.layer === ref.layer && body.id === ref.id;

export function createReplayMicroscopeDev(ctx, render) {
  let capsule = null;
  let frame = null;
  let selectedBody = null;
  let focus = 'recorded';
  let progress = null;
  let overlayNames = new Set(DEFAULT_OVERLAYS);
  let overlayCanvas = null;
  let knownMarkers = [];
  const markerKeys = new Set();

  const mergeMarkers = (markers = []) => {
    for (const marker of markers) {
      const key = JSON.stringify(marker);
      if (markerKeys.has(key)) continue;
      markerKeys.add(key);
      knownMarkers.push(marker);
    }
    knownMarkers.sort((a, b) => a.turn - b.turn || a.type.localeCompare(b.type));
  };

  const ensureOverlay = () => {
    if (!overlayCanvas) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.dataset.replayMicroscopeOverlay = '';
      overlayCanvas.style.position = 'absolute';
      overlayCanvas.style.inset = '0';
      overlayCanvas.style.width = '100%';
      overlayCanvas.style.height = '100%';
      overlayCanvas.style.zIndex = '2';
      overlayCanvas.style.pointerEvents = 'none';
      ctx.container.appendChild(overlayCanvas);
    }
    if (overlayCanvas.width !== ctx.canvas.width
        || overlayCanvas.height !== ctx.canvas.height) {
      overlayCanvas.width = ctx.canvas.width;
      overlayCanvas.height = ctx.canvas.height;
    }
    return overlayCanvas;
  };

  const cellPoint = (x, y) => {
    const cam = ctx.engine?.getCam?.() || { x: 0, y: 0 };
    const offset = ctx.engine?.glGetOffset?.() || { offX: 0, offY: 0 };
    return {
      x: (x - Math.floor(cam.x)) * ctx.cellDev + offset.offX,
      y: (y - Math.floor(cam.y)) * ctx.cellDev + offset.offY,
    };
  };

  const drawArrow = (g, x0, y0, x1, y1, color) => {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    g.strokeStyle = color;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x1 - 7 * Math.cos(angle - 0.55), y1 - 7 * Math.sin(angle - 0.55));
    g.lineTo(x1 - 7 * Math.cos(angle + 0.55), y1 - 7 * Math.sin(angle + 0.55));
    g.closePath();
    g.fill();
  };

  const draw = () => {
    const canvas = ensureOverlay();
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!frame || overlayNames.size === 0) return;
    const scale = ctx.cellDev;
    g.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 1.5);
    g.font = `${Math.max(11, 11 * (window.devicePixelRatio || 1))}px monospace`;
    g.textBaseline = 'bottom';
    const isolateDetails = overlayNames.has('selection') && !!selectedBody;
    const detailedBody = (body) => !isolateDetails || sameBody(body, selectedBody);

    if (overlayNames.has('bodies')) {
      for (const body of frame.bodies) {
        const color = body.layer ? '#ff66d8' : '#50e6ff';
        const selected = sameBody(body, selectedBody);
        const detailed = detailedBody(body);
        const p = cellPoint(body.state.px, body.state.py);
        g.globalAlpha = isolateDetails && !selected ? 0.3 : 1;
        g.strokeStyle = selected ? '#fff36a' : color;
        g.lineWidth = selected ? 4 : 2;
        if (body.bounds) {
          const topLeft = cellPoint(body.bounds.x0, body.bounds.y0);
          g.strokeRect(
            topLeft.x, topLeft.y,
            (body.bounds.x1 - body.bounds.x0) * scale,
            (body.bounds.y1 - body.bounds.y0) * scale,
          );
        } else {
          g.beginPath();
          g.arc(p.x, p.y, Math.max(3, body.state.maxR * scale), 0, Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = selected ? '#fff36a' : color;
        g.beginPath();
        g.arc(p.x, p.y, selected ? 5 : 3, 0, Math.PI * 2);
        g.fill();
        if (overlayNames.has('labels') && detailed) {
          const flags = [
            body.awake ? 'awake' : 'sleep',
            body.terrainBlocked ? 'terrain' : '',
            body.jointRole ? `joint${body.jointRole}` : '',
          ].filter(Boolean).join(',');
          g.fillStyle = 'rgba(0,0,0,.78)';
          const label = `${body.layer}:${body.id} ${body.state.nPts}c ${flags}`;
          const width = g.measureText(label).width + 6;
          g.fillRect(p.x + 5, p.y - 18, width, 16);
          g.fillStyle = selected ? '#fff36a' : color;
          g.fillText(label, p.x + 8, p.y - 3);
        }
        if (overlayNames.has('velocity') && detailed && body.speed > 0.001) {
          const gain = Math.min(12, 2 + 10 / Math.max(1, body.speed));
          drawArrow(
            g, p.x, p.y,
            p.x + body.state.vx * scale * gain,
            p.y + body.state.vy * scale * gain,
            '#f8f8f8',
          );
        }
        if (overlayNames.has('status') && detailed && body.terrainBlocked) {
          g.fillStyle = 'rgba(255,90,50,.22)';
          g.beginPath();
          g.arc(p.x, p.y, Math.max(6, body.state.maxR * scale), 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    }

    if (overlayNames.has('contacts')) {
      for (const contact of frame.contacts) {
        if (isolateDetails
            && !sameBody({ layer: contact.aLayer, id: contact.aId }, selectedBody)
            && !sameBody({ layer: contact.bLayer, id: contact.bId }, selectedBody)) continue;
        if (!contact.point) continue;
        const p = cellPoint(contact.point.x, contact.point.y);
        const length = Math.max(8, Math.min(40, 8 + contact.depth * scale * 4));
        const color = contact.bLayer >= 0 && contact.aLayer !== contact.bLayer
          ? '#ff9cf0' : (contact.bLayer < 0 ? '#ffad4d' : '#8cff78');
        drawArrow(g, p.x, p.y, p.x + contact.nx * length, p.y + contact.ny * length, color);
        g.fillStyle = color;
        g.fillText(contact.depth.toFixed(3), p.x + 4, p.y - 3);
      }
    }

    if (overlayNames.has('cells')) {
      for (const cell of frame.cells || []) {
        if (!cell.inside) continue;
        const p = cellPoint(cell.localX, cell.localY);
        g.strokeStyle = '#fff36a';
        g.lineWidth = 3;
        g.strokeRect(p.x, p.y, scale, scale);
        const label = `${cell.worldX},${cell.worldY} `
          + cell.layers.map((layer) => `L${layer.layer}:m${layer.material}/b${layer.bodyId}`)
            .join(' ');
        g.fillStyle = 'rgba(0,0,0,.82)';
        const width = g.measureText(label).width + 8;
        g.fillRect(p.x + scale, p.y - 18, width, 18);
        g.fillStyle = '#fff36a';
        g.fillText(label, p.x + scale + 4, p.y - 2);
      }
    }

    g.lineWidth = 1;
    g.fillStyle = 'rgba(0,0,0,.82)';
    g.fillRect(8, 8, 250, 42);
    g.fillStyle = '#fff';
    g.fillText(`turn ${frame.turn}/${capsule?.turns ?? '?'}  tick ${frame.tick}`, 14, 28);
    g.fillStyle = '#bbb';
    g.fillText(`${frame.bodies.length} bodies  ${frame.contacts.length} contacts`, 14, 46);
  };

  const focusSelectedBody = () => {
    if (focus !== 'body' || !selectedBody || !frame || !ctx.engine) return;
    const body = frame.bodies.find((candidate) => sameBody(candidate, selectedBody));
    if (!body) return;
    ctx.engine.cameraSet(
      body.worldX - ctx.engine.getWorldOffsetX() - ctx.viewCols / 2,
      body.worldY - ctx.engine.getWorldOffsetY() - ctx.viewRows / 2,
    );
  };

  const present = () => {
    focusSelectedBody();
    render(false);
    draw();
  };

  const onProgress = (turn, turns) => { progress = { turn, turns }; };
  const seekOptions = (options = {}) => ({
    inspectCells: options.cells || [],
    scanBodyLimit: options.scanBodyLimit,
  });

  const acceptFrame = (next, options = {}) => {
    frame = next;
    if (options.body !== undefined) selectedBody = bodyRef(options.body);
    if (options.focus) focus = options.focus;
    mergeMarkers(frame.markers);
    progress = null;
    present();
    return frame;
  };

  const api = {
    async open(value, options = {}) {
      capsule = typeof value === 'string' ? await decodeReplayCapsule(value) : value;
      selectedBody = options.body !== undefined ? bodyRef(options.body) : null;
      focus = options.focus || 'recorded';
      knownMarkers = [];
      markerKeys.clear();
      progress = { turn: 0, turns: capsule.turns };
      const next = await ctx.worldWorker.openReplayMicroscope(
        capsule, onProgress, seekOptions(options),
      );
      return acceptFrame(next, options);
    },
    async seek(turn, options = {}) {
      if (!capsule) throw new Error('Open a replay before seeking its timeline.');
      progress = { turn: frame?.turn || 0, turns: capsule.turns };
      const next = await ctx.worldWorker.seekReplayMicroscope(
        Math.max(0, Math.min(capsule.turns, turn | 0)),
        onProgress,
        seekOptions(options),
      );
      return acceptFrame(next, options);
    },
    step(delta = 1, options = {}) {
      return api.seek((frame?.turn || 0) + (delta | 0), options);
    },
    async inspectCell(x, y) {
      const next = await api.seek(frame?.turn || 0, { cells: [{ x, y }] });
      return next.cells[0] || null;
    },
    inspectBody(value = selectedBody) {
      const ref = bodyRef(value);
      return frame?.bodies.find((body) => sameBody(body, ref)) || null;
    },
    selectBody(value, nextFocus = focus) {
      selectedBody = bodyRef(value);
      focus = nextFocus;
      present();
      return api.inspectBody();
    },
    findBodies(query = {}) {
      return (frame?.bodies || []).filter((body) => (
        (query.layer === undefined || body.layer === (query.layer | 0))
        && (query.awake === undefined || body.awake === !!query.awake)
        && (query.terrainBlocked === undefined
          || body.terrainBlocked === !!query.terrainBlocked)
        && (query.minCells === undefined || body.state.nPts >= query.minCells)
        && (query.maxSpeed === undefined || body.speed <= query.maxSpeed)
      ));
    },
    setOverlays(names = DEFAULT_OVERLAYS) {
      overlayNames = new Set(names);
      present();
      return [...overlayNames];
    },
    overlays: () => [...overlayNames],
    frame: () => frame,
    timeline: () => ({
      turns: capsule?.turns || 0,
      currentTurn: frame?.turn || 0,
      currentTick: frame?.tick || 0,
      events: capsule?.events || [],
      gates: capsule?.gates || [],
      markers: knownMarkers.slice(),
      progress,
    }),
    nearbyEvents(radius = 5) {
      const turn = frame?.turn || 0;
      return (capsule?.events || []).filter(
        (event) => Math.abs(event.tick - turn) <= Math.max(0, radius | 0),
      );
    },
    screenBounds(value = selectedBody, padding = 24) {
      const body = api.inspectBody(value);
      if (!body || !ctx.engine) return null;
      const bounds = body.bounds || {
        x0: body.state.px - body.state.maxR,
        y0: body.state.py - body.state.maxR,
        x1: body.state.px + body.state.maxR,
        y1: body.state.py + body.state.maxR,
      };
      const p0 = cellPoint(bounds.x0, bounds.y0);
      const p1 = cellPoint(bounds.x1, bounds.y1);
      const dpr = ctx.dpr || window.devicePixelRatio || 1;
      const rect = ctx.canvas.getBoundingClientRect();
      const x0 = rect.left + Math.min(p0.x, p1.x) / dpr - padding;
      const y0 = rect.top + Math.min(p0.y, p1.y) / dpr - padding;
      const x1 = rect.left + Math.max(p0.x, p1.x) / dpr + padding;
      const y1 = rect.top + Math.max(p0.y, p1.y) / dpr + padding;
      return {
        x: Math.max(rect.left, x0),
        y: Math.max(rect.top, y0),
        width: Math.max(1, Math.min(rect.right, x1) - Math.max(rect.left, x0)),
        height: Math.max(1, Math.min(rect.bottom, y1) - Math.max(rect.top, y0)),
      };
    },
    summary: () => frame ? {
      turn: frame.turn,
      tick: frame.tick,
      bodies: frame.bodies.length,
      contacts: frame.contacts.length,
      markers: knownMarkers.length,
      selectedBody: api.inspectBody(),
      cells: frame.cells,
    } : null,
    redraw: present,
    destroy() {
      overlayCanvas?.remove();
      overlayCanvas = null;
      capsule = null;
      frame = null;
    },
  };
  return api;
}
