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
const GRAVITY = 0.26;
// Terminal speed. A fall accelerates up to this, so a long drop visibly speeds up
// rather than pinning at a low constant velocity. A single integration step must
// still not move a body much past one cell or it tunnels through thin terrain and
// buries into other bodies (the terrain probe only looks one cell ahead). So the
// tick is split into substeps each advancing at most ~SAFE_SUBSTEP_DISP cell; the
// substep count is adaptive, so slow / resting / stacked bodies run a single step
// and behave exactly as before — only fast movers pay for the finer integration.
const MAX_SPEED = 3.0;
const SAFE_SUBSTEP_DISP = 0.6; // max cells a body should travel in one substep
const MAX_SUBSTEPS = 6;        // ceiling on substeps per tick
const RESTITUTION = 0;        // inelastic so bodies settle, don't bounce
const FRICTION = 0.6;
// Sequential-impulse iterations. Contact support propagates ~one body per iteration,
// so the count needed grows with stack height; 64 holds a ~5-high column. The solver
// is cheap next to the cellular automaton, so a generous count is affordable.
// (Taller single columns may still compress — they'd need cross-frame warm starting.)
const SOLVER_ITERS = 64;
const BAUMGARTE = 0.2;        // positional correction fraction
const MAX_BIAS_VEL = 0.3;     // cap on per-tick penetration-expulsion speed
// A boundary point resting on a surface sits ~0.5 cell into the contact cell (its
// own cell-center), so 0.5 is the natural penetration of a body at rest. The slop
// must match it: a smaller value makes the bias expel a correctly-resting body,
// which then hovers and bounces and never sleeps. Only deeper overlap is corrected.
const PENETRATION_SLOP = 0.5;
// Velocity damping applied while a body is in contact, so the constant
// positional correction can't sustain a perpetual rest jitter — a resting body
// bleeds energy and reaches the sleep thresholds instead of buzzing forever.
const CONTACT_LIN_DAMP = 0.9;
const CONTACT_ANG_DAMP = 0.6;
const LIQUID_DRAG = 0.12;
const LIQUID_ANG_DRAG = 0.1;
const SLEEP_LIN = 0.03;       // |v| below which a body may sleep
const SLEEP_ANG = 0.02;       // |omega| below which a body may sleep
const SLEEP_TICKS = 20;
// A sleeping body is only woken by a body moving faster than this (a real impact).
// Gentle resting contact leaves it asleep (treated as static), so a body settling
// on top of it can also sleep instead of the two endlessly re-waking each other.
const WAKE_LIN2 = 0.12 * 0.12;
const WAKE_ANG2 = 0.06 * 0.06;
// A body may only sleep once its penetration is nearly resolved (~half a cell, the
// natural resting depth). Otherwise it could freeze mid-overlap, since the split-
// impulse expulsion lives in the pseudo-velocity and doesn't count toward sleep.
const REST_DEPTH = 1.0;

// Create an isolated rigid-body world. `cols`/`rows` bound the grid; the solver
// queries terrain through the `isSolidAt(x, y)` callback supplied to `step`.
export function createRigidWorld({ cols, rows }) {
  /** @type {Array<object>} */
  const bodies = [];
  let nextId = 1;

  const computeDerived = (b, preserveWorld = false) => {
    let nPts = 0;
    let sumX = 0, sumY = 0;
    for (let j = 0; j < b.h; j++) {
      for (let i = 0; i < b.w; i++) {
        if (!b.occ[j * b.w + i]) continue;
        nPts++;
        sumX += b.offsetX + i;
        sumY += b.offsetY + j;
      }
    }
    if (nPts === 0) return false;

    const dx = sumX / nPts;
    const dy = sumY / nPts;
    if (preserveWorld && (dx !== 0 || dy !== 0)) {
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      b.px += dx * cos - dy * sin;
      b.py += dx * sin + dy * cos;
    }
    b.offsetX -= dx;
    b.offsetY -= dy;

    const points = new Float32Array(nPts * 2);
    const boundary = [];
    let pi = 0;
    let inertia = 0;
    let maxR2 = 0;
    const filled = (ii, jj) => ii >= 0 && ii < b.w && jj >= 0 && jj < b.h && b.occ[jj * b.w + ii];
    for (let j = 0; j < b.h; j++) {
      for (let i = 0; i < b.w; i++) {
        if (!b.occ[j * b.w + i]) continue;
        const lx = b.offsetX + i;
        const ly = b.offsetY + j;
        points[pi * 2] = lx;
        points[pi * 2 + 1] = ly;
        const r2 = lx * lx + ly * ly;
        inertia += b.density * r2;
        if (r2 > maxR2) maxR2 = r2;
        if (!filled(i - 1, j) || !filled(i + 1, j) || !filled(i, j - 1) || !filled(i, j + 1)) {
          boundary.push(pi);
        }
        pi++;
      }
    }

    const mass = b.density * nPts;
    b.points = points;
    b.nPts = nPts;
    b.boundaryPts = Int32Array.from(boundary);
    b.invMass = mass > 0 ? 1 / mass : 0;
    b.invInertia = inertia > 0 ? 1 / inertia : 0;
    b.maxR = Math.sqrt(maxR2);
    b.awake = true;
    b.stillTicks = 0;
    return true;
  };

  // Build a body from a list of integer cell coordinates [[x,y], ...]. The point
  // cloud is stored body-local relative to the center of mass; mass and inertia
  // come from the (uniform-density-weighted) point set.
  const spawnBody = (cells, { material, density = 1, vx = 0, vy = 0, omega = 0 } = {}) => {
    const nPts = cells.length;
    if (nPts === 0) return null;
    let cx = 0, cy = 0;
    for (let i = 0; i < nPts; i++) { cx += cells[i][0] + 0.5; cy += cells[i][1] + 0.5; }
    cx /= nPts; cy /= nPts;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < nPts; i++) {
      const gx = cells[i][0], gy = cells[i][1];
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
    const body = {
      id: nextId++,
      occ, w, h, offsetX, offsetY,
      px: cx, py: cy, angle: 0,
      vx, vy, omega,
      material,
      density,
      awake: true,
      stillTicks: 0,
    };
    computeDerived(body);
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

  // Local occupancy index of world point (wx,wy) inside body b, or -1 if outside.
  // Inverse-transforms the point into b's local frame (b.sin/b.cos precomputed).
  const insideBodyIndex = (b, wx, wy) => {
    if (b.cos === undefined || b.sin === undefined) {
      b.cos = Math.cos(b.angle);
      b.sin = Math.sin(b.angle);
    }
    const dx = wx - b.px;
    const dy = wy - b.py;
    const lx = dx * b.cos + dy * b.sin;
    const ly = -dx * b.sin + dy * b.cos;
    const i = Math.round(lx - b.offsetX);
    const j = Math.round(ly - b.offsetY);
    if (i < 0 || i >= b.w || j < 0 || j >= b.h) return -1;
    const k = j * b.w + i;
    return b.occ[k] ? k : -1;
  };

  // World-space outward surface normal of body b at local occupancy index `idx`,
  // from the occupancy gradient (points from b's interior toward its exterior).
  // Falls back to the radial direction (point - COM) for a fully-buried cell.
  const bodyNormalAt = (b, idx, wx, wy, out) => {
    const i = idx % b.w;
    const j = (idx / b.w) | 0;
    const occ = b.occ, w = b.w, h = b.h;
    const at = (ii, jj) => (ii < 0 || ii >= w || jj < 0 || jj >= h) ? 0 : occ[jj * w + ii];
    const nlx = at(i - 1, j) - at(i + 1, j);
    const nly = at(i, j - 1) - at(i, j + 1);
    if (nlx === 0 && nly === 0) {
      let rx = wx - b.px, ry = wy - b.py;
      const rl = Math.sqrt(rx * rx + ry * ry);
      if (rl > 0) { out[0] = rx / rl; out[1] = ry / rl; } else { out[0] = 0; out[1] = -1; }
      return;
    }
    // Rotate the local normal into world space by b's orientation.
    const wx2 = nlx * b.cos - nly * b.sin;
    const wy2 = nlx * b.sin + nly * b.cos;
    const inv = 1 / Math.sqrt(wx2 * wx2 + wy2 * wy2);
    out[0] = wx2 * inv;
    out[1] = wy2 * inv;
  };

  // Apply a normal+friction impulse for a contact whose normal points toward
  // body A (out of the terrain/body B). `b` may be null for a terrain contact.
  const resolveContact = (c) => {
    const A = c.a, B = c.b;
    // A sleeping body acts as immovable static (invMass 0), so an awake body can
    // rest on it and settle to sleep without perpetually re-waking it.
    const aInvM = A.awake ? A.invMass : 0, aInvI = A.awake ? A.invInertia : 0;
    const bInvM = (B && B.awake) ? B.invMass : 0, bInvI = (B && B.awake) ? B.invInertia : 0;
    // Relative velocity at contact = velA(point) - velB(point).
    let rvx = (A.vx - A.omega * c.ray);
    let rvy = (A.vy + A.omega * c.rax);
    if (B) { rvx -= (B.vx - B.omega * c.rby); rvy -= (B.vy + B.omega * c.rbx); }
    const vn = rvx * c.nx + rvy * c.ny;
    {
      const rnA = c.rax * c.ny - c.ray * c.nx;
      const rnB = B ? c.rbx * c.ny - c.rby * c.nx : 0;
      const denom = aInvM + bInvM + aInvI * rnA * rnA + bInvI * rnB * rnB;
      if (denom > 0) {
        // Accumulated impulse: clamp the TOTAL normal impulse >= 0 and apply only
        // the delta. Across iterations the total builds up to whatever supports the
        // load, which is what lets a multi-body stack hold instead of slowly sinking
        // (recomputing a fresh per-iteration impulse cannot accumulate that support).
        const delta = -(1 + RESTITUTION) * vn / denom;
        const newJn = Math.max(0, c.accJn + delta);
        const applied = newJn - c.accJn;
        c.accJn = newJn;
        const jx = applied * c.nx, jy = applied * c.ny;
        A.vx += jx * aInvM; A.vy += jy * aInvM;
        A.omega += aInvI * (c.rax * jy - c.ray * jx);
        if (B) { B.vx -= jx * bInvM; B.vy -= jy * bInvM; B.omega -= bInvI * (c.rbx * jy - c.rby * jx); }
      }
    }
    // Coulomb friction along the tangent, accumulated and clamped to mu*accJn.
    const tx = -c.ny, ty = c.nx;
    let rtvx = (A.vx - A.omega * c.ray);
    let rtvy = (A.vy + A.omega * c.rax);
    if (B) { rtvx -= (B.vx - B.omega * c.rby); rtvy -= (B.vy + B.omega * c.rbx); }
    const vt = rtvx * tx + rtvy * ty;
    const rtA = c.rax * ty - c.ray * tx;
    const rtB = B ? c.rbx * ty - c.rby * tx : 0;
    const denomT = aInvM + bInvM + aInvI * rtA * rtA + bInvI * rtB * rtB;
    if (denomT > 0) {
      const maxF = FRICTION * c.accJn;
      const delta = -vt / denomT;
      let newJt = c.accJt + delta;
      if (newJt > maxF) newJt = maxF; else if (newJt < -maxF) newJt = -maxF;
      const applied = newJt - c.accJt;
      c.accJt = newJt;
      const jx = applied * tx, jy = applied * ty;
      A.vx += jx * aInvM; A.vy += jy * aInvM;
      A.omega += aInvI * (c.rax * jy - c.ray * jx);
      if (B) { B.vx -= jx * bInvM; B.vy -= jy * bInvM; B.omega -= bInvI * (c.rbx * jy - c.rby * jx); }
    }
  };

  // Split-impulse position correction: resolve penetration in a SEPARATE pseudo-
  // velocity (pvx/pvy/pw) that is integrated into position but never fed back into
  // the real velocity. This expels overlap without the Baumgarte energy injection
  // that would otherwise keep resting bodies jittering and prevent them sleeping.
  const resolveBias = (c) => {
    const A = c.a, B = c.b;
    let bias = BAUMGARTE * Math.max(0, c.depth - PENETRATION_SLOP);
    if (bias <= 0) return;
    if (bias > MAX_BIAS_VEL) bias = MAX_BIAS_VEL; // expel steadily, never with a kick

    const aInvM = A.awake ? A.invMass : 0, aInvI = A.awake ? A.invInertia : 0;
    const bInvM = (B && B.awake) ? B.invMass : 0, bInvI = (B && B.awake) ? B.invInertia : 0;
    let rvx = A.pvx - A.pw * c.ray, rvy = A.pvy + A.pw * c.rax;
    if (B) { rvx -= B.pvx - B.pw * c.rby; rvy -= B.pvy + B.pw * c.rbx; }
    const vn = rvx * c.nx + rvy * c.ny;
    if (vn >= bias) return;
    const rnA = c.rax * c.ny - c.ray * c.nx;
    const rnB = B ? c.rbx * c.ny - c.rby * c.nx : 0;
    const denom = aInvM + bInvM + aInvI * rnA * rnA + bInvI * rnB * rnB;
    if (denom <= 0) return;
    // Accumulated (clamped >= 0) so the expulsion impulse builds through a stack.
    const delta = (bias - vn) / denom;
    const newJ = Math.max(0, c.accBias + delta);
    const applied = newJ - c.accBias;
    c.accBias = newJ;
    const jx = applied * c.nx, jy = applied * c.ny;
    A.pvx += jx * aInvM; A.pvy += jy * aInvM; A.pw += aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B.pvx -= jx * bInvM; B.pvy -= jy * bInvM; B.pw -= bInvI * (c.rbx * jy - c.rby * jx); }
  };

  // Advance the world one tick. `isSolidAt(x,y)` returns true for terrain the
  // bodies collide against (stone, settled sand, etc.); body cells must NOT be
  // reported solid here (the engine clears them before calling).
  const step = (isSolidAt, fluidDensityAt = null, tickDt = 1) => {
    const wp = [0, 0];
    const nrm = [0, 0];
    const n = bodies.length;
    const islandParent = new Int32Array(n);
    const islandMinStill = new Float64Array(n);

    // Adaptive sub-stepping: a body may now reach several cells/tick, but each
    // integration substep must stay under ~1 cell so the one-cell-ahead terrain
    // probe still catches collisions (no tunneling). Size the substep count to the
    // fastest awake body (plus the gravity it will gain); slow / resting bodies use
    // a single step, leaving their contact + sleep behaviour byte-identical.
    let maxSpeed2 = 0;
    for (let bi = 0; bi < n; bi++) {
      const b = bodies[bi];
      if (!b.awake) continue;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 > maxSpeed2) maxSpeed2 = sp2;
    }
    const maxSpeed = Math.sqrt(maxSpeed2) + GRAVITY * tickDt;
    const substeps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(maxSpeed / SAFE_SUBSTEP_DISP)));

    // Produced by the final substep, consumed by the island-sleep pass after the
    // loop, so they are declared out here.
    let contacts = [];
    let nc = 0;

    for (let sub = 0; sub < substeps; sub++) {
      const dt = tickDt / substeps;

    // 1) Apply gravity to velocity (NOT position yet) and cache orientation + world
    // AABB at the current pose. Position integrates after the contact solve, so the
    // solver can cancel inward velocity and bias out penetration before the body
    // actually moves — this is what stops loaded bodies from sinking through.
    for (let bi = 0; bi < n; bi++) {
      const b = bodies[bi];
      if (b.awake) {
        b.vy += GRAVITY * dt;
      }
      b.cos = Math.cos(b.angle);
      b.sin = Math.sin(b.angle);
      if (b.awake && fluidDensityAt && b.boundaryPts.length > 0) {
        let wet = 0;
        let densitySum = 0;
        for (let bp = 0; bp < b.boundaryPts.length; bp++) {
          worldPoint(b, b.boundaryPts[bp], b.sin, b.cos, wp);
          const d = fluidDensityAt(Math.floor(wp[0]), Math.floor(wp[1]));
          if (d <= 0) continue;
          wet++;
          densitySum += d;
        }
        if (wet > 0) {
          const submerged = wet / b.boundaryPts.length;
          const avgFluidD = densitySum / wet;
          b.vy -= GRAVITY * (avgFluidD / b.density) * submerged * dt;
          const drag = Math.max(0, 1 - LIQUID_DRAG * submerged);
          b.vx *= drag;
          b.vy *= drag;
          b.omega *= Math.max(0, 1 - LIQUID_ANG_DRAG * submerged);
        }
      }
      if (b.awake) {
        const sp2 = b.vx * b.vx + b.vy * b.vy;
        if (sp2 > MAX_SPEED * MAX_SPEED) {
          const s = MAX_SPEED / Math.sqrt(sp2);
          b.vx *= s; b.vy *= s;
        }
        const wMax = MAX_SPEED / (b.maxR || 1);
        if (b.omega > wMax) b.omega = wMax;
        else if (b.omega < -wMax) b.omega = -wMax;
      }
      const cos = b.cos, sin = b.sin;
      const lx0 = b.offsetX - 0.5, lx1 = b.offsetX + b.w - 0.5;
      const ly0 = b.offsetY - 0.5, ly1 = b.offsetY + b.h - 0.5;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const corner = (lx, ly) => {
        const wx = b.px + lx * cos - ly * sin, wy = b.py + lx * sin + ly * cos;
        if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
      };
      corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
      b.aabbX0 = x0; b.aabbY0 = y0; b.aabbX1 = x1; b.aabbY1 = y1;
      b.pvx = 0; b.pvy = 0; b.pw = 0; // pseudo-velocity (split-impulse position)
      b.hadContact = false;
      b.maxDepth = 0;
      b.idx = bi;
    }

    contacts = [];

    // 2) Body-body contacts. Sampling every penetrating boundary point as its own
    // contact yields a noisy, asymmetric manifold that pumps rotation (stacked
    // boxes spin up and merge). Instead, per colliding pair, collect penetrations
    // from both directions, derive ONE consistent normal, and reduce to a 2-point
    // manifold (the extremes along the contact tangent). Two points with a shared
    // normal resist rotation, so bodies stack and tumble stably.
    const penAcc = [];
    // Penetration depth of world point along `nx,ny` out of body T (march until
    // the point leaves T's occupancy; ~0.5 at the surface, larger when buried).
    const penDepth = (T, wx, wy, nx, ny) => {
      let d = 0.5, mx = wx, my = wy;
      for (let s = 0; s < 4; s++) { mx += nx; my += ny; if (insideBodyIndex(T, mx, my) < 0) break; d += 1; }
      return d;
    };
    // Collect P's boundary points that penetrate T. `sign` flips T's outward
    // normal so every accumulated normal points toward body A of the pair.
    const collectPen = (P, T, sign) => {
      for (let bp = 0; bp < P.boundaryPts.length; bp++) {
        const i = P.boundaryPts[bp];
        worldPoint(P, i, P.sin, P.cos, wp);
        if (wp[0] < T.aabbX0 || wp[0] > T.aabbX1 || wp[1] < T.aabbY0 || wp[1] > T.aabbY1) continue;
        const idx = insideBodyIndex(T, wp[0], wp[1]);
        if (idx < 0) continue;
        bodyNormalAt(T, idx, wp[0], wp[1], nrm);
        penAcc.push({ wx: wp[0], wy: wp[1], nx: nrm[0] * sign, ny: nrm[1] * sign, depth: penDepth(T, wp[0], wp[1], nrm[0], nrm[1]) });
      }
    };
    // Reduce a set of penetration points {wx,wy,nx,ny,depth} (normals already
    // pointing toward A) to a stable 2-point manifold with one shared normal, and
    // push it into the contact list. Two points + one normal resist rotation, so
    // resting bodies neither spin up nor wobble; a single point would let them tip.
    const reduceManifold = (acc, A, B, fbx, fby) => {
      if (acc.length === 0) return;
      let snx = 0, sny = 0;
      for (let p = 0; p < acc.length; p++) { snx += acc[p].nx; sny += acc[p].ny; }
      const nl = Math.sqrt(snx * snx + sny * sny);
      let Nx, Ny;
      if (nl < 1e-6) { Nx = fbx; Ny = fby; } else { Nx = snx / nl; Ny = sny / nl; }
      const tx = -Ny, ty = Nx;
      let lo = null, hi = null, loP = Infinity, hiP = -Infinity;
      for (let p = 0; p < acc.length; p++) {
        const pt = acc[p];
        const pr = pt.wx * tx + pt.wy * ty;
        if (pr < loP) { loP = pr; lo = pt; }
        if (pr > hiP) { hiP = pr; hi = pt; }
      }
      const push = (p) => {
        contacts.push({
          a: A, b: B,
          rax: p.wx - A.px, ray: p.wy - A.py,
          rbx: B ? p.wx - B.px : 0, rby: B ? p.wy - B.py : 0,
          nx: Nx, ny: Ny, depth: p.depth,
          accJn: 0, accJt: 0, accBias: 0,
        });
        if (p.depth > A.maxDepth) A.maxDepth = p.depth;
        if (B && p.depth > B.maxDepth) B.maxDepth = p.depth;
      };
      push(lo);
      if (hi !== lo) push(hi);
      A.hadContact = true;
      if (B) B.hadContact = true;
    };
    for (let i = 0; i < n; i++) {
      const A = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const B = bodies[j];
        if (!A.awake && !B.awake) continue;
        if (A.aabbX1 < B.aabbX0 || B.aabbX1 < A.aabbX0 ||
            A.aabbY1 < B.aabbY0 || B.aabbY1 < A.aabbY0) continue;
        penAcc.length = 0;
        collectPen(A, B, 1);   // A's points in B (used for contact points + depth).
        collectPen(B, A, -1);  // B's points in A.
        if (penAcc.length === 0) continue;
        // Wake a sleeping body only on a real impact from a fast-moving partner;
        // gentle resting contact leaves it asleep (static) so both can settle.
        const aMoving = A.awake && (A.vx * A.vx + A.vy * A.vy > WAKE_LIN2 || A.omega * A.omega > WAKE_ANG2);
        const bMoving = B.awake && (B.vx * B.vx + B.vy * B.vy > WAKE_LIN2 || B.omega * B.omega > WAKE_ANG2);
        if (!A.awake && bMoving) wake(A);
        if (!B.awake && aMoving) wake(B);
        if (!A.awake && !B.awake) continue; // both settled: leave them at rest
        // Use the COM-to-COM direction as the contact normal rather than the
        // per-point occupancy gradient. For two bodies the gradient degrades to a
        // wrong (radial) direction once a fast impact buries the boundary points,
        // shoving the bodies together; the COM direction is stable, never points
        // the wrong way, and for stacked boxes is exactly vertical.
        let dx = A.px - B.px, dy = A.py - B.py; const dl = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dl; dy /= dl;
        // Robust penetration depth: separating-axis overlap of the two bodies along
        // N. The per-point march degrades for deep overlap (interior normals go
        // radial and exit early), so it under-expels a stack; the projected overlap
        // is correct at any depth. The expulsion velocity is capped in resolveBias,
        // so even an over-estimate during a glancing fall can't deliver a flip-kick.
        let minA = Infinity, maxB = -Infinity;
        for (let bp = 0; bp < A.boundaryPts.length; bp++) {
          worldPoint(A, A.boundaryPts[bp], A.sin, A.cos, wp);
          const pr = wp[0] * dx + wp[1] * dy; if (pr < minA) minA = pr;
        }
        for (let bp = 0; bp < B.boundaryPts.length; bp++) {
          worldPoint(B, B.boundaryPts[bp], B.sin, B.cos, wp);
          const pr = wp[0] * dx + wp[1] * dy; if (pr > maxB) maxB = pr;
        }
        const depth = Math.max(0.5, (maxB - minA) + 0.5);
        for (let p = 0; p < penAcc.length; p++) { penAcc[p].nx = dx; penAcc[p].ny = dy; penAcc[p].depth = depth; }
        reduceManifold(penAcc, A, B, dx, dy);
      }
    }

    // 3) Terrain contacts for awake bodies, reduced to a per-body 2-point manifold
    // (same rationale as body-body: per-point terrain contacts wobble and never sleep).
    const terrAcc = [];
    for (let bi = 0; bi < n; bi++) {
      const b = bodies[bi];
      if (!b.awake) continue;
      terrAcc.length = 0;
      for (let bp = 0; bp < b.boundaryPts.length; bp++) {
        const i = b.boundaryPts[bp];
        worldPoint(b, i, b.sin, b.cos, wp);
        const cx = Math.floor(wp[0]);
        const cy = Math.floor(wp[1]);
        if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
        let tx = cx, ty = cy;
        let depth = 0.5;
        if (!isSolidAt(cx, cy)) {
          const rx = wp[0] - b.px;
          const ry = wp[1] - b.py;
          tx = Math.floor(wp[0] + (b.vx - b.omega * ry) * dt);
          ty = Math.floor(wp[1] + (b.vy + b.omega * rx) * dt);
          if (tx < 0 || tx >= cols || ty < 0 || ty >= rows || !isSolidAt(tx, ty)) continue;
          depth = 0;
        }
        terrainNormal(tx, ty, isSolidAt, nrm);
        if (depth > 0) {
          // Depth: march out along the normal until the cell is no longer solid.
          let mx = wp[0], my = wp[1];
          for (let s = 0; s < 4; s++) {
            mx += nrm[0]; my += nrm[1];
            const ix = Math.floor(mx), iy = Math.floor(my);
            if (ix < 0 || ix >= cols || iy < 0 || iy >= rows || !isSolidAt(ix, iy)) break;
            depth += 1;
          }
        }
        terrAcc.push({ wx: wp[0], wy: wp[1], nx: nrm[0], ny: nrm[1], depth });
      }
      reduceManifold(terrAcc, b, null, 0, -1);
    }

    // 4) Sequential-impulse velocity resolution (real velocity), then a separate
    // pseudo-velocity pass that expels penetration (split impulse). Each iteration
    // alternates traversal direction: a fixed order biases the solver and injects a
    // steady same-sign torque that slowly tips resting bodies over; alternating
    // cancels it so a flat stack stays flat.
    nc = contacts.length;
    for (let it = 0; it < SOLVER_ITERS; it++) {
      if (it & 1) { for (let ci = nc - 1; ci >= 0; ci--) resolveContact(contacts[ci]); }
      else { for (let ci = 0; ci < nc; ci++) resolveContact(contacts[ci]); }
    }
    for (let it = 0; it < SOLVER_ITERS; it++) {
      if (it & 1) { for (let ci = nc - 1; ci >= 0; ci--) resolveBias(contacts[ci]); }
      else { for (let ci = 0; ci < nc; ci++) resolveBias(contacts[ci]); }
    }

    // 5) Integrate position with real + pseudo velocity, then damp and update each
    // body's still-counter on the real velocity only (the pseudo-velocity carries no
    // energy into the next tick). Sleeping itself is deferred to the island pass.
    for (let bi = 0; bi < n; bi++) {
      const b = bodies[bi];
      if (!b.awake) continue;
      b.px += (b.vx + b.pvx) * dt;
      b.py += (b.vy + b.pvy) * dt;
      b.angle += (b.omega + b.pw) * dt;
      if (!b.hadContact) { b.stillTicks = 0; continue; }
      b.vx *= CONTACT_LIN_DAMP;
      b.vy *= CONTACT_LIN_DAMP;
      b.omega *= CONTACT_ANG_DAMP;
      if (b.vx * b.vx + b.vy * b.vy < SLEEP_LIN * SLEEP_LIN &&
          b.omega * b.omega < SLEEP_ANG * SLEEP_ANG &&
          b.maxDepth <= REST_DEPTH) {
        b.stillTicks++;
      } else {
        b.stillTicks = 0;
      }
    }
    } // end substep loop

    // 6) Island sleep. Union awake bodies joined by a contact, then sleep a whole
    // island only once EVERY member has been still long enough. Sleeping as a group
    // (not individually) is essential for stacks: a body that sleeps alone beneath a
    // still-settling neighbour gets re-woken every tick, and the repeated waking
    // destabilises and collapses the stack. An airborne body (no contact) keeps
    // stillTicks at 0 and so never drags an island to sleep.
    for (let bi = 0; bi < n; bi++) islandParent[bi] = bi;
    const ifind = (a) => { while (islandParent[a] !== a) { islandParent[a] = islandParent[islandParent[a]]; a = islandParent[a]; } return a; };
    for (let ci = 0; ci < nc; ci++) {
      const c = contacts[ci];
      if (!c.b || !c.a.awake || !c.b.awake) continue;
      const ra = ifind(c.a.idx), rb = ifind(c.b.idx);
      if (ra !== rb) islandParent[ra] = rb;
    }
    for (let bi = 0; bi < n; bi++) islandMinStill[bi] = Infinity;
    for (let bi = 0; bi < n; bi++) {
      const b = bodies[bi];
      if (!b.awake) continue;
      const r = ifind(bi);
      const st = b.hadContact ? b.stillTicks : 0;
      if (st < islandMinStill[r]) islandMinStill[r] = st;
    }
    for (let bi = 0; bi < n; bi++) {
      const b = bodies[bi];
      if (!b.awake) continue;
      if (islandMinStill[ifind(bi)] >= SLEEP_TICKS) { b.awake = false; b.vx = 0; b.vy = 0; b.omega = 0; }
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
  const recomputeBody = (b) => computeDerived(b, true);
  const splitDisconnectedBody = (b) => {
    const seen = new Uint8Array(b.occ.length);
    const parts = [];
    const stack = [];
    for (let k = 0; k < b.occ.length; k++) {
      if (seen[k] || !b.occ[k]) continue;
      const part = [];
      seen[k] = 1;
      stack.push(k);
      while (stack.length) {
        const cur = stack.pop();
        part.push(cur);
        const i = cur % b.w;
        const j = (cur / b.w) | 0;
        const push = (ii, jj) => {
          if (ii < 0 || ii >= b.w || jj < 0 || jj >= b.h) return;
          const nk = jj * b.w + ii;
          if (seen[nk] || !b.occ[nk]) return;
          seen[nk] = 1;
          stack.push(nk);
        };
        push(i - 1, j); push(i + 1, j); push(i, j - 1); push(i, j + 1);
      }
      parts.push(part);
    }
    if (parts.length <= 1) return false;

    const oldPx = b.px, oldPy = b.py;
    const oldVx = b.vx, oldVy = b.vy, oldOmega = b.omega;
    const makePiece = (part, id) => {
      let minI = Infinity, minJ = Infinity, maxI = -Infinity, maxJ = -Infinity;
      for (const idx of part) {
        const i = idx % b.w;
        const j = (idx / b.w) | 0;
        if (i < minI) minI = i; if (i > maxI) maxI = i;
        if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
      }
      const w = maxI - minI + 1;
      const h = maxJ - minJ + 1;
      const occ = new Uint8Array(w * h);
      for (const idx of part) {
        const i = idx % b.w;
        const j = (idx / b.w) | 0;
        occ[(j - minJ) * w + (i - minI)] = 1;
      }
      const piece = {
        id,
        occ, w, h,
        offsetX: b.offsetX + minI,
        offsetY: b.offsetY + minJ,
        px: oldPx, py: oldPy, angle: b.angle,
        vx: oldVx, vy: oldVy, omega: oldOmega,
        material: b.material,
        density: b.density,
        awake: true,
        stillTicks: 0,
      };
      computeDerived(piece, true);
      const rx = piece.px - oldPx;
      const ry = piece.py - oldPy;
      piece.vx = oldVx - oldOmega * ry;
      piece.vy = oldVy + oldOmega * rx;
      return piece;
    };

    const pieces = [makePiece(parts[0], b.id)];
    for (let p = 1; p < parts.length; p++) pieces.push(makePiece(parts[p], nextId++));
    Object.assign(b, pieces[0]);
    const bi = bodies.indexOf(b);
    if (bi >= 0) bodies.splice(bi + 1, 0, ...pieces.slice(1));
    else bodies.push(...pieces.slice(1));
    return true;
  };
  const localCellAt = (b, wx, wy) => {
    b.cos = Math.cos(b.angle);
    b.sin = Math.sin(b.angle);
    return insideBodyIndex(b, wx, wy);
  };
  const eraseLocalCell = (b, idx) => {
    if (idx < 0 || idx >= b.occ.length || !b.occ[idx]) return false;
    b.occ[idx] = 0;
    return true;
  };

  return { bodies, spawnBody, step, forEachBodyCell, wake, recomputeBody, splitDisconnectedBody, localCellAt, eraseLocalCell };
}
