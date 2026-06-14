// Pure, deterministic 2D rigid-body solver for the sand engine. No DOM, no
// Math.random — only ordered IEEE-754 float ops, so a fixed seed reproduces
// across runs and the headless benchmark checksum stays stable.
//
// Bodies live in continuous space (float center-of-mass position + angle) and
// are rasterized into the cellular-automaton grid by the engine each tick, so
// sand/water interact with them. Collision uses a point cloud sampled from each
// body's cells; a contact impulse applied at an offset from the center of mass
// updates both linear and angular velocity, so real torque — tumbling and
// rolling — emerges without any special-casing.

// Tunables (cells / ticks).
const GRAVITY = 0.18;
const MAX_SPEED = 0.9;        // clamp translation/tick below 1 cell (anti-tunnel)
const RESTITUTION = 0;        // inelastic so bodies settle, don't bounce
const FRICTION = 0.6;
const SOLVER_ITERS = 6;
const BAUMGARTE = 0.2;        // positional correction fraction
const PENETRATION_SLOP = 0.1;
// Velocity damping applied while a body is in contact, so the constant
// positional correction can't sustain a perpetual rest jitter — a resting body
// bleeds energy and reaches the sleep thresholds instead of buzzing forever.
const CONTACT_LIN_DAMP = 0.9;
const CONTACT_ANG_DAMP = 0.82;
const SLEEP_LIN = 0.03;       // |v| below which a body may sleep
const SLEEP_ANG = 0.02;       // |omega| below which a body may sleep
const SLEEP_TICKS = 20;

// Create an isolated rigid-body world. `cols`/`rows` bound the grid; the solver
// queries terrain through the `isSolidAt(x, y)` callback supplied to `step`.
export function createRigidWorld({ cols, rows }) {
  /** @type {Array<object>} */
  const bodies = [];
  let nextId = 1;

  // Build a body from a list of integer cell coordinates [[x,y], ...]. The point
  // cloud is stored body-local relative to the center of mass; mass and inertia
  // come from the (uniform-density-weighted) point set.
  const spawnBody = (cells, { material, density = 1, vx = 0, vy = 0, omega = 0 } = {}) => {
    const nPts = cells.length;
    if (nPts === 0) return null;
    let cx = 0, cy = 0;
    for (let i = 0; i < nPts; i++) { cx += cells[i][0] + 0.5; cy += cells[i][1] + 0.5; }
    cx /= nPts; cy /= nPts;

    const points = new Float32Array(nPts * 2);
    let inertia = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < nPts; i++) {
      const gx = cells[i][0], gy = cells[i][1];
      const lx = gx + 0.5 - cx;
      const ly = gy + 0.5 - cy;
      points[i * 2] = lx;
      points[i * 2 + 1] = ly;
      inertia += density * (lx * lx + ly * ly);
      if (gx < minX) minX = gx; if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy; if (gy > maxY) maxY = gy;
    }
    // Body-local integer occupancy mask, used for inverse rasterization (every
    // covered world cell maps back to exactly one local cell -> no holes/doubles
    // under rotation). offsetX/Y is the body-local position of local cell 0's center.
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const occ = new Uint8Array(w * h);
    for (let i = 0; i < nPts; i++) {
      occ[(cells[i][1] - minY) * w + (cells[i][0] - minX)] = 1;
    }
    const offsetX = minX + 0.5 - cx;
    const offsetY = minY + 0.5 - cy;
    const mass = density * nPts;
    const body = {
      id: nextId++,
      points,
      nPts,
      occ, w, h, offsetX, offsetY,
      px: cx, py: cy, angle: 0,
      vx, vy, omega,
      invMass: mass > 0 ? 1 / mass : 0,
      invInertia: inertia > 0 ? 1 / inertia : 0,
      material,
      density,
      awake: true,
      stillTicks: 0,
    };
    bodies.push(body);
    return body;
  };

  // World position of body point i (sin/cos hoisted by caller).
  const worldPoint = (b, i, sin, cos, out) => {
    const lx = b.points[i * 2];
    const ly = b.points[i * 2 + 1];
    out[0] = b.px + lx * cos - ly * sin;
    out[1] = b.py + lx * sin + ly * cos;
  };

  // Surface normal pointing out of the terrain at cell (cx,cy), estimated from
  // the solid gradient of the 4-neighborhood. Falls back to "up" for an
  // ambiguous (fully buried or open) cell, matching a body resting on a floor.
  const terrainNormal = (cx, cy, isSolidAt, out) => {
    const l = cx > 0 && isSolidAt(cx - 1, cy) ? 1 : 0;
    const r = cx < cols - 1 && isSolidAt(cx + 1, cy) ? 1 : 0;
    const u = cy > 0 && isSolidAt(cx, cy - 1) ? 1 : 0;
    const d = cy < rows - 1 && isSolidAt(cx, cy + 1) ? 1 : 0;
    let nx = l - r;
    let ny = u - d;
    if (nx === 0 && ny === 0) { out[0] = 0; out[1] = -1; return; }
    const inv = 1 / Math.sqrt(nx * nx + ny * ny);
    out[0] = nx * inv;
    out[1] = ny * inv;
  };

  // Advance the world one tick. `isSolidAt(x,y)` returns true for terrain the
  // bodies collide against (stone, settled sand, etc.); body cells must NOT be
  // reported solid here (the engine clears them before calling).
  const step = (isSolidAt, dt = 1) => {
    const wp = [0, 0];
    const nrm = [0, 0];
    for (let bi = 0; bi < bodies.length; bi++) {
      const b = bodies[bi];
      if (!b.awake) continue;

      // 1) Integrate velocity + pose (semi-implicit Euler), clamped to < 1 cell.
      b.vy += GRAVITY * dt;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 > MAX_SPEED * MAX_SPEED) {
        const s = MAX_SPEED / Math.sqrt(sp2);
        b.vx *= s; b.vy *= s;
      }
      b.px += b.vx * dt;
      b.py += b.vy * dt;
      b.angle += b.omega * dt;

      // 2) Build contacts: body points embedded in terrain.
      let sin = Math.sin(b.angle);
      let cos = Math.cos(b.angle);
      const contacts = [];
      for (let i = 0; i < b.nPts; i++) {
        worldPoint(b, i, sin, cos, wp);
        const cx = Math.floor(wp[0]);
        const cy = Math.floor(wp[1]);
        if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
        if (!isSolidAt(cx, cy)) continue;
        terrainNormal(cx, cy, isSolidAt, nrm);
        contacts.push({
          rx: wp[0] - b.px,
          ry: wp[1] - b.py,
          nx: nrm[0],
          ny: nrm[1],
        });
      }

      if (contacts.length === 0) {
        // Airborne: track for sleep (a falling body is never asleep).
        b.stillTicks = 0;
        continue;
      }

      // 3) Sequential-impulse velocity resolution. Impulse at offset r updates
      // omega via cross(r, J) — the source of tumbling.
      for (let it = 0; it < SOLVER_ITERS; it++) {
        for (let ci = 0; ci < contacts.length; ci++) {
          const c = contacts[ci];
          // Relative velocity at the contact point: v + omega x r.
          const rvx = b.vx - b.omega * c.ry;
          const rvy = b.vy + b.omega * c.rx;
          const vn = rvx * c.nx + rvy * c.ny;
          if (vn < 0) {
            const rn = c.rx * c.ny - c.ry * c.nx;
            const denom = b.invMass + b.invInertia * rn * rn;
            if (denom > 0) {
              const jn = -(1 + RESTITUTION) * vn / denom;
              const jx = jn * c.nx;
              const jy = jn * c.ny;
              b.vx += jx * b.invMass;
              b.vy += jy * b.invMass;
              b.omega += b.invInertia * (c.rx * jy - c.ry * jx);
              c.jn = jn;
            }
          }
          // Coulomb friction along the tangent, clamped to mu*jn.
          const tx = -c.ny;
          const ty = c.nx;
          const rvx2 = b.vx - b.omega * c.ry;
          const rvy2 = b.vy + b.omega * c.rx;
          const vt = rvx2 * tx + rvy2 * ty;
          const rt = c.rx * ty - c.ry * tx;
          const denomT = b.invMass + b.invInertia * rt * rt;
          if (denomT > 0) {
            let jt = -vt / denomT;
            const maxF = FRICTION * (c.jn || 0);
            if (jt > maxF) jt = maxF;
            else if (jt < -maxF) jt = -maxF;
            const jx = jt * tx;
            const jy = jt * ty;
            b.vx += jx * b.invMass;
            b.vy += jy * b.invMass;
            b.omega += b.invInertia * (c.rx * jy - c.ry * jx);
          }
        }
      }

      // 4) Positional correction: push the body out of the deepest penetration
      // along the averaged contact normal (linear only; rotation recovers via
      // velocity impulses over subsequent ticks).
      let anx = 0, any = 0;
      for (let ci = 0; ci < contacts.length; ci++) { anx += contacts[ci].nx; any += contacts[ci].ny; }
      const al = Math.sqrt(anx * anx + any * any);
      if (al > 0) {
        anx /= al; any /= al;
        const corr = BAUMGARTE * Math.max(0, 1 - PENETRATION_SLOP);
        b.px += anx * corr;
        b.py += any * corr;
      }

      // Bleed energy while resting so the body converges to sleep.
      b.vx *= CONTACT_LIN_DAMP;
      b.vy *= CONTACT_LIN_DAMP;
      b.omega *= CONTACT_ANG_DAMP;

      // 5) Sleep bodies that have come to rest.
      if (b.vx * b.vx + b.vy * b.vy < SLEEP_LIN * SLEEP_LIN &&
          b.omega * b.omega < SLEEP_ANG * SLEEP_ANG) {
        if (++b.stillTicks >= SLEEP_TICKS) {
          b.awake = false;
          b.vx = 0; b.vy = 0; b.omega = 0;
        }
      } else {
        b.stillTicks = 0;
      }
    }
  };

  // Visit each integer grid cell covered by a body, via inverse rasterization:
  // walk the body's world-space AABB and, for each candidate cell, transform its
  // center back into body-local space and test the occupancy mask. Every covered
  // cell maps to exactly one local cell, so a rotated body rasterizes solid (no
  // holes, no doubled cells). Used by the engine to stamp footprints into the grid.
  const forEachBodyCell = (b, cb) => {
    const sin = Math.sin(b.angle);
    const cos = Math.cos(b.angle);
    // World AABB from the four local-rect corners.
    const lx0 = b.offsetX - 0.5, lx1 = b.offsetX + b.w - 0.5;
    const ly0 = b.offsetY - 0.5, ly1 = b.offsetY + b.h - 0.5;
    let minWX = Infinity, minWY = Infinity, maxWX = -Infinity, maxWY = -Infinity;
    const corner = (lx, ly) => {
      const wx = b.px + lx * cos - ly * sin;
      const wy = b.py + lx * sin + ly * cos;
      if (wx < minWX) minWX = wx; if (wx > maxWX) maxWX = wx;
      if (wy < minWY) minWY = wy; if (wy > maxWY) maxWY = wy;
    };
    corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
    let x0 = Math.floor(minWX), x1 = Math.floor(maxWX);
    let y0 = Math.floor(minWY), y1 = Math.floor(maxWY);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 >= cols) x1 = cols - 1; if (y1 >= rows) y1 = rows - 1;
    for (let wy = y0; wy <= y1; wy++) {
      for (let wx = x0; wx <= x1; wx++) {
        const dx = wx + 0.5 - b.px;
        const dy = wy + 0.5 - b.py;
        // Inverse-rotate (rotate by -angle) into body-local space.
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        const i = Math.round(lx - b.offsetX);
        const j = Math.round(ly - b.offsetY);
        if (i < 0 || i >= b.w || j < 0 || j >= b.h) continue;
        if (b.occ[j * b.w + i]) cb(wx, wy, b);
      }
    }
  };

  // Wake a sleeping body (e.g. when material lands on it). Idempotent.
  const wake = (b) => { b.awake = true; b.stillTicks = 0; };

  return { bodies, spawnBody, step, forEachBodyCell, wake };
}
