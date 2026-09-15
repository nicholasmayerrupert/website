double RigidBodySystem::contactPenetrationDepth(
    Body* target, double wx, double wy, double nx, double ny,
    bool precise, bool foregroundOnly = false) {
  if (!precise) {
    double depth = 0.5, mx = wx, my = wy;
    for (int step = 0; step < 4; step++) {
      mx += nx;
      my += ny;
      if (insideBodyIndex(target, mx, my, foregroundOnly) < 0) break;
      depth += 1;
    }
    return depth;
  }
  double inside = 0, outside = 0.25;
  while (outside <= 4.5
         && insideBodyIndex(target, wx + nx * outside,
                            wy + ny * outside, foregroundOnly) >= 0) {
    inside = outside;
    outside += 0.25;
  }
  if (outside > 4.5) return 4.5;
  for (int iteration = 0; iteration < 6; iteration++) {
    double mid = (inside + outside) * 0.5;
    if (insideBodyIndex(target, wx + nx * mid, wy + ny * mid, foregroundOnly) >= 0)
      inside = mid;
    else
      outside = mid;
  }
  return outside;
}

void RigidBodySystem::collectBodySweep(
    ContactGeometry& geometry, Body* P, Body* T, double sign, double dt,
    std::vector<ContactPoint>& penAcc) {
  double nx_, ny_;
  const std::vector<float>& S = P->boundarySamples;
  const std::vector<double>& radii = P->boundarySampleRadii;
  double pm = P->sweepMargin;
  bool preciseDepth =
    P->maxR >= R_SOLVER_HUGE_BODY_RADIUS
    && T->maxR >= R_SOLVER_HUGE_BODY_RADIUS;
  bool exactAngular = geometry.needsExactAngularSweep(P)
                   || geometry.needsExactAngularSweep(T);
  double relativeLinear = exactAngular
    ? std::hypot(P->vx - T->vx, P->vy - T->vy) : 0;
  double sourceAngularSpeed = std::fabs(P->omega);
  double targetAngularSpeed = std::fabs(T->omega) * T->maxR;
  for (size_t si = 0; si + 1 < S.size(); si += 2) {
    double lx = S[si], ly = S[si + 1];
    double sx = P->px + lx * P->cs - ly * P->sn, sy = P->py + lx * P->sn + ly * P->cs;
    if (sx < T->aabbX0 - pm || sx > T->aabbX1 + pm || sy < T->aabbY0 - pm || sy > T->aabbY1 + pm) continue;
    int idx0 = insideBodyIndex(T, sx, sy);
    if (idx0 >= 0) {
      bodyNormalAt(T, idx0, sx, sy, nx_, ny_);
      penAcc.push_back({
        sx, sy, nx_ * sign, ny_ * sign,
        contactPenetrationDepth(T, sx, sy, nx_, ny_, preciseDepth), 0,
      });
      continue;
    }
    // Compact bodies use the point's tangent over this short substep.
    // Long or large rotating bodies follow their exact circular trajectory,
    // since their endpoints can depart materially from that tangent.
    if (!exactAngular) {
      double rPx = sx - P->px, rPy = sy - P->py;
      double rTx = sx - T->px, rTy = sy - T->py;
      double mvx = ((P->vx - P->omega * rPy)
                  - (T->vx - T->omega * rTy)) * dt;
      double mvy = ((P->vy + P->omega * rPx)
                  - (T->vy + T->omega * rTx)) * dt;
      double mlen = std::sqrt(mvx * mvx + mvy * mvy);
      if (mlen < 1e-9) continue;
      double dirx = mvx / mlen, diry = mvy / mlen;
      double total = mlen + R_CONTACT_SKIN;
      int steps = (int)std::ceil(total / R_SWEEP_STEP);
      if (steps < 1) steps = 1;
      for (int k = 1; k <= steps; k++) {
        double dk = total * (double)k / steps;
        if (insideBodyIndex(T, sx + dirx * dk, sy + diry * dk) < 0)
          continue;
        double miss = total * (double)(k - 1) / steps, hit = dk;
        for (int it = 0; it < 6; it++) {
          double mid = (miss + hit) * 0.5;
          if (insideBodyIndex(T, sx + dirx * mid, sy + diry * mid) >= 0)
            hit = mid;
          else
            miss = mid;
        }
        double hx = sx + dirx * hit, hy = sy + diry * hit;
        int hidx = insideBodyIndex(T, hx, hy);
        if (hidx < 0) {
          hx = sx + dirx * dk;
          hy = sy + diry * dk;
          hidx = insideBodyIndex(T, hx, hy);
        }
        if (hidx < 0) break;
        bodyNormalAt(T, hidx, hx, hy, nx_, ny_);
        penAcc.push_back({hx, hy, nx_ * sign, ny_ * sign, 0.0, 0});
        break;
      }
      continue;
    }
    double pointRadius = radii[si / 2];
    double speedBound = relativeLinear
      + sourceAngularSpeed * pointRadius
      + targetAngularSpeed;
    if (speedBound < 1e-9) continue;
    double timeEnd = dt + R_CONTACT_SKIN / speedBound;
    double total = speedBound * timeEnd;
    int steps = (int)std::ceil(total / R_SWEEP_STEP);
    if (steps < 1) steps = 1;
    for (int k = 1; k <= steps; k++) {
      double hitTime = timeEnd * (double)k / steps;
      double hx, hy;
      geometry.sweptPoint(P, lx, ly, hitTime, hx, hy);
      if (geometry.insideBodyAt(T, hx, hy, hitTime) < 0) continue;
      double missTime = timeEnd * (double)(k - 1) / steps;
      for (int it = 0; it < 7; it++) {
        double midTime = (missTime + hitTime) * 0.5;
        double mx, my;
        geometry.sweptPoint(P, lx, ly, midTime, mx, my);
        if (geometry.insideBodyAt(T, mx, my, midTime) >= 0) hitTime = midTime;
        else missTime = midTime;
      }
      geometry.sweptPoint(P, lx, ly, hitTime, hx, hy);
      int hidx = geometry.insideBodyAt(T, hx, hy, hitTime);
      if (hidx < 0) {
        hitTime = timeEnd * (double)k / steps;
        geometry.sweptPoint(P, lx, ly, hitTime, hx, hy);
        hidx = geometry.insideBodyAt(T, hx, hy, hitTime);
      }
      if (hidx < 0) break;
      geometry.bodyNormalAtTime(T, hidx, hx, hy, hitTime, nx_, ny_);
      penAcc.push_back({hx, hy, nx_ * sign, ny_ * sign, 0.0, 0});
      break;
    }
  }
}

void RigidBodySystem::collectTerrainSweep(
    ContactGeometry& geometry, bool terrainOccupancyReady, Body* b, double dt,
    std::vector<ContactPoint>& terrAcc) {
  double nx_, ny_;
  const std::vector<float>& S = b->boundarySamples;
  const std::vector<double>& radii = b->boundarySampleRadii;
  bool exactAngular = geometry.needsExactAngularSweep(b);
  double linearSpeed = std::hypot(b->vx, b->vy);
  double angularSpeed = std::fabs(b->omega);
  {
    // The complete substep sweep lies inside the current oriented bounds
    // expanded by translation, rotational point travel, contact skin, and
    // one terrain-cell corner radius. Scan only its horizontal row spans;
    // any material found still goes through the exact sample sweep below.
    double localX = b->offsetX + (b->w - 1) * 0.5;
    double localY = b->offsetY + (b->h - 1) * 0.5;
    double centerX =
      b->px + localX * b->cs - localY * b->sn
      + b->vx * dt * 0.5;
    double centerY =
      b->py + localX * b->sn + localY * b->cs
      + b->vy * dt * 0.5;
    double theta = std::fabs(b->omega) * dt;
    double radius = b->maxR + 0.7071067811865476;
    double rotationReach = theta >= M_PI
      ? radius * 2
      : radius * 2 * std::sin(theta * 0.5);
    double pad = rotationReach + R_CONTACT_SKIN
      + 0.7071067811865476 + 1e-9;
    double halfX = b->w * 0.5 + pad
      + std::fabs(b->vx * b->cs + b->vy * b->sn) * dt * 0.5;
    double halfY = b->h * 0.5 + pad
      + std::fabs(-b->vx * b->sn + b->vy * b->cs) * dt * 0.5;
    double extentX =
      std::fabs(b->cs) * halfX + std::fabs(b->sn) * halfY;
    double extentY =
      std::fabs(b->sn) * halfX + std::fabs(b->cs) * halfY;
    bool sweepInside =
      centerX - extentX >= 0 && centerY - extentY >= 0
      && centerX + extentX < E.cols
      && centerY + extentY < E.rows;
    if (!sweepInside) b->rasterMayOverlapSolid = true;
    if (sweepInside) {
      bool occupied = false;
      int y0 = imax(0, (int)std::ceil(
        centerY - extentY - 0.5 - 1e-9));
      int y1 = imin(E.rows - 1, (int)std::floor(
        centerY + extentY - 0.5 + 1e-9));
      for (int y = y0; y <= y1 && !occupied; y++) {
        double dy = y + 0.5 - centerY;
        double minX = -1e18, maxX = 1e18;
        auto clipAxis = [&](double coefficient, double constant,
                            double half) {
          if (std::fabs(coefficient) < 1e-12)
            return std::fabs(constant) <= half;
          double lo = (-half - constant) / coefficient;
          double hi = (half - constant) / coefficient;
          if (lo > hi) std::swap(lo, hi);
          minX = std::fmax(minX, centerX + lo);
          maxX = std::fmin(maxX, centerX + hi);
          return minX <= maxX + 1e-9;
        };
        if (!clipAxis(b->cs, b->sn * dy, halfX)
            || !clipAxis(-b->sn, b->cs * dy, halfY))
          continue;
        int x0 = imax(0, (int)std::ceil(minX - 0.5 - 1e-9));
        int x1 = imin(E.cols - 1,
                      (int)std::floor(maxX - 0.5 + 1e-9));
        if (x0 > x1) continue;
        const uint8_t* row = E.L->grid + y * E.cols;
        const uint8_t* peerRow = b->jointRole == 1 && b->jointPeer
          ? E.bg.grid + y * E.cols : nullptr;
        auto scanRow = [&](const uint8_t* scan) {
          int x = x0;
          for (; x + 7 <= x1; x += 8) {
            uint64_t materials = 0;
            memcpy(&materials, scan + x, sizeof(materials));
            if (materials == 0) continue;
            for (int lane = 0; lane < 8; lane++) {
              uint8_t material = scan[x + lane];
              if (material != EMPTY && !E.isGasMaterial(material)
                  && !E.isBuoyantMedium(material))
                b->rasterMayOverlapSolid = true;
              if (E.isRigidMaterialClass(material)) {
                occupied = true;
                break;
              }
            }
            if (occupied) break;
          }
          for (; x <= x1 && !occupied; x++) {
            uint8_t material = scan[x];
            if (material != EMPTY && !E.isGasMaterial(material)
                && !E.isBuoyantMedium(material))
              b->rasterMayOverlapSolid = true;
            occupied = E.isRigidMaterialClass(material);
          }
        };
        scanRow(row);
        if (!occupied && peerRow) scanRow(peerRow);
      }
      if (!occupied) return;
    }
  }
  auto solid = [&](int ix, int iy) { return ix < 0 || ix >= E.cols || iy < 0 || iy >= E.rows || isBodyTerrain(b, ix, iy, b->density); };
  auto tnorm = [&](int ix, int iy, double& ox, double& oy) {
    if (ix < 0) { ox = 1; oy = 0; return; }
    if (ix >= E.cols) { ox = -1; oy = 0; return; }
    if (iy < 0) { ox = 0; oy = 1; return; }
    if (iy >= E.rows) { ox = 0; oy = -1; return; }
    terrainNormalAt(b, ix, iy, b->density, ox, oy);
  };
  auto terrainPenetrationDepth = [&](double x, double y,
                                     double nx, double ny) {
    double inside = 0, outside = 0.25;
    while (outside <= 4.5
           && solid((int)std::floor(x + nx * outside),
                    (int)std::floor(y + ny * outside))) {
      inside = outside;
      outside += 0.25;
    }
    if (outside > 4.5) return 4.5;
    for (int iteration = 0; iteration < 6; iteration++) {
      double middle = (inside + outside) * 0.5;
      if (solid((int)std::floor(x + nx * middle),
                (int)std::floor(y + ny * middle)))
        inside = middle;
      else
        outside = middle;
    }
    return outside;
  };
  auto terrainMayOccupy = [&](double minX, double minY,
                              double maxX, double maxY) {
    if (!terrainOccupancyReady) return true;
    if (minX < 0 || minY < 0 || maxX >= E.cols || maxY >= E.rows)
      return true;
    int binX0 = (int)std::floor(minX) >> TERRAIN_RIGID_BIN_SHIFT;
    int binY0 = (int)std::floor(minY) >> TERRAIN_RIGID_BIN_SHIFT;
    int binX1 = (int)std::floor(maxX) >> TERRAIN_RIGID_BIN_SHIFT;
    int binY1 = (int)std::floor(maxY) >> TERRAIN_RIGID_BIN_SHIFT;
    for (int binY = binY0; binY <= binY1; binY++)
      for (int binX = binX0; binX <= binX1; binX++)
        if (terrainRigidBins[binY * terrainRigidBinCols + binX])
          return true;
    return false;
  };
  auto collectTerrainSample = [&](size_t sample) {
    size_t si = sample * 2;
    double lx = S[si], ly = S[si + 1];
    double sx = b->px + lx * b->cs - ly * b->sn, sy = b->py + lx * b->sn + ly * b->cs;
    double pointTravel = (linearSpeed + angularSpeed * radii[sample]) * dt
                       + R_CONTACT_SKIN;
    rigidTerrainSamples++;
    if (!terrainMayOccupy(sx - pointTravel, sy - pointTravel,
                          sx + pointTravel, sy + pointTravel)) {
      rigidTerrainSamplesSkipped++;
      return;
    }
    int cx = (int)std::floor(sx), cy = (int)std::floor(sy);
    if (solid(cx, cy)) {
      tnorm(cx, cy, nx_, ny_);
      double depth = b->maxR >= R_SOLVER_HUGE_BODY_RADIUS
        ? terrainPenetrationDepth(sx, sy, nx_, ny_)
        : 0.5;
      if (b->maxR < R_SOLVER_HUGE_BODY_RADIUS) {
        double mx = sx, my = sy;
        for (int s = 0; s < 4; s++) {
          mx += nx_;
          my += ny_;
          if (!solid((int)std::floor(mx), (int)std::floor(my))) break;
          depth += 1;
        }
      }
      terrAcc.push_back({sx, sy, nx_, ny_, depth, 0});
      return;
    }
    if (!exactAngular) {
      double rx = sx - b->px, ry = sy - b->py;
      double mvx = (b->vx - b->omega * ry) * dt;
      double mvy = (b->vy + b->omega * rx) * dt;
      double mlen = std::sqrt(mvx * mvx + mvy * mvy);
      if (mlen < 1e-9) return;
      double dirx = mvx / mlen, diry = mvy / mlen;
      double total = mlen + R_CONTACT_SKIN;
      int steps = (int)std::ceil(total / R_SWEEP_STEP);
      if (steps < 1) steps = 1;
      for (int k = 1; k <= steps; k++) {
        double dk = total * (double)k / steps;
        if (!solid((int)std::floor(sx + dirx * dk),
                   (int)std::floor(sy + diry * dk)))
          continue;
        double miss = total * (double)(k - 1) / steps, hit = dk;
        for (int it = 0; it < 6; it++) {
          double mid = (miss + hit) * 0.5;
          if (solid((int)std::floor(sx + dirx * mid),
                    (int)std::floor(sy + diry * mid)))
            hit = mid;
          else
            miss = mid;
        }
        double hx = sx + dirx * hit, hy = sy + diry * hit;
        int hxx = (int)std::floor(hx), hyy = (int)std::floor(hy);
        if (!solid(hxx, hyy)) {
          hx = sx + dirx * dk;
          hy = sy + diry * dk;
          hxx = (int)std::floor(hx);
          hyy = (int)std::floor(hy);
        }
        tnorm(hxx, hyy, nx_, ny_);
        terrAcc.push_back({hx, hy, nx_, ny_, 0.0, 0});
        break;
      }
      return;
    }
    double pointRadius = radii[sample];
    double speedBound = linearSpeed + angularSpeed * pointRadius;
    if (speedBound < 1e-9) return;
    double timeEnd = dt + R_CONTACT_SKIN / speedBound;
    double total = speedBound * timeEnd;
    int steps = (int)std::ceil(total / R_SWEEP_STEP);
    if (steps < 1) steps = 1;
    for (int k = 1; k <= steps; k++) {
      double hitTime = timeEnd * (double)k / steps;
      double hx, hy;
      geometry.sweptPoint(b, lx, ly, hitTime, hx, hy);
      if (!solid((int)std::floor(hx), (int)std::floor(hy))) continue;
      double missTime = timeEnd * (double)(k - 1) / steps;
      for (int it = 0; it < 7; it++) {
        double midTime = (missTime + hitTime) * 0.5;
        double mx, my;
        geometry.sweptPoint(b, lx, ly, midTime, mx, my);
        if (solid((int)std::floor(mx), (int)std::floor(my))) hitTime = midTime;
        else missTime = midTime;
      }
      geometry.sweptPoint(b, lx, ly, hitTime, hx, hy);
      int hxx = (int)std::floor(hx), hyy = (int)std::floor(hy);
      if (!solid(hxx, hyy)) {
        hitTime = timeEnd * (double)k / steps;
        geometry.sweptPoint(b, lx, ly, hitTime, hx, hy);
        hxx = (int)std::floor(hx);
        hyy = (int)std::floor(hy);
      }
      tnorm(hxx, hyy, nx_, ny_);
      terrAcc.push_back({hx, hy, nx_, ny_, 0.0, 0});
      break;
    }
  };
  auto collectTerrainBlock = [&](const BodyBoundarySampleBlock& block) {
    double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
    auto includeCorner = [&](double lx, double ly) {
      double x = b->px + lx * b->cs - ly * b->sn;
      double y = b->py + lx * b->sn + ly * b->cs;
      minX = std::fmin(minX, x);
      minY = std::fmin(minY, y);
      maxX = std::fmax(maxX, x);
      maxY = std::fmax(maxY, y);
    };
    includeCorner(block.minX, block.minY);
    includeCorner(block.minX, block.maxY);
    includeCorner(block.maxX, block.minY);
    includeCorner(block.maxX, block.maxY);
    double travel = (linearSpeed + angularSpeed * block.maxRadius) * dt
                  + R_CONTACT_SKIN;
    if (!terrainMayOccupy(minX - travel, minY - travel,
                          maxX + travel, maxY + travel)) {
      rigidTerrainSamples += block.count;
      rigidTerrainSamplesSkipped += block.count;
      return;
    }
    for (int sample = block.first;
         sample < block.first + block.count; sample++)
      collectTerrainSample((size_t)sample);
  };
  if (b->boundarySampleBlocks.empty()) {
    for (size_t sample = 0; sample < radii.size(); sample++)
      collectTerrainSample(sample);
  } else {
    for (const BodyBoundarySampleBlock& block : b->boundarySampleBlocks)
      collectTerrainBlock(block);
  }
}

