  auto addSlenderObbManifold = [&](Body* first, Body* second,
                                   std::vector<PenPt>& points,
                                   double& referenceX, double& referenceY) {
    if (points.empty()) return false;
    struct Frame {
      double cx, cy, ax, ay, nx, ny, halfMajor, halfMinor;
      bool slender;
    };
    auto frame = [](Body* body) {
      Frame result{};
      result.slender = rigidLargeSlenderBody(body);
      bool horizontal = body->w >= body->h;
      result.ax = horizontal ? body->cs : -body->sn;
      result.ay = horizontal ? body->sn : body->cs;
      result.nx = -result.ay;
      result.ny = result.ax;
      result.halfMajor = (horizontal ? body->w : body->h) * 0.5;
      result.halfMinor = (horizontal ? body->h : body->w) * 0.5;
      double localX = body->offsetX + (body->w - 1) * 0.5;
      double localY = body->offsetY + (body->h - 1) * 0.5;
      result.cx = body->px + localX * body->cs - localY * body->sn;
      result.cy = body->py + localX * body->sn + localY * body->cs;
      return result;
    };
    Frame a = frame(first), b = frame(second);
    if (!a.slender || !b.slender)
      return false;
    auto extent = [](const Frame& shape, double x, double y) {
      return std::fabs(x * shape.ax + y * shape.ay) * shape.halfMajor
           + std::fabs(x * shape.nx + y * shape.ny) * shape.halfMinor;
    };
    const double axes[4][2] = {
      {a.ax, a.ay}, {a.nx, a.ny}, {b.ax, b.ay}, {b.nx, b.ny},
    };
    double normalX = 0, normalY = -1, minimumOverlap = 1e18;
    for (const auto& axis : axes) {
      double delta = (a.cx - b.cx) * axis[0]
                   + (a.cy - b.cy) * axis[1];
      double overlap = extent(a, axis[0], axis[1])
                     + extent(b, axis[0], axis[1])
                     - std::fabs(delta);
      if (overlap <= 0) return false;
      if (overlap >= minimumOverlap) continue;
      minimumOverlap = overlap;
      normalX = axis[0];
      normalY = axis[1];
      if (std::fabs(delta) < 1e-6) {
        double relative = (first->vx - second->vx) * normalX
                        + (first->vy - second->vy) * normalY;
        delta = relative <= 0 ? 1 : -1;
      }
      if (delta < 0) {
        normalX = -normalX;
        normalY = -normalY;
      }
    }
    referenceX = normalX;
    referenceY = normalY;
    double deepestRaster = 0;
    for (const PenPt& point : points)
      deepestRaster = std::fmax(deepestRaster, point.depth);
    double alignment = std::fabs(a.ax * b.ax + a.ay * b.ay);
    // Crossed pairs and sparse masks keep only their raster anchors. A span
    // manifold is safe when each occupied union closely fits its local bounds.
    if (alignment < R_SLENDER_PARALLEL_COS) return true;
    if (!rigidTightSlenderBounds(first)
        || !rigidTightSlenderBounds(second)) return true;
    double tangentX = -normalY, tangentY = normalX;
    double aTangent = a.cx * tangentX + a.cy * tangentY;
    double bTangent = b.cx * tangentX + b.cy * tangentY;
    double aTangentExtent = extent(a, tangentX, tangentY);
    double bTangentExtent = extent(b, tangentX, tangentY);
    double lo = std::fmax(aTangent - aTangentExtent,
                          bTangent - bTangentExtent);
    double hi = std::fmin(aTangent + aTangentExtent,
                          bTangent + bTangentExtent);
    if (hi <= lo) return true;
    double aNormal = a.cx * normalX + a.cy * normalY;
    double bNormal = b.cx * normalX + b.cy * normalY;
    double aNormalExtent = extent(a, normalX, normalY);
    double bNormalExtent = extent(b, normalX, normalY);
    double depth = std::fmin(4.5, deepestRaster);
    double plane = ((aNormal - aNormalExtent)
                  + (bNormal + bNormalExtent)) * 0.5;
    points.push_back({
      tangentX * lo + normalX * plane,
      tangentY * lo + normalY * plane,
      normalX, normalY, depth, 0,
    });
    if (hi - lo >= 1) {
      points.push_back({
        tangentX * hi + normalX * plane,
        tangentY * hi + normalY * plane,
        normalX, normalY, depth, 0,
      });
    }
    return true;
  };
  std::vector<int>& broadphaseOrder = broadphaseOrderScratch;
  std::vector<std::pair<int, int>>& broadphasePairs = broadphasePairScratch;
  broadphaseOrder.clear();
  broadphasePairs.clear();
  if (broadphasePairs.capacity() < (size_t)n * 4)
    broadphasePairs.reserve((size_t)n * 4);
  int activeLayer = E.L == &E.fg ? 0 : 1;
  std::unordered_map<int, int> bodyIndexById;
  bodyIndexById.reserve((size_t)n * 2);
  for (int i = 0; i < n; i++) bodyIndexById[solverBodies[i]->id] = i;
  std::vector<uint8_t> broadphaseSeen(n, 0);
  for (int id : broadphaseBodyIds[activeLayer]) {
    auto it = bodyIndexById.find(id);
    if (it == bodyIndexById.end() || broadphaseSeen[it->second]) continue;
    broadphaseSeen[it->second] = 1;
    broadphaseOrder.push_back(it->second);
  }
  for (int i = 0; i < n; i++)
    if (!broadphaseSeen[i]) broadphaseOrder.push_back(i);
  ContactCache& previousContacts = contactCaches[activeLayer];
  auto& impactTicks = impactContactTicks[activeLayer];
  for (auto it = impactTicks.begin(); it != impactTicks.end();) {
    if (it->second < E.tick - R_IMPACT_SOUND_SEPARATION_TICKS)
      it = impactTicks.erase(it);
    else
      ++it;
  }
  auto& activePairAxes = pairAxes[activeLayer];
  auto bodyPairKey = [](int aId, int bId) {
    return ((uint64_t)(uint32_t)aId << 32) | (uint32_t)bId;
  };
  for (auto it = activePairAxes.begin(); it != activePairAxes.end();) {
    if (it->second.age >= 4) it = activePairAxes.erase(it);
    else {
      it->second.age++;
      ++it;
    }
  }
  auto cacheKey = [&](const Contact& contact, int normalBucket) {
    bool peerLayer = contact.b && !contact.bIntegrated
      && !contact.b->kinematic;
    return ContactCacheKey{
      contact.a->id,
      contact.b ? contact.b->id : -1,
      contact.childA,
      contact.childB,
      contact.featureA,
      contact.featureB,
      contact.a->geometryRevision,
      contact.b ? contact.b->geometryRevision : 0,
      (uint8_t)normalBucket,
      (uint8_t)(contact.b ? (peerLayer ? 1 - activeLayer : activeLayer) : 2),
      (uint8_t)(contact.a->maxR >= 24
        || (contact.b && contact.b->maxR >= 24)),
    };
  };
  auto localAnchors = [](const Contact& contact, double& lax, double& lay,
                         double& lbx, double& lby) {
    Body* A = contact.a;
    lax = contact.rax * A->cs + contact.ray * A->sn;
    lay = -contact.rax * A->sn + contact.ray * A->cs;
    lbx = lby = 0;
    if (!contact.b) return;
    Body* B = contact.b;
    double bcs = contact.bIntegrated ? B->cs : std::cos(B->angle);
    double bsn = contact.bIntegrated ? B->sn : std::sin(B->angle);
    lbx = contact.rbx * bcs + contact.rby * bsn;
    lby = -contact.rbx * bsn + contact.rby * bcs;
  };
  auto restoreContact = [&](Contact& contact, int normalBucket, double dt) {
    auto found = previousContacts.find(cacheKey(contact, normalBucket));
    if (found == previousContacts.end()) return;
    double lax, lay, lbx, lby;
    localAnchors(contact, lax, lay, lbx, lby);
    CachedContact* best = nullptr;
    double bestDistance = 1e18;
    for (CachedContact& cached : found->second) {
      if (cached.used || cached.nx * contact.nx + cached.ny * contact.ny < 0.7)
        continue;
      double dax = cached.lax - lax, day = cached.lay - lay;
      double aDistance = dax * dax + day * day;
      if (aDistance > R_CONTACT_CACHE_MATCH2) continue;
      double distance = aDistance;
      if (contact.b) {
        double dbx = cached.lbx - lbx, dby = cached.lby - lby;
        double bDistance = dbx * dbx + dby * dby;
        if (bDistance > R_CONTACT_CACHE_MATCH2) continue;
        distance += bDistance;
      }
      if (distance < bestDistance) {
        best = &cached;
        bestDistance = distance;
      }
    }
    if (!best) return;
    best->used = true;
    double dtRatio = best->dt > 0 ? dt / best->dt : 1;
    if (dtRatio < 0.25) dtRatio = 0.25;
    else if (dtRatio > 4) dtRatio = 4;
    contact.accJn = std::fmax(0.0, best->jn * dtRatio * R_WARM_START_FACTOR);
    double maxFriction = contact.staticFriction * contact.accJn;
    contact.accJt = best->jt * dtRatio * R_WARM_START_FACTOR;
    if (contact.accJt > maxFriction) contact.accJt = maxFriction;
    else if (contact.accJt < -maxFriction) contact.accJt = -maxFriction;
    contact.persisted = true;
    contact.targetVn = 0;
  };
  // Each layer owns its integration pass, but a joint body's collision shape is
  // present in both grids. Resolve owner-marked contacts against the peer's real
  // dynamics while leaving positional integration to that body's owning pass.
  std::unordered_map<int, Body*> peerBackgroundBodies;
  std::unordered_map<int, Body*> peerJointLeaders;
  if (E.bgEnabled) {
    if (E.L == &E.fg) {
      bool hasJointLeader = false;
      for (Body* body : solverBodies)
        if (body->jointRole == 1) { hasJointLeader = true; break; }
      if (hasJointLeader)
        for (Body* peer : E.bg.bodies)
          if (peer->jointRole == 0) peerBackgroundBodies[peer->id] = peer;
    } else if (!E.bg.passiveBodyIds.empty()) {
      for (Body* leader : E.fg.bodies)
        if (leader->jointRole == 1) peerJointLeaders[leader->id] = leader;
    }
  }
  auto peerDynamicBodyAt = [&](Body* body, int x, int y) -> Body* {
    if (!E.bgEnabled || x < 0 || x >= E.cols || y < 0 || y >= E.rows)
      return nullptr;
    int k = y * E.cols + x;
    if (E.L == &E.fg && body->jointRole == 1) {
      int owner = E.bg.bodyOwner[k];
      if (owner < 0 || owner == body->id
          || E.bg.passiveBodyIds.count(owner)) return nullptr;
      auto it = peerBackgroundBodies.find(owner);
      return it == peerBackgroundBodies.end() ? nullptr : it->second;
    }
    if (E.L == &E.bg && body->jointRole == 0) {
      int owner = E.bg.bodyOwner[k];
      if (owner < 0 || !E.bg.passiveBodyIds.count(owner)) return nullptr;
      auto it = peerJointLeaders.find(owner);
      return it == peerJointLeaders.end() ? nullptr : it->second;
    }
    return nullptr;
  };
  auto bodyUsesPeerContacts = [&](Body* body) {
    return (E.L == &E.fg && body->jointRole == 1
            && !peerBackgroundBodies.empty())
        || (E.L == &E.bg && body->jointRole == 0
            && !peerJointLeaders.empty());
  };
  double wpx, wpy, nx_, ny_;
  auto sweptPoint = [](Body* body, double lx, double ly, double t,
                       double& wx, double& wy) {
    double angle = body->angle + body->omega * t;
    double cs = std::cos(angle), sn = std::sin(angle);
    wx = body->px + body->vx * t + lx * cs - ly * sn;
    wy = body->py + body->vy * t + lx * sn + ly * cs;
  };
  auto insideBodyAt = [](Body* body, double wx, double wy, double t) {
    double angle = body->angle + body->omega * t;
    double cs = std::cos(angle), sn = std::sin(angle);
    double dx = wx - body->px - body->vx * t;
    double dy = wy - body->py - body->vy * t;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - body->offsetX);
    int j = (int)std::lround(ly - body->offsetY);
    if (i < 0 || i >= body->w || j < 0 || j >= body->h) return -1;
    int local = j * body->w + i;
    return body->occ[local] ? local : -1;
  };
  auto bodyNormalAtTime = [](Body* body, int idx, double wx, double wy,
                             double t, double& ox, double& oy) {
    int i = idx % body->w, j = idx / body->w;
    auto at = [&](int ii, int jj) {
      return ii < 0 || ii >= body->w || jj < 0 || jj >= body->h
        ? 0 : (int)body->occ[jj * body->w + ii];
    };
    int nlx = at(i - 1, j) - at(i + 1, j);
    int nly = at(i, j - 1) - at(i, j + 1);
    double angle = body->angle + body->omega * t;
    double cs = std::cos(angle), sn = std::sin(angle);
    if (nlx == 0 && nly == 0) {
      double dx = wx - body->px - body->vx * t;
      double dy = wy - body->py - body->vy * t;
      double lx = dx * cs + dy * sn;
      double ly = -dx * sn + dy * cs;
      int left = 1, right = 1, up = 1, down = 1;
      while (at(i - left, j)) left++;
      while (at(i + right, j)) right++;
      while (at(i, j - up)) up++;
      while (at(i, j + down)) down++;
      double dl = lx - (body->offsetX + i - left + 0.5);
      double dr = body->offsetX + i + right - 0.5 - lx;
      double du = ly - (body->offsetY + j - up + 0.5);
      double dd = body->offsetY + j + down - 0.5 - ly;
      nlx = -1; nly = 0; double nearest = dl;
      if (dr < nearest) { nearest = dr; nlx = 1; nly = 0; }
      if (du < nearest) { nearest = du; nlx = 0; nly = -1; }
      if (dd < nearest) { nlx = 0; nly = 1; }
    }
    double nx = nlx * cs - nly * sn;
    double ny = nlx * sn + nly * cs;
    double inv = 1 / std::sqrt(nx * nx + ny * ny);
    ox = nx * inv;
    oy = ny * inv;
  };
  auto needsExactAngularSweep = [](Body* body) {
    if (std::fabs(body->omega) < 1e-8) return false;
    return body->maxR >= 24;
  };
  auto pairSeparatingDirection = [](Body* first, Body* second,
                                    double& ox, double& oy) {
    bool firstSlender = rigidLargeSlenderBody(first);
    bool secondSlender = rigidLargeSlenderBody(second);
    if (firstSlender && secondSlender) {
      double firstAngle = first->angle + (first->h > first->w ? M_PI * 0.5 : 0);
      double secondAngle = second->angle + (second->h > second->w ? M_PI * 0.5 : 0);
      double fax = std::cos(firstAngle), fay = std::sin(firstAngle);
      double sax = std::cos(secondAngle), say = std::sin(secondAngle);
      double alignment = fax * sax + fay * say;
      if (alignment < 0) {
        sax = -sax;
        say = -say;
        alignment = -alignment;
      }
      if (alignment >= R_SLENDER_PARALLEL_COS) {
        double axisX = fax + sax, axisY = fay + say;
        double axisLength = std::hypot(axisX, axisY);
        if (axisLength > 1e-9) {
          axisX /= axisLength;
          axisY /= axisLength;
          ox = -axisY;
          oy = axisX;
          double projection = (first->px - second->px) * ox
                            + (first->py - second->py) * oy;
          if (std::fabs(projection) < 1e-6)
            projection = -((first->vx - second->vx) * ox
                         + (first->vy - second->vy) * oy);
          if (projection < 0) {
            ox = -ox;
            oy = -oy;
          }
          return;
        }
      }
    }
    if (firstSlender != secondSlender) {
      Body* slender = firstSlender ? first : second;
      bool horizontal = slender->w >= slender->h;
      double axisX = horizontal ? slender->cs : -slender->sn;
      double axisY = horizontal ? slender->sn : slender->cs;
      ox = -axisY;
      oy = axisX;
      double projection = (first->px - second->px) * ox
                        + (first->py - second->py) * oy;
      if (std::fabs(projection) < 1e-6)
        projection = -((first->vx - second->vx) * ox
                     + (first->vy - second->vy) * oy);
      if (projection < 0) {
        ox = -ox;
        oy = -oy;
      }
      return;
    }
    ox = first->px - second->px;
    oy = first->py - second->py;
    double length = std::hypot(ox, oy);
    if (length < 1e-9) {
      ox = 0;
      oy = -1;
    } else {
      ox /= length;
      oy /= length;
    }
  };
  struct ChildFrame {
    Body* body = nullptr;
    const BodyCollisionRect* rect = nullptr;
    int child = -1;
    double px = 0, py = 0;
    double ux = 1, uy = 0, vx = 0, vy = 1;
    double cx = 0, cy = 0, hx = 0, hy = 0;
  };
  struct ChildManifold {
    PenPt points[2];
    int count = 0;
  };
  struct ChildBounds {
    double minX = 0, minY = 0, maxX = 0, maxY = 0;
  };
  struct ChildEvent {
    double position = 0;
    int child = -1;
    bool fromA = false;
    bool start = false;
  };
  std::vector<ChildManifold> childManifoldScratch;
  std::vector<ChildFrame> currentChildFramesA, currentChildFramesB;
  std::vector<ChildFrame> nextChildFramesA, nextChildFramesB;
  std::vector<ChildBounds> childBoundsA, childBoundsB;
  std::vector<ChildEvent> childEventScratch;
  std::vector<int> activeChildrenA, activeChildrenB;
  std::vector<std::pair<int, int>> childPairScratch;
  auto collectChildFrames = [](Body* body, double time,
                               std::vector<ChildFrame>& frames) {
    frames.resize(body->collisionRects.size());
    double angle = body->angle + body->omega * time;
    double ux = std::cos(angle), uy = std::sin(angle);
    double vx = -uy, vy = ux;
    double px = body->px + body->vx * time;
    double py = body->py + body->vy * time;
    for (int child = 0; child < (int)frames.size(); child++) {
      ChildFrame& frame = frames[child];
      frame.body = body;
      frame.rect = &body->collisionRects[child];
      frame.child = child;
      frame.ux = ux;
      frame.uy = uy;
      frame.vx = vx;
      frame.vy = vy;
      frame.px = px;
      frame.py = py;
      double lx = body->offsetX
        + (frame.rect->x0 + frame.rect->x1 - 1) * 0.5;
      double ly = body->offsetY
        + (frame.rect->y0 + frame.rect->y1 - 1) * 0.5;
      frame.cx = px + lx * ux + ly * vx;
      frame.cy = py + lx * uy + ly * vy;
      frame.hx = (frame.rect->x1 - frame.rect->x0) * 0.5;
      frame.hy = (frame.rect->y1 - frame.rect->y0) * 0.5;
    }
  };
  auto childFramesOverlap = [](const ChildFrame& a, const ChildFrame& b) {
    double aExtentX = std::fabs(a.ux) * a.hx + std::fabs(a.vx) * a.hy;
    double aExtentY = std::fabs(a.uy) * a.hx + std::fabs(a.vy) * a.hy;
    double bExtentX = std::fabs(b.ux) * b.hx + std::fabs(b.vx) * b.hy;
    double bExtentY = std::fabs(b.uy) * b.hx + std::fabs(b.vy) * b.hy;
    return std::fabs(a.cx - b.cx)
             <= aExtentX + bExtentX + R_CONTACT_SKIN
        && std::fabs(a.cy - b.cy)
             <= aExtentY + bExtentY + R_CONTACT_SKIN;
  };
  auto childBoundsAtBothPoses = [&](Body* body, const ChildFrame& now,
                                    const ChildFrame& next, double dt) {
    double nowX = std::fabs(now.ux) * now.hx
                + std::fabs(now.vx) * now.hy;
    double nowY = std::fabs(now.uy) * now.hx
                + std::fabs(now.vy) * now.hy;
    double nextX = std::fabs(next.ux) * next.hx
                 + std::fabs(next.vx) * next.hy;
    double nextY = std::fabs(next.uy) * next.hx
                 + std::fabs(next.vy) * next.hy;
    double theta = std::fabs(body->omega) * dt;
    double radius = body->maxR + 0.7071067811865476;
    double rotationReach = theta >= M_PI
      ? radius * 2
      : radius * 2 * std::sin(theta * 0.5);
    double pad = rotationReach + R_CONTACT_SKIN * 0.5;
    return ChildBounds{
      std::fmin(now.cx - nowX, next.cx - nextX) - pad,
      std::fmin(now.cy - nowY, next.cy - nextY) - pad,
      std::fmax(now.cx + nowX, next.cx + nextX) + pad,
      std::fmax(now.cy + nowY, next.cy + nextY) + pad,
    };
  };
  auto childBoundsOverlap = [](const ChildBounds& a,
                               const ChildBounds& b) {
    return a.minX <= b.maxX && b.minX <= a.maxX
        && a.minY <= b.maxY && b.minY <= a.maxY;
  };
  auto collectChildPairCandidates = [&](Body* bodyA, Body* bodyB, double dt) {
    int countA = (int)bodyA->collisionRects.size();
    int countB = (int)bodyB->collisionRects.size();
    bool sweptCandidate = false;
    childPairScratch.clear();
    if ((int64_t)countA * countB <= 64) {
      for (int ai = 0; ai < countA; ai++)
        for (int bi = 0; bi < countB; bi++) {
          ChildBounds boundsA = childBoundsAtBothPoses(
            bodyA, currentChildFramesA[ai], nextChildFramesA[ai], dt);
          ChildBounds boundsB = childBoundsAtBothPoses(
            bodyB, currentChildFramesB[bi], nextChildFramesB[bi], dt);
          if (!childBoundsOverlap(boundsA, boundsB)) continue;
          sweptCandidate = true;
          if (!childFramesOverlap(currentChildFramesA[ai],
                                  currentChildFramesB[bi])
              && !childFramesOverlap(nextChildFramesA[ai],
                                     nextChildFramesB[bi]))
            continue;
          childPairScratch.push_back({ai, bi});
        }
      return sweptCandidate;
    }
    childBoundsA.resize(countA);
    childBoundsB.resize(countB);
    double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
    double totalX = 0, totalY = 0;
    auto includeBounds = [&](const ChildBounds& bounds) {
      minX = std::fmin(minX, bounds.minX);
      minY = std::fmin(minY, bounds.minY);
      maxX = std::fmax(maxX, bounds.maxX);
      maxY = std::fmax(maxY, bounds.maxY);
      totalX += bounds.maxX - bounds.minX;
      totalY += bounds.maxY - bounds.minY;
    };
    for (int ai = 0; ai < countA; ai++) {
      childBoundsA[ai] = childBoundsAtBothPoses(bodyA,
        currentChildFramesA[ai], nextChildFramesA[ai], dt);
      includeBounds(childBoundsA[ai]);
    }
    for (int bi = 0; bi < countB; bi++) {
      childBoundsB[bi] = childBoundsAtBothPoses(bodyB,
        currentChildFramesB[bi], nextChildFramesB[bi], dt);
      includeBounds(childBoundsB[bi]);
    }
    double spanX = std::fmax(1e-9, maxX - minX);
    double spanY = std::fmax(1e-9, maxY - minY);
    bool sweepX = totalX * spanY <= totalY * spanX;
    childEventScratch.clear();
    childEventScratch.reserve((size_t)(countA + countB) * 2);
    auto addEvents = [&](const std::vector<ChildBounds>& bounds, bool fromA) {
      for (int child = 0; child < (int)bounds.size(); child++) {
        double lo = sweepX ? bounds[child].minX : bounds[child].minY;
        double hi = sweepX ? bounds[child].maxX : bounds[child].maxY;
        childEventScratch.push_back({lo, child, fromA, true});
        childEventScratch.push_back({hi, child, fromA, false});
      }
    };
    addEvents(childBoundsA, true);
    addEvents(childBoundsB, false);
    std::sort(childEventScratch.begin(), childEventScratch.end(),
              [](const ChildEvent& first, const ChildEvent& second) {
      if (first.position != second.position)
        return first.position < second.position;
      if (first.start != second.start) return first.start;
      if (first.fromA != second.fromA) return first.fromA;
      return first.child < second.child;
    });
    activeChildrenA.clear();
    activeChildrenB.clear();
    auto overlapsOtherAxis = [&](const ChildBounds& a,
                                 const ChildBounds& b) {
      return sweepX
        ? a.minY <= b.maxY && b.minY <= a.maxY
        : a.minX <= b.maxX && b.minX <= a.maxX;
    };
    auto removeActive = [](std::vector<int>& active, int child) {
      auto found = std::find(active.begin(), active.end(), child);
      if (found == active.end()) return;
      *found = active.back();
      active.pop_back();
    };
    for (const ChildEvent& event : childEventScratch) {
      std::vector<int>& own = event.fromA ? activeChildrenA : activeChildrenB;
      std::vector<int>& other = event.fromA ? activeChildrenB : activeChildrenA;
      if (!event.start) {
        removeActive(own, event.child);
        continue;
      }
      for (int peer : other) {
        int ai = event.fromA ? event.child : peer;
        int bi = event.fromA ? peer : event.child;
        if (!overlapsOtherAxis(childBoundsA[ai], childBoundsB[bi]))
          continue;
        sweptCandidate = true;
        if (!childFramesOverlap(currentChildFramesA[ai],
                                currentChildFramesB[bi])
            && !childFramesOverlap(nextChildFramesA[ai],
                                   nextChildFramesB[bi]))
          continue;
        childPairScratch.push_back({ai, bi});
      }
      own.push_back(event.child);
    }
    // Sequential manifold collection is order-sensitive. Restore the original
    // child-index nesting after exact swept-AABB culling.
    std::sort(childPairScratch.begin(), childPairScratch.end());
    return sweptCandidate;
  };
  auto sweptBodyBounds = [&](Body* body, const ChildFrame& now,
                             const ChildFrame& next, double dt) {
    double localX = body->offsetX + (body->w - 1) * 0.5;
    double localY = body->offsetY + (body->h - 1) * 0.5;
    double halfX = body->w * 0.5, halfY = body->h * 0.5;
    double nowCx = now.px + localX * now.ux + localY * now.vx;
    double nowCy = now.py + localX * now.uy + localY * now.vy;
    double nextCx = next.px + localX * next.ux + localY * next.vx;
    double nextCy = next.py + localX * next.uy + localY * next.vy;
    double nowX = std::fabs(now.ux) * halfX
                + std::fabs(now.vx) * halfY;
    double nowY = std::fabs(now.uy) * halfX
                + std::fabs(now.vy) * halfY;
    double nextX = std::fabs(next.ux) * halfX
                 + std::fabs(next.vx) * halfY;
    double nextY = std::fabs(next.uy) * halfX
                 + std::fabs(next.vy) * halfY;
    double pad = (body->maxR + 0.7071067811865476)
               * std::fabs(body->omega) * dt
               + R_CONTACT_SKIN * 0.5 + 1e-9;
    return ChildBounds{
      std::fmin(nowCx - nowX, nextCx - nextX) - pad,
      std::fmin(nowCy - nowY, nextCy - nextY) - pad,
      std::fmax(nowCx + nowX, nextCx + nextX) + pad,
      std::fmax(nowCy + nowY, nextCy + nextY) + pad,
    };
  };
  auto sweptBoundsOverlap = [](const ChildBounds& a, const ChildBounds& b) {
    return a.minX <= b.maxX && b.minX <= a.maxX
        && a.minY <= b.maxY && b.minY <= a.maxY;
  };
  auto sweptObbsSeparated = [](Body* a, const ChildFrame& nowA,
                               const ChildFrame& nextA,
                               Body* b, const ChildFrame& nowB,
                               const ChildFrame& nextB, double dt) {
    struct WholeFrame {
      double cx, cy, ux, uy, vx, vy, hx, hy;
    };
    auto wholeFrame = [](Body* body, const ChildFrame& pose) {
      double localX = body->offsetX + (body->w - 1) * 0.5;
      double localY = body->offsetY + (body->h - 1) * 0.5;
      return WholeFrame{
        pose.px + localX * pose.ux + localY * pose.vx,
        pose.py + localX * pose.uy + localY * pose.vy,
        pose.ux, pose.uy, pose.vx, pose.vy,
        body->w * 0.5, body->h * 0.5,
      };
    };
    auto rotationReach = [dt](Body* body) {
      double theta = std::fabs(body->omega) * dt;
      double radius = body->maxR + 0.7071067811865476;
      return theta >= M_PI
        ? radius * 2
        : radius * 2 * std::sin(theta * 0.5);
    };
    double rotationA = rotationReach(a);
    double rotationB = rotationReach(b);
    double relativeVx = a->vx - b->vx;
    double relativeVy = a->vy - b->vy;
    auto separatedAt = [&](const WholeFrame& frameA,
                           const WholeFrame& frameB) {
      double axes[4][2] = {
        {frameA.ux, frameA.uy}, {frameA.vx, frameA.vy},
        {frameB.ux, frameB.uy}, {frameB.vx, frameB.vy},
      };
      double centerX = frameA.cx - frameB.cx;
      double centerY = frameA.cy - frameB.cy;
      for (const auto& axis : axes) {
        double extentA =
          std::fabs(axis[0] * frameA.ux + axis[1] * frameA.uy)
            * frameA.hx
          + std::fabs(axis[0] * frameA.vx + axis[1] * frameA.vy)
            * frameA.hy;
        double extentB =
          std::fabs(axis[0] * frameB.ux + axis[1] * frameB.uy)
            * frameB.hx
          + std::fabs(axis[0] * frameB.vx + axis[1] * frameB.vy)
            * frameB.hy;
        double separation =
          std::fabs(centerX * axis[0] + centerY * axis[1])
          - extentA - extentB;
        double closing =
          std::fabs(relativeVx * axis[0] + relativeVy * axis[1]) * dt
          + rotationA + rotationB + R_CONTACT_SKIN + 1e-9;
        if (separation > closing) return true;
      }
      return false;
    };
    WholeFrame currentA = wholeFrame(a, nowA);
    WholeFrame currentB = wholeFrame(b, nowB);
    if (separatedAt(currentA, currentB)) return true;
    WholeFrame endA = wholeFrame(a, nextA);
    WholeFrame endB = wholeFrame(b, nextB);
    return separatedAt(endA, endB);
  };
  auto faceNormal = [](const ChildFrame& frame, BodyCollisionFace face,
                       double& nx, double& ny) {
    if (face == BCF_LEFT) { nx = -frame.ux; ny = -frame.uy; }
    else if (face == BCF_RIGHT) { nx = frame.ux; ny = frame.uy; }
    else if (face == BCF_UP) { nx = -frame.vx; ny = -frame.vy; }
    else { nx = frame.vx; ny = frame.vy; }
  };
  auto faceForNormal = [&](const ChildFrame& frame, double nx, double ny) {
    BodyCollisionFace best = BCF_LEFT;
    double bestDot = -1e18;
    for (int fi = 0; fi < 4; fi++) {
      double fx, fy;
      faceNormal(frame, (BodyCollisionFace)fi, fx, fy);
      double dot = fx * nx + fy * ny;
      if (dot > bestDot) {
        bestDot = dot;
        best = (BodyCollisionFace)fi;
      }
    }
    return best;
  };
  auto facePoint = [](const ChildFrame& frame, BodyCollisionFace face,
                      double tangent, double& wx, double& wy) {
    double lx = 0, ly = 0;
    if (face == BCF_LEFT) {
      lx = frame.body->offsetX + frame.rect->x0 - 0.5;
      ly = tangent;
    } else if (face == BCF_RIGHT) {
      lx = frame.body->offsetX + frame.rect->x1 - 0.5;
      ly = tangent;
    } else if (face == BCF_UP) {
      lx = tangent;
      ly = frame.body->offsetY + frame.rect->y0 - 0.5;
    } else {
      lx = tangent;
      ly = frame.body->offsetY + frame.rect->y1 - 0.5;
    }
    wx = frame.px + lx * frame.ux + ly * frame.vx;
    wy = frame.py + lx * frame.uy + ly * frame.vy;
  };
  auto clipLinearRange = [](double start, double end, double lo, double hi,
                            double& u0, double& u1) {
    double delta = end - start;
    if (std::fabs(delta) < 1e-12)
      return start >= lo - 1e-9 && start <= hi + 1e-9;
    double first = (lo - start) / delta;
    double second = (hi - start) / delta;
    if (first > second) std::swap(first, second);
    u0 = std::fmax(u0, first);
    u1 = std::fmin(u1, second);
    return u1 >= u0 - 1e-9;
  };
  auto childSatManifolds = [&](const ChildFrame& a, const ChildFrame& b,
                               bool speculative) {
    struct Axis {
      double x, y;
      bool fromA;
      int order;
    };
    struct AxisCandidate {
      Axis axis;
      double overlap;
      double separation;
    };
    Axis axes[4] = {
      {a.ux, a.uy, true, 0},
      {a.vx, a.vy, true, 1},
      {b.ux, b.uy, false, 2},
      {b.vx, b.vy, false, 3},
    };
    double deltaX = a.cx - b.cx, deltaY = a.cy - b.cy;
    AxisCandidate candidates[4];
    int candidateCount = 0;
    for (const Axis& axis : axes) {
      double aExtent = std::fabs(axis.x * a.ux + axis.y * a.uy) * a.hx
                     + std::fabs(axis.x * a.vx + axis.y * a.vy) * a.hy;
      double bExtent = std::fabs(axis.x * b.ux + axis.y * b.uy) * b.hx
                     + std::fabs(axis.x * b.vx + axis.y * b.vy) * b.hy;
      double separation = deltaX * axis.x + deltaY * axis.y;
      double overlap = aExtent + bExtent + R_CONTACT_SKIN
                     - std::fabs(separation);
      if (overlap < 0) return false;
      candidates[candidateCount++] = {axis, overlap, separation};
    }
    std::sort(candidates, candidates + candidateCount,
              [](const AxisCandidate& first, const AxisCandidate& second) {
      if (first.overlap != second.overlap)
        return first.overlap < second.overlap;
      return first.axis.order < second.axis.order;
    });
    for (const AxisCandidate& candidate : candidates) {
      double minimum = candidate.overlap;
      double separation = candidate.separation;
      double normalX = candidate.axis.x;
      double normalY = candidate.axis.y;
      bool referenceA = candidate.axis.fromA;
      if (std::fabs(separation) < 1e-9) {
        double arx = a.cx - a.px, ary = a.cy - a.py;
        double brx = b.cx - b.px, bry = b.cy - b.py;
        double relativeX = (a.body->vx - a.body->omega * ary)
                         - (b.body->vx - b.body->omega * bry);
        double relativeY = (a.body->vy + a.body->omega * arx)
                         - (b.body->vy + b.body->omega * brx);
        separation = -(relativeX * candidate.axis.x
                     + relativeY * candidate.axis.y);
      }
      if (separation < 0) {
        normalX = -normalX;
        normalY = -normalY;
      }
      const ChildFrame& reference = referenceA ? a : b;
      const ChildFrame& incident = referenceA ? b : a;
      double refOutX = referenceA ? -normalX : normalX;
      double refOutY = referenceA ? -normalY : normalY;
      BodyCollisionFace refFace = faceForNormal(reference, refOutX, refOutY);
      BodyCollisionFace incFace = faceForNormal(incident, -refOutX, -refOutY);
      double refTangentX = (refFace == BCF_LEFT || refFace == BCF_RIGHT)
        ? reference.vx : reference.ux;
      double refTangentY = (refFace == BCF_LEFT || refFace == BCF_RIGHT)
        ? reference.vy : reference.uy;
      double planeX, planeY;
      facePoint(reference, refFace, 0, planeX, planeY);
      const BodyCollisionRect& refRect = *reference.rect;
      const BodyCollisionRect& incRect = *incident.rect;
      int refStart = refRect.spanStart[refFace];
      int refEnd = refStart + refRect.spanCount[refFace];
      if (refStart == refEnd) continue;
      int incStart = incRect.spanStart[incFace];
      int incEnd = incStart + incRect.spanCount[incFace];
      if (incStart == incEnd) continue;
      bool produced = false;
      for (int ii = incStart; ii < incEnd; ii++) {
        const BodyCollisionSpan& incSpan =
          incident.body->collisionSpans[ii];
        double x0, y0, x1, y1;
        facePoint(incident, incFace, incSpan.lo, x0, y0);
        facePoint(incident, incFace, incSpan.hi, x1, y1);
        double tangent0 = (x0 - reference.px) * refTangentX
                        + (y0 - reference.py) * refTangentY;
        double tangent1 = (x1 - reference.px) * refTangentX
                        + (y1 - reference.py) * refTangentY;
        double sep0 = (x0 - planeX) * refOutX + (y0 - planeY) * refOutY;
        double sep1 = (x1 - planeX) * refOutX + (y1 - planeY) * refOutY;
        double sepDelta = sep1 - sep0;
        for (int ri = refStart; ri < refEnd; ri++) {
          const BodyCollisionSpan& refSpan =
            reference.body->collisionSpans[ri];
          double u0 = 0, u1 = 1;
          if (!clipLinearRange(tangent0, tangent1,
                               refSpan.lo, refSpan.hi, u0, u1))
            continue;
          if (std::fabs(sepDelta) < 1e-12) {
            if (sep0 > R_CONTACT_SKIN) continue;
          } else {
            double crossing = (R_CONTACT_SKIN - sep0) / sepDelta;
            if (sepDelta > 0) u1 = std::fmin(u1, crossing);
            else u0 = std::fmax(u0, crossing);
            if (u1 < u0 - 1e-9) continue;
          }
          ChildManifold manifold;
          int pointCount = u1 - u0 > 1e-6 ? 2 : 1;
          for (int pi = 0; pi < pointCount; pi++) {
            double u = pi == 0 ? u0 : u1;
            double px = x0 + (x1 - x0) * u;
            double py = y0 + (y1 - y0) * u;
            double pointSeparation = sep0 + sepDelta * u;
            double satDepth = std::fmax(0.0, minimum - R_CONTACT_SKIN);
            double depth = speculative
              ? 0 : std::fmin(4.5, std::fmax(satDepth, -pointSeparation));
            px -= refOutX * pointSeparation * 0.5;
            py -= refOutY * pointSeparation * 0.5;
            PenPt point{px, py, normalX, normalY, depth};
            point.childA = a.child;
            point.childB = b.child;
            int refFeature = ((int)refFace << 24) | ri;
            int incFeature = ((int)incFace << 24) | ii;
            point.featureA = referenceA ? refFeature : incFeature;
            point.featureB = referenceA ? incFeature : refFeature;
            manifold.points[manifold.count++] = point;
          }
          childManifoldScratch.push_back(manifold);
          rigidChildManifolds++;
          produced = true;
        }
      }
      if (produced) return true;
    }
    return false;
  };
  enum ChildContactState {
    CCS_SEPARATED,
    CCS_NONE,
    CCS_SPECULATIVE,
    CCS_CURRENT,
  };
  auto collectChildContacts = [&](Body* a, Body* b, double dt) {
    childManifoldScratch.clear();
    collectChildFrames(a, 0, currentChildFramesA);
    collectChildFrames(b, 0, currentChildFramesB);
    collectChildFrames(a, dt, nextChildFramesA);
    collectChildFrames(b, dt, nextChildFramesB);
    bool sweptCandidate = collectChildPairCandidates(a, b, dt);
    bool currentContact = false;
    for (const auto& pair : childPairScratch) {
      int ai = pair.first, bi = pair.second;
      rigidChildPairs++;
      const ChildFrame& nowA = currentChildFramesA[ai];
      const ChildFrame& nowB = currentChildFramesB[bi];
      if (!childFramesOverlap(nowA, nowB)) {
        const ChildFrame& nextA = nextChildFramesA[ai];
        const ChildFrame& nextB = nextChildFramesB[bi];
        if (childFramesOverlap(nextA, nextB))
          childSatManifolds(nextA, nextB, true);
        continue;
      }
      if (childSatManifolds(nowA, nowB, false)) {
        currentContact = true;
        continue;
      }
      const ChildFrame& nextA = nextChildFramesA[ai];
      const ChildFrame& nextB = nextChildFramesB[bi];
      if (childFramesOverlap(nextA, nextB))
        childSatManifolds(nextA, nextB, true);
    }
    if (currentContact) return CCS_CURRENT;
    if (!childManifoldScratch.empty()) return CCS_SPECULATIVE;
    return sweptCandidate ? CCS_NONE : CCS_SEPARATED;
  };
  std::vector<uint8_t> activeBody(n, 0);
  std::vector<double> bodyDt(n, 0);
