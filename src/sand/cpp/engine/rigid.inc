  // Free rigid bodies and component-to-body conversion.
  //
  // Components are grid-anchored while bodies are moving entities. This file owns
  // body geometry, integration, collision sampling, and stamping settled bodies
  // back into component-aware grid state.
  void worldPoint(Body* b, int i, double sn, double cs, double& ox, double& oy) {
    double lx = b->points[i * 2], ly = b->points[i * 2 + 1];
    ox = b->px + lx * cs - ly * sn; oy = b->py + lx * sn + ly * cs;
  }
  bool computeDerived(Body* b, bool preserveWorld) {
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
  Body* spawnBodyImpl(const std::vector<std::pair<int, int>>& cells, uint8_t material, double density) {
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
    b->material = material; b->density = density; b->id = L->nextBodyId++;
    computeDerived(b, false);
    L->bodies.push_back(b);
    return b;
  }
  void terrainNormalAt(int cx, int cy, double bodyDensity, double& ox, double& oy) {
    int l = cx > 0 && isBodyTerrain(cx - 1, cy, bodyDensity) ? 1 : 0;
    int r = cx < cols - 1 && isBodyTerrain(cx + 1, cy, bodyDensity) ? 1 : 0;
    int u = cy > 0 && isBodyTerrain(cx, cy - 1, bodyDensity) ? 1 : 0;
    int d = cy < rows - 1 && isBodyTerrain(cx, cy + 1, bodyDensity) ? 1 : 0;
    double nx = l - r, ny = u - d;
    if (nx == 0 && ny == 0) { ox = 0; oy = -1; return; }
    double inv = 1 / std::sqrt(nx * nx + ny * ny); ox = nx * inv; oy = ny * inv;
  }
  int insideBodyIndex(Body* b, double wx, double wy) {
    double dx = wx - b->px, dy = wy - b->py;
    double lx = dx * b->cs + dy * b->sn, ly = -dx * b->sn + dy * b->cs;
    int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
    if (i < 0 || i >= b->w || j < 0 || j >= b->h) return -1;
    int k = j * b->w + i; return b->occ[k] ? k : -1;
  }
  void bodyNormalAt(Body* b, int idx, double wx, double wy, double& ox, double& oy) {
    int i = idx % b->w, j = idx / b->w; int w = b->w, h = b->h;
    auto at = [&](int ii, int jj) { return (ii < 0 || ii >= w || jj < 0 || jj >= h) ? 0 : (int)b->occ[jj * w + ii]; };
    int nlx = at(i - 1, j) - at(i + 1, j), nly = at(i, j - 1) - at(i, j + 1);
    if (nlx == 0 && nly == 0) { double rx = wx - b->px, ry = wy - b->py; double rl = std::sqrt(rx * rx + ry * ry); if (rl > 0) { ox = rx / rl; oy = ry / rl; } else { ox = 0; oy = -1; } return; }
    double wx2 = nlx * b->cs - nly * b->sn, wy2 = nlx * b->sn + nly * b->cs;
    double inv = 1 / std::sqrt(wx2 * wx2 + wy2 * wy2); ox = wx2 * inv; oy = wy2 * inv;
  }
  void resolveContact(Contact& c) {
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
  void resolveBias(Contact& c) {
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
  void wakeBody(Body* b) { b->awake = true; b->stillTicks = 0; }
  void rigidStep(double tickDt) {
    int n = (int)L->bodies.size();
    std::vector<int> islandParent(n);
    std::vector<double> islandMinStill(n);
    // Substep count is driven by the fastest *point* on any body — linear speed
    // plus angular tip speed (|omega|*radius) — not just the centre velocity, so
    // a slowly-translating but fast-spinning bar still gets enough substeps that
    // its tip moves only a fraction of a cell per substep (no endpoint tunnelling).
    double maxPointSpeed = 0;
    for (Body* b : L->bodies) {
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
        Body* b = L->bodies[bi];
        if (b->awake) b->vy += R_GRAVITY * dt;
        b->cs = std::cos(b->angle); b->sn = std::sin(b->angle);
        if (b->awake && !b->boundaryPts.empty()) {
          // Buoyancy/drag from surrounding fluid. The body's own footprint is
          // cleared to EMPTY for the duration of rigidStep, so probing the
          // boundary cell itself reads air; we instead take the densest liquid
          // among its 4-neighbours (the medium the body sits IN). A face deep in
          // fluid has wet neighbours; a face above the surface does not — so the
          // wet fraction rises with depth and gives an Archimedes restoring force
          // that settles a light body part-submerged in a denser fluid rather than
          // resting on top of it (fluid is no longer treated as solid terrain).
          int wet = 0; double densitySum = 0;
          for (int bp : b->boundaryPts) {
            worldPoint(b, bp, b->sn, b->cs, wpx, wpy);
            int cx = (int)std::floor(wpx), cy = (int)std::floor(wpy);
            double d = fluidDensityAt(cx, cy);
            d = std::fmax(d, fluidDensityAt(cx - 1, cy)); d = std::fmax(d, fluidDensityAt(cx + 1, cy));
            d = std::fmax(d, fluidDensityAt(cx, cy - 1)); d = std::fmax(d, fluidDensityAt(cx, cy + 1));
            if (d <= 0) continue; wet++; densitySum += d;
          }
          if (wet > 0) {
            double submerged = (double)wet / b->boundaryPts.size(), avgFluidD = densitySum / wet;
            b->vy -= R_GRAVITY * (avgFluidD / b->density) * submerged * dt;
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
        b->pvx = 0; b->pvy = 0; b->pw = 0; b->hadContact = false; b->maxDepth = 0; b->idx = bi;
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
        auto solid = [&](int ix, int iy) { return ix < 0 || ix >= cols || iy < 0 || iy >= rows || isBodyTerrain(ix, iy, b->density); };
        auto tnorm = [&](int ix, int iy, double& ox, double& oy) {
          if (ix < 0) { ox = 1; oy = 0; return; }
          if (ix >= cols) { ox = -1; oy = 0; return; }
          if (iy < 0) { ox = 0; oy = 1; return; }
          if (iy >= rows) { ox = 0; oy = -1; return; }
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
        Body* A = L->bodies[i];
        for (int j = i + 1; j < n; j++) {
          Body* B = L->bodies[j];
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
        Body* b = L->bodies[bi]; if (!b->awake) continue;
        terrAcc.clear();
        collectTerrain(b, dt);
        reduceManifold(terrAcc, b, nullptr, 0, -1);
      }
      nc = (int)contacts.size();
      for (int it = 0; it < R_SOLVER_ITERS; it++) { if (it & 1) for (int ci = nc - 1; ci >= 0; ci--) resolveContact(contacts[ci]); else for (int ci = 0; ci < nc; ci++) resolveContact(contacts[ci]); }
      for (int it = 0; it < R_SOLVER_ITERS; it++) { if (it & 1) for (int ci = nc - 1; ci >= 0; ci--) resolveBias(contacts[ci]); else for (int ci = 0; ci < nc; ci++) resolveBias(contacts[ci]); }
      for (int bi = 0; bi < n; bi++) {
        Body* b = L->bodies[bi]; if (!b->awake) continue;
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
    std::function<int(int)> ifind = [&](int a) { while (islandParent[a] != a) { islandParent[a] = islandParent[islandParent[a]]; a = islandParent[a]; } return a; };
    for (int ci = 0; ci < nc; ci++) { Contact& c = contacts[ci]; if (!c.b || !c.a->awake || !c.b->awake) continue; int ra = ifind(c.a->idx), rb = ifind(c.b->idx); if (ra != rb) islandParent[ra] = rb; }
    for (int bi = 0; bi < n; bi++) islandMinStill[bi] = 1e18;
    for (int bi = 0; bi < n; bi++) { Body* b = L->bodies[bi]; if (!b->awake) continue; int r = ifind(bi); double st = b->hadContact ? b->stillTicks : 0; if (st < islandMinStill[r]) islandMinStill[r] = st; }
    for (int bi = 0; bi < n; bi++) { Body* b = L->bodies[bi]; if (!b->awake) continue; if (islandMinStill[ifind(bi)] >= R_SLEEP_TICKS) { b->awake = false; b->vx = 0; b->vy = 0; b->omega = 0; } }
  }
  template <class F> void forEachBodyCell(Body* b, F cb) {
    // Inverse rasterization: for each grid cell in the body's world AABB, map its
    // center back into occ space and stamp if filled. This is hole-free for
    // rotated L->bodies (forward occ->world point-sampling instead leaves gaps
    // between rotated rows). The body shape stays authoritative in occ.
    double sn = std::sin(b->angle), cs = std::cos(b->angle);
    double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
    double minWX = 1e18, minWY = 1e18, maxWX = -1e18, maxWY = -1e18;
    auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < minWX) minWX = wx; if (wx > maxWX) maxWX = wx; if (wy < minWY) minWY = wy; if (wy > maxWY) maxWY = wy; };
    corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
    int x0 = (int)std::floor(minWX), x1 = (int)std::floor(maxWX), y0 = (int)std::floor(minWY), y1 = (int)std::floor(maxWY);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= cols) x1 = cols - 1; if (y1 >= rows) y1 = rows - 1;
    for (int wy = y0; wy <= y1; wy++) for (int wx = x0; wx <= x1; wx++) {
      double dx = wx + 0.5 - b->px, dy = wy + 0.5 - b->py;
      double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
      int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
      if (i < 0 || i >= b->w || j < 0 || j >= b->h) continue;
      if (b->occ[j * b->w + i]) cb(wx, wy);
    }
  }
  int localCellAt(Body* b, double wx, double wy) { b->cs = std::cos(b->angle); b->sn = std::sin(b->angle); return insideBodyIndex(b, wx, wy); }
  bool eraseLocalCell(Body* b, int idx) { if (idx < 0 || idx >= (int)b->occ.size() || !b->occ[idx]) return false; b->occ[idx] = 0; return true; }

  // ---- rigidBodies.js layer ----
  bool isBodyTerrain(int x, int y, double bodyDensity) {
    int k = y * cols + x; uint8_t m = grid[k];
    if (MAT_KIND[m] == K_POWDER) return groundedCell[k] == 1 && DENSITY[m] >= bodyDensity;
    if (isLiquid(m)) return false;                              // fluids are never a solid wall — buoyancy (rigidStep) governs how deep a body sinks, so a light body part-submerges in a denser fluid instead of resting on top
    if (m == DRIFTWOOD || m == RIGID) return false;             // free body / drifting wood are not static terrain
    return isRigidMaterial(m);                                  // stone/plant/ice-group solids incl. new ores & woods
  }
  double fluidDensityAt(int x, int y) { if (x < 0 || x >= cols || y < 0 || y >= rows) return 0; uint8_t m = grid[y * cols + x]; return isLiquid(m) ? DENSITY[m] : 0; }
  // Any liquid is relocatable: a body submerging into a denser fluid displaces it
  // (spilled around the body), letting it part-sink to its buoyant equilibrium
  // rather than being blocked at the surface. Lighter fluid was already displaceable.
  bool isBodyRelocatable(uint8_t m, int k, double bodyDensity) { return isLiquid(m) || (MAT_KIND[m] == K_POWDER && (groundedCell[k] != 1 || DENSITY[m] < bodyDensity)); }
  // Gases (fire/steam/acrid smoke/…) never support or block a body — it sweeps
  // through them and they vanish on commit. Keyed off K_GAS so any new gas is
  // handled automatically (was a hardcoded FIRE/STEAM list that missed ACRID_SMOKE).
  bool canBodyOccupy(uint8_t m, int k, double bodyDensity) { return m == EMPTY || isGas(m) || isBodyRelocatable(m, k, bodyDensity); }
  struct Disp { uint8_t material; int from; };
  void spillDisplacedBodyMaterial(std::vector<Disp>& displaced, std::unordered_set<int>& footprint, std::unordered_set<int>& edgeFootprint, double bodyDensity) {
    if (displaced.empty()) return;
    (void)bodyDensity;
    // Spread displaced fluid sideways and downward before upward (lateral, down,
    // then up last) — same priority the component-body spill uses. A body plunging
    // into a pool then distributes the rise across the surface instead of firing a
    // narrow fountain straight up out of the entry column ("lava out the top").
    int offs[4] = {-1, 1, cols, -cols}; int gridLen = cols * rows;
    // Passability is keyed to the DISPLACED material's own density (curD), not the
    // body's: a dense fluid (lava) shoved aside by a lighter body must be able to
    // percolate through its own pool to reach the free surface — otherwise, deep in
    // the pool it finds no path and is silently dropped (volume loss). It can move
    // through EMPTY/gas, equal-or-lighter liquid, and ungrounded/lighter powder.
    double curD = 0;
    auto isPassable = [&](uint8_t m, int k) { return m == EMPTY || isGas(m) || (isLiquid(m) && DENSITY[m] <= curD) || (MAT_KIND[m] == K_POWDER && (groundedCell[k] != 1 || DENSITY[m] < curD)); };
    std::unordered_set<int> seen;
    auto canVisit = [&](int k) { if (k <= 0 || k >= gridLen || footprint.count(k) || seen.count(k)) return false; int y = k / cols, x = k - y * cols; return x > 0 && x < cols - 1 && y > 0 && y < rows && isPassable(grid[k], k); };
    auto isDropTarget = [&](int k, uint8_t mat) { if (footprint.count(k)) return false; uint8_t m = grid[k]; if (m == EMPTY) return true; return (isLiquid(m) || isGas(m) || MAT_KIND[m] == K_POWDER) && DENSITY[m] < DENSITY[mat]; };
    // Footprint-edge seeds (used when a displaced cell's own neighbours are all
    // blocked). Permissive — any fluid/empty/gas/loose powder; canVisit re-filters
    // per displaced material once curD is set in the worklist loop below.
    auto seedPassable = [&](uint8_t m, int k) { return m == EMPTY || isGas(m) || isLiquid(m) || (MAT_KIND[m] == K_POWDER && groundedCell[k] != 1); };
    std::vector<int> footprintEdgeStarts; std::unordered_set<int> footprintEdgeSeen;
    std::vector<int> sortedFootprint(edgeFootprint.begin(), edgeFootprint.end()); std::sort(sortedFootprint.begin(), sortedFootprint.end());
    for (int k : sortedFootprint) for (int off : offs) { int nk = k + off; if (footprintEdgeSeen.count(nk)) continue; int y = nk / cols, x = nk - y * cols; if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) continue; if (seedPassable(grid[nk], nk)) { footprintEdgeSeen.insert(nk); footprintEdgeStarts.push_back(nk); } }
    std::vector<Disp> worklist = displaced;
    std::sort(worklist.begin(), worklist.end(), [](const Disp& a, const Disp& b) { return DENSITY[b.material] < DENSITY[a.material]; });
    std::vector<int> queue;
    for (size_t wi = 0; wi < worklist.size(); wi++) {
      Disp d = worklist[wi]; curD = DENSITY[d.material]; seen.clear(); queue.clear(); int target = -1;
      for (int off : offs) { int nk = d.from + off; if (!canVisit(nk)) continue; seen.insert(nk); queue.push_back(nk); }
      if (queue.empty()) for (int nk : footprintEdgeStarts) { if (!canVisit(nk)) continue; seen.insert(nk); queue.push_back(nk); }
      for (size_t qi = 0; qi < queue.size(); qi++) { int k = queue[qi]; if (isDropTarget(k, d.material)) { target = k; break; } for (int off : offs) { int nk = k + off; if (!canVisit(nk)) continue; seen.insert(nk); queue.push_back(nk); } }
      if (target >= 0) { uint8_t evicted = grid[target]; if (evicted != EMPTY) worklist.push_back({evicted, target}); writeGridIndex(target, d.material); }
    }
  }
  double rigidErodeProbabilityAt(int k) {
    double p = 0; int x = k % cols, y = k / cols;
    auto consider = [&](int nk) { uint8_t m = grid[nk]; if (m == ACID) p = std::fmax(p, ACID_DISSOLVE_P); else if (m == LAVA) p = std::fmax(p, RIGID_LAVA_ERODE_P); else if (m == FIRE) p = std::fmax(p, RIGID_FIRE_ERODE_P); };
    if (x < cols - 1) consider(k + 1); if (x > 0) consider(k - 1); if (y < rows - 1) consider(k + cols); if (y > 0) consider(k - cols);
    return p;
  }
  static const double RIGID_LAVA_ERODE_P, RIGID_FIRE_ERODE_P;
  bool eraseBodyCellIndex(int k, std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirty) {
    int id = bodyOwner[k]; if (id < 0 || grid[k] != RIGID) return false;
    auto it = bodyById.find(id); if (it == bodyById.end()) return false; Body* b = it->second;
    int y = k / cols, x = k - y * cols;
    int idx = localCellAt(b, x + 0.5, y + 0.5);
    if (idx < 0 || !eraseLocalCell(b, idx)) return false;
    writeGridIndex(k, EMPTY); bodyOwner[k] = -1; dirty.insert(b); return true;
  }
  void finishErasedBodies(std::unordered_set<Body*>& dirty, std::vector<int>& cells) {
    if (dirty.empty()) { L->bodyCells = cells; return; }
    // Split each erased body by the connectivity of its actual WORLD grid cells
    // (the clean source of truth), not its occ grid: the occ<->world map is lossy
    // for rotated L->bodies, so an occ-space flood over-fragments a clean cut into
    // dozens of slivers and loses a half. A body merely chipped (one world
    // component) keeps its rotation via computeDerived; a body actually cut into
    // multiple pieces is rebuilt as axis-aligned L->bodies, inheriting velocity.
    std::unordered_set<int> removedIds;
    for (Body* b : dirty) {
      std::vector<int> wc; // b's remaining world cells
      for (int k : cells) if (grid[k] == RIGID && bodyOwner[k] == b->id) wc.push_back(k);
      if (wc.empty()) { removedIds.insert(b->id); continue; }
      // flood (4-connected) into world-connected groups
      std::unordered_map<int, int> idxOf; for (size_t i = 0; i < wc.size(); i++) idxOf[wc[i]] = (int)i;
      std::vector<int> comp(wc.size(), -1); std::vector<std::vector<int>> groups;
      for (size_t i = 0; i < wc.size(); i++) {
        if (comp[i] != -1) continue; int gid = (int)groups.size(); groups.push_back({}); std::vector<int> st{(int)i}; comp[i] = gid;
        while (!st.empty()) { int ci = st.back(); st.pop_back(); int k = wc[ci]; groups[gid].push_back(k); int y = k / cols, x = k - y * cols;
          const int off[4][2] = {{-1,0},{1,0},{0,-1},{0,1}};
          for (auto& o : off) { int nx = x + o[0], ny = y + o[1]; if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue; auto it = idxOf.find(ny * cols + nx); if (it == idxOf.end() || comp[it->second] != -1) continue; comp[it->second] = gid; st.push_back(it->second); } }
      }
      if (groups.size() <= 1) { computeDerived(b, true); continue; } // chip: keep the body (+ rotation)
      // genuine split: rebuild each piece as an axis-aligned body with inherited motion
      double ovx = b->vx, ovy = b->vy, ow = b->omega, opx = b->px, opy = b->py;
      for (auto& grp : groups) {
        std::vector<std::pair<int, int>> gc; gc.reserve(grp.size());
        for (int k : grp) gc.push_back({k % cols, k / cols});
        Body* p = spawnBodyImpl(gc, b->material, b->density);
        if (!p) continue;
        double rx = p->px - opx, ry = p->py - opy;
        p->vx = ovx - ow * ry; p->vy = ovy + ow * rx; p->omega = ow;
      }
      removedIds.insert(b->id);
    }
    if (!removedIds.empty()) {
      std::vector<Body*> keep;
      for (Body* b : L->bodies) { if (removedIds.count(b->id)) delete b; else keep.push_back(b); }
      L->bodies = std::move(keep);
    }
    for (int k : cells) if (grid[k] == RIGID) bodyOwner[k] = -1;
    std::vector<int> kept; std::unordered_set<int> claimed;
    for (Body* b : L->bodies) forEachBodyCell(b, [&](int x, int y) { int k = y * cols + x; if (grid[k] != RIGID || claimed.count(k)) return; bodyOwner[k] = b->id; claimed.insert(k); kept.push_back(k); });
    for (int k : cells) if (grid[k] == RIGID && !claimed.count(k)) { writeGridIndex(k, EMPTY); bodyOwner[k] = -1; }
    L->bodyCells = kept;
  }
  void erodeBodies(std::vector<int>& cells) {
    if (cells.empty()) { L->bodyCells = cells; return; }
    std::unordered_map<int, Body*> bodyById; for (Body* b : L->bodies) bodyById[b->id] = b;
    std::unordered_set<Body*> dirty;
    for (int k : cells) { double p = rigidErodeProbabilityAt(k); if (p <= 0 || rand() >= p) continue; eraseBodyCellIndex(k, bodyById, dirty); }
    finishErasedBodies(dirty, cells);
  }
  int bodyFootprintBlocked(Body* b) {
    int blocked = 0;
    forEachBodyCell(b, [&](int x, int y) { int k = y * cols + x; uint8_t m = grid[k]; if (m == RIGID && bodyOwner[k] == b->id) return; if (!canBodyOccupy(m, k, b->density)) blocked++; });
    return blocked;
  }
  // A sleeping body keeps its support if nudging it straight down by `probe`
  // cells makes its footprint overlap solid terrain or another body. If nothing
  // is there, its ground crumbled away (erased/dissolved/sand drained) and it
  // must wake and fall. Must be called while the L->bodies' cells are still in the
  // grid (so other L->bodies count as support); the body's own cells are ignored.
  bool sleepingBodyHasSupport(Body* b, double probe) {
    double savedPy = b->py;
    b->py = savedPy + probe;
    bool supported = false;
    forEachBodyCell(b, [&](int x, int y) {
      if (supported) return;
      int k = y * cols + x; uint8_t m = grid[k];
      if (m == RIGID) { if (bodyOwner[k] != b->id) supported = true; return; }
      if (!canBodyOccupy(m, k, b->density)) supported = true; // solid terrain / dense grounded powder
    });
    b->py = savedPy;
    return supported;
  }
  int bodyDepenTolerance(Body* b) { return imax(1, (int)std::floor(imin(b->w, b->h) * 0.34)); }
  bool depenetrateBodyRaster(Body* b, double prePx, double prePy, bool hasPre) {
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
  void moveBodies() {
    if (L->bodies.empty() && L->bodyCells.empty()) return;
    computeGrounded();
    // Wake any sleeping body whose support crumbled away since it slept, so it
    // falls instead of floating. Checked before the grid cells are cleared so
    // other L->bodies still count as support; body-on-body stacks cascade (the
    // bottom body wakes and moves, then the contact solver wakes those above).
    for (Body* b : L->bodies) if (!b->awake && !sleepingBodyHasSupport(b, 1.0)) wakeBody(b);
    for (int k : L->bodyCells) { if (grid[k] == RIGID) writeGridIndex(k, EMPTY); bodyOwner[k] = -1; }
    std::unordered_map<int, std::pair<double, double>> prePoses;
    for (Body* b : L->bodies) prePoses[b->id] = {b->px, b->py};
    rigidStep(1.0);
    rigidRejectedCells = 0; rigidDepenetrations = 0;
    for (Body* b : L->bodies) { auto it = prePoses.find(b->id); bool hp = it != prePoses.end(); double ppx = hp ? it->second.first : 0, ppy = hp ? it->second.second : 0; if (depenetrateBodyRaster(b, ppx, ppy, hp)) rigidDepenetrations++; }
    std::vector<int> cells; std::unordered_set<int> footprint;
    std::unordered_map<int, std::pair<std::vector<Disp>, std::unordered_set<int>>> perBody;
    for (Body* b : L->bodies) {
      auto& pb = perBody[b->id];
      forEachBodyCell(b, [&](int x, int y) {
        int k = y * cols + x; if (bodyOwner[k] != -1) return; uint8_t m = grid[k];
        if (!canBodyOccupy(m, k, b->density)) { rigidRejectedCells++; return; }
        if (isBodyRelocatable(m, k, b->density)) pb.first.push_back({m, k});
        writeGridIndex(k, RIGID); bodyOwner[k] = b->id; cells.push_back(k); footprint.insert(k); pb.second.insert(k);
      });
    }
    for (Body* b : L->bodies) {
      auto it = perBody.find(b->id);
      if (it != perBody.end()) spillDisplacedBodyMaterial(it->second.first, footprint, it->second.second, b->density);
    }
    erodeBodies(cells);
  }
  Body* finishSpawn(const std::vector<std::pair<int, int>>& cells, uint8_t material) {
    Body* b = spawnBodyImpl(cells, material, DENSITY[material]);
    if (b && !cells.empty()) { int minX = cols - 1, minY = rows - 1, maxX = 0, maxY = 0; for (auto& c : cells) { if (c.first < minX) minX = c.first; if (c.first > maxX) maxX = c.first; if (c.second < minY) minY = c.second; if (c.second > maxY) maxY = c.second; } markDirtyRect(minX, minY, maxX, maxY); }
    return b;
  }
  Body* spawnBody(const std::vector<std::pair<int, int>>& cells) { return finishSpawn(cells, RIGID); }

  // Primitive body shapes built engine-side (no per-cell array marshalled from
  // JS). Cells are clipped to the interior, exactly like the old JS cube tool
  // (dx in [-halfW, halfW), dy in [-halfH, halfH) for the box).
  Body* spawnBox(int cx, int cy, int halfW, int halfH, uint8_t material) {
    if (material >= TABLE) material = RIGID;
    std::vector<std::pair<int, int>> cells;
    cells.reserve((size_t)imax(0, 2 * halfW) * imax(0, 2 * halfH));
    for (int dx = -halfW; dx < halfW; dx++)
      for (int dy = -halfH; dy < halfH; dy++) {
        int x = cx + dx, y = cy + dy;
        if (x >= 1 && x < cols - 1 && y >= 1 && y < rows - 1) cells.push_back({x, y});
      }
    return finishSpawn(cells, material);
  }
  Body* spawnDisc(int cx, int cy, int radius, uint8_t material) {
    if (material >= TABLE) material = RIGID;
    std::vector<std::pair<int, int>> cells;
    int r2 = radius * radius;
    for (int dy = -radius; dy <= radius; dy++)
      for (int dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        int x = cx + dx, y = cy + dy;
        if (x >= 1 && x < cols - 1 && y >= 1 && y < rows - 1) cells.push_back({x, y});
      }
    return finishSpawn(cells, material);
  }
