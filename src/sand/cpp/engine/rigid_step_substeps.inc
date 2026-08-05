  for (int sub = 0; sub < substeps; sub++) {
    for (int bi = 0; bi < n; bi++) {
      int cadence = bodySubsteps[bi];
      int before = sub * cadence / substeps;
      int after = (sub + 1) * cadence / substeps;
      activeBody[bi] = after != before;
      bodyDt[bi] = activeBody[bi] ? tickDt / cadence : 0;
      if (activeBody[bi]) rigidIslandBodySteps++;
    }
    std::fill(solidContact.begin(), solidContact.end(), 0);
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi];
      double dt = bodyDt[bi];
      b->cs = std::cos(b->angle);
      b->sn = std::sin(b->angle);
      if (!activeBody[bi]) {
        bodyBounds(b, R_CONTACT_SKIN + 0.5,
                   b->aabbX0, b->aabbY0, b->aabbX1, b->aabbY1);
        continue;
      }
      if (b->awake) b->vy += E.scaledGravity(R_GRAVITY) * dt;
      b->pvx = 0; b->pvy = 0; b->pw = 0;
      b->hadContact = liquidContact[bi] != 0;
      b->maxDepth = 0;
      if (b->awake && !b->boundaryPts.empty()) {
        // Powder support remains a local bearing-capacity model. Liquid forces
        // have already been resolved as pressure impulses by coupleLiquids.
        double powderBottomDensityArea = 0;
        for (int bp : b->boundaryPts) {
          worldPoint(b, bp, b->sn, b->cs, wpx, wpy);
          int cx = (int)std::floor(wpx), cy = (int)std::floor(wpy);
          powderBottomDensityArea += granularMediumDensityAt(cx, cy + 1);
        }
        double bodyMass = b->invMass > 0 ? 1.0 / b->invMass : 0;
        bool powderCanBear = powderBottomDensityArea * R_GRANULAR_BEARING_DEPTH
          >= bodyMass - 1e-6;
        int powderWet = 0; double powderDensitySum = 0;
        for (int bp : b->boundaryPts) {
          worldPoint(b, bp, b->sn, b->cs, wpx, wpy);
          int cx = (int)std::floor(wpx), cy = (int)std::floor(wpy);
          double pd = 0;
          if (powderCanBear) {
            pd = granularMediumDensityAt(cx, cy);
            pd = std::fmax(pd, granularMediumDensityAt(cx - 1, cy));
            pd = std::fmax(pd, granularMediumDensityAt(cx + 1, cy));
            pd = std::fmax(pd, granularMediumDensityAt(cx, cy - 1));
            pd = std::fmax(pd, granularMediumDensityAt(cx, cy + 1));
          }
          if (pd > 0) { powderWet++; powderDensitySum += pd; }
        }
        if (powderWet > 0) {
          double powderSubmerged = (double)powderWet / b->boundaryPts.size();
          double powderSupport = powderWet > 0 ? (powderDensitySum / powderWet / b->density) * powderSubmerged : 0;
          powderSupport = std::fmin(1.0, powderSupport);
          b->vy -= E.scaledGravity(R_GRAVITY) * powderSupport * dt;
          if (std::fabs(powderSupport - 1.0) <= R_GRANULAR_REST_BAND) {
            b->vy *= R_GRANULAR_REST_DAMP;
            if (std::fabs(b->vy) < R_GRANULAR_ZERO_VY) b->vy = 0;
            if (std::fabs(b->omega) < R_SETTLE_ANG) b->omega = 0;
            b->hadContact = true;
          }
          double drag = std::fmax(0.0, 1 - R_GRANULAR_DRAG * powderSubmerged);
          b->vx *= drag;
          b->vy *= drag;
          b->omega *= std::fmax(0.0, 1 - R_GRANULAR_ANG_DRAG * powderSubmerged);
        }
      }
      if (b->awake) {
        double sp2 = b->vx * b->vx + b->vy * b->vy;
        if (sp2 > R_MAX_SPEED * R_MAX_SPEED) { double s = R_MAX_SPEED / std::sqrt(sp2); b->vx *= s; b->vy *= s; }
        double wMax = R_MAX_SPEED / (b->maxR > 0 ? b->maxR : 1);
        if (b->omega > wMax) b->omega = wMax; else if (b->omega < -wMax) b->omega = -wMax;
      }
      // Expand the broad-phase AABB by this body's per-substep reach (point speed
      // travelled this substep + contact skin) so a swept sample that starts just
      // outside the static AABB but moves into the pair this substep is not pruned.
      b->sweepMargin = (std::sqrt(b->vx * b->vx + b->vy * b->vy) + std::fabs(b->omega) * (b->maxR > 0 ? b->maxR : 1)) * dt + R_CONTACT_SKIN + 0.5;
      bodyBounds(b, b->sweepMargin,
                 b->aabbX0, b->aabbY0, b->aabbX1, b->aabbY1);
      b->omegaPre = b->omega;                                  // spin entering this substep's contact solve
    }
    for (int bi = 0; bi < n; bi++) {
      currentChildPoses[bi] = childPose(solverBodies[bi], 0);
      currentChildFramesValid[bi] = 0;
      nextChildPoseDt[bi] = -1;
    }
    contacts.clear();
    previousRestoreKeyValid = false;
    // Penetration depth of a point that is already inside target T, measured by
    // marching outward along T's surface normal until it exits the mask.
    auto penDepth = [&](Body* target, double wx, double wy,
                        double nx, double ny, bool precise) {
      if (!precise) {
        double depth = 0.5, mx = wx, my = wy;
        for (int step = 0; step < 4; step++) {
          mx += nx;
          my += ny;
          if (insideBodyIndex(target, mx, my) < 0) break;
          depth += 1;
        }
        return depth;
      }
      double inside = 0, outside = 0.25;
      while (outside <= 4.5
             && insideBodyIndex(target, wx + nx * outside,
                                wy + ny * outside) >= 0) {
        inside = outside;
        outside += 0.25;
      }
      if (outside > 4.5) return 4.5;
      for (int iteration = 0; iteration < 6; iteration++) {
        double mid = (inside + outside) * 0.5;
        if (insideBodyIndex(target, wx + nx * mid, wy + ny * mid) >= 0)
          inside = mid;
        else
          outside = mid;
      }
      return outside;
    };
    // Swept body-to-body sampling: for each exposed boundary sample of P, either
    // record an existing penetration (t=0) or march the sample's per-substep
    // RELATIVE path (P's point velocity minus T's velocity at that point) through
    // T's occupancy mask and record the first impact. The contact normal is taken
    // from T's mask surface (bodyNormalAt), oriented from B toward A via `sign`,
    // never a centre-to-centre direction. This stops a sample crossing from one
    // side of a thin body to the other without generating a contact.
    auto collectSweep = [&](Body* P, Body* T, double sign, double dt) {
      const std::vector<float>& S = P->boundarySamples; double pm = P->sweepMargin;
      const std::vector<double>& radii = P->boundarySampleRadii;
      bool preciseDepth = rigidLargeSlenderBody(P)
                       && rigidLargeSlenderBody(T);
      bool exactAngular = needsExactAngularSweep(P)
                       || needsExactAngularSweep(T);
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
            penDepth(T, sx, sy, nx_, ny_, preciseDepth), 0,
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
          sweptPoint(P, lx, ly, hitTime, hx, hy);
          if (insideBodyAt(T, hx, hy, hitTime) < 0) continue;
          double missTime = timeEnd * (double)(k - 1) / steps;
          for (int it = 0; it < 7; it++) {
            double midTime = (missTime + hitTime) * 0.5;
            double mx, my;
            sweptPoint(P, lx, ly, midTime, mx, my);
            if (insideBodyAt(T, mx, my, midTime) >= 0) hitTime = midTime;
            else missTime = midTime;
          }
          sweptPoint(P, lx, ly, hitTime, hx, hy);
          int hidx = insideBodyAt(T, hx, hy, hitTime);
          if (hidx < 0) {
            hitTime = timeEnd * (double)k / steps;
            sweptPoint(P, lx, ly, hitTime, hx, hy);
            hidx = insideBodyAt(T, hx, hy, hitTime);
          }
          if (hidx < 0) break;
          bodyNormalAtTime(T, hidx, hx, hy, hitTime, nx_, ny_);
          penAcc.push_back({hx, hy, nx_ * sign, ny_ * sign, 0.0, 0});
          break;
        }
      }
    };
    // Swept body-to-grid sampling. Static cells stay terrain contacts; owner-
    // marked peer-layer cells are grouped by their dynamic body below.
    // The loaded-buffer rim counts as solid wall: a body's own motion must not
    // carry it off the simulated window (where its raster is clipped away and it
    // silently vanishes). Off-buffer cells get an inward-pointing normal so the
    // body rests against / is pushed back from the render boundary until the
    // window streams that region into view. World-stream eviction (which legitly
    // carries bodies off-buffer and persists them) is a separate path.
    auto collectTerrain = [&](Body* b, double dt) {
      bool bodyHasPeerContacts = bodyUsesPeerContacts(b);
      const std::vector<float>& S = b->boundarySamples;
      const std::vector<double>& radii = b->boundarySampleRadii;
      bool exactAngular = needsExactAngularSweep(b);
      double linearSpeed = exactAngular ? std::hypot(b->vx, b->vy) : 0;
      double angularSpeed = std::fabs(b->omega);
      if (!bodyHasPeerContacts) {
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
            int x = x0;
            for (; x + 7 <= x1; x += 8) {
              uint64_t materials = 0;
              memcpy(&materials, row + x, sizeof(materials));
              if (materials == 0) continue;
              for (int lane = 0; lane < 8; lane++) {
                uint8_t material = row[x + lane];
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
              uint8_t material = row[x];
              if (material != EMPTY && !E.isGasMaterial(material)
                  && !E.isBuoyantMedium(material))
                b->rasterMayOverlapSolid = true;
              occupied = E.isRigidMaterialClass(material);
            }
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
      for (size_t si = 0; si + 1 < S.size(); si += 2) {
        double lx = S[si], ly = S[si + 1];
        double sx = b->px + lx * b->cs - ly * b->sn, sy = b->py + lx * b->sn + ly * b->cs;
        int cx = (int)std::floor(sx), cy = (int)std::floor(sy);
        if (solid(cx, cy)) {
          tnorm(cx, cy, nx_, ny_);
          double depth = 0.5, mx = sx, my = sy;
          for (int s = 0; s < 4; s++) { mx += nx_; my += ny_; if (!solid((int)std::floor(mx), (int)std::floor(my))) break; depth += 1; }
          terrAcc.push_back({sx, sy, nx_, ny_, depth, 0});
          if (bodyHasPeerContacts)
            terrPeers.push_back(peerDynamicBodyAt(b, cx, cy));
          continue;
        }
        if (!exactAngular) {
          double rx = sx - b->px, ry = sy - b->py;
          double mvx = (b->vx - b->omega * ry) * dt;
          double mvy = (b->vy + b->omega * rx) * dt;
          double mlen = std::sqrt(mvx * mvx + mvy * mvy);
          if (mlen < 1e-9) continue;
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
            if (bodyHasPeerContacts)
              terrPeers.push_back(peerDynamicBodyAt(b, hxx, hyy));
            break;
          }
          continue;
        }
        double pointRadius = radii[si / 2];
        double speedBound = linearSpeed + angularSpeed * pointRadius;
        if (speedBound < 1e-9) continue;
        double timeEnd = dt + R_CONTACT_SKIN / speedBound;
        double total = speedBound * timeEnd;
        int steps = (int)std::ceil(total / R_SWEEP_STEP);
        if (steps < 1) steps = 1;
        for (int k = 1; k <= steps; k++) {
          double hitTime = timeEnd * (double)k / steps;
          double hx, hy;
          sweptPoint(b, lx, ly, hitTime, hx, hy);
          if (!solid((int)std::floor(hx), (int)std::floor(hy))) continue;
          double missTime = timeEnd * (double)(k - 1) / steps;
          for (int it = 0; it < 7; it++) {
            double midTime = (missTime + hitTime) * 0.5;
            double mx, my;
            sweptPoint(b, lx, ly, midTime, mx, my);
            if (solid((int)std::floor(mx), (int)std::floor(my))) hitTime = midTime;
            else missTime = midTime;
          }
          sweptPoint(b, lx, ly, hitTime, hx, hy);
          int hxx = (int)std::floor(hx), hyy = (int)std::floor(hy);
          if (!solid(hxx, hyy)) {
            hitTime = timeEnd * (double)k / steps;
            sweptPoint(b, lx, ly, hitTime, hx, hy);
            hxx = (int)std::floor(hx);
            hyy = (int)std::floor(hy);
          }
          tnorm(hxx, hyy, nx_, ny_);
          terrAcc.push_back({hx, hy, nx_, ny_, 0.0, 0});
          if (bodyHasPeerContacts)
            terrPeers.push_back(peerDynamicBodyAt(b, hxx, hyy));
          break;
        }
      }
    };
    // Reduce raw samples into a small contact manifold. Samples are bucketed by
    // quantized normal direction so materially different contact faces stay
    // separate (not blended into one diagonal normal); within each bucket the two
    // tangential extremes are kept so a long contact gets stable torque at both
    // ends. Deepest contributes to maxDepth for the sleep gate.
    auto reduceManifold = [&](std::vector<PenPt>& acc, Body* A, Body* B,
                              double fbx, double fby, double contactDt) {
      if (acc.empty()) return;
      int bIndex = B && B->idx >= 0 && B->idx < n
        && solverBodies[B->idx] == B ? B->idx : -1;
      const double Q = 8.0 / (2.0 * M_PI);
      double snx[8] = {0}, sny[8] = {0}; int cnt[8] = {0};
      bool sweptHit[8] = {false};
      bool childFeature[8] = {false};
      for (auto& p : acc) {
        int bk = ((int)std::lround(std::atan2(p.ny, p.nx) * Q)) & 7;
        p.bk = bk;
        snx[bk] += p.nx;
        sny[bk] += p.ny;
        cnt[bk]++;
        sweptHit[bk] = sweptHit[bk] || p.depth == 0;
        childFeature[bk] = childFeature[bk] || p.childA >= 0;
      }
      double Nx[8], Ny[8], tx[8], ty[8], loP[8], hiP[8]; PenPt* lo[8] = {nullptr}; PenPt* hi[8] = {nullptr};
      for (int bk = 0; bk < 8; bk++) {
        if (!cnt[bk]) continue;
        double nl = std::sqrt(snx[bk] * snx[bk] + sny[bk] * sny[bk]);
        if (nl < 1e-6) { Nx[bk] = fbx; Ny[bk] = fby; } else { Nx[bk] = snx[bk] / nl; Ny[bk] = sny[bk] / nl; }
        // Deep overlap samples can see the target's far-side faces too. For a
        // large slender body the reference follows its minor axis, so
        // longitudinal center offset does not discard a valid support face.
        // A sparse shape's first swept hit already identifies its entered local
        // face; a remote concave arm can put the body's center on the other side.
        // Terrain remains multi-sided for floor/wall corners.
        bool localSparseSweep = sweptHit[bk]
          && (!rigidTightSlenderBounds(A)
              || !rigidTightSlenderBounds(B));
        if (B && !childFeature[bk] && !localSparseSweep
            && Nx[bk] * fbx + Ny[bk] * fby < 0.5) {
          cnt[bk] = 0;
          continue;
        }
        tx[bk] = -Ny[bk]; ty[bk] = Nx[bk]; loP[bk] = 1e18; hiP[bk] = -1e18;
      }
      for (auto& p : acc) {
        int bk = p.bk;
        if (!cnt[bk]) continue;
        double pr = p.wx * tx[bk] + p.wy * ty[bk];
        if (pr < loP[bk] - 1e-9
            || (std::fabs(pr - loP[bk]) <= 1e-9
                && (!lo[bk] || p.depth > lo[bk]->depth))) {
          loP[bk] = pr;
          lo[bk] = &p;
        }
        if (pr > hiP[bk] + 1e-9
            || (std::fabs(pr - hiP[bk]) <= 1e-9
                && (!hi[bk] || p.depth > hi[bk]->depth))) {
          hiP[bk] = pr;
          hi[bk] = &p;
        }
      }
      auto push = [&](PenPt* p, int bk) {
        if (!p) return -1;
        double rax = p->wx - A->px, ray = p->wy - A->py;
        double rbx = B ? p->wx - B->px : 0, rby = B ? p->wy - B->py : 0;
        double rvx = A->vx - A->omega * ray, rvy = A->vy + A->omega * rax;
        if (B) {
          rvx -= rigidContactVx(B) - rigidContactOmega(B) * rby;
          rvy -= rigidContactVy(B) + rigidContactOmega(B) * rbx;
        }
        double impactVn = rvx * Nx[bk] + rvy * Ny[bk];
        double impactSpeed = std::max(0.0, -impactVn);
        A->recentImpactSpeed = std::fmax(
          A->recentImpactSpeed, impactSpeed);
        if (B)
          B->recentImpactSpeed = std::fmax(
            B->recentImpactSpeed, impactSpeed);
        bool softImpact = B && B->kinematic;
        double restitution = B ? R_BODY_RESTITUTION : R_TERRAIN_RESTITUTION;
        double targetVn = !softImpact && impactVn < -R_BOUNCE_MIN_SPEED ? -restitution * impactVn : 0;
        auto materialAtContact = [&](Body* body) {
          if (body->cellMaterials.empty()) return body->material;
          int local = insideBodyIndex(body, p->wx, p->wy);
          return local >= 0 ? bodyMaterialAt(body, local) : body->material;
        };
        bool icyContact = materialAtContact(A) == ICE
          || (B && materialAtContact(B) == ICE);
        if (!B) {
          int tx = (int)std::floor(p->wx), ty = (int)std::floor(p->wy);
          icyContact = icyContact || (tx >= 0 && tx < E.cols
            && ty >= 0 && ty < E.rows && E.L->grid[ty * E.cols + tx] == ICE);
        }
        double staticFriction = icyContact
          ? R_ICE_STATIC_FRICTION : R_STATIC_FRICTION;
        double dynamicFriction = icyContact
          ? R_ICE_DYNAMIC_FRICTION : R_DYNAMIC_FRICTION;
        Contact contact{
          A, B, rax, ray, rbx, rby, Nx[bk], Ny[bk], p->depth,
          p->childA, p->childB, p->featureA, p->featureB,
          (uint8_t)bk,
          bIndex >= 0, impactSpeed, targetVn,
          contactDt, staticFriction, dynamicFriction,
          0, 0, 0,
          0, 0, 0, -1, false,
        };
        restoreContact(contact, bk, contactDt);
        int contactIndex = (int)contacts.size();
        contacts.push_back(contact);
        if (p->depth > A->maxDepth) A->maxDepth = p->depth;
        if (B && p->depth > B->maxDepth) B->maxDepth = p->depth;
        return contactIndex;
      };
      for (int bk = 0; bk < 8; bk++) {
        if (!cnt[bk]) continue;
        int first = push(lo[bk], bk);
        if (hi[bk] == lo[bk]) continue;
        int second = push(hi[bk], bk);
        contacts[first].blockMate = second;
        contacts[second].blockMate = first;
      }
      A->hadContact = true;
      if (!B) A->rasterMayOverlapSolid = true;
      solidContact[A->idx] = 1;
      if (B) {
        B->hadContact = true;
        if (B->kinematic) actorContact[A->idx] = 1;
        if (bIndex >= 0) solidContact[bIndex] = 1;
      }
    };
    auto broadphaseLess = [&](int a, int b) {
      if (solverBodies[a]->aabbX0 != solverBodies[b]->aabbX0)
        return solverBodies[a]->aabbX0 < solverBodies[b]->aabbX0;
      return a < b;
    };
    // Body order is coherent across substeps and ticks. Insertion repair makes
    // the common nearly-sorted broadphase linear while preserving deterministic
    // index ordering for equal AABB starts.
    for (int i = 1; i < n; i++) {
      int value = broadphaseOrder[i];
      int j = i;
      while (j > 0 && broadphaseLess(value, broadphaseOrder[j - 1])) {
        broadphaseOrder[j] = broadphaseOrder[j - 1];
        j--;
      }
      broadphaseOrder[j] = value;
    }
    broadphasePairs.clear();
    for (int oi = 0; oi < n; oi++) {
      int a = broadphaseOrder[oi];
      Body* A = solverBodies[a];
      if (!activeBody[a]) continue;
      for (int oj = oi + 1; oj < n; oj++) {
        int b = broadphaseOrder[oj];
        Body* B = solverBodies[b];
        if (B->aabbX0 > A->aabbX1) break;
        if (!activeBody[b]) continue;
        if (A->aabbY1 < B->aabbY0 || B->aabbY1 < A->aabbY0) continue;
        broadphasePairs.push_back({imin(a, b), imax(a, b)});
      }
    }
    // Contact order is part of deterministic sequential impulse behavior.
    // Restore the original nested-loop order after sweep-and-prune culling.
    std::sort(broadphasePairs.begin(), broadphasePairs.end());
    for (const auto& pair : broadphasePairs) {
      Body* A = solverBodies[pair.first];
      Body* B = solverBodies[pair.second];
      if (!A->awake && !B->awake) continue;
      double pairDt = std::fmin(bodyDt[pair.first], bodyDt[pair.second]);
      bool aMoving = A->awake && (A->vx * A->vx + A->vy * A->vy > R_WAKE_LIN2 || A->omega * A->omega > R_WAKE_ANG2);
      bool bMoving = B->awake && (B->vx * B->vx + B->vy * B->vy > R_WAKE_LIN2 || B->omega * B->omega > R_WAKE_ANG2);
      ChildContactState childContactState =
        collectChildContacts(A, B, pairDt, pair.first, pair.second);
      if (childContactState == CCS_SEPARATED) continue;
      ChildBounds sweptA, sweptB;
      if (childContactState != CCS_CURRENT) {
        sweptA = sweptBodyBounds(
          A, (*activeCurrentChildFramesA)[0],
          (*activeNextChildFramesA)[0], pairDt);
        sweptB = sweptBodyBounds(
          B, (*activeCurrentChildFramesB)[0],
          (*activeNextChildFramesB)[0], pairDt);
        if (childContactState == CCS_NONE
            && !sweptBoundsOverlap(sweptA, sweptB))
          continue;
        if (childContactState == CCS_NONE
            && sweptObbsSeparated(
              A, (*activeCurrentChildFramesA)[0],
              (*activeNextChildFramesA)[0],
              B, (*activeCurrentChildFramesB)[0],
              (*activeNextChildFramesB)[0], pairDt)) {
          continue;
        }
      }
      uint64_t pairKey = bodyPairKey(A->id, B->id);
      auto remembered = activePairAxes.find(pairKey);
      if (remembered != activePairAxes.end()
          && (remembered->second.aRevision != A->geometryRevision
              || remembered->second.bRevision != B->geometryRevision)) {
        activePairAxes.erase(remembered);
        remembered = activePairAxes.end();
      }
      double scratchNormalX = 0, scratchNormalY = 0;
      int scratchPointCount = 0;
      for (const ChildManifold& manifold : childManifoldScratch)
        for (int pi = 0; pi < manifold.count; pi++) {
          scratchNormalX += manifold.points[pi].nx;
          scratchNormalY += manifold.points[pi].ny;
          scratchPointCount++;
        }
      double scratchNormalLength =
        std::hypot(scratchNormalX, scratchNormalY);
      bool coherentScratch = scratchPointCount > 0
        && scratchNormalLength >= scratchPointCount * 0.65;
      if (coherentScratch) {
        scratchNormalX /= scratchNormalLength;
        scratchNormalY /= scratchNormalLength;
        if (remembered == activePairAxes.end()) {
          remembered = activePairAxes.emplace(pairKey, PairAxisState{
            A->geometryRevision, B->geometryRevision,
            scratchNormalX, scratchNormalY, 0,
          }).first;
        }
      }
      if (childContactState != CCS_NONE
          && remembered != activePairAxes.end())
        remembered->second.age = 0;
      if (childContactState != CCS_CURRENT) {
        rigidSweepFallbacks++;
        penAcc.clear();
        collectSweep(A, B, 1, pairDt);
        collectSweep(B, A, -1, pairDt);
        double fbx, fby;
        bool hasSlenderObb = addSlenderObbManifold(
          A, B, penAcc, fbx, fby);
        if (!penAcc.empty()) {
          if (!A->awake && bMoving) wakeBody(A);
          if (!B->awake && aMoving) wakeBody(B);
          if (!A->awake && !B->awake) continue;
          if (!hasSlenderObb)
            pairSeparatingDirection(A, B, fbx, fby);
          reduceManifold(penAcc, A, B, fbx, fby, pairDt);
          continue;
        }
        if (childContactState == CCS_NONE) continue;
      }
      if (!A->awake && bMoving) wakeBody(A);
      if (!B->awake && aMoving) wakeBody(B);
      if (!A->awake && !B->awake) continue;
      double preferredX = 0, preferredY = 0;
      bool hasPreferredNormal = false;
      if (remembered != activePairAxes.end()) {
        preferredX = remembered->second.nx;
        preferredY = remembered->second.ny;
        hasPreferredNormal = true;
      }
      penAcc.clear();
      for (const ChildManifold& manifold : childManifoldScratch) {
        for (int pi = 0; pi < manifold.count; pi++) {
          const PenPt& point = manifold.points[pi];
          if (hasPreferredNormal
              && point.nx * preferredX + point.ny * preferredY < -0.25)
            continue;
          penAcc.push_back(point);
        }
      }
      reduceManifold(penAcc, A, B, 0, -1, pairDt);
    }
    for (int ai = 0; ai < n; ai++) {
      if (!activeBody[ai]) continue;
      Body* A = solverBodies[ai];
      for (int proxyIndex : actorProxyOrder) {
        Body* B = &actorProxies[proxyIndex].body;
        if (B->aabbX0 > A->aabbX1) break;
        if (B->aabbX1 < A->aabbX0
            || A->aabbY1 < B->aabbY0
            || B->aabbY1 < A->aabbY0)
          continue;
        double pairDt = bodyDt[ai];
        ChildContactState childContactState =
          collectChildContacts(A, B, pairDt, ai, -1);
        if (childContactState == CCS_SEPARATED) continue;
        ChildBounds sweptA, sweptB;
        if (childContactState != CCS_CURRENT) {
          sweptA = sweptBodyBounds(
            A, (*activeCurrentChildFramesA)[0],
            (*activeNextChildFramesA)[0], pairDt);
          sweptB = sweptBodyBounds(
            B, (*activeCurrentChildFramesB)[0],
            (*activeNextChildFramesB)[0], pairDt);
          if (childContactState == CCS_NONE
              && !sweptBoundsOverlap(sweptA, sweptB))
            continue;
          if (childContactState == CCS_NONE
              && sweptObbsSeparated(
                A, (*activeCurrentChildFramesA)[0],
                (*activeNextChildFramesA)[0],
                B, (*activeCurrentChildFramesB)[0],
                (*activeNextChildFramesB)[0], pairDt)) {
            continue;
          }
        }
        if (childContactState != CCS_CURRENT) {
          rigidSweepFallbacks++;
          penAcc.clear();
          collectSweep(A, B, 1, pairDt);
          collectSweep(B, A, -1, pairDt);
          double fbx, fby;
          bool hasSlenderObb = addSlenderObbManifold(
            A, B, penAcc, fbx, fby);
          if (!penAcc.empty()) {
            if (!A->awake) wakeBody(A);
            if (!hasSlenderObb)
              pairSeparatingDirection(A, B, fbx, fby);
            reduceManifold(penAcc, A, B, fbx, fby, pairDt);
            continue;
          }
          if (childContactState == CCS_NONE) continue;
        }
        if (!A->awake) wakeBody(A);
        penAcc.clear();
        for (const ChildManifold& manifold : childManifoldScratch)
          for (int pi = 0; pi < manifold.count; pi++)
            penAcc.push_back(manifold.points[pi]);
        reduceManifold(penAcc, A, B, 0, -1, pairDt);
      }
    }
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi];
      if (!activeBody[bi] || !b->awake) continue;
      double contactDt = bodyDt[bi];
      terrAcc.clear();
      terrPeers.clear();
      collectTerrain(b, contactDt);
      if (!bodyUsesPeerContacts(b)) {
        reduceManifold(terrAcc, b, nullptr, 0, -1, contactDt);
        continue;
      }
      size_t terrGroupCount = 0;
      for (size_t pi = 0; pi < terrAcc.size(); pi++) {
        const PenPt& point = terrAcc[pi];
        Body* peer = terrPeers[pi];
        auto it = std::find_if(
          terrGroups.begin(), terrGroups.begin() + terrGroupCount,
          [&](const TerrainGroup& group) { return group.peer == peer; });
        if (it == terrGroups.begin() + terrGroupCount) {
          if (terrGroupCount == terrGroups.size())
            terrGroups.push_back({nullptr, {}});
          it = terrGroups.begin() + terrGroupCount++;
          it->peer = peer;
          it->points.clear();
        }
        it->points.push_back(point);
      }
      for (size_t gi = 0; gi < terrGroupCount; gi++) {
        TerrainGroup& group = terrGroups[gi];
        Body* peer = group.peer;
        if (peer) {
          bool bodyMoving = b->awake
            && (b->vx * b->vx + b->vy * b->vy > R_WAKE_LIN2
                || b->omega * b->omega > R_WAKE_ANG2);
          bool peerMoving = peer->awake
            && (peer->vx * peer->vx + peer->vy * peer->vy > R_WAKE_LIN2
                || peer->omega * peer->omega > R_WAKE_ANG2);
          if (!b->awake && peerMoving) wakeBody(b);
          if (!peer->awake && bodyMoving) wakeBody(peer);
          if (!b->awake && !peer->awake) continue;
          double fbx, fby;
          pairSeparatingDirection(b, peer, fbx, fby);
          reduceManifold(group.points, b, peer, fbx, fby, contactDt);
        } else {
          reduceManifold(group.points, b, nullptr, 0, -1, contactDt);
        }
      }
    }
    nc = (int)contacts.size();
    if (sub + 1 == substeps) {
      for (const Contact& contact : contacts) {
        if (!contact.b || !contact.bIntegrated
            || contact.a->idx < 0 || contact.b->idx < 0)
          continue;
        terrainContactPairs.push_back({contact.a->id, contact.b->id});
      }
    }
    rigidContacts += nc;
    for (Contact& contact : contacts) {
      Body* A = contact.a;
      Body* B = contact.b;
      double aInvM = A->awake ? A->invMass : 0;
      double aInvI = A->awake ? A->invInertia : 0;
      double bInvM = B && B->awake ? B->invMass : 0;
      double bInvI = B && B->awake ? B->invInertia : 0;
      double tx = -contact.ny, ty = contact.nx;
      double rnA = contact.rax * contact.ny
                 - contact.ray * contact.nx;
      double rnB = B ? contact.rbx * contact.ny
                     - contact.rby * contact.nx : 0;
      double rtA = contact.rax * ty - contact.ray * tx;
      double rtB = B ? contact.rbx * ty - contact.rby * tx : 0;
      double normalK = aInvM + bInvM
        + aInvI * rnA * rnA + bInvI * rnB * rnB;
      double tangentK = aInvM + bInvM
        + aInvI * rtA * rtA + bInvI * rtB * rtB;
      if (!contact.bIntegrated) {
        bInvM = 0;
        bInvI = 0;
      }
      double biasK = aInvM + bInvM
        + aInvI * rnA * rnA + bInvI * rnB * rnB;
      contact.normalMass = normalK > 0 ? 1 / normalK : 0;
      contact.tangentMass = tangentK > 0 ? 1 / tangentK : 0;
      contact.biasMass = biasK > 0 ? 1 / biasK : 0;
#ifdef SAND_INVARIANT_CHECKS
      if (!std::isfinite(contact.normalMass)
          || !std::isfinite(contact.tangentMass)
          || !std::isfinite(contact.biasMass)
          || contact.normalMass < 0
          || contact.tangentMass < 0
          || contact.biasMass < 0) {
        emscripten_console_error(
          "RIGID CONTACT MASS INVARIANT: invalid effective mass");
        abort();
      }
#endif
      if (contact.depth > rigidMaxContactDepth)
        rigidMaxContactDepth = contact.depth;
      if (contact.persisted) rigidWarmStarted++;
      if (contact.persisted && (contact.accJn != 0 || contact.accJt != 0))
        applyWarmStart(contact);
    }
    for (const Contact& contact : contacts) {
      uint32_t aId = (uint32_t)contact.a->id;
      uint32_t bId = contact.b ? (uint32_t)contact.b->id : UINT32_MAX;
      if (contact.b && bId < aId) std::swap(aId, bId);
      uint64_t soundKey = ((uint64_t)aId << 32) | bId;
      auto previous = impactTicks.find(soundKey);
      bool contactStarted = previous == impactTicks.end()
        || previous->second < E.tick - R_IMPACT_SOUND_SEPARATION_TICKS;
      impactTicks[soundKey] = E.tick;
      bool fluidImpact = liquidContact[contact.a->idx]
        || (contact.b && contact.b->idx >= 0 && contact.b->idx < n
            && liquidContact[contact.b->idx]);
      double audibleSpeed = fluidImpact
        ? R_FLUID_IMPACT_SOUND_MIN_SPEED : R_BOUNCE_MIN_SPEED;
      if (!contactStarted || contact.impactSpeed < audibleSpeed)
        continue;
      E.audio.emit(
        SE_IMPACT, contact.a->px, contact.a->py,
        std::min(1.8, 0.25 + contact.impactSpeed * 0.55),
        contact.a->material);
    }
    solveParent = stepIslandParent;
    for (const Contact& contact : contacts)
      if (contact.b && contact.bIntegrated)
        ufUnite(solveParent, contact.a->idx, contact.b->idx);
    std::fill(solveBodyCount.begin(), solveBodyCount.end(), 0);
    std::fill(solveMaxRadius.begin(), solveMaxRadius.end(), 0);
    std::fill(solveMinX.begin(), solveMinX.end(), 1e18);
    std::fill(solveMinY.begin(), solveMinY.end(), 1e18);
    std::fill(solveMaxX.begin(), solveMaxX.end(), -1e18);
    std::fill(solveMaxY.begin(), solveMaxY.end(), -1e18);
    std::fill(solveShockKey.begin(), solveShockKey.end(),
      E.L == &E.bg ? 0xcbf29ce484222325ULL : 0x84222325cbf29ce4ULL);
    std::fill(solveHasGeneral.begin(), solveHasGeneral.end(), 0);
    for (int bi = 0; bi < n; bi++) {
      int root = ufFind(solveParent, bi);
      Body* body = solverBodies[bi];
      solveBodyCount[root]++;
      solveMaxRadius[root] = std::fmax(solveMaxRadius[root], body->maxR);
      solveMinX[root] = std::fmin(solveMinX[root], body->aabbX0);
      solveMinY[root] = std::fmin(solveMinY[root], body->aabbY0);
      solveMaxX[root] = std::fmax(solveMaxX[root], body->aabbX1);
      solveMaxY[root] = std::fmax(solveMaxY[root], body->aabbY1);
      solveShockKey[root] ^= (uint32_t)body->id;
      solveShockKey[root] *= 0x100000001b3ULL;
      if (!body->blastDebris) solveHasGeneral[root] = 1;
    }
    contactOrder.resize(nc);
    contactRoot.resize(nc);
    for (int ci = 0; ci < nc; ci++) {
      contactOrder[ci] = ci;
      contactRoot[ci] = ufFind(solveParent, contacts[ci].a->idx);
    }
    std::sort(contactOrder.begin(), contactOrder.end(), [&](int a, int b) {
        if (contactRoot[a] != contactRoot[b])
          return contactRoot[a] < contactRoot[b];
        double ay = contacts[a].a->py + contacts[a].ray;
        double by = contacts[b].a->py + contacts[b].ray;
        if (ay != by) return ay > by;
        return a < b;
    });
    for (int islandStart = 0; islandStart < nc;) {
      int root = contactRoot[contactOrder[islandStart]];
      int islandEnd = islandStart + 1;
      while (islandEnd < nc
             && contactRoot[contactOrder[islandEnd]] == root)
        islandEnd++;
      int solverIters = R_BLAST_DEBRIS_SOLVER_ITERS;
      if (solveHasGeneral[root]) {
        solverIters = R_SOLVER_BASE_ITERS
          + R_SOLVER_ITERS_PER_BODY * solveBodyCount[root];
        if (solveMaxRadius[root] >= 24)
          solverIters = imax(solverIters, R_SOLVER_LARGE_BODY_ITERS);
        solverIters = imin(R_SOLVER_ITERS, solverIters);
      }
      bool hasImpactTarget = false;
      for (int oi = islandStart; oi < islandEnd; oi++)
        if (contacts[contactOrder[oi]].targetVn > 0) {
          hasImpactTarget = true;
          break;
        }
      if (hasImpactTarget) solverIters = R_SOLVER_ITERS;
      auto solveVelocity = [&](int ci) {
        Contact& contact = contacts[ci];
        int mate = contact.blockMate;
        if (mate >= 0)
          return ci < mate ? resolveContactBlock(contact, contacts[mate]) : 0.0;
        return resolveContact(contact);
      };
      auto contactVelocityResidual = [&](const Contact& contact) {
        Body* A = contact.a;
        Body* B = contact.b;
        double rvx = A->vx - A->omega * contact.ray;
        double rvy = A->vy + A->omega * contact.rax;
        if (B) {
          rvx -= rigidContactVx(B) - rigidContactOmega(B) * contact.rby;
          rvy -= rigidContactVy(B) + rigidContactOmega(B) * contact.rbx;
        }
        double vn = rvx * contact.nx + rvy * contact.ny;
        double normalResidual = contact.accJn > 1e-12
          ? std::fabs(contact.targetVn - vn)
          : std::fmax(0.0, contact.targetVn - vn);
        double tx = -contact.ny, ty = contact.nx;
        double vt = rvx * tx + rvy * ty;
        double coefficient = std::fabs(vt) <= R_STATIC_FRICTION_SPEED
          ? contact.staticFriction : contact.dynamicFriction;
        double limit = coefficient * contact.accJn;
        double tangentResidual = 0;
        if (limit > 1e-12) {
          if (contact.accJt >= limit - 1e-12)
            tangentResidual = std::fmax(0.0, vt);
          else if (contact.accJt <= -limit + 1e-12)
            tangentResidual = std::fmax(0.0, -vt);
          else
            tangentResidual = std::fabs(vt);
        }
        return std::fmax(normalResidual, tangentResidual);
      };
      auto contactBiasResidual = [&](const Contact& contact) {
        double slop = rigidContactSlop(contact);
        double bias = R_BAUMGARTE
          * std::fmax(0.0, contact.depth - slop);
        bias = std::fmin(bias, R_MAX_BIAS_VEL);
        double rvx = contact.a->pvx - contact.a->pw * contact.ray;
        double rvy = contact.a->pvy + contact.a->pw * contact.rax;
        if (contact.b && contact.bIntegrated) {
          rvx -= contact.b->pvx - contact.b->pw * contact.rby;
          rvy -= contact.b->pvy + contact.b->pw * contact.rbx;
        }
        double vn = rvx * contact.nx + rvy * contact.ny;
        return contact.accBias > 1e-12
          ? std::fabs(bias - vn) : std::fmax(0.0, bias - vn);
      };
      bool shockVelocityConverged = false;
      uint64_t shockIslandKey = solveShockKey[root];
      bool shockAspectEligible = solveBodyCount[root] >= 8
        && solveMaxY[root] - solveMinY[root]
          >= solveMaxX[root] - solveMinX[root];
      bool shockAttemptAllowed = true;
      if (solverMode >= 2) {
        auto previousAttempt = shockAttemptCache.find(shockIslandKey);
        if (previousAttempt != shockAttemptCache.end()
            && previousAttempt->second.retryTick > E.tick) {
          shockAttemptAllowed = false;
          previousAttempt->second.lastTick = E.tick;
          rigidShockSkipped++;
        }
      }
      if (solverMode >= 2 && !hasImpactTarget && solveBodyCount[root] >= 4
          && !E.L->forceActive && shockAttemptAllowed && shockAspectEligible) {
#include "rigid_step_shock.inc"
      }
      // The first passes run from the lowest contact upward so support impulses
      // propagate through tall stacks promptly. Later passes alternate direction
      // to remove a permanent ordering bias.
      for (int it = 0; it < solverIters && !shockVelocityConverged; it++) {
        rigidVelocityIterations++;
        rigidVelocityConstraintEvals += islandEnd - islandStart;
        double moved = 0;
        bool bottomUp = it < R_SHOCK_ORDER_ITERS || !(it & 1);
        if (bottomUp) {
          for (int oi = islandStart; oi < islandEnd; oi++)
            moved += solveVelocity(contactOrder[oi]);
        } else {
          for (int oi = islandEnd - 1; oi >= islandStart; oi--)
            moved += solveVelocity(contactOrder[oi]);
        }
        if (moved == 0.0) break;
        if (solverMode > 0 && it + 1 >= solverMinIterations
            && ((it + 1 - solverMinIterations) & 1) == 0) {
          double residual = 0;
          for (int oi = islandStart; oi < islandEnd; oi++)
            residual = std::fmax(residual, contactVelocityResidual(
              contacts[contactOrder[oi]]));
          if (residual <= solverResidualTolerance) break;
        }
      }
      for (int oi = islandStart; oi < islandEnd; oi++)
        rigidMaxVelocityResidual = std::fmax(
          rigidMaxVelocityResidual,
          contactVelocityResidual(contacts[contactOrder[oi]]));
      for (int it = 0; it < solverIters; it++) {
        rigidBiasIterations++;
        rigidBiasConstraintEvals += islandEnd - islandStart;
        double moved = 0;
        bool bottomUp = it < R_SHOCK_ORDER_ITERS || !(it & 1);
        if (bottomUp) {
          for (int oi = islandStart; oi < islandEnd; oi++)
            moved += resolveBias(contacts[contactOrder[oi]]);
        } else {
          for (int oi = islandEnd - 1; oi >= islandStart; oi--)
            moved += resolveBias(contacts[contactOrder[oi]]);
        }
        if (moved == 0.0) break;
        if (solverMode > 0 && it + 1 >= solverMinIterations
            && ((it + 1 - solverMinIterations) & 1) == 0) {
          double residual = 0;
          for (int oi = islandStart; oi < islandEnd; oi++)
            residual = std::fmax(residual, contactBiasResidual(
              contacts[contactOrder[oi]]));
          if (residual <= solverResidualTolerance) break;
        }
      }
      for (int oi = islandStart; oi < islandEnd; oi++) {
        const Contact& contact = contacts[contactOrder[oi]];
        rigidMaxBiasResidual = std::fmax(
          rigidMaxBiasResidual, contactBiasResidual(contact));
        double slop = rigidContactSlop(contact);
        rigidMaxPenetrationResidual = std::fmax(
          rigidMaxPenetrationResidual,
          std::fmax(0.0, contact.depth - slop));
      }
      islandStart = islandEnd;
    }
    for (const Contact& contact : contacts) {
      auto proxy = actorProxyIndex.find(contact.b);
      if (proxy == actorProxyIndex.end() || contact.ny >= -0.35)
        continue;
      actorProxies[proxy->second].crushImpulse +=
        contact.accJn * -contact.ny;
    }
    ContactCache& nextContacts = nextContactCacheScratch;
    nextContacts.clear();
    nextContacts.reserve(previousContacts.size());
    for (const Contact& contact : contacts) {
      double lax, lay, lbx, lby;
      localAnchors(contact, lax, lay, lbx, lby);
      nextContacts[cacheKey(contact, contact.normalBucket)].push_back({
        lax, lay, lbx, lby, contact.nx, contact.ny,
        contact.accJn, contact.accJt, contact.dt, 0, false,
      });
    }
    // A raster contact can disappear for one substep while a long or slowly
    // rotating face crosses a cell boundary. Retain unmatched anchors briefly
    // with decaying impulses so the manifold reconnects without a cold solve.
    for (auto& entry : previousContacts) {
      for (CachedContact cached : entry.second) {
        auto bodyIt = bodyIndexById.find(entry.first.aId);
        bool activeKey = bodyIt != bodyIndexById.end()
          && activeBody[bodyIt->second];
        if (!activeKey) {
          cached.used = false;
          nextContacts[entry.first].push_back(cached);
          continue;
        }
        if (!entry.first.retainMissed) continue;
        if (cached.used || cached.age >= R_CONTACT_CACHE_MISSED_SUBSTEPS)
          continue;
        std::vector<CachedContact>& destination = nextContacts[entry.first];
        if ((int)destination.size() >= R_CONTACT_CACHE_MAX_PER_KEY) break;
        cached.age++;
        cached.jn *= R_CONTACT_CACHE_STALE_DECAY;
        cached.jt *= R_CONTACT_CACHE_STALE_DECAY;
        cached.used = false;
        destination.push_back(cached);
      }
    }
    previousContacts.swap(nextContacts);
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi];
      if (!activeBody[bi] || !b->awake) continue;
      double dt = bodyDt[bi];
      b->px += (b->vx + b->pvx) * dt;
      b->py += (b->vy + b->pvy) * dt;
      b->angle += (b->omega + b->pw) * dt;
      // Granular support is sampled as a medium rather than a terrain contact.
      // Near rest, confirm the body has powder beneath its bottom edge so an
      // exact zero-velocity equilibrium can sleep instead of remaining an awake
      // solver participant forever.
      bool looseContact = false;
      if (b->vx * b->vx + b->vy * b->vy < R_SLEEP_LIN * R_SLEEP_LIN
          && b->omega * b->omega < R_SLEEP_ANG * R_SLEEP_ANG
          && !liquidContact[bi]
          && bodyHasLooseSupport(b)) {
        b->hadContact = true;
        looseContact = true;
      }
      if (!b->hadContact) { b->stillTicks = 0; continue; }
      bool frictionalContact = solidContact[bi] || looseContact;
      if (frictionalContact
          && b->vx * b->vx + b->vy * b->vy < R_SETTLE_LIN * R_SETTLE_LIN) {
        b->vx *= R_CONTACT_LIN_DAMP;
        b->vy *= R_CONTACT_LIN_DAMP;
      }
      // Don't damp a spin the contact solve is actively building in one direction
      // (a body toppling about a corner): that is real rotation, not jitter, and
      // damping it every substep is what made hand-drawn bodies creep over
      // agonizingly slowly instead of tipping. Rest jitter oscillates sign / decays
      // (omega*omegaPre <= 0 or |omega| not growing) and is still damped, so bodies
      // whose centre of mass sits over their support stay put and settle as before.
      bool spinGrowing = b->omega * b->omegaPre > 0 && std::fabs(b->omega) > std::fabs(b->omegaPre);
      if (frictionalContact && !spinGrowing
          && b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG) {
        b->omega *= R_CONTACT_ANG_DAMP;
        int shortSide = imin(b->w, b->h);
        int longSide = imax(b->w, b->h);
        if (shortSide > 0 && longSide < shortSide * 2
            && std::fabs(b->omega) < R_CONTACT_ZERO_SQUAT_ANG)
          b->omega = 0;
      }
      bool fluidOnlyContact = liquidContact[bi] && !frictionalContact;
      bool fluidRestContact = liquidSurfaceContact[bi]
                           || liquidDensityEquilibrium[bi];
      fluidOnlySleep[bi] =
        fluidOnlyContact && !liquidDensityEquilibrium[bi] ? 1 : 0;
      if (fluidOnlyContact && liquidDensityEquilibrium[bi]
          && b->vx * b->vx + b->vy * b->vy
               < R_BOUNCE_MIN_SPEED * R_BOUNCE_MIN_SPEED
          && std::fabs(b->omega) < R_SETTLE_ANG * 2) {
        b->vx *= 0.25;
        b->vy *= 0.25;
        b->omega *= 0.25;
      }
      // Dissipate residual vertical surface waves once the body is already
      // inside the ordinary settling band; translation and spin stay physical
      // at larger speeds.
      if (fluidOnlyContact && fluidRestContact
          && std::fabs(b->vy) < R_SETTLE_LIN
          && b->maxDepth <= R_REST_DEPTH) {
        b->vy *= R_FLUID_REST_DAMP;
        int shortSide = imin(b->w, b->h);
        int longSide = imax(b->w, b->h);
        if (shortSide > 0 && longSide >= shortSide * 8
            && std::fabs(b->vx) < R_SETTLE_LIN
            && std::fabs(b->omega) < R_SETTLE_ANG) {
          b->vx *= R_FLUID_SLENDER_REST_DAMP;
          b->vy *= R_FLUID_SLENDER_REST_DAMP;
          b->omega *= R_FLUID_REST_DAMP;
        }
      }
      double sleepLinear = liquidContact[bi]
        ? R_FLUID_SLEEP_LIN : R_SLEEP_LIN;
      bool sleepQuiet = b->vx * b->vx + b->vy * b->vy < sleepLinear * sleepLinear
                     && b->omega * b->omega < R_SLEEP_ANG * R_SLEEP_ANG
                     && b->maxDepth <= R_REST_DEPTH;
      if (actorContact[bi]) sleepQuiet = false;
      if (fluidOnlyContact && !fluidRestContact) sleepQuiet = false;
      if (sleepQuiet) {
        b->stillTicks++;
      } else if (fluidOnlyContact) {
        b->stillTicks = fluidRestContact
          ? imax(0, b->stillTicks - 1)
          : 0;
      } else {
        bool settling = b->vx * b->vx + b->vy * b->vy < R_SETTLE_LIN * R_SETTLE_LIN
                     && b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG
                     && b->maxDepth <= R_REST_DEPTH;
        b->stillTicks = settling ? std::fmax(0.0, b->stillTicks - 1.0) : 0;
      }
    }
    // The velocity solve prevents ordinary tunnelling. If a sustained spatial
    // force still leaves an already-contacting body pair slightly overlapped,
    // project only those pairs at their integrated poses. This cold path keeps
    // rasterized ownership unique without changing ordinary pile settling.
    positionPairs.clear();
    if (E.L->forceActive) {
      spatialForceIsland.assign(n, 0);
      bool hasForceDrivenIsland = false;
      for (int bi = 0; bi < n; bi++) {
        if (!solverBodies[bi]->spatialForceApplied) continue;
        spatialForceIsland[ufFind(solveParent, bi)] = 1;
        hasForceDrivenIsland = true;
      }
      if (hasForceDrivenIsland) {
        terrainAnchored.assign(n, 0);
        for (const Contact& contact : contacts) {
          int root = ufFind(solveParent, contact.a->idx);
          if (!spatialForceIsland[root]) continue;
          if (!contact.b) {
            if (contact.depth > 0)
              terrainAnchored[contact.a->idx] = 1;
            continue;
          }
          if (!contact.bIntegrated) continue;
          int a = contact.a->idx, b = contact.b->idx;
          positionPairs.push_back({imin(a, b), imax(a, b)});
        }
      }
    }
    if (!positionPairs.empty()) {
      std::sort(positionPairs.begin(), positionPairs.end());
      positionPairs.erase(
        std::unique(positionPairs.begin(), positionPairs.end()),
        positionPairs.end());
      for (int iteration = 0; iteration < R_BODY_POSITION_ITERS; iteration++) {
        bool corrected = false;
        for (const auto& pair : positionPairs) {
          Body* A = solverBodies[pair.first];
          Body* B = solverBodies[pair.second];
          currentChildPoses[pair.first] = childPose(A, 0);
          currentChildPoses[pair.second] = childPose(B, 0);
          currentChildFramesValid[pair.first] = 0;
          currentChildFramesValid[pair.second] = 0;
          nextChildPoseDt[pair.first] = -1;
          nextChildPoseDt[pair.second] = -1;
          if (collectChildContacts(
                A, B, 0, pair.first, pair.second) != CCS_CURRENT)
            continue;
          PenPt deepest{};
          bool hasPenetration = false;
          for (const ChildManifold& manifold : childManifoldScratch) {
            for (int pi = 0; pi < manifold.count; pi++) {
              const PenPt& point = manifold.points[pi];
              if (point.depth <= 0
                  || (hasPenetration && point.depth <= deepest.depth))
                continue;
              deepest = point;
              hasPenetration = true;
            }
          }
          if (!hasPenetration) continue;
          double aInvM = A->awake && !terrainAnchored[pair.first]
            ? A->invMass : 0;
          double aInvI = A->awake && !terrainAnchored[pair.first]
            ? A->invInertia : 0;
          double bInvM = B->awake && !terrainAnchored[pair.second]
            ? B->invMass : 0;
          double bInvI = B->awake && !terrainAnchored[pair.second]
            ? B->invInertia : 0;
          double rax = deepest.wx - A->px, ray = deepest.wy - A->py;
          double rbx = deepest.wx - B->px, rby = deepest.wy - B->py;
          double aCross = rax * deepest.ny - ray * deepest.nx;
          double bCross = rbx * deepest.ny - rby * deepest.nx;
          double inverseMass = aInvM + bInvM
            + aCross * aCross * aInvI + bCross * bCross * bInvI;
          if (inverseMass <= 1e-12) continue;
          double impulse =
            (deepest.depth + R_BODY_RASTER_CLEARANCE) / inverseMass;
          A->px += deepest.nx * impulse * aInvM;
          A->py += deepest.ny * impulse * aInvM;
          A->angle += aCross * impulse * aInvI;
          B->px -= deepest.nx * impulse * bInvM;
          B->py -= deepest.ny * impulse * bInvM;
          B->angle -= bCross * impulse * bInvI;
          rigidPositionCorrections++;
          corrected = true;
        }
        if (!corrected) break;
      }
      for (const auto& pair : positionPairs) {
        Body* A = solverBodies[pair.first];
        Body* B = solverBodies[pair.second];
        A->cs = std::cos(A->angle);
        A->sn = std::sin(A->angle);
        B->cs = std::cos(B->angle);
        B->sn = std::sin(B->angle);
        if (A->jointRole == 1) syncJointFollower(A);
        if (B->jointRole == 1) syncJointFollower(B);
      }
    }
  }
