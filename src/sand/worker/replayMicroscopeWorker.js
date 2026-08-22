import { attachTestHooks } from '../wasmBridge/testHooks.js';

const DEFAULT_SCAN_BODY_LIMIT = 256;
const MAX_MARKERS = 2000;
const STALL_TURNS = 24;

const bodyKey = (layer, id) => `${layer}:${id}`;

function bodyBounds(engine, hooks, layer) {
  const owners = hooks._bodyOwnerGrid(layer);
  const bounds = new Map();
  for (let cell = 0; cell < owners.length; cell++) {
    const id = owners[cell];
    if (id < 0) continue;
    const x = cell % engine.cols;
    const y = Math.floor(cell / engine.cols);
    const prior = bounds.get(id);
    if (prior) {
      prior.x0 = Math.min(prior.x0, x);
      prior.y0 = Math.min(prior.y0, y);
      prior.x1 = Math.max(prior.x1, x + 1);
      prior.y1 = Math.max(prior.y1, y + 1);
      prior.cells++;
    } else {
      bounds.set(id, { x0: x, y0: y, x1: x + 1, y1: y + 1, cells: 1 });
    }
  }
  return bounds;
}

function readBodies(engine, hooks, { detailed = false, limit = Infinity } = {}) {
  const offsetX = engine.getWorldOffsetX();
  const offsetY = engine.getWorldOffsetY();
  const bounds = detailed
    ? [bodyBounds(engine, hooks, 0), bodyBounds(engine, hooks, 1)]
    : [null, null];
  const bodies = [];
  let truncated = false;
  for (let layer = 0; layer < 2; layer++) {
    const count = hooks._bodyCountLayer(layer);
    for (let index = 0; index < count; index++) {
      if (bodies.length >= limit) {
        truncated = true;
        break;
      }
      const state = hooks._bodyStateLayer(layer, index);
      if (!state) continue;
      const id = hooks._bodyIdLayer(layer, index);
      const localBounds = bounds[layer]?.get(id) || null;
      const body = {
        layer, index, id,
        jointRole: hooks._bodyJointRoleLayer(layer, index),
        material: layer === 0 ? hooks._bodyMaterial(index) : -1,
        awake: hooks._bodyAwakeLayer(layer, index) === 1,
        blocked: hooks._bodyBlockedLayer(layer, index) === 1,
        terrainBlocked: hooks._bodyTerrainBlockedLayer(layer, index) === 1,
        blastDebris: hooks._bodyBlastDebrisLayer(layer, index) === 1,
        worldX: offsetX + state.px,
        worldY: offsetY + state.py,
        speed: Math.hypot(state.vx, state.vy),
        state,
      };
      if (localBounds) {
        body.bounds = {
          ...localBounds,
          worldX0: offsetX + localBounds.x0,
          worldY0: offsetY + localBounds.y0,
          worldX1: offsetX + localBounds.x1,
          worldY1: offsetY + localBounds.y1,
        };
      }
      if (detailed) {
        body.terrainBlocker = hooks._bodyTerrainBlocker(layer, index);
        body.peerBlockers = [0, 1].map((probeLayer) => ({
          layer: probeLayer,
          ...hooks._bodyPrimaryBlocker(layer, index, probeLayer),
        }));
      }
      bodies.push(body);
    }
    if (truncated) break;
  }
  return { bodies, truncated };
}

function contactPoint(contact, bodyMap, offsetX, offsetY) {
  const body = bodyMap.get(bodyKey(contact.aLayer, contact.aId));
  if (!body) return null;
  const c = Math.cos(body.state.angle);
  const s = Math.sin(body.state.angle);
  const x = body.state.px + contact.lax * c - contact.lay * s;
  const y = body.state.py + contact.lax * s + contact.lay * c;
  return { x, y, worldX: offsetX + x, worldY: offsetY + y };
}

function readContacts(engine, hooks, bodies) {
  const offsetX = engine.getWorldOffsetX();
  const offsetY = engine.getWorldOffsetY();
  const bodyMap = new Map(bodies.map((body) => [bodyKey(body.layer, body.id), body]));
  return hooks._worldContacts().map((contact, index) => ({
    index,
    ...contact,
    point: contactPoint(contact, bodyMap, offsetX, offsetY),
  }));
}

function readCells(engine, hooks, cells = []) {
  const offsetX = engine.getWorldOffsetX();
  const offsetY = engine.getWorldOffsetY();
  const grids = [engine.getGrid(), engine.getGridBg()];
  const grounded = [hooks._groundedGrid(0), hooks._groundedGrid(1)];
  const owners = [hooks._bodyOwnerGrid(0), hooks._bodyOwnerGrid(1)];
  const fallSpeed = [hooks._fallSpeedGrid(0), hooks._fallSpeedGrid(1)];
  return cells.map(({ x, y }) => {
    const worldX = Math.floor(x);
    const worldY = Math.floor(y);
    const localX = worldX - offsetX;
    const localY = worldY - offsetY;
    const inside = localX >= 0 && localY >= 0
      && localX < engine.cols && localY < engine.rows;
    const cell = inside ? localY * engine.cols + localX : -1;
    return {
      worldX, worldY, localX, localY, inside,
      layers: [0, 1].map((layer) => ({
        layer,
        material: inside ? grids[layer][cell] : -1,
        grounded: inside ? grounded[layer][cell] === 1 : false,
        bodyId: inside ? owners[layer][cell] : -1,
        fallSpeed: inside ? fallSpeed[layer][cell] : 0,
      })),
    };
  });
}

export function createReplayMicroscopeProbe(rawEngine, options = {}) {
  const engine = attachTestHooks(rawEngine);
  const scanBodyLimit = Math.max(1,
    Math.min(2000, options.scanBodyLimit | 0 || DEFAULT_SCAN_BODY_LIMIT));
  let markers = [];
  let priorBodies = new Map();
  const stallTicks = new Map();

  const addMarker = (marker) => {
    if (markers.length >= MAX_MARKERS) return;
    markers.push(marker);
  };

  const observe = (turn) => {
    const { bodies, truncated } = readBodies(engine, engine, {
      detailed: false, limit: scanBodyLimit,
    });
    const contacts = readContacts(engine, engine, bodies);
    const contactCounts = new Map();
    for (const contact of contacts) {
      const a = bodyKey(contact.aLayer, contact.aId);
      contactCounts.set(a, (contactCounts.get(a) || 0) + 1);
      if (contact.bLayer >= 0) {
        const b = bodyKey(contact.bLayer, contact.bId);
        contactCounts.set(b, (contactCounts.get(b) || 0) + 1);
      }
      if (contact.depth > 1 && (turn === 0 || turn % 10 === 0)) {
        addMarker({
          type: 'deep-contact', turn,
          depth: contact.depth,
          a: { layer: contact.aLayer, id: contact.aId },
          b: { layer: contact.bLayer, id: contact.bId },
        });
      }
    }

    const nextBodies = new Map();
    for (const body of bodies) {
      const key = bodyKey(body.layer, body.id);
      const prior = priorBodies.get(key);
      const dx = prior ? body.worldX - prior.worldX : 0;
      const dy = prior ? body.worldY - prior.worldY : 0;
      const displacement = Math.hypot(dx, dy);
      const contactCount = contactCounts.get(key) || 0;
      const stalled = body.state.nPts >= 8 && body.awake && !body.terrainBlocked
        && contactCount > 0 && body.speed < 0.075 && displacement < 0.025;
      const stalledFor = stalled ? (stallTicks.get(key) || 0) + 1 : 0;
      stallTicks.set(key, stalledFor);
      if (stalledFor === STALL_TURNS) {
        addMarker({
          type: 'stalled-airborne', turn: turn - STALL_TURNS + 1,
          detectedAt: turn,
          body: { layer: body.layer, id: body.id, cells: body.state.nPts },
          speed: body.speed, displacement, contactCount,
        });
      }
      if (prior && prior.awake !== body.awake) {
        addMarker({
          type: body.awake ? 'body-woke' : 'body-slept', turn,
          body: { layer: body.layer, id: body.id, cells: body.state.nPts },
        });
      }
      if (prior && prior.terrainBlocked !== body.terrainBlocked) {
        addMarker({
          type: body.terrainBlocked ? 'terrain-contact-began' : 'terrain-contact-ended',
          turn, body: { layer: body.layer, id: body.id, cells: body.state.nPts },
        });
      }
      nextBodies.set(key, {
        worldX: body.worldX, worldY: body.worldY,
        awake: body.awake, terrainBlocked: body.terrainBlocked,
      });
    }
    priorBodies = nextBodies;
    return { bodies: bodies.length, contacts: contacts.length, truncated };
  };

  const snapshot = (turn, { inspectCells = [] } = {}) => {
    const { bodies, truncated } = readBodies(engine, engine, { detailed: true });
    const contacts = readContacts(engine, engine, bodies);
    const cam = engine.getCam();
    const offsetX = engine.getWorldOffsetX();
    const offsetY = engine.getWorldOffsetY();
    return {
      turn,
      tick: engine.getTick(),
      actorTick: engine.getActorTick(),
      gridHash: engine.gridHash(),
      cols: engine.cols,
      rows: engine.rows,
      worldOffset: { x: offsetX, y: offsetY },
      camera: {
        x: cam.x, y: cam.y,
        worldX: offsetX + cam.x,
        worldY: offsetY + cam.y,
      },
      bodies,
      bodiesTruncated: truncated,
      contacts,
      cells: readCells(engine, engine, inspectCells),
      solver: engine.getRigidSolverDebug(),
      markers: markers.slice(),
    };
  };

  return {
    observe,
    snapshot,
    markers: () => markers.slice(),
    reset() {
      markers = [];
      priorBodies = new Map();
      stallTicks.clear();
    },
  };
}
