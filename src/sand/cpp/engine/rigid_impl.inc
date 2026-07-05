// RigidBodySystem method bodies (need the full Engine definition; see rigid.hpp).

// Free rigid bodies and component-to-body conversion.
//
// Components are grid-anchored while bodies are moving entities. This file owns
// body geometry, integration, collision sampling, and stamping settled bodies
// back into component-aware grid state.
void RigidBodySystem::worldPoint(Body* b, int i, double sn, double cs, double& ox, double& oy) {
  double lx = b->points[i * 2], ly = b->points[i * 2 + 1];
  ox = b->px + lx * cs - ly * sn; oy = b->py + lx * sn + ly * cs;
}
bool RigidBodySystem::computeDerived(Body* b, bool preserveWorld) {
  int nPts = 0; double sumX = 0, sumY = 0;
  for (int j = 0; j < b->h; j++) for (int i = 0; i < b->w; i++) { if (!b->occ[j * b->w + i]) continue; nPts++; sumX += b->offsetX + i; sumY += b->offsetY + j; }
  if (nPts == 0) return false;
  double dx = sumX / nPts, dy = sumY / nPts;
  if (preserveWorld && (dx != 0 || dy != 0)) { double c = std::cos(b->angle), s = std::sin(b->angle); b->px += dx * c - dy * s; b->py += dx * s + dy * c; }
  b->offsetX -= dx; b->offsetY -= dy;
  b->points.assign((size_t)nPts * 2, 0.f); b->boundaryPts.clear(); b->boundarySamples.clear();
  int pi = 0; double inertia = 0, maxR2 = 0;
  auto filled = [&](int ii, int jj) { return ii >= 0 && ii < b->w && jj >= 0 && jj < b->h && b->occ[jj * b->w + ii]; };
  auto addSample = [&](double sx, double sy) { b->boundarySamples.push_back((float)sx); b->boundarySamples.push_back((float)sy); };
  for (int j = 0; j < b->h; j++) for (int i = 0; i < b->w; i++) {
    if (!b->occ[j * b->w + i]) continue;
    double lx = b->offsetX + i, ly = b->offsetY + j;
    b->points[pi * 2] = (float)lx; b->points[pi * 2 + 1] = (float)ly;
    double r2 = lx * lx + ly * ly; inertia += b->density * r2; if (r2 > maxR2) maxR2 = r2;
    bool exL = !filled(i - 1, j), exR = !filled(i + 1, j), exU = !filled(i, j - 1), exD = !filled(i, j + 1);
    if (exL || exR || exU || exD) {
      b->boundaryPts.push_back(pi);
      addSample(lx, ly);                                   // cell centre
      if (exR) addSample(lx + 0.5, ly);                    // exposed face midpoints
      if (exL) addSample(lx - 0.5, ly);
      if (exD) addSample(lx, ly + 0.5);
      if (exU) addSample(lx, ly - 0.5);
    }
    pi++;
  }
  double mass = b->density * nPts;
  b->nPts = nPts; b->invMass = mass > 0 ? 1 / mass : 0; b->invInertia = inertia > 0 ? 1 / inertia : 0;
  b->maxR = std::sqrt(maxR2); b->awake = true; b->stillTicks = 0;
  return true;
}
Body* RigidBodySystem::spawnBodyImpl(const std::vector<std::pair<int, int>>& cells, uint8_t material, double density) {
  int nPts = (int)cells.size(); if (nPts == 0) return nullptr;
  double cx = 0, cy = 0;
  for (auto& c : cells) { cx += c.first + 0.5; cy += c.second + 0.5; }
  cx /= nPts; cy /= nPts;
  int minX = 1 << 30, minY = 1 << 30, maxX = -(1 << 30), maxY = -(1 << 30);
  for (auto& c : cells) { if (c.first < minX) minX = c.first; if (c.first > maxX) maxX = c.first; if (c.second < minY) minY = c.second; if (c.second > maxY) maxY = c.second; }
  int w = maxX - minX + 1, h = maxY - minY + 1;
  Body* b = new Body();
  b->occ.assign((size_t)w * h, 0);
  for (auto& c : cells) b->occ[(size_t)(c.second - minY) * w + (c.first - minX)] = 1;
  b->w = w; b->h = h; b->offsetX = minX + 0.5 - cx; b->offsetY = minY + 0.5 - cy;
  b->px = cx; b->py = cy; b->angle = 0; b->vx = 0; b->vy = 0; b->omega = 0;
  b->material = material; b->density = density; b->id = E.L->nextBodyId++;
  computeDerived(b, false);
  E.L->bodies.push_back(b);
  return b;
}
void RigidBodySystem::terrainNormalAt(int cx, int cy, double bodyDensity, double& ox, double& oy) {
  int l = cx > 0 && isBodyTerrain(cx - 1, cy, bodyDensity) ? 1 : 0;
  int r = cx < E.cols - 1 && isBodyTerrain(cx + 1, cy, bodyDensity) ? 1 : 0;
  int u = cy > 0 && isBodyTerrain(cx, cy - 1, bodyDensity) ? 1 : 0;
  int d = cy < E.rows - 1 && isBodyTerrain(cx, cy + 1, bodyDensity) ? 1 : 0;
  double nx = l - r, ny = u - d;
  if (nx == 0 && ny == 0) { ox = 0; oy = -1; return; }
  double inv = 1 / std::sqrt(nx * nx + ny * ny); ox = nx * inv; oy = ny * inv;
}
int RigidBodySystem::insideBodyIndex(Body* b, double wx, double wy) {
  double dx = wx - b->px, dy = wy - b->py;
  double lx = dx * b->cs + dy * b->sn, ly = -dx * b->sn + dy * b->cs;
  int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
  if (i < 0 || i >= b->w || j < 0 || j >= b->h) return -1;
  int k = j * b->w + i; return b->occ[k] ? k : -1;
}
void RigidBodySystem::bodyNormalAt(Body* b, int idx, double wx, double wy, double& ox, double& oy) {
  int i = idx % b->w, j = idx / b->w; int w = b->w, h = b->h;
  auto at = [&](int ii, int jj) { return (ii < 0 || ii >= w || jj < 0 || jj >= h) ? 0 : (int)b->occ[jj * w + ii]; };
  int nlx = at(i - 1, j) - at(i + 1, j), nly = at(i, j - 1) - at(i, j + 1);
  if (nlx == 0 && nly == 0) { double rx = wx - b->px, ry = wy - b->py; double rl = std::sqrt(rx * rx + ry * ry); if (rl > 0) { ox = rx / rl; oy = ry / rl; } else { ox = 0; oy = -1; } return; }
  double wx2 = nlx * b->cs - nly * b->sn, wy2 = nlx * b->sn + nly * b->cs;
  double inv = 1 / std::sqrt(wx2 * wx2 + wy2 * wy2); ox = wx2 * inv; oy = wy2 * inv;
}
void RigidBodySystem::resolveContact(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
  double bInvM = (B && B->awake) ? B->invMass : 0, bInvI = (B && B->awake) ? B->invInertia : 0;
  double rvx = A->vx - A->omega * c.ray, rvy = A->vy + A->omega * c.rax;
  if (B) { rvx -= B->vx - B->omega * c.rby; rvy -= B->vy + B->omega * c.rbx; }
  double vn = rvx * c.nx + rvy * c.ny;
  double rnA = c.rax * c.ny - c.ray * c.nx, rnB = B ? c.rbx * c.ny - c.rby * c.nx : 0;
  double denom = aInvM + bInvM + aInvI * rnA * rnA + bInvI * rnB * rnB;
  if (denom > 0) {
    double delta = -(1 + R_RESTITUTION) * vn / denom;
    double newJn = c.accJn + delta; if (newJn < 0) newJn = 0;
    double applied = newJn - c.accJn; c.accJn = newJn;
    double jx = applied * c.nx, jy = applied * c.ny;
    A->vx += jx * aInvM; A->vy += jy * aInvM; A->omega += aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * bInvM; B->vy -= jy * bInvM; B->omega -= bInvI * (c.rbx * jy - c.rby * jx); }
  }
  double tx = -c.ny, ty = c.nx;
  double rtvx = A->vx - A->omega * c.ray, rtvy = A->vy + A->omega * c.rax;
  if (B) { rtvx -= B->vx - B->omega * c.rby; rtvy -= B->vy + B->omega * c.rbx; }
  double vt = rtvx * tx + rtvy * ty;
  double rtA = c.rax * ty - c.ray * tx, rtB = B ? c.rbx * ty - c.rby * tx : 0;
  double denomT = aInvM + bInvM + aInvI * rtA * rtA + bInvI * rtB * rtB;
  if (denomT > 0) {
    double maxF = R_FRICTION * c.accJn, delta = -vt / denomT;
    double newJt = c.accJt + delta; if (newJt > maxF) newJt = maxF; else if (newJt < -maxF) newJt = -maxF;
    double applied = newJt - c.accJt; c.accJt = newJt;
    double jx = applied * tx, jy = applied * ty;
    A->vx += jx * aInvM; A->vy += jy * aInvM; A->omega += aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * bInvM; B->vy -= jy * bInvM; B->omega -= bInvI * (c.rbx * jy - c.rby * jx); }
  }
}
void RigidBodySystem::resolveBias(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double bias = R_BAUMGARTE * std::fmax(0.0, c.depth - R_PEN_SLOP);
  if (bias <= 0) return; if (bias > R_MAX_BIAS_VEL) bias = R_MAX_BIAS_VEL;
  double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
  double bInvM = (B && B->awake) ? B->invMass : 0, bInvI = (B && B->awake) ? B->invInertia : 0;
  double rvx = A->pvx - A->pw * c.ray, rvy = A->pvy + A->pw * c.rax;
  if (B) { rvx -= B->pvx - B->pw * c.rby; rvy -= B->pvy + B->pw * c.rbx; }
  double vn = rvx * c.nx + rvy * c.ny; if (vn >= bias) return;
  double rnA = c.rax * c.ny - c.ray * c.nx, rnB = B ? c.rbx * c.ny - c.rby * c.nx : 0;
  double denom = aInvM + bInvM + aInvI * rnA * rnA + bInvI * rnB * rnB; if (denom <= 0) return;
  double delta = (bias - vn) / denom;
  double newJ = c.accBias + delta; if (newJ < 0) newJ = 0;
  double applied = newJ - c.accBias; c.accBias = newJ;
  double jx = applied * c.nx, jy = applied * c.ny;
  A->pvx += jx * aInvM; A->pvy += jy * aInvM; A->pw += aInvI * (c.rax * jy - c.ray * jx);
  if (B) { B->pvx -= jx * bInvM; B->pvy -= jy * bInvM; B->pw -= bInvI * (c.rbx * jy - c.rby * jx); }
}
void RigidBodySystem::wakeBody(Body* b) { b->awake = true; b->stillTicks = 0; }
void RigidBodySystem::rigidStep(double tickDt) {
  int n = (int)E.L->bodies.size();
  std::vector<int> islandParent(n);
  std::vector<double> islandMinStill(n);
  // Substep count is driven by the fastest *point* on any body — linear speed
  // plus angular tip speed (|omega|*radius) — not just the centre velocity, so
  // a slowly-translating but fast-spinning bar still gets enough substeps that
  // its tip moves only a fraction of a cell per substep (no endpoint tunnelling).
  double maxPointSpeed = 0;
  for (Body* b : E.L->bodies) {
    if (!b->awake) continue;
    double lin = std::sqrt(b->vx * b->vx + b->vy * b->vy);
    double pt = lin + std::fabs(b->omega) * (b->maxR > 0 ? b->maxR : 1);
    if (pt > maxPointSpeed) maxPointSpeed = pt;
  }
  maxPointSpeed += R_GRAVITY * tickDt;
  int substeps = (int)std::ceil(maxPointSpeed / R_SAFE_SUBSTEP); if (substeps < 1) substeps = 1; if (substeps > R_MAX_SUBSTEPS) substeps = R_MAX_SUBSTEPS;
  std::vector<Contact> contacts; int nc = 0;
  struct PenPt { double wx, wy, nx, ny, depth; int bk; };
  std::vector<PenPt> penAcc, terrAcc;
  double wpx, wpy, nx_, ny_;
  for (int sub = 0; sub < substeps; sub++) {
    double dt = tickDt / substeps;
    for (int bi = 0; bi < n; bi++) {
      Body* b = E.L->bodies[bi];
      if (b->awake) b->vy += R_GRAVITY * dt;
      b->cs = std::cos(b->angle); b->sn = std::sin(b->angle);
      b->pvx = 0; b->pvy = 0; b->pw = 0; b->hadContact = false; b->maxDepth = 0; b->idx = bi;
      if (b->awake && !b->boundaryPts.empty()) {
        // Support/drag from surrounding loose media. The body's own footprint is
        // cleared to EMPTY for the duration of rigidStep, so probing the
        // boundary cell itself reads air; we instead take the densest liquid/powder
        // among its 4-neighbours (the medium the body sits IN). A face deep in
        // a medium has wet neighbours; a face above the surface does not — so the
        // wet fraction rises with depth. Liquids may produce true buoyancy
        // (including upward acceleration); powders can only cancel gravity, never
        // exceed it, so bodies in grains settle but do not bob/rise.
        int liquidWet = 0, powderWet = 0; double liquidDensitySum = 0, powderDensitySum = 0;
        for (int bp : b->boundaryPts) {
          worldPoint(b, bp, b->sn, b->cs, wpx, wpy);
          int cx = (int)std::floor(wpx), cy = (int)std::floor(wpy);
          double ld = buoyantLiquidDensityAt(cx, cy);
          ld = std::fmax(ld, buoyantLiquidDensityAt(cx - 1, cy)); ld = std::fmax(ld, buoyantLiquidDensityAt(cx + 1, cy));
          ld = std::fmax(ld, buoyantLiquidDensityAt(cx, cy - 1)); ld = std::fmax(ld, buoyantLiquidDensityAt(cx, cy + 1));
          double pd = granularMediumDensityAt(cx, cy);
          pd = std::fmax(pd, granularMediumDensityAt(cx - 1, cy)); pd = std::fmax(pd, granularMediumDensityAt(cx + 1, cy));
          pd = std::fmax(pd, granularMediumDensityAt(cx, cy - 1)); pd = std::fmax(pd, granularMediumDensityAt(cx, cy + 1));
          if (ld > 0) { liquidWet++; liquidDensitySum += ld; }
          if (pd > 0) { powderWet++; powderDensitySum += pd; }
        }
        if (liquidWet > 0 || powderWet > 0) {
          double liquidSubmerged = (double)liquidWet / b->boundaryPts.size();
          double powderSubmerged = (double)powderWet / b->boundaryPts.size();
          double liquidSupport = liquidWet > 0 ? (liquidDensitySum / liquidWet / b->density) * liquidSubmerged : 0;
          double powderSupport = powderWet > 0 ? (powderDensitySum / powderWet / b->density) * powderSubmerged : 0;
          double supportRatio = liquidSupport + powderSupport;
          double maxSupport = powderWet > 0 ? std::fmax(1.0, liquidSupport) : supportRatio;
          if (supportRatio > maxSupport) supportRatio = maxSupport;
          b->vy -= R_GRAVITY * supportRatio * dt;
          if (std::fabs(supportRatio - 1.0) <= R_BUOY_REST_BAND) {
            b->vy *= R_BUOY_REST_DAMP;
            if (std::fabs(b->vy) < R_BUOY_ZERO_VY) b->vy = 0;
            if (std::fabs(b->omega) < R_SETTLE_ANG) b->omega = 0;
            b->hadContact = true; // buoyant rest counts as support for sleeping.
          }
          double submerged = std::fmax(liquidSubmerged, powderSubmerged);
          double drag = std::fmax(0.0, 1 - R_LIQUID_DRAG * submerged);
          b->vx *= drag; b->vy *= drag; b->omega *= std::fmax(0.0, 1 - R_LIQUID_ANG_DRAG * submerged);
        }
      }
      if (b->awake) {
        double sp2 = b->vx * b->vx + b->vy * b->vy;
        if (sp2 > R_MAX_SPEED * R_MAX_SPEED) { double s = R_MAX_SPEED / std::sqrt(sp2); b->vx *= s; b->vy *= s; }
        double wMax = R_MAX_SPEED / (b->maxR > 0 ? b->maxR : 1);
        if (b->omega > wMax) b->omega = wMax; else if (b->omega < -wMax) b->omega = -wMax;
      }
      double cs = b->cs, sn = b->sn;
      double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
      double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
      auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy; };
      corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
      // Expand the broad-phase AABB by this body's per-substep reach (point speed
      // travelled this substep + contact skin) so a swept sample that starts just
      // outside the static AABB but moves into the pair this substep is not pruned.
      b->sweepMargin = (std::sqrt(b->vx * b->vx + b->vy * b->vy) + std::fabs(b->omega) * (b->maxR > 0 ? b->maxR : 1)) * dt + R_CONTACT_SKIN + 0.5;
      double m = b->sweepMargin;
      b->aabbX0 = x0 - m; b->aabbY0 = y0 - m; b->aabbX1 = x1 + m; b->aabbY1 = y1 + m;
      b->omegaPre = b->omega;                                  // spin entering this substep's contact solve
    }
    contacts.clear();
    // Penetration depth of a point that is already inside target T, measured by
    // marching outward along T's surface normal until it exits the mask.
    auto penDepth = [&](Body* T, double wx, double wy, double nx, double ny) { double d = 0.5, mx = wx, my = wy; for (int s = 0; s < 4; s++) { mx += nx; my += ny; if (insideBodyIndex(T, mx, my) < 0) break; d += 1; } return d; };
    // Swept body-to-body sampling: for each exposed boundary sample of P, either
    // record an existing penetration (t=0) or march the sample's per-substep
    // RELATIVE path (P's point velocity minus T's velocity at that point) through
    // T's occupancy mask and record the first impact. The contact normal is taken
    // from T's mask surface (bodyNormalAt), oriented from B toward A via `sign`,
    // never a centre-to-centre direction. This stops a sample crossing from one
    // side of a thin body to the other without generating a contact.
    auto collectSweep = [&](Body* P, Body* T, double sign, double dt) {
      const std::vector<float>& S = P->boundarySamples; double pm = P->sweepMargin;
      for (size_t si = 0; si + 1 < S.size(); si += 2) {
        double lx = S[si], ly = S[si + 1];
        double sx = P->px + lx * P->cs - ly * P->sn, sy = P->py + lx * P->sn + ly * P->cs;
        if (sx < T->aabbX0 - pm || sx > T->aabbX1 + pm || sy < T->aabbY0 - pm || sy > T->aabbY1 + pm) continue;
        int idx0 = insideBodyIndex(T, sx, sy);
        if (idx0 >= 0) { bodyNormalAt(T, idx0, sx, sy, nx_, ny_); penAcc.push_back({sx, sy, nx_ * sign, ny_ * sign, penDepth(T, sx, sy, nx_, ny_), 0}); continue; }
        double rPx = sx - P->px, rPy = sy - P->py, rTx = sx - T->px, rTy = sy - T->py;
        double mvx = ((P->vx - P->omega * rPy) - (T->vx - T->omega * rTy)) * dt;
        double mvy = ((P->vy + P->omega * rPx) - (T->vy + T->omega * rTx)) * dt;
        double mlen = std::sqrt(mvx * mvx + mvy * mvy);
        if (mlen < 1e-9) continue;
        double dirx = mvx / mlen, diry = mvy / mlen, total = mlen + R_CONTACT_SKIN;
        int steps = (int)std::ceil(total / R_SWEEP_STEP); if (steps < 1) steps = 1;
        for (int k = 1; k <= steps; k++) {
          double dk = total * (double)k / steps;
          if (insideBodyIndex(T, sx + dirx * dk, sy + diry * dk) < 0) continue;
          double a = total * (double)(k - 1) / steps, bb = dk;
          for (int it = 0; it < 6; it++) { double mm = (a + bb) * 0.5; if (insideBodyIndex(T, sx + dirx * mm, sy + diry * mm) >= 0) bb = mm; else a = mm; }
          double hx = sx + dirx * bb, hy = sy + diry * bb; int hidx = insideBodyIndex(T, hx, hy);
          if (hidx < 0) { hx = sx + dirx * dk; hy = sy + diry * dk; hidx = insideBodyIndex(T, hx, hy); }
          if (hidx < 0) break;
          bodyNormalAt(T, hidx, hx, hy, nx_, ny_); penAcc.push_back({hx, hy, nx_ * sign, ny_ * sign, 0.0, 0});
          break;
        }
      }
    };
    // Swept body-to-terrain sampling: same idea against the static grid mask.
    // The loaded-buffer rim counts as solid wall: a body's own motion must not
    // carry it off the simulated window (where its raster is clipped away and it
    // silently vanishes). Off-buffer cells get an inward-pointing normal so the
    // body rests against / is pushed back from the render boundary until the
    // window streams that region into view. World-stream eviction (which legitly
    // carries bodies off-buffer and persists them) is a separate path.
    auto collectTerrain = [&](Body* b, double dt) {
      const std::vector<float>& S = b->boundarySamples;
      auto solid = [&](int ix, int iy) { return ix < 0 || ix >= E.cols || iy < 0 || iy >= E.rows || isBodyTerrain(ix, iy, b->density); };
      auto tnorm = [&](int ix, int iy, double& ox, double& oy) {
        if (ix < 0) { ox = 1; oy = 0; return; }
        if (ix >= E.cols) { ox = -1; oy = 0; return; }
        if (iy < 0) { ox = 0; oy = 1; return; }
        if (iy >= E.rows) { ox = 0; oy = -1; return; }
        terrainNormalAt(ix, iy, b->density, ox, oy);
      };
      for (size_t si = 0; si + 1 < S.size(); si += 2) {
        double lx = S[si], ly = S[si + 1];
        double sx = b->px + lx * b->cs - ly * b->sn, sy = b->py + lx * b->sn + ly * b->cs;
        int cx = (int)std::floor(sx), cy = (int)std::floor(sy);
        if (solid(cx, cy)) {
          tnorm(cx, cy, nx_, ny_);
          double depth = 0.5, mx = sx, my = sy;
          for (int s = 0; s < 4; s++) { mx += nx_; my += ny_; if (!solid((int)std::floor(mx), (int)std::floor(my))) break; depth += 1; }
          terrAcc.push_back({sx, sy, nx_, ny_, depth, 0}); continue;
        }
        double rx = sx - b->px, ry = sy - b->py;
        double mvx = (b->vx - b->omega * ry) * dt, mvy = (b->vy + b->omega * rx) * dt;
        double mlen = std::sqrt(mvx * mvx + mvy * mvy);
        if (mlen < 1e-9) continue;
        double dirx = mvx / mlen, diry = mvy / mlen, total = mlen + R_CONTACT_SKIN;
        int steps = (int)std::ceil(total / R_SWEEP_STEP); if (steps < 1) steps = 1;
        for (int k = 1; k <= steps; k++) {
          double dk = total * (double)k / steps;
          if (!solid((int)std::floor(sx + dirx * dk), (int)std::floor(sy + diry * dk))) continue;
          double a = total * (double)(k - 1) / steps, bb = dk;
          for (int it = 0; it < 6; it++) { double mm = (a + bb) * 0.5; if (solid((int)std::floor(sx + dirx * mm), (int)std::floor(sy + diry * mm))) bb = mm; else a = mm; }
          double hx = sx + dirx * bb, hy = sy + diry * bb; int hxx = (int)std::floor(hx), hyy = (int)std::floor(hy);
          if (!solid(hxx, hyy)) { hx = sx + dirx * dk; hy = sy + diry * dk; hxx = (int)std::floor(hx); hyy = (int)std::floor(hy); }
          tnorm(hxx, hyy, nx_, ny_); terrAcc.push_back({hx, hy, nx_, ny_, 0.0, 0});
          break;
        }
      }
    };
    // Reduce raw samples into a small contact manifold. Samples are bucketed by
    // quantized normal direction so materially different contact faces stay
    // separate (not blended into one diagonal normal); within each bucket the two
    // tangential extremes are kept so a long contact gets stable torque at both
    // ends. Deepest contributes to maxDepth for the sleep gate.
    auto reduceManifold = [&](std::vector<PenPt>& acc, Body* A, Body* B, double fbx, double fby) {
      if (acc.empty()) return;
      const double Q = 8.0 / (2.0 * M_PI);
      double snx[8] = {0}, sny[8] = {0}; int cnt[8] = {0};
      for (auto& p : acc) { int bk = ((int)std::lround(std::atan2(p.ny, p.nx) * Q)) & 7; p.bk = bk; snx[bk] += p.nx; sny[bk] += p.ny; cnt[bk]++; }
      double Nx[8], Ny[8], tx[8], ty[8], loP[8], hiP[8]; PenPt* lo[8] = {nullptr}; PenPt* hi[8] = {nullptr};
      for (int bk = 0; bk < 8; bk++) {
        if (!cnt[bk]) continue;
        double nl = std::sqrt(snx[bk] * snx[bk] + sny[bk] * sny[bk]);
        if (nl < 1e-6) { Nx[bk] = fbx; Ny[bk] = fby; } else { Nx[bk] = snx[bk] / nl; Ny[bk] = sny[bk] / nl; }
        tx[bk] = -Ny[bk]; ty[bk] = Nx[bk]; loP[bk] = 1e18; hiP[bk] = -1e18;
      }
      for (auto& p : acc) { int bk = p.bk; double pr = p.wx * tx[bk] + p.wy * ty[bk]; if (pr < loP[bk]) { loP[bk] = pr; lo[bk] = &p; } if (pr > hiP[bk]) { hiP[bk] = pr; hi[bk] = &p; } }
      auto push = [&](PenPt* p, int bk) { if (!p) return; contacts.push_back({A, B, p->wx - A->px, p->wy - A->py, B ? p->wx - B->px : 0, B ? p->wy - B->py : 0, Nx[bk], Ny[bk], p->depth, 0, 0, 0}); if (p->depth > A->maxDepth) A->maxDepth = p->depth; if (B && p->depth > B->maxDepth) B->maxDepth = p->depth; };
      for (int bk = 0; bk < 8; bk++) { if (!cnt[bk]) continue; push(lo[bk], bk); if (hi[bk] != lo[bk]) push(hi[bk], bk); }
      A->hadContact = true; if (B) B->hadContact = true;
    };
    for (int i = 0; i < n; i++) {
      Body* A = E.L->bodies[i];
      for (int j = i + 1; j < n; j++) {
        Body* B = E.L->bodies[j];
        if (!A->awake && !B->awake) continue;
        if (A->aabbX1 < B->aabbX0 || B->aabbX1 < A->aabbX0 || A->aabbY1 < B->aabbY0 || B->aabbY1 < A->aabbY0) continue;
        bool aMoving = A->awake && (A->vx * A->vx + A->vy * A->vy > R_WAKE_LIN2 || A->omega * A->omega > R_WAKE_ANG2);
        bool bMoving = B->awake && (B->vx * B->vx + B->vy * B->vy > R_WAKE_LIN2 || B->omega * B->omega > R_WAKE_ANG2);
        penAcc.clear(); collectSweep(A, B, 1, dt); collectSweep(B, A, -1, dt);
        if (penAcc.empty()) continue;
        if (!A->awake && bMoving) wakeBody(A);
        if (!B->awake && aMoving) wakeBody(B);
        if (!A->awake && !B->awake) continue;
        double fbx = A->px - B->px, fby = A->py - B->py, fl = std::sqrt(fbx * fbx + fby * fby);
        if (fl < 1e-9) { fbx = 0; fby = -1; } else { fbx /= fl; fby /= fl; }
        reduceManifold(penAcc, A, B, fbx, fby);
      }
    }
    for (int bi = 0; bi < n; bi++) {
      Body* b = E.L->bodies[bi]; if (!b->awake) continue;
      terrAcc.clear();
      collectTerrain(b, dt);
      reduceManifold(terrAcc, b, nullptr, 0, -1);
    }
    nc = (int)contacts.size();
    for (int it = 0; it < R_SOLVER_ITERS; it++) { if (it & 1) for (int ci = nc - 1; ci >= 0; ci--) resolveContact(contacts[ci]); else for (int ci = 0; ci < nc; ci++) resolveContact(contacts[ci]); }
    for (int it = 0; it < R_SOLVER_ITERS; it++) { if (it & 1) for (int ci = nc - 1; ci >= 0; ci--) resolveBias(contacts[ci]); else for (int ci = 0; ci < nc; ci++) resolveBias(contacts[ci]); }
    for (int bi = 0; bi < n; bi++) {
      Body* b = E.L->bodies[bi]; if (!b->awake) continue;
      b->px += (b->vx + b->pvx) * dt; b->py += (b->vy + b->pvy) * dt; b->angle += (b->omega + b->pw) * dt;
      if (!b->hadContact) { b->stillTicks = 0; continue; }
      if (b->vx * b->vx + b->vy * b->vy < R_SETTLE_LIN * R_SETTLE_LIN) { b->vx *= R_CONTACT_LIN_DAMP; b->vy *= R_CONTACT_LIN_DAMP; }
      // Don't damp a spin the contact solve is actively building in one direction
      // (a body toppling about a corner): that is real rotation, not jitter, and
      // damping it every substep is what made hand-drawn bodies creep over
      // agonizingly slowly instead of tipping. Rest jitter oscillates sign / decays
      // (omega*omegaPre <= 0 or |omega| not growing) and is still damped, so bodies
      // whose centre of mass sits over their support stay put and settle as before.
      bool spinGrowing = b->omega * b->omegaPre > 0 && std::fabs(b->omega) > std::fabs(b->omegaPre);
      if (!spinGrowing && b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG) b->omega *= R_CONTACT_ANG_DAMP;
      if (b->vx * b->vx + b->vy * b->vy < R_SLEEP_LIN * R_SLEEP_LIN && b->omega * b->omega < R_SLEEP_ANG * R_SLEEP_ANG && b->maxDepth <= R_REST_DEPTH) b->stillTicks++; else b->stillTicks = 0;
    }
  }
  for (int bi = 0; bi < n; bi++) islandParent[bi] = bi;
  for (int ci = 0; ci < nc; ci++) { Contact& c = contacts[ci]; if (!c.b || !c.a->awake || !c.b->awake) continue; ufUnite(islandParent, c.a->idx, c.b->idx); }
  for (int bi = 0; bi < n; bi++) islandMinStill[bi] = 1e18;
  for (int bi = 0; bi < n; bi++) { Body* b = E.L->bodies[bi]; if (!b->awake) continue; int r = ufFind(islandParent, bi); double st = b->hadContact ? b->stillTicks : 0; if (st < islandMinStill[r]) islandMinStill[r] = st; }
  for (int bi = 0; bi < n; bi++) { Body* b = E.L->bodies[bi]; if (!b->awake) continue; if (islandMinStill[ufFind(islandParent, bi)] >= R_SLEEP_TICKS) { b->awake = false; b->vx = 0; b->vy = 0; b->omega = 0; } }
}
template <class F> void RigidBodySystem::forEachBodyCell(Body* b, F cb) {
  // Inverse rasterization: for each grid cell in the body's world AABB, map its
  // center back into occ space and stamp if filled. This is hole-free for
  // rotated E.L->bodies (forward occ->world point-sampling instead leaves gaps
  // between rotated E.rows). The body shape stays authoritative in occ.
  double sn = std::sin(b->angle), cs = std::cos(b->angle);
  double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
  double minWX = 1e18, minWY = 1e18, maxWX = -1e18, maxWY = -1e18;
  auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < minWX) minWX = wx; if (wx > maxWX) maxWX = wx; if (wy < minWY) minWY = wy; if (wy > maxWY) maxWY = wy; };
  corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
  int x0 = (int)std::floor(minWX), x1 = (int)std::floor(maxWX), y0 = (int)std::floor(minWY), y1 = (int)std::floor(maxWY);
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= E.cols) x1 = E.cols - 1; if (y1 >= E.rows) y1 = E.rows - 1;
  for (int wy = y0; wy <= y1; wy++) for (int wx = x0; wx <= x1; wx++) {
    double dx = wx + 0.5 - b->px, dy = wy + 0.5 - b->py;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
    if (i < 0 || i >= b->w || j < 0 || j >= b->h) continue;
    if (b->occ[j * b->w + i]) cb(wx, wy);
  }
}
int RigidBodySystem::localCellAt(Body* b, double wx, double wy) { b->cs = std::cos(b->angle); b->sn = std::sin(b->angle); return insideBodyIndex(b, wx, wy); }
bool RigidBodySystem::eraseLocalCell(Body* b, int idx) { if (idx < 0 || idx >= (int)b->occ.size() || !b->occ[idx]) return false; b->occ[idx] = 0; return true; }

// ---- rigidBodies.js layer ----
bool RigidBodySystem::isBodyTerrain(int x, int y, double bodyDensity) {
  (void)bodyDensity;
  int k = y * E.cols + x; uint8_t m = E.grid[k];
  if (E.isBodyCell(k)) return false;                            // free bodies collide via body-vs-body, not as static terrain
  if (E.isBuoyantMedium(m)) return false;                       // liquids/powders are not solid walls; liquid buoys, powder supports one-way
  return E.isRigidMaterialClass(m);                             // stone/plant/ice-group solids incl. new ores & woods
}
double RigidBodySystem::buoyantLiquidDensityAt(int x, int y) { if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return 0; uint8_t m = E.grid[y * E.cols + x]; return E.isLiquidMaterial(m) ? DENSITY[m] : 0; }
double RigidBodySystem::granularMediumDensityAt(int x, int y) { if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return 0; uint8_t m = E.grid[y * E.cols + x]; return E.isLooseSolidMaterial(m) ? DENSITY[m] : 0; }
// Any loose medium is relocatable: a body submerging into liquid or powder
// displaces it (spilled around the body) rather than being blocked at the surface.
// Only liquids provide upward buoyancy; powders can support, but only by
// cancelling gravity.
bool RigidBodySystem::isBodyRelocatable(uint8_t m, int k, double bodyDensity) { (void)k; (void)bodyDensity; return E.isBuoyantMedium(m); }
// Gases (fire/steam/acrid smoke/…) never support or block a body — it sweeps
// through them and they vanish on commit.
bool RigidBodySystem::canBodyOccupy(uint8_t m, int k, double bodyDensity) { return m == EMPTY || E.isGasMaterial(m) || isBodyRelocatable(m, k, bodyDensity); }
void RigidBodySystem::spillDisplacedBodyMaterial(std::vector<Disp>& displaced, const std::vector<int>& edgeFootprint, int32_t footprintGen, double bodyDensity) {
  if (displaced.empty()) return;
  (void)bodyDensity;
  // Spread displaced fluid sideways and downward before upward (lateral, down,
  // then up last) — same priority the component-body spill uses. A body plunging
  // into a pool then distributes the rise across the surface instead of firing a
  // narrow fountain straight up out of the entry column ("lava out the top").
  int offs[4] = {-1, 1, E.cols, -E.cols}; int gridLen = E.cols * E.rows;
  // Passability is keyed to the DISPLACED material's own density (curD), not the
  // body's: a dense fluid (lava) shoved aside by a lighter body must be able to
  // percolate through its own pool to reach the free surface — otherwise, deep in
  // the pool it finds no path and is silently dropped (volume loss). It can move
  // through EMPTY/gas, equal-or-lighter liquid, and ungrounded or equal-or-lighter
  // powder. Powder uses the SAME <= rule liquids do (not a strict <) so displaced
  // sand can rise through its own grounded pool to the surface and spread flat,
  // exactly like water — instead of jamming against equal-density sand and heaping
  // into a local cone at the body's entry column.
  double curD = 0;
  auto isPassable = [&](uint8_t m, int k) { return m == EMPTY || E.isGasMaterial(m) || (E.isLiquidMaterial(m) && DENSITY[m] <= curD) || (E.isLooseSolidMaterial(m) && (E.groundedCell[k] != 1 || DENSITY[m] <= curD)); };
  int32_t reservedGen = ++E.L->seenGen;
  auto inFootprint = [&](int k) { return E.L->rigidSpillFootprint[k] == footprintGen; };
  auto isDropTarget = [&](int k, uint8_t mat) { if (inFootprint(k) || E.L->rigidSpillReserved[k] == reservedGen || E.isBodyCell(k)) return false; uint8_t m = E.grid[k]; if (m == EMPTY) return true; return (E.isLiquidMaterial(m) || E.isGasMaterial(m) || E.isLooseSolidMaterial(m)) && DENSITY[m] < DENSITY[mat]; };
  // Footprint-edge seeds (used when a displaced cell's own neighbours are all
  // blocked). Permissive — any fluid/empty/gas/loose powder; canVisit re-filters
  // per displaced material once curD is set in the worklist loop below.
  auto seedPassable = [&](uint8_t m, int k) { (void)k; return m == EMPTY || E.isGasMaterial(m) || E.isBuoyantMedium(m); };
  std::vector<int> footprintEdgeStarts; int32_t edgeGen = ++E.L->seenGen;
  std::vector<int> sortedFootprint(edgeFootprint.begin(), edgeFootprint.end()); std::sort(sortedFootprint.begin(), sortedFootprint.end());
  for (int k : sortedFootprint) for (int off : offs) {
    int nk = k + off; if (nk <= 0 || nk >= gridLen || E.L->seenStamp[nk] == edgeGen) continue;
    int y = nk / E.cols, x = nk - y * E.cols; if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) continue;
    if (seedPassable(E.grid[nk], nk)) { E.L->seenStamp[nk] = edgeGen; footprintEdgeStarts.push_back(nk); }
  }
  // Intentionally batch by material: each density/material group gets one
  // multi-source BFS instead of clearing a queue and searching once per displaced
  // cell. Heavier groups run first so they claim spill targets before lighter
  // material; evicted lighter material is processed in later waves.
  std::vector<Disp> pending = displaced, nextPending;
  std::vector<int> queue, targets;
  for (int wave = 0; !pending.empty() && wave < TABLE + 4; wave++) {
    std::sort(pending.begin(), pending.end(), [](const Disp& a, const Disp& b) {
      if (DENSITY[a.material] != DENSITY[b.material]) return DENSITY[a.material] > DENSITY[b.material];
      if (a.material != b.material) return a.material < b.material;
      return a.from < b.from;
    });
    nextPending.clear();
    for (size_t gi = 0; gi < pending.size();) {
      uint8_t mat = pending[gi].material;
      size_t gj = gi + 1;
      while (gj < pending.size() && pending[gj].material == mat) gj++;
      curD = DENSITY[mat];
      int need = (int)(gj - gi);
      queue.clear(); targets.clear();
      int32_t seenGen = ++E.L->seenGen;
      auto canVisit = [&](int k) {
        if (k <= 0 || k >= gridLen || inFootprint(k) || E.L->rigidSpillReserved[k] == reservedGen || E.L->seenStamp[k] == seenGen) return false;
        int y = k / E.cols, x = k - y * E.cols;
        return x > 0 && x < E.cols - 1 && y > 0 && y < E.rows && isPassable(E.grid[k], k);
      };
      auto enqueue = [&](int k) { if (!canVisit(k)) return; E.L->seenStamp[k] = seenGen; queue.push_back(k); };
      for (size_t di = gi; di < gj; di++) for (int off : offs) enqueue(pending[di].from + off);
      if (queue.empty()) for (int nk : footprintEdgeStarts) enqueue(nk);
      int visitBudget = imin(gridLen, imax(4096, need * 128));
      int visits = 0;
      for (size_t qi = 0; qi < queue.size() && (int)targets.size() < need && visits < visitBudget; qi++, visits++) {
        int k = queue[qi];
        if (isDropTarget(k, mat)) { E.L->rigidSpillReserved[k] = reservedGen; targets.push_back(k); }
        for (int off : offs) enqueue(k + off);
      }
      int n = imin((int)targets.size(), need);
      for (int i = 0; i < n; i++) {
        int target = targets[i];
        uint8_t evicted = E.grid[target];
        if (evicted != EMPTY) nextPending.push_back({evicted, target});
        E.writeGridIndex(target, mat);
      }
      gi = gj;
    }
    pending.swap(nextPending);
  }
}
double RigidBodySystem::rigidErodeProbabilityAt(int k) {
  double p = 0; int x = k % E.cols, y = k / E.cols;
  auto consider = [&](int nk) { uint8_t m = E.grid[nk]; if (m == ACID) p = std::fmax(p, ACID_DISSOLVE_P); else if (m == LAVA) p = std::fmax(p, RIGID_LAVA_ERODE_P); else if (m == FIRE) p = std::fmax(p, RIGID_FIRE_ERODE_P); };
  if (x < E.cols - 1) consider(k + 1); if (x > 0) consider(k - 1); if (y < E.rows - 1) consider(k + E.cols); if (y > 0) consider(k - E.cols);
  return p;
}
bool RigidBodySystem::eraseBodyCellIndex(int k, std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirty) {
  int id = E.bodyOwner[k]; if (id < 0) return false; // E.bodyOwner is authoritative (cell holds the body's real material, not RIGID)
  auto it = bodyById.find(id); if (it == bodyById.end()) return false; Body* b = it->second;
  int y = k / E.cols, x = k - y * E.cols;
  int idx = localCellAt(b, x + 0.5, y + 0.5);
  if (idx < 0 || !eraseLocalCell(b, idx)) return false;
  E.writeGridIndex(k, EMPTY); E.bodyOwner[k] = -1; dirty.insert(b); return true;
}
void RigidBodySystem::finishErasedBodies(std::unordered_set<Body*>& dirty, std::vector<int>& cells) {
  if (dirty.empty()) { E.L->bodyCells = cells; return; }
  // Split each erased body by the connectivity of its actual WORLD grid cells
  // (the clean source of truth), not its occ grid: the occ<->world map is lossy
  // for rotated E.L->bodies, so an occ-space flood over-fragments a clean cut into
  // dozens of slivers and loses a half. A body merely chipped (one world
  // component) keeps its rotation via computeDerived; a body actually cut into
  // multiple pieces is rebuilt as axis-aligned E.L->bodies, inheriting velocity.
  std::unordered_set<int> removedIds;
  for (Body* b : dirty) {
    std::vector<int> wc; // b's remaining world cells
    for (int k : cells) if (E.bodyOwner[k] == b->id) wc.push_back(k); // body cells carry the body's real material; E.bodyOwner identifies them
    if (wc.empty()) { removedIds.insert(b->id); continue; }
    // flood (4-connected) into world-connected groups
    std::unordered_map<int, int> idxOf; for (size_t i = 0; i < wc.size(); i++) idxOf[wc[i]] = (int)i;
    std::vector<int> comp(wc.size(), -1); std::vector<std::vector<int>> groups;
    for (size_t i = 0; i < wc.size(); i++) {
      if (comp[i] != -1) continue; int gid = (int)groups.size(); groups.push_back({}); std::vector<int> st{(int)i}; comp[i] = gid;
      while (!st.empty()) { int ci = st.back(); st.pop_back(); int k = wc[ci]; groups[gid].push_back(k); int y = k / E.cols, x = k - y * E.cols;
        const int off[4][2] = {{-1,0},{1,0},{0,-1},{0,1}};
        for (auto& o : off) { int nx = x + o[0], ny = y + o[1]; if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue; auto it = idxOf.find(ny * E.cols + nx); if (it == idxOf.end() || comp[it->second] != -1) continue; comp[it->second] = gid; st.push_back(it->second); } }
    }
    if (groups.size() <= 1) { computeDerived(b, true); continue; } // chip: keep the body (+ rotation)
    // genuine split: rebuild each piece as an axis-aligned body with inherited motion
    double ovx = b->vx, ovy = b->vy, ow = b->omega, opx = b->px, opy = b->py;
    for (auto& grp : groups) {
      std::vector<std::pair<int, int>> gc; gc.reserve(grp.size());
      for (int k : grp) gc.push_back({k % E.cols, k / E.cols});
      Body* p = spawnBodyImpl(gc, b->material, b->density);
      if (!p) continue;
      double rx = p->px - opx, ry = p->py - opy;
      p->vx = ovx - ow * ry; p->vy = ovy + ow * rx; p->omega = ow;
    }
    removedIds.insert(b->id);
  }
  if (!removedIds.empty()) {
    std::vector<Body*> keep;
    for (Body* b : E.L->bodies) { if (removedIds.count(b->id)) delete b; else keep.push_back(b); }
    E.L->bodies = std::move(keep);
  }
  // Re-assign ownership from scratch over the FORMER body cells. Body cells carry
  // the body's real material now (not RIGID), so the old `E.grid[k] == RIGID` no longer
  // identifies them — `wasBody` (the prior body-cell set) is the authoritative source,
  // and disambiguates a body cell from identical-looking static terrain of the same
  // material that the rebuilt footprint may overlap.
  std::unordered_set<int> wasBody(cells.begin(), cells.end());
  for (int k : cells) E.bodyOwner[k] = -1;
  std::vector<int> kept; std::unordered_set<int> claimed;
  // Skip EMPTY cells: an erased cell (grid already cleared) can still fall
  // under a rotated body's re-rasterization, and claiming it would leave a
  // body-owned EMPTY cell until the next moveBodies stamp — a powder settling
  // into it that step would then be wiped by the un-stamp (silent cell loss).
  // Found by the SAND_INVARIANT_CHECKS post-step validator.
  for (Body* b : E.L->bodies) forEachBodyCell(b, [&](int x, int y) { int k = y * E.cols + x; if (!wasBody.count(k) || claimed.count(k) || E.grid[k] == EMPTY) return; E.bodyOwner[k] = b->id; claimed.insert(k); kept.push_back(k); });
  for (int k : cells) if (!claimed.count(k)) { E.writeGridIndex(k, EMPTY); E.bodyOwner[k] = -1; }
  E.L->bodyCells = kept;
}
void RigidBodySystem::erodeBodies(std::vector<int>& cells) {
  if (cells.empty()) { E.L->bodyCells = cells; return; }
  std::unordered_map<int, Body*> bodyById; for (Body* b : E.L->bodies) bodyById[b->id] = b;
  std::unordered_set<Body*> dirty;
  for (int k : cells) { double p = rigidErodeProbabilityAt(k); if (p <= 0 || E.rand() >= p) continue; eraseBodyCellIndex(k, bodyById, dirty); }
  finishErasedBodies(dirty, cells);
}
int RigidBodySystem::bodyFootprintBlocked(Body* b) {
  int blocked = 0;
  forEachBodyCell(b, [&](int x, int y) { int k = y * E.cols + x; if (E.bodyOwner[k] == b->id) return; uint8_t m = E.grid[k]; if (!canBodyOccupy(m, k, b->density)) blocked++; });
  return blocked;
}
// A sleeping body keeps its support if nudging it straight down by `probe`
// cells makes its footprint overlap solid terrain or another body. If nothing
// is there, its ground crumbled away (erased/dissolved/sand drained) and it
// must wake and fall. Must be called while the E.L->bodies' cells are still in the
// grid (so other E.L->bodies count as support); the body's own cells are ignored.
bool RigidBodySystem::sleepingBodyHasSupport(Body* b, double probe) {
  if (bodyHasLooseSupport(b)) return true;
  double savedPy = b->py;
  b->py = savedPy + probe;
  bool supported = false;
  forEachBodyCell(b, [&](int x, int y) {
    if (supported) return;
    int k = y * E.cols + x; uint8_t m = E.grid[k];
    if (E.isBodyCell(k)) { if (E.bodyOwner[k] != b->id) supported = true; return; } // another body underneath counts as support; our own cells are ignored
    if (!canBodyOccupy(m, k, b->density)) supported = true; // solid terrain / another body
  });
  b->py = savedPy;
  return supported;
}
int RigidBodySystem::bodyDepenTolerance(Body* b) { return imax(1, (int)std::floor(imin(b->w, b->h) * 0.34)); }
bool RigidBodySystem::depenetrateBodyRaster(Body* b, double prePx, double prePy, bool hasPre) {
  int tol = bodyDepenTolerance(b);
  if (bodyFootprintBlocked(b) <= tol) return false;
  double newPx = b->px, newPy = b->py, newAngle = b->angle;
  if (hasPre) {
    b->px = prePx; b->py = prePy; b->angle = newAngle;
    if (bodyFootprintBlocked(b) <= tol) {
      double lo = 0, hi = 1;
      for (int iter = 0; iter < 6; iter++) { double mid = (lo + hi) * 0.5; b->px = prePx + (newPx - prePx) * mid; b->py = prePy + (newPy - prePy) * mid; b->angle = newAngle; if (bodyFootprintBlocked(b) <= tol) lo = mid; else hi = mid; }
      b->px = prePx + (newPx - prePx) * lo; b->py = prePy + (newPy - prePy) * lo; b->angle = newAngle;
      double mvx = newPx - prePx, mvy = newPy - prePy, len = std::hypot(mvx, mvy);
      if (len > 1e-6) { double nx = mvx / len, ny = mvy / len, vn = b->vx * nx + b->vy * ny; if (vn > 0) { b->vx -= vn * nx; b->vy -= vn * ny; } }
      b->awake = true; b->stillTicks = 0; return true;
    }
  }
  b->px = newPx; b->py = newPy; b->angle = newAngle;
  double maxLift = 3.0, st = 0.125;
  for (double lift = st; lift <= maxLift + 1e-9; lift += st) { b->py = newPy - lift; if (bodyFootprintBlocked(b) <= tol) { if (b->vy > 0) b->vy = 0; b->awake = true; b->stillTicks = 0; return true; } }
  b->px = newPx; b->py = newPy; b->angle = newAngle; return false;
}
// ===== Body material identity & solidify-on-rest =====
// (See the BODY-MATERIAL INVARIANT block in members.inc.) A free body stamps its
// real material into the grid; when a NON-RIGID body sleeps it bakes into a normal
// static component here. RIGID bodies never bake — they stay free bodies forever.
void RigidBodySystem::bakeBodyToGrid(Body* b) {
  // The body's cells were just cleared to EMPTY (moveBodies), so write the body's
  // material into them and hand the set to registerRigidCells — the exact primitive
  // lava-hardening uses to turn loose cells into a grounded stone/ice component.
  std::unordered_set<int> baked; int yMax = 0;
  forEachBodyCell(b, [&](int x, int y) {
    int k = y * E.cols + x;
    if (E.grid[k] != EMPTY && !E.componentDisplaceable(E.grid[k])) return; // never clobber solid terrain it came to rest against
    E.writeGridIndex(k, b->material); baked.insert(k); if (y > yMax) yMax = y;
  });
  if (baked.empty()) return;
  if (E.isIceComponentMaterial(b->material)) E.registerRigidCells(E.L->iceComponents, E.L->nextIceId, b->material, baked, yMax, true);
  else if (E.isPlantMaterial(b->material)) E.registerPlantCells(b->material, baked, yMax); // wood/plant body -> inert plant component (analogue of the stone path)
  else E.registerRigidCells(E.L->stoneComponents, E.L->nextStoneId, b->material, baked, yMax, false);
}
// Every solid component material has a static form to bake into: stone-group
// (stone/ores/brick/TNT), ice, and plant-family (wood/plant/cactus/…). Only the
// generic RIGID cube has no terrain form, so it stays a free body forever.
bool RigidBodySystem::bodySolidifies(uint8_t m) { return E.isStoneComponentMaterial(m) || E.isIceComponentMaterial(m) || E.isPlantMaterial(m); }
// A sleeping body bakes UNLESS it is FLOATING in liquid. "Floating" = its
// bottom-edge contact is predominantly liquid (a wood log bobbing on water).
// Powders never provide upward support, so a body in grains can only sink.
// Everything else at rest solidifies:
// on terrain, the world floor, OR piled on other debris (at bake time other bodies'
// cells are already cleared from the grid, so a debris pile reads as empty-below, not
// medium-supported — so it bakes, which is what keeps a big TNT chain's rubble from lingering as
// hundreds of live bodies grinding the solver). Probes the cell under each bottom-edge
// cell. (sleepingBodyHasSupport can't be reused: it clamps the AABB and so misses the
// world-floor boundary, where stone/wood bodies legitimately come to rest.)
bool RigidBodySystem::bodyFloatsOnMedium(Body* b) {
  std::unordered_set<int> occ;
  forEachBodyCell(b, [&](int x, int y) { occ.insert(y * E.cols + x); });
  int solidBelow = 0, mediumBelow = 0;
  for (int k : occ) {
    int y = k / E.cols, x = k - y * E.cols, bk = (y + 1) * E.cols + x;
    if (occ.count(bk)) continue;                            // interior cell, not a bottom edge
    if (y + 1 >= E.rows) { solidBelow++; continue; }          // the world floor is solid support
    uint8_t m = E.grid[bk];
    if (E.isLiquidMaterial(m)) mediumBelow++;
    else if (m != EMPTY && !E.isGasMaterial(m)) solidBelow++; // terrain / another body's cell
  }
  return mediumBelow > 0 && mediumBelow > solidBelow;
}
bool RigidBodySystem::bodyHasLooseSupport(Body* b) {
  std::unordered_set<int> occ;
  forEachBodyCell(b, [&](int x, int y) { occ.insert(y * E.cols + x); });
  int solidBelow = 0, mediumBelow = 0;
  for (int k : occ) {
    int y = k / E.cols, x = k - y * E.cols, bk = (y + 1) * E.cols + x;
    if (occ.count(bk)) continue;
    if (y + 1 >= E.rows) { solidBelow++; continue; }
    uint8_t m = E.grid[bk];
    if (E.isBuoyantMedium(m)) mediumBelow++;
    else if (m != EMPTY && !E.isGasMaterial(m)) solidBelow++;
  }
  return mediumBelow > 0 && mediumBelow > solidBelow;
}
void RigidBodySystem::bakeRestingBodies() {
  bool baked = false; std::vector<Body*> keep;
  for (Body* b : E.L->bodies) {
    // Solidify a sleeping body unless it is still floating in liquid.
    if (!b->awake && bodySolidifies(b->material) && !bodyFloatsOnMedium(b)) { bakeBodyToGrid(b); delete b; baked = true; }
    else keep.push_back(b);
  }
  if (baked) E.L->bodies = std::move(keep);
}
void RigidBodySystem::moveBodies() {
  if (E.L->bodies.empty() && E.L->bodyCells.empty()) return;
  E.computeGrounded();
  // Wake any sleeping body whose support crumbled away since it slept, so it
  // falls instead of floating. Checked before the grid cells are cleared so
  // other E.L->bodies still count as support; body-on-body stacks cascade (the
  // bottom body wakes and moves, then the contact solver wakes those above).
  for (Body* b : E.L->bodies) if (!b->awake && !sleepingBodyHasSupport(b, 1.0)) wakeBody(b);
  for (int k : E.L->bodyCells) { if (E.isBodyCell(k)) E.writeGridIndex(k, EMPTY); E.bodyOwner[k] = -1; } // body-material invariant: body cells hold the body's real material; E.bodyOwner marks them
  std::unordered_map<int, std::pair<double, double>> prePoses;
  for (Body* b : E.L->bodies) prePoses[b->id] = {b->px, b->py};
  rigidStep(1.0);
  rigidRejectedCells = 0; rigidDepenetrations = 0;
  for (Body* b : E.L->bodies) { auto it = prePoses.find(b->id); bool hp = it != prePoses.end(); double ppx = hp ? it->second.first : 0, ppy = hp ? it->second.second : 0; if (depenetrateBodyRaster(b, ppx, ppy, hp)) rigidDepenetrations++; }
  bakeRestingBodies(); // a non-RIGID body that just slept solidifies into a static component (after depenetrate, which may re-wake it)
  std::vector<int> cells, footprint;
  std::unordered_map<int, std::pair<std::vector<Disp>, std::vector<int>>> perBody;
  for (Body* b : E.L->bodies) {
    auto& pb = perBody[b->id];
    forEachBodyCell(b, [&](int x, int y) {
      int k = y * E.cols + x; if (E.bodyOwner[k] != -1) return; uint8_t m = E.grid[k];
      if (!canBodyOccupy(m, k, b->density)) { rigidRejectedCells++; return; }
      if (isBodyRelocatable(m, k, b->density)) pb.first.push_back({m, k});
      E.writeGridIndex(k, b->material); E.bodyOwner[k] = b->id; cells.push_back(k); footprint.push_back(k); pb.second.push_back(k); // body-material invariant: stamp the body's REAL material so it renders/mines/reacts as that material
    });
  }
  {
    std::vector<Body*> keep;
    keep.reserve(E.L->bodies.size());
    for (Body* b : E.L->bodies) {
      auto it = perBody.find(b->id);
      if (it != perBody.end() && it->second.second.empty()) { delete b; continue; }
      keep.push_back(b);
    }
    if (keep.size() != E.L->bodies.size()) E.L->bodies = std::move(keep);
  }
  int32_t footprintGen = ++E.L->seenGen;
  for (int k : footprint) E.L->rigidSpillFootprint[k] = footprintGen;
  for (Body* b : E.L->bodies) {
    auto it = perBody.find(b->id);
    if (it != perBody.end()) spillDisplacedBodyMaterial(it->second.first, it->second.second, footprintGen, b->density);
  }
  erodeBodies(cells);
}
Body* RigidBodySystem::finishSpawn(const std::vector<std::pair<int, int>>& cells, uint8_t material) {
  Body* b = spawnBodyImpl(cells, material, DENSITY[material]);
  if (b && !cells.empty()) { int minX = E.cols - 1, minY = E.rows - 1, maxX = 0, maxY = 0; for (auto& c : cells) { if (c.first < minX) minX = c.first; if (c.first > maxX) maxX = c.first; if (c.second < minY) minY = c.second; if (c.second > maxY) maxY = c.second; } E.markDirtyRect(minX, minY, maxX, maxY); }
  return b;
}
Body* RigidBodySystem::spawnBody(const std::vector<std::pair<int, int>>& cells) { return finishSpawn(cells, RIGID); }

// Primitive body shapes built engine-side (no per-cell array marshalled from
// JS). Cells are clipped to the interior, exactly like the old JS cube tool
// (dx in [-halfW, halfW), dy in [-halfH, halfH) for the box).
Body* RigidBodySystem::spawnBox(int cx, int cy, int halfW, int halfH, uint8_t material) {
  if (material >= TABLE) material = RIGID;
  std::vector<std::pair<int, int>> cells;
  cells.reserve((size_t)imax(0, 2 * halfW) * imax(0, 2 * halfH));
  for (int dx = -halfW; dx < halfW; dx++)
    for (int dy = -halfH; dy < halfH; dy++) {
      int x = cx + dx, y = cy + dy;
      if (x >= 1 && x < E.cols - 1 && y >= 1 && y < E.rows - 1) cells.push_back({x, y});
    }
  return finishSpawn(cells, material);
}
Body* RigidBodySystem::spawnDisc(int cx, int cy, int radius, uint8_t material) {
  if (material >= TABLE) material = RIGID;
  std::vector<std::pair<int, int>> cells;
  int r2 = radius * radius;
  for (int dy = -radius; dy <= radius; dy++)
    for (int dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      int x = cx + dx, y = cy + dy;
      if (x >= 1 && x < E.cols - 1 && y >= 1 && y < E.rows - 1) cells.push_back({x, y});
    }
  return finishSpawn(cells, material);
}
