// Free rigid bodies and component-to-body conversion.
//
// Components are grid-anchored while bodies are moving entities. This file owns
// body geometry, integration, collision sampling, and stamping settled bodies
// back into component-aware grid state.
static bool rigidLargeSlenderBody(const Body* body) {
  int shortSide = imax(1, imin(body->w, body->h));
  return imax(body->w, body->h) >= shortSide * 4 && body->maxR >= 24;
}

static bool rigidStructureScaleBody(const Body* body) {
  return body->maxR >= R_EXACT_RASTER_BODY_RADIUS
    || body->nPts >= R_EXACT_RASTER_BODY_CELLS;
}

static bool rigidTightSlenderBounds(const Body* body) {
  return body->tightSlenderBounds;
}

static bool rigidWorldBridgeMode(int mode) {
  return mode == 5 || mode == 13 || mode == 14
    || mode == 15 || mode == 16
    || (mode >= 18 && mode <= 23) || mode == 25
    || mode == 27 || mode == 28 || mode == 30 || mode == 31
    || mode == 32 || mode == 33 || mode == 34 || mode == 35
    || mode == 36 || mode == 37 || mode == 38 || mode == 39
    || mode == 40 || mode == 42 || mode == 43 || mode == 44
    || mode == 45 || mode == 46;
}

static bool rigidPreciseContact(const Contact& contact) {
  return contact.a->jointRole == 1
    || (contact.b && (!contact.bIntegrated
      || contact.b->jointRole == 1
      || (rigidLargeSlenderBody(contact.a)
        && rigidLargeSlenderBody(contact.b))));
}

static double rigidContactSlop(const Contact& contact) {
  if (!contact.b && contact.a->jointRole == 1) {
    double pointSpeed = std::hypot(contact.a->vx, contact.a->vy)
      + std::fabs(contact.a->omega) * contact.a->maxR;
    if (pointSpeed < R_SETTLE_LIN) return R_PEN_SLOP;
  }
  return rigidPreciseContact(contact) ? R_BODY_PEN_SLOP : R_PEN_SLOP;
}

static double rigidContactVx(const Body* body) {
  return body->kinematic ? body->kinematicVx : body->vx;
}

static double rigidContactVy(const Body* body) {
  return body->kinematic ? body->kinematicVy : body->vy;
}

static double rigidContactOmega(const Body* body) {
  return body->kinematic ? body->kinematicOmega : body->omega;
}

bool RigidBodySystem::bodyFullyInsideLoadedWindow(Body* body) const {
  if (!E.L->infinite) return true;
  double cs = std::cos(body->angle), sn = std::sin(body->angle);
  constexpr double edgeTolerance = 1e-7;
  for (const BodyCollisionRect& rect : body->collisionRects) {
    double lx0 = body->offsetX + rect.x0 - 0.5;
    double lx1 = body->offsetX + rect.x1 - 0.5;
    double ly0 = body->offsetY + rect.y0 - 0.5;
    double ly1 = body->offsetY + rect.y1 - 0.5;
    auto inside = [&](double lx, double ly) {
      double x = body->px + lx * cs - ly * sn;
      double y = body->py + lx * sn + ly * cs;
      return x >= -edgeTolerance && x <= E.cols + edgeTolerance
          && y >= -edgeTolerance && y <= E.rows + edgeTolerance;
    };
    if (!inside(lx0, ly0) || !inside(lx1, ly0)
        || !inside(lx1, ly1) || !inside(lx0, ly1))
      return false;
  }
  return true;
}

void RigidBodySystem::clearContactCaches() {
  for (ContactCache& cache : contactCaches) cache.clear();
  for (auto& contacts : impactContactTicks) contacts.clear();
  for (auto& axes : pairAxes) axes.clear();
  shockAttemptCache.clear();
  for (std::vector<int>& ids : broadphaseBodyIds) ids.clear();
  worldContacts.clear();
  worldHasPeerContact = false;
}

void RigidBodySystem::captureTracePose(int stage) {
  if (rigidTraceLayer < 0 || stage < 0
      || stage >= (int)rigidTracePoses.size())
    return;
  Layer& layer = rigidTraceLayer ? E.bg : E.fg;
  for (Body* body : layer.bodies) {
    if (body->id != rigidTraceBodyId) continue;
    rigidTracePoses[stage] = {body->px, body->py, body->angle};
    rigidTracePoseMask |= 1u << stage;
    return;
  }
}

void RigidBodySystem::beginWorldContactRelax() {
  if (solverMode == 46 && !worldContacts.empty()) {
    auto key = [](int layer, int id) {
      return ((uint64_t)(uint32_t)layer << 32) | (uint32_t)id;
    };
    std::unordered_map<uint64_t, Body*> bodies;
    bodies.reserve(E.fg.bodies.size() + E.bg.bodies.size());
    for (Body* body : E.fg.bodies)
      if (body->jointRole != 2) bodies[key(0, body->id)] = body;
    for (Body* body : E.bg.bodies)
      if (body->jointRole == 0) bodies[key(1, body->id)] = body;
    std::vector<Body*> indexed;
    std::unordered_map<Body*, int> indices;
    auto indexBody = [&](Body* body) {
      auto found = indices.find(body);
      if (found != indices.end()) return found->second;
      int index = (int)indexed.size();
      indexed.push_back(body);
      indices[body] = index;
      return index;
    };
    struct PreBiasConstraint {
      int a = -1, b = -1;
      double nx = 0, ny = 0;
      double rax = 0, ray = 0, rbx = 0, rby = 0;
      double aInvM = 0, aInvI = 0, bInvM = 0, bInvI = 0;
      double bias = 0, mass = 0, impulse = 0;
    };
    std::vector<PreBiasConstraint> constraints;
    constraints.reserve(worldContacts.size());
    auto anchor = [](Body* body, double lx, double ly,
                     double& rx, double& ry) {
      double cs = std::cos(body->angle), sn = std::sin(body->angle);
      rx = lx * cs - ly * sn;
      ry = lx * sn + ly * cs;
    };
    for (const WorldContact& contact : worldContacts) {
      if (contact.bLayer < 0 || contact.aLayer == contact.bLayer) continue;
      auto aFound = bodies.find(key(contact.aLayer, contact.aId));
      auto bFound = bodies.find(key(contact.bLayer, contact.bId));
      if (aFound == bodies.end() || bFound == bodies.end()) continue;
      Body* A = aFound->second;
      Body* B = bFound->second;
      if (!A->awake && !B->awake) continue;
      PreBiasConstraint constraint;
      constraint.a = indexBody(A);
      constraint.b = indexBody(B);
      constraint.nx = contact.nx;
      constraint.ny = contact.ny;
      anchor(A, contact.lax, contact.lay, constraint.rax, constraint.ray);
      anchor(B, contact.lbx, contact.lby, constraint.rbx, constraint.rby);
      double projection =
        (A->px + constraint.rax - B->px - constraint.rbx) * contact.nx
        + (A->py + constraint.ray - B->py - constraint.rby) * contact.ny;
      double penetration = contact.depth
        - (projection - contact.initialProjection) - R_BODY_PEN_SLOP;
      if (penetration <= 0) continue;
      constraint.aInvM = A->awake ? A->invMass : 0;
      constraint.aInvI = A->awake ? A->invInertia : 0;
      constraint.bInvM = B->awake ? B->invMass : 0;
      constraint.bInvI = B->awake ? B->invInertia : 0;
      double rnA = constraint.rax * contact.ny
                 - constraint.ray * contact.nx;
      double rnB = constraint.rbx * contact.ny
                 - constraint.rby * contact.nx;
      double inverseMass = constraint.aInvM + constraint.bInvM
        + constraint.aInvI * rnA * rnA
        + constraint.bInvI * rnB * rnB;
      if (inverseMass <= 0) continue;
      constraint.bias = std::fmin(
        R_MAX_BIAS_VEL, R_BAUMGARTE * penetration);
      constraint.mass = 1 / inverseMass;
      constraints.push_back(constraint);
    }
    std::vector<double> dx(indexed.size(), 0), dy(indexed.size(), 0);
    std::vector<double> da(indexed.size(), 0);
    for (int iteration = 0; iteration < 8; iteration++) {
      bool reverse = (iteration & 1) != 0;
      double moved = 0;
      for (int position = 0; position < (int)constraints.size(); position++) {
        int ci = reverse ? (int)constraints.size() - 1 - position : position;
        PreBiasConstraint& constraint = constraints[ci];
        double rvx = dx[constraint.a] - da[constraint.a] * constraint.ray
                   - dx[constraint.b] + da[constraint.b] * constraint.rby;
        double rvy = dy[constraint.a] + da[constraint.a] * constraint.rax
                   - dy[constraint.b] - da[constraint.b] * constraint.rbx;
        double vn = rvx * constraint.nx + rvy * constraint.ny;
        double next = std::fmax(0.0, constraint.impulse
          + (constraint.bias - vn) * constraint.mass);
        double impulse = next - constraint.impulse;
        constraint.impulse = next;
        double jx = impulse * constraint.nx;
        double jy = impulse * constraint.ny;
        dx[constraint.a] += jx * constraint.aInvM;
        dy[constraint.a] += jy * constraint.aInvM;
        da[constraint.a] += constraint.aInvI
          * (constraint.rax * jy - constraint.ray * jx);
        dx[constraint.b] -= jx * constraint.bInvM;
        dy[constraint.b] -= jy * constraint.bInvM;
        da[constraint.b] -= constraint.bInvI
          * (constraint.rbx * jy - constraint.rby * jx);
        moved += std::fabs(impulse);
      }
      if (moved <= 1e-12) break;
    }
    for (int index = 0; index < (int)indexed.size(); index++) {
      Body* body = indexed[index];
      double translation = std::hypot(dx[index], dy[index]);
      double scale = translation > worldPositionMotionLimit
        ? worldPositionMotionLimit / translation : 1;
      double rotation = std::fabs(da[index]);
      if (rotation > 0.01) scale = std::fmin(scale, 0.01 / rotation);
      body->px += dx[index] * scale;
      body->py += dy[index] * scale;
      body->angle += da[index] * scale;
      body->cs = std::cos(body->angle);
      body->sn = std::sin(body->angle);
      body->rasterFootprintValid = false;
    }
    for (Body* body : E.fg.bodies)
      if (body->jointRole == 1) syncJointFollower(body);
  }
  worldContacts.clear();
  worldHasPeerContact = false;
  worldPreviousPoses.clear();
  rigidWorldRelaxBodies = 0;
  rigidWorldRelaxContacts = 0;
  rigidWorldPositionIterations = 0;
  rigidWorldPositionLimitHits = 0;
  rigidWorldMaxPositionTranslation = 0;
  rigidWorldMaxPositionRotation = 0;
  rigidTracePoseMask = 0;
  rigidTraceVelocityMotion = {};
  rigidTraceBiasMotion = {};
  rigidTraceProjectionMotion = {};
  rigidTraceBiasByKind = {};
  captureTracePose(0);
  if (solverMode < 5) return;
  auto key = [](int layer, int id) {
    return ((uint64_t)(uint32_t)layer << 32) | (uint32_t)id;
  };
  worldPreviousPoses.reserve(E.fg.bodies.size() + E.bg.bodies.size());
  for (Body* body : E.fg.bodies)
    if (body->jointRole != 2)
      worldPreviousPoses[key(0, body->id)] = {
        body->px, body->py, body->angle,
      };
  for (Body* body : E.bg.bodies)
    if (body->jointRole == 0)
      worldPreviousPoses[key(1, body->id)] = {
        body->px, body->py, body->angle,
      };
}

int RigidBodySystem::worldContactCount() const {
  return (int)worldContacts.size();
}

double RigidBodySystem::worldContactState(int index, int field) const {
  if (index < 0 || index >= (int)worldContacts.size()) return NAN;
  const WorldContact& contact = worldContacts[index];
  switch (field) {
    case 0: return contact.aLayer;
    case 1: return contact.bLayer;
    case 2: return contact.aId;
    case 3: return contact.bId;
    case 4: return contact.nx;
    case 5: return contact.ny;
    case 6: return contact.depth;
    case 7: return contact.accJn;
    case 8: return contact.accJt;
    case 9: return contact.lax;
    case 10: return contact.lay;
    case 11: return contact.lbx;
    case 12: return contact.lby;
    case 13: return contact.initialProjection;
    case 14: return contact.targetVn;
    case 15: return contact.staticFriction;
    case 16: return contact.dynamicFriction;
    default: return NAN;
  }
}

void RigidBodySystem::relaxWorldContacts() {
  if (solverMode < 5) return;
  bool worldRasterPotential = false;
  if (E.bgEnabled) {
    bool hasBackgroundBody = false;
    for (Body* body : E.bg.bodies)
      hasBackgroundBody = hasBackgroundBody || body->jointRole == 0;
    if (hasBackgroundBody)
      for (Body* body : E.fg.bodies)
        if (body->jointRole == 1
            && (body->maxR >= R_EXACT_RASTER_BODY_RADIUS
              || body->nPts >= R_EXACT_RASTER_BODY_CELLS)) {
          worldRasterPotential = true;
          break;
        }
  }
  if ((!worldHasPeerContact || worldContacts.empty())
      && !worldRasterPotential) return;
  std::array<std::unordered_map<int, Body*>, 2> bodies;
  bodies[0].reserve(E.fg.bodies.size() * 2);
  bodies[1].reserve(E.bg.bodies.size() * 2);
  for (Body* body : E.fg.bodies)
    if (body->jointRole != 2) bodies[0][body->id] = body;
  for (Body* body : E.bg.bodies)
    if (body->jointRole == 0) bodies[1][body->id] = body;

  auto bodyAt = [&](int layer, int id) -> Body* {
    if (layer < 0 || layer > 1) return nullptr;
    auto found = bodies[layer].find(id);
    return found == bodies[layer].end() ? nullptr : found->second;
  };
  auto bodyKey = [](int layer, int id) {
    return ((uint64_t)(uint32_t)layer << 32) | (uint32_t)id;
  };
  std::unordered_map<uint64_t, int> bodyIndex;
  bodyIndex.reserve(E.fg.bodies.size() + E.bg.bodies.size());
  int bodyCount = 0;
  for (int layer = 0; layer < 2; layer++)
    for (const auto& entry : bodies[layer])
      bodyIndex[bodyKey(layer, entry.first)] = bodyCount++;
  std::vector<int> parent(bodyCount);
  for (int body = 0; body < bodyCount; body++) parent[body] = body;
  auto root = [&](int body) {
    int result = body;
    while (parent[result] != result) result = parent[result];
    while (parent[body] != body) {
      int next = parent[body];
      parent[body] = result;
      body = next;
    }
    return result;
  };
  auto unite = [&](int a, int b) {
    a = root(a);
    b = root(b);
    if (a != b) parent[b] = a;
  };
  for (const WorldContact& contact : worldContacts) {
    if (contact.bLayer < 0) continue;
    auto a = bodyIndex.find(bodyKey(contact.aLayer, contact.aId));
    auto b = bodyIndex.find(bodyKey(contact.bLayer, contact.bId));
    if (a != bodyIndex.end() && b != bodyIndex.end())
      unite(a->second, b->second);
  }
  std::vector<uint8_t> peerIsland(bodyCount, 0);
  for (const WorldContact& contact : worldContacts) {
    if (contact.bLayer < 0 || contact.aLayer == contact.bLayer) continue;
    auto a = bodyIndex.find(bodyKey(contact.aLayer, contact.aId));
    if (a != bodyIndex.end()) peerIsland[root(a->second)] = 1;
  }
  auto inPeerIsland = [&](const WorldContact& contact) {
    auto found = bodyIndex.find(bodyKey(contact.aLayer, contact.aId));
    return found != bodyIndex.end() && peerIsland[root(found->second)];
  };
  std::vector<Body*> indexedBodies(bodyCount, nullptr);
  std::vector<uint64_t> indexedBodyKeys(bodyCount, 0);
  for (int layer = 0; layer < 2; layer++)
    for (const auto& entry : bodies[layer]) {
      auto found = bodyIndex.find(bodyKey(layer, entry.first));
      if (found != bodyIndex.end()) {
        indexedBodies[found->second] = entry.second;
        indexedBodyKeys[found->second] = bodyKey(layer, entry.first);
      }
    }
  if (solverMode == 15 || solverMode == 16
      || (solverMode >= 19 && solverMode <= 22)) {
    std::vector<uint8_t> awakeIsland(bodyCount, 0);
    for (int index = 0; index < bodyCount; index++) {
      Body* body = indexedBodies[index];
      if (body && peerIsland[root(index)] && body->awake)
        awakeIsland[root(index)] = 1;
    }
    for (int index = 0; index < bodyCount; index++) {
      Body* body = indexedBodies[index];
      if (body && !body->awake && awakeIsland[root(index)])
        wakeBody(body);
    }
  }
  std::vector<MovePose> worldRelaxStart(bodyCount);
  for (int index = 0; index < bodyCount; index++) {
    Body* body = indexedBodies[index];
    if (!body || !peerIsland[root(index)]) continue;
    rigidWorldRelaxBodies++;
    worldRelaxStart[index] = {body->px, body->py, body->angle};
  }
  for (const WorldContact& contact : worldContacts)
    rigidWorldRelaxContacts += inPeerIsland(contact);
  auto anchor = [](Body* body, double lx, double ly,
                   double& rx, double& ry) {
    double cs = std::cos(body->angle), sn = std::sin(body->angle);
    rx = lx * cs - ly * sn;
    ry = lx * sn + ly * cs;
  };
  std::stable_sort(worldContacts.begin(), worldContacts.end(),
    [&](const WorldContact& a, const WorldContact& b) {
      Body* aBody = bodyAt(a.aLayer, a.aId);
      Body* bBody = bodyAt(b.aLayer, b.aId);
      double arx = 0, ary = 0, brx = 0, bry = 0;
      if (aBody) anchor(aBody, a.lax, a.lay, arx, ary);
      if (bBody) anchor(bBody, b.lax, b.lay, brx, bry);
      double ay = aBody ? aBody->py + ary : -1e18;
      double by = bBody ? bBody->py + bry : -1e18;
      return ay > by;
    });
  // The world-wide bias-free pass follows Box2D's MIT-licensed
  // solve/integrate/relax staging. It is world-wide here because foreground and
  // background bodies are integrated by separate layer passes.
  // https://github.com/erincatto/box2d/blob/main/src/solver.c
  for (int iteration = 0; iteration < 8; iteration++) {
    bool reverse = (iteration & 1) != 0;
    double moved = 0;
    for (int position = 0; position < (int)worldContacts.size(); position++) {
      int ci = reverse ? (int)worldContacts.size() - 1 - position : position;
      WorldContact& contact = worldContacts[ci];
      if (!inPeerIsland(contact)) continue;
      Body* A = bodyAt(contact.aLayer, contact.aId);
      Body* B = bodyAt(contact.bLayer, contact.bId);
      if (!A || !A->awake || (contact.bLayer >= 0 && !B)) continue;
      double aInvM = A->invMass, aInvI = A->invInertia;
      double bInvM = B && B->awake ? B->invMass : 0;
      double bInvI = B && B->awake ? B->invInertia : 0;
      double rax, ray, rbx = 0, rby = 0;
      anchor(A, contact.lax, contact.lay, rax, ray);
      if (B) anchor(B, contact.lbx, contact.lby, rbx, rby);
      double rnA = rax * contact.ny - ray * contact.nx;
      double rnB = B ? rbx * contact.ny - rby * contact.nx : 0;
      double normalK = aInvM + bInvM
        + aInvI * rnA * rnA + bInvI * rnB * rnB;
      if (normalK <= 0) continue;
      double rvx = A->vx - A->omega * ray;
      double rvy = A->vy + A->omega * rax;
      if (B) {
        rvx -= B->vx - B->omega * rby;
        rvy -= B->vy + B->omega * rbx;
      }
      double vn = rvx * contact.nx + rvy * contact.ny;
      double nextJn = std::fmax(0.0,
        contact.accJn + (contact.targetVn - vn) / normalK);
      double appliedN = nextJn - contact.accJn;
      contact.accJn = nextJn;
      double jx = appliedN * contact.nx;
      double jy = appliedN * contact.ny;
      A->vx += jx * aInvM;
      A->vy += jy * aInvM;
      A->omega += aInvI * (rax * jy - ray * jx);
      if (B) {
        B->vx -= jx * bInvM;
        B->vy -= jy * bInvM;
        B->omega -= bInvI * (rbx * jy - rby * jx);
      }

      double tx = -contact.ny, ty = contact.nx;
      double rtA = rax * ty - ray * tx;
      double rtB = B ? rbx * ty - rby * tx : 0;
      double tangentK = aInvM + bInvM
        + aInvI * rtA * rtA + bInvI * rtB * rtB;
      if (tangentK > 0) {
        rvx = A->vx - A->omega * ray;
        rvy = A->vy + A->omega * rax;
        if (B) {
          rvx -= B->vx - B->omega * rby;
          rvy -= B->vy + B->omega * rbx;
        }
        double vt = rvx * tx + rvy * ty;
        double coefficient = std::fabs(vt) <= R_STATIC_FRICTION_SPEED
          ? contact.staticFriction : contact.dynamicFriction;
        double limit = coefficient * contact.accJn;
        double nextJt = std::fmax(-limit, std::fmin(
          limit, contact.accJt - vt / tangentK));
        double appliedT = nextJt - contact.accJt;
        contact.accJt = nextJt;
        jx = appliedT * tx;
        jy = appliedT * ty;
        A->vx += jx * aInvM;
        A->vy += jy * aInvM;
        A->omega += aInvI * (rax * jy - ray * jx);
        if (B) {
          B->vx -= jx * bInvM;
          B->vy -= jy * bInvM;
          B->omega -= bInvI * (rbx * jy - rby * jx);
        }
        moved += std::fabs(appliedT);
      }
      moved += std::fabs(appliedN);
    }
    if (moved <= 1e-12) break;
  }
  for (Body* body : E.fg.bodies)
    if (body->jointRole == 1) syncJointFollower(body);
  if (solverMode == 6 || solverMode == 7
      || solverMode == 31 || solverMode == 46) return;

  std::vector<uint8_t> terrainAnchored(bodyCount, 0);
  auto markTerrainAnchor = [&](int layer, Body* body) {
    auto found = bodyIndex.find(bodyKey(layer, body->id));
    if (found == bodyIndex.end() || !peerIsland[root(found->second)]) return;
    Layer& active = layer ? E.bg : E.fg;
    Engine::ActiveLayerScope layerScope(E, &active);
    bool supported = bodyTouchesStaticSupport(body);
    if (!supported && body->jointRole == 1 && body->jointPeer) {
      Engine::ActiveLayerScope peerScope(E, &E.bg);
      supported = bodyTouchesStaticSupport(body->jointPeer);
    }
    terrainAnchored[found->second] = supported;
  };
  for (Body* body : E.fg.bodies)
    if (body->jointRole != 2) markTerrainAnchor(0, body);
  for (Body* body : E.bg.bodies)
    if (body->jointRole == 0) markTerrainAnchor(1, body);
  auto anchored = [&](int layer, int id) {
    auto found = bodyIndex.find(bodyKey(layer, id));
    return found != bodyIndex.end() && terrainAnchored[found->second];
  };

  bool positionMoved = false;
  auto positionMotion = [&](int index, Body* body,
                            double px, double py, double angle) {
    const MovePose& start = worldRelaxStart[index];
    return std::hypot(px - start.px, py - start.py)
      + std::fabs(angle - start.angle) * body->maxR;
  };
  auto correctionScale = [&](int index, Body* body,
                             double dpx, double dpy, double dangle,
                             bool deepContact) {
    if (dpx == 0 && dpy == 0 && dangle == 0) return 1.0;
    bool independentAngle = solverMode == 27 || solverMode == 30
      || solverMode == 31
      || solverMode == 32
      || solverMode == 33
      || solverMode == 34
      || solverMode == 35
      || solverMode == 36
      || solverMode == 37
      || solverMode == 38
      || solverMode == 39
      || solverMode == 40
      || solverMode == 42
      || solverMode == 43
      || solverMode == 44
      || solverMode == 45
      || (solverMode == 28 && deepContact
        && rigidStructureScaleBody(body));
    if (independentAngle) {
      const MovePose& start = worldRelaxStart[index];
      double translationLimit = std::fmax(
        1e-9, worldPositionMotionLimit);
      auto normalizedMotion = [&](double scale) {
        double translation = std::hypot(
          body->px + scale * dpx - start.px,
          body->py + scale * dpy - start.py) / translationLimit;
        double rotation = std::fabs(
          body->angle + scale * dangle - start.angle) / 0.01;
        return std::fmax(translation, rotation);
      };
      double current = normalizedMotion(0);
      double candidate = normalizedMotion(1);
      if (candidate <= 1 || candidate < current) return 1.0;
      if (current >= 1) return 0.0;
      double low = 0, high = 1;
      for (int step = 0; step < 12; step++) {
        double mid = 0.5 * (low + high);
        if (normalizedMotion(mid) <= 1) low = mid;
        else high = mid;
      }
      return low;
    }
    double current = positionMotion(
      index, body, body->px, body->py, body->angle);
    double candidate = positionMotion(index, body,
      body->px + dpx, body->py + dpy, body->angle + dangle);
    if (candidate <= worldPositionMotionLimit || candidate < current)
      return 1.0;
    if (current >= worldPositionMotionLimit) return 0.0;
    double low = 0, high = 1;
    for (int step = 0; step < 12; step++) {
      double mid = 0.5 * (low + high);
      double motion = positionMotion(index, body,
        body->px + mid * dpx, body->py + mid * dpy,
        body->angle + mid * dangle);
      if (motion <= worldPositionMotionLimit) low = mid;
      else high = mid;
    }
    return low;
  };
  if (solverMode == 9 || solverMode == 23 || solverMode == 40) {
    struct WorldBiasConstraint {
      int aIndex = -1, bIndex = -1;
      double nx = 0, ny = 0;
      double rax = 0, ray = 0, rbx = 0, rby = 0;
      double aInvM = 0, aInvI = 0, bInvM = 0, bInvI = 0;
      double bias = 0, normalMass = 0, impulse = 0;
    };
    std::vector<WorldBiasConstraint> constraints;
    constraints.reserve(worldContacts.size());
    for (const WorldContact& contact : worldContacts) {
      if (!inPeerIsland(contact) || contact.bLayer < 0) continue;
      if (solverMode == 40 && contact.aLayer == contact.bLayer) continue;
      Body* A = bodyAt(contact.aLayer, contact.aId);
      Body* B = bodyAt(contact.bLayer, contact.bId);
      if (!A || !B) continue;
      int aIndex = bodyIndex[bodyKey(contact.aLayer, contact.aId)];
      int bIndex = bodyIndex[bodyKey(contact.bLayer, contact.bId)];
      WorldBiasConstraint constraint;
      constraint.aIndex = aIndex;
      constraint.bIndex = bIndex;
      constraint.nx = contact.nx;
      constraint.ny = contact.ny;
      anchor(A, contact.lax, contact.lay,
             constraint.rax, constraint.ray);
      anchor(B, contact.lbx, contact.lby,
             constraint.rbx, constraint.rby);
      double projection =
        (A->px + constraint.rax - B->px - constraint.rbx) * contact.nx
        + (A->py + constraint.ray - B->py - constraint.rby) * contact.ny;
      double penetration = contact.depth
        - (projection - contact.initialProjection) - R_BODY_PEN_SLOP;
      if (penetration <= 0) continue;
      bool aAnchored = anchored(contact.aLayer, contact.aId);
      bool bAnchored = anchored(contact.bLayer, contact.bId);
      constraint.aInvM = aAnchored
          || (!A->awake && A->rasterAssignmentLocked)
        ? 0 : A->invMass;
      constraint.aInvI = aAnchored
          || (!A->awake && A->rasterAssignmentLocked)
        ? 0 : A->invInertia;
      constraint.bInvM = bAnchored
          || (!B->awake && B->rasterAssignmentLocked)
        ? 0 : B->invMass;
      constraint.bInvI = bAnchored
          || (!B->awake && B->rasterAssignmentLocked)
        ? 0 : B->invInertia;
      double rnA = constraint.rax * contact.ny
                 - constraint.ray * contact.nx;
      double rnB = constraint.rbx * contact.ny
                 - constraint.rby * contact.nx;
      double normalK = constraint.aInvM + constraint.bInvM
        + constraint.aInvI * rnA * rnA
        + constraint.bInvI * rnB * rnB;
      if (normalK <= 0) continue;
      constraint.bias = std::fmin(
        R_MAX_BIAS_VEL, R_BAUMGARTE * penetration);
      constraint.normalMass = 1 / normalK;
      constraints.push_back(constraint);
    }
    std::vector<double> biasVx(bodyCount, 0), biasVy(bodyCount, 0);
    std::vector<double> biasW(bodyCount, 0);
    for (int iteration = 0; iteration < 8; iteration++) {
      bool reverse = (iteration & 1) != 0;
      double moved = 0;
      for (int position = 0; position < (int)constraints.size(); position++) {
        int ci = reverse ? (int)constraints.size() - 1 - position : position;
        WorldBiasConstraint& constraint = constraints[ci];
        int ai = constraint.aIndex, bi = constraint.bIndex;
        double rvx = biasVx[ai] - biasW[ai] * constraint.ray
                   - biasVx[bi] + biasW[bi] * constraint.rby;
        double rvy = biasVy[ai] + biasW[ai] * constraint.rax
                   - biasVy[bi] - biasW[bi] * constraint.rbx;
        double vn = rvx * constraint.nx + rvy * constraint.ny;
        double nextImpulse = std::fmax(0.0,
          constraint.impulse
            + (constraint.bias - vn) * constraint.normalMass);
        double impulse = nextImpulse - constraint.impulse;
        constraint.impulse = nextImpulse;
        double jx = impulse * constraint.nx;
        double jy = impulse * constraint.ny;
        biasVx[ai] += jx * constraint.aInvM;
        biasVy[ai] += jy * constraint.aInvM;
        biasW[ai] += constraint.aInvI
          * (constraint.rax * jy - constraint.ray * jx);
        biasVx[bi] -= jx * constraint.bInvM;
        biasVy[bi] -= jy * constraint.bInvM;
        biasW[bi] -= constraint.bInvI
          * (constraint.rbx * jy - constraint.rby * jx);
        moved += std::fabs(impulse);
      }
      rigidWorldPositionIterations = iteration + 1;
      if (moved <= 1e-12) break;
    }
    // Box2D's contact solver accumulates bias impulses against fixed local
    // anchors and integrates the island together. Applying the resulting pose
    // deltas simultaneously prevents constraint order from exposing a
    // half-updated compound body to the next contact.
    // https://github.com/erincatto/box2d/blob/main/src/contact_solver.c
    for (int index = 0; index < bodyCount; index++) {
      Body* body = indexedBodies[index];
      if (!body || !peerIsland[root(index)]) continue;
      double scale = correctionScale(
        index, body, biasVx[index], biasVy[index], biasW[index], false);
      if (scale < 1) rigidWorldPositionLimitHits++;
      if (scale <= 0) continue;
      double dx = biasVx[index] * scale;
      double dy = biasVy[index] * scale;
      double da = biasW[index] * scale;
      if (dx == 0 && dy == 0 && da == 0) continue;
      body->px += dx;
      body->py += dy;
      body->angle += da;
      body->cs = std::cos(body->angle);
      body->sn = std::sin(body->angle);
      body->rasterFootprintValid = false;
      positionMoved = true;
    }
    for (Body* body : E.fg.bodies)
      if (body->jointRole == 1) syncJointFollower(body);
  } else {
    for (int iteration = 0; iteration < 8; iteration++) {
      bool reverse = (iteration & 1) != 0;
      double moved = 0;
      for (int position = 0; position < (int)worldContacts.size(); position++) {
        int ci = reverse ? (int)worldContacts.size() - 1 - position : position;
        const WorldContact& contact = worldContacts[ci];
        if (!inPeerIsland(contact) || contact.bLayer < 0) continue;
        Body* A = bodyAt(contact.aLayer, contact.aId);
        Body* B = bodyAt(contact.bLayer, contact.bId);
        if (!A || (contact.bLayer >= 0 && !B)) continue;
        if (solverMode == 45 && contact.aLayer != contact.bLayer
            && A->awake && B->awake
            && (A->nPts >= 8 * B->nPts || B->nPts >= 8 * A->nPts))
          continue;
        double rax, ray, rbx = 0, rby = 0;
        anchor(A, contact.lax, contact.lay, rax, ray);
        if (B) anchor(B, contact.lbx, contact.lby, rbx, rby);
        double projection = (A->px + rax) * contact.nx
          + (A->py + ray) * contact.ny;
        if (B)
          projection -= (B->px + rbx) * contact.nx
            + (B->py + rby) * contact.ny;
        double positionSlop = solverMode == 33 ? 0.125 : R_BODY_PEN_SLOP;
        double penetration = contact.depth
          - (projection - contact.initialProjection) - positionSlop;
        if (penetration <= 0) continue;
        bool aAnchored = anchored(contact.aLayer, contact.aId);
        bool bAnchored = B && anchored(contact.bLayer, contact.bId);
        int aIndex = bodyIndex[bodyKey(contact.aLayer, contact.aId)];
        int bIndex = bodyIndex[bodyKey(contact.bLayer, contact.bId)];
        double aInvM = aAnchored
            || (!A->awake && A->rasterAssignmentLocked)
          ? 0 : A->invMass;
        double aInvI = aAnchored
            || (!A->awake && A->rasterAssignmentLocked)
          ? 0 : A->invInertia;
        double bInvM = !B || bAnchored
            || (!B->awake && B->rasterAssignmentLocked)
          ? 0 : B->invMass;
        double bInvI = !B || bAnchored
            || (!B->awake && B->rasterAssignmentLocked)
          ? 0 : B->invInertia;
        double rnA = rax * contact.ny - ray * contact.nx;
        double rnB = B ? rbx * contact.ny - rby * contact.nx : 0;
        double normalK = aInvM + bInvM
          + aInvI * rnA * rnA + bInvI * rnB * rnB;
        if (normalK <= 0) continue;
        double impulse = std::fmin(
          R_MAX_BIAS_VEL, R_BAUMGARTE * penetration) / normalK;
        double dx = impulse * contact.nx;
        double dy = impulse * contact.ny;
        double aAngle = aInvI * (rax * dy - ray * dx);
        double bAngle = -bInvI * (rbx * dy - rby * dx);
        double scale = std::fmin(
          correctionScale(aIndex, A,
            dx * aInvM, dy * aInvM, aAngle, penetration > 0.5),
          correctionScale(bIndex, B,
            -dx * bInvM, -dy * bInvM, bAngle, penetration > 0.5));
        if (scale < 1) rigidWorldPositionLimitHits++;
        if (scale <= 0) continue;
        dx *= scale;
        dy *= scale;
        aAngle *= scale;
        bAngle *= scale;
        A->px += dx * aInvM;
        A->py += dy * aInvM;
        A->angle += aAngle;
        A->cs = std::cos(A->angle);
        A->sn = std::sin(A->angle);
        A->rasterFootprintValid = false;
        if (B) {
          B->px -= dx * bInvM;
          B->py -= dy * bInvM;
          B->angle += bAngle;
          B->cs = std::cos(B->angle);
          B->sn = std::sin(B->angle);
          B->rasterFootprintValid = false;
        }
        moved += std::fabs(impulse);
        positionMoved = true;
      }
      for (Body* body : E.fg.bodies)
        if (body->jointRole == 1) syncJointFollower(body);
      rigidWorldPositionIterations = iteration + 1;
      if (moved <= 1e-12) break;
    }
  }
  for (int index = 0; index < bodyCount; index++) {
    Body* body = indexedBodies[index];
    if (!body || !peerIsland[root(index)]) continue;
    const MovePose& start = worldRelaxStart[index];
    rigidWorldMaxPositionTranslation = std::fmax(
      rigidWorldMaxPositionTranslation,
      std::hypot(body->px - start.px, body->py - start.py));
    rigidWorldMaxPositionRotation = std::fmax(
      rigidWorldMaxPositionRotation, std::fabs(body->angle - start.angle));
  }
  captureTracePose(3);
  if (positionMoved) {
    // The world bridge can rotate a distant arm of a large joint body after
    // each layer has completed its exact raster projection. Re-run that final
    // discrete constraint at the committed world pose; the continuous pass
    // remains responsible for impulses, while this pass only chooses a unique
    // sand-cell assignment.
    auto loadWorldProjectionRollback = [&](int layer, Layer& source) {
      moveBodySlotById.clear();
      movePreviousPoses.clear();
      for (Body* body : source.bodies) {
        if (body->jointRole == 2) continue;
        auto found = bodyIndex.find(bodyKey(layer, body->id));
        if (found == bodyIndex.end()) continue;
        moveBodySlotById[body->id] = (int)movePreviousPoses.size();
        movePreviousPoses.push_back(worldRelaxStart[found->second]);
      }
    };
    loadWorldProjectionRollback(0, E.fg);
    {
      Engine::ActiveLayerScope foreground(E, &E.fg);
      resolveStructureRasterOverlaps();
    }
    loadWorldProjectionRollback(1, E.bg);
    {
      Engine::ActiveLayerScope background(E, &E.bg);
      resolveStructureRasterOverlaps();
    }
    auto clearLayerRasters = [&](Layer& layer) {
      Engine::ActiveLayerScope layerScope(E, &layer);
      auto clear = [&](std::vector<int>& cells) {
        for (int k : cells) {
          if (k < 0 || k >= E.cols * E.rows) continue;
          if (E.isBodyCell(k)) layer.clearVacatedCellPhases((size_t)k);
          else layer.bodyOwner[k] = -1;
        }
        cells.clear();
      };
      clear(layer.bodyCells);
      clear(layer.passiveBodyCells);
      layer.blastSparseCarryReady = false;
    };
    clearLayerRasters(E.fg);
    clearLayerRasters(E.bg);
    {
      Engine::ActiveLayerScope foreground(E, &E.fg);
      restampBodiesAfterStream(PCSO_BODY_MOTION);
    }
    {
      Engine::ActiveLayerScope background(E, &E.bg);
      restampBodiesAfterStream(PCSO_BODY_MOTION);
    }
  }
  captureTracePose(4);
  // Box2D sleeps a complete island only after every active body's farthest
  // point velocity, including half-weighted pose correction, remains below the
  // threshold for 0.5 seconds. The world graph supplies that same decision for
  // contacts spanning the foreground/background solver passes.
  // https://github.com/erincatto/box2d/blob/main/src/solver.c
  if (solverMode == 30) {
    std::vector<uint8_t> islandQuiet(bodyCount, 1);
    std::vector<uint16_t> islandStill(bodyCount, UINT16_MAX);
    std::vector<uint8_t> islandHasAwake(bodyCount, 0);
    for (int index = 0; index < bodyCount; index++) {
      Body* body = indexedBodies[index];
      int island = root(index);
      if (!body || !peerIsland[island]) continue;
      islandHasAwake[island] = islandHasAwake[island] || body->awake;
      if (!body->awake) continue;
      double pointSpeed = std::hypot(body->vx, body->vy)
        + std::fabs(body->omega) * body->maxR;
      double poseSpeed = 0;
      auto previous = worldPreviousPoses.find(indexedBodyKeys[index]);
      if (previous != worldPreviousPoses.end())
        poseSpeed = 0.5 * (
          std::hypot(body->px - previous->second.px,
                     body->py - previous->second.py)
          + std::fabs(body->angle - previous->second.angle) * body->maxR);
      double sleepVelocity = std::fmax(pointSpeed, poseSpeed);
      if (sleepVelocity > R_WORLD_SLEEP_VELOCITY
          || body->spatialForceApplied)
        islandQuiet[island] = 0;
      islandStill[island] = std::min(
        islandStill[island], body->worldStillTicks);
    }
    for (int index = 0; index < bodyCount; index++) {
      Body* body = indexedBodies[index];
      int island = root(index);
      if (!body || !body->awake || !peerIsland[island]) continue;
      if (!islandQuiet[island]) {
        body->worldStillTicks = 0;
        continue;
      }
      body->worldStillTicks = islandStill[island] == UINT16_MAX
        ? 1 : (uint16_t)imin(
          (int)UINT16_MAX, (int)islandStill[island] + 1);
    }
    for (int island = 0; island < bodyCount; island++) {
      if (!peerIsland[island] || root(island) != island
          || !islandQuiet[island]
          || !islandHasAwake[island])
        continue;
      uint16_t still = UINT16_MAX;
      for (int index = 0; index < bodyCount; index++)
        if (root(index) == island && indexedBodies[index]
            && indexedBodies[index]->awake)
          still = std::min(still, indexedBodies[index]->worldStillTicks);
      if (still < R_WORLD_SLEEP_TICKS) continue;
      std::vector<uint8_t> newlySleeping(bodyCount, 0);
      for (int index = 0; index < bodyCount; index++) {
        Body* body = indexedBodies[index];
        if (!body || !body->awake || root(index) != island) continue;
        newlySleeping[index] = 1;
        body->awake = false;
        body->vx = body->vy = body->omega = 0;
        body->pvx = body->pvy = body->pw = 0;
        body->stillTicks = R_SLEEP_TICKS;
        body->sleepSupports.clear();
      }
      auto addSupport = [](Body* body, double x, double y,
                           int owner, int layer) {
        if (!body || body->sleepSupports.size() >= 8) return;
        for (const BodySleepSupport& support : body->sleepSupports)
          if (support.owner == owner && support.layer == layer
              && std::fabs(support.x - x) <= 0.5
              && std::fabs(support.y - y) <= 0.5)
            return;
        body->sleepSupports.push_back({x, y, owner, (uint8_t)layer});
      };
      for (const WorldContact& contact : worldContacts) {
        auto found = bodyIndex.find(bodyKey(contact.aLayer, contact.aId));
        if (found == bodyIndex.end() || root(found->second) != island)
          continue;
        Body* A = bodyAt(contact.aLayer, contact.aId);
        Body* B = bodyAt(contact.bLayer, contact.bId);
        if (!A) continue;
        double rax = 0, ray = 0, rbx = 0, rby = 0;
        anchor(A, contact.lax, contact.lay, rax, ray);
        if (B) anchor(B, contact.lbx, contact.lby, rbx, rby);
        if (newlySleeping[found->second])
          addSupport(A, A->px + rax, A->py + ray,
            B ? B->id : -1, B ? contact.bLayer : contact.aLayer);
        auto bFound = B ? bodyIndex.find(
          bodyKey(contact.bLayer, contact.bId)) : bodyIndex.end();
        if (B && bFound != bodyIndex.end() && newlySleeping[bFound->second])
          addSupport(B, B->px + rbx, B->py + rby,
            A->id, contact.aLayer);
      }
      for (int index = 0; index < bodyCount; index++) {
        Body* body = indexedBodies[index];
        if (body && newlySleeping[index] && body->jointRole == 1)
          syncJointFollower(body);
      }
    }
  }
}

bool RigidBodySystem::preserveRasterRecoveryMotion(
    Body* body, const MovePose& rejectedPose) {
  if (!rigidWorldBridgeMode(solverMode)) return false;
  double pointSpeed = std::hypot(body->vx, body->vy)
    + std::fabs(body->omega) * body->maxR;
  if (pointSpeed <= R_WORLD_SLEEP_VELOCITY
      && !body->spatialForceApplied)
    return false;

  // The accepted pose is an exact positional constraint. Remove only linear
  // motion aimed back through its correction; tangential velocity and angular
  // momentum remain available to roll or slide along the blocking surface.
  double dx = body->px - rejectedPose.px;
  double dy = body->py - rejectedPose.py;
  double translation = std::hypot(dx, dy);
  if (translation > 1e-9) {
    double nx = dx / translation;
    double ny = dy / translation;
    double inwardSpeed = body->vx * nx + body->vy * ny;
    if (inwardSpeed < 0) {
      body->vx -= inwardSpeed * nx;
      body->vy -= inwardSpeed * ny;
    }
  }
  body->pvx = body->pvy = body->pw = 0;
  body->hadContact = true;
  wakeBody(body);
  return true;
}

void RigidBodySystem::resolveWorldRasterAssignment() {
  if (!E.bgEnabled) {
    worldRasterAssignmentValid = true;
    worldRasterAcceptedRosterValid = false;
    return;
  }
  bool hasJoint = false;
  size_t nodeCount = 0;
  for (Body* body : E.fg.bodies) {
    if (body->jointRole == 2) continue;
    nodeCount++;
    hasJoint = hasJoint
      || (body->jointRole == 1 && body->jointPeer);
  }
  bool hasIndependentBackground = false;
  for (Body* body : E.bg.bodies) {
    if (body->jointRole != 0) continue;
    nodeCount++;
    hasIndependentBackground = true;
  }
  if (!hasJoint || !hasIndependentBackground) {
    worldRasterAssignmentValid = true;
    worldRasterAcceptedRosterValid = false;
    return;
  }

  auto geometryMatchesAccepted = [&](Body* body) {
    return body->acceptedRasterPoseValid
      && body->acceptedRasterGeometryRevision == body->geometryRevision;
  };
  auto checkpointBody = [&](Body* body, Layer& layer) {
    body->acceptedWorldPx = layer.worldOffsetX + body->px;
    body->acceptedWorldPy = layer.worldOffsetY + body->py;
    body->acceptedAngle = body->angle;
    body->acceptedRasterGeometryRevision = body->geometryRevision;
    body->acceptedRasterPoseValid = true;
  };
  size_t rosterIndex = 0;
  auto rosterEntryMatches = [&](Body* body, int bodyLayer, Body* peer) {
    if (rosterIndex >= worldRasterAcceptedRoster.size()) return false;
    const WorldRasterRosterEntry& accepted =
      worldRasterAcceptedRoster[rosterIndex++];
    return accepted.bodyId == body->id
      && accepted.peerId == (peer ? peer->id : -1)
      && accepted.bodyLayer == bodyLayer
      && accepted.jointRole == body->jointRole;
  };
  bool needsExactValidation = !worldRasterAssignmentValid
    || !worldRasterAcceptedRosterValid
    || worldRasterAcceptedRoster.size() != nodeCount
    || rigidOwnershipConflicts > 0
    || rigidRejectedCells > 0
    || rigidRasterCorrections > 0
    || rigidRasterProjectionFailures > 0
    || rigidWorldMaxPositionTranslation > 0
    || rigidWorldMaxPositionRotation > 0;
  if (!needsExactValidation) {
    for (Body* body : E.fg.bodies) {
      if (body->jointRole == 2) continue;
      Body* peer = body->jointRole == 1 ? body->jointPeer : nullptr;
      if (!rosterEntryMatches(body, 0, peer)
          || !geometryMatchesAccepted(body)
          || (body->jointRole == 1 && body->jointPeer
            && (!body->jointPeer->acceptedRasterPoseValid
              || body->jointPeer->acceptedRasterGeometryRevision
                != body->jointPeer->geometryRevision))) {
        needsExactValidation = true;
        break;
      }
    }
  }
  if (!needsExactValidation) {
    for (Body* body : E.bg.bodies) {
      if (body->jointRole != 0) continue;
      if (!rosterEntryMatches(body, 1, nullptr)
          || !geometryMatchesAccepted(body)) {
        needsExactValidation = true;
        break;
      }
    }
  }
  if (!needsExactValidation
      && rosterIndex != worldRasterAcceptedRoster.size())
    needsExactValidation = true;
  if (!needsExactValidation) {
    for (Body* body : E.fg.bodies) {
      if (body->jointRole == 2) continue;
      checkpointBody(body, E.fg);
      if (body->jointRole == 1 && body->jointPeer) {
        Body* follower = body->jointPeer;
        follower->acceptedWorldPx = body->acceptedWorldPx;
        follower->acceptedWorldPy = body->acceptedWorldPy;
        follower->acceptedAngle = body->acceptedAngle;
        follower->acceptedRasterGeometryRevision = follower->geometryRevision;
        follower->acceptedRasterPoseValid = true;
      }
    }
    for (Body* body : E.bg.bodies)
      if (body->jointRole == 0) checkpointBody(body, E.bg);
    return;
  }

  worldRasterNodes.clear();
  worldRasterNodes.reserve(E.fg.bodies.size() + E.bg.bodies.size());
  for (Body* body : E.fg.bodies) {
    if (body->jointRole == 2) continue;
    WorldRasterNode node;
    node.body = body;
    node.foreground = body;
    node.bodyLayer = 0;
    if (body->jointRole == 1 && body->jointPeer) {
      node.background = body->jointPeer;
    }
    worldRasterNodes.push_back(node);
  }
  for (Body* body : E.bg.bodies) {
    if (body->jointRole != 0) continue;
    WorldRasterNode node;
    node.body = body;
    node.background = body;
    node.bodyLayer = 1;
    worldRasterNodes.push_back(node);
  }

  auto acceptAssignment = [&]() {
    for (WorldRasterNode& node : worldRasterNodes) {
      Layer& layer = node.bodyLayer ? E.bg : E.fg;
      checkpointBody(node.body, layer);
      if (node.body->jointRole == 1 && node.background) {
        Body* follower = node.background;
        follower->acceptedWorldPx = node.body->acceptedWorldPx;
        follower->acceptedWorldPy = node.body->acceptedWorldPy;
        follower->acceptedAngle = node.body->acceptedAngle;
        follower->acceptedRasterGeometryRevision = follower->geometryRevision;
        follower->acceptedRasterPoseValid = true;
      }
    }
    worldRasterAcceptedRoster.clear();
    worldRasterAcceptedRoster.reserve(worldRasterNodes.size());
    for (const WorldRasterNode& node : worldRasterNodes) {
      worldRasterAcceptedRoster.push_back({
        node.body->id,
        node.body->jointRole == 1 && node.background
          ? node.background->id : -1,
        node.bodyLayer,
        node.body->jointRole,
      });
    }
    worldRasterAcceptedRosterValid = true;
    worldRasterAssignmentValid = true;
  };

  size_t gridSize = (size_t)E.cols * E.rows;
  if (rasterProjectionOwner.size() != gridSize) {
    rasterProjectionOwner.assign(gridSize, -1);
    rasterProjectionTouched.clear();
  }
  auto clearOwners = [&]() {
    for (int k : rasterProjectionTouched) rasterProjectionOwner[k] = -1;
    rasterProjectionTouched.clear();
  };
  auto assignmentValid = [&](std::vector<uint8_t>* violating) {
    if (violating)
      violating->assign(worldRasterNodes.size(), 0);
    bool valid = true;
    for (int layerIndex = 0; layerIndex < 2; layerIndex++) {
      Layer& layer = layerIndex ? E.bg : E.fg;
      // A single shared lattice sample is an alias, as in the per-layer
      // projection. Repeated overlap still invalidates the whole assignment.
      std::unordered_map<uint64_t, int> overlapCounts;
      clearOwners();
      for (int nodeIndex = 0;
           nodeIndex < (int)worldRasterNodes.size(); nodeIndex++) {
        WorldRasterNode& node = worldRasterNodes[nodeIndex];
        std::array<Body*, 2> members{{nullptr, nullptr}};
        int memberCount = 0;
        if (node.body->jointRole == 1) {
          if (node.foreground) members[memberCount++] = node.foreground;
          if (node.background) members[memberCount++] = node.background;
        } else {
          Body* member = layerIndex ? node.background : node.foreground;
          if (member) members[memberCount++] = member;
        }
        for (int memberIndex = 0; memberIndex < memberCount; memberIndex++) {
          Body* member = members[memberIndex];
          ensureBodyRaster(member);
          for (const BodyRasterCell& cell : member->rasterFootprint) {
            int k = cell.y * E.cols + cell.x;
            int previous = rasterProjectionOwner[k];
            if (previous < 0) {
              rasterProjectionOwner[k] = nodeIndex;
              rasterProjectionTouched.push_back(k);
            } else if (previous != nodeIndex) {
              int first = imin(previous, nodeIndex);
              int second = imax(previous, nodeIndex);
              uint64_t key = ((uint64_t)(uint32_t)first << 32)
                           | (uint32_t)second;
              if (++overlapCounts[key] <= R_STRUCTURE_RASTER_ALIAS_CELLS)
                continue;
              valid = false;
              if (violating) {
                (*violating)[previous] = 1;
                (*violating)[nodeIndex] = 1;
              }
            }
            if (layer.infinite
                && (cell.x == 0 || cell.x == E.cols - 1))
              continue;
            if (layer.bodyOwner[k] >= 0) continue;
            uint8_t material = layer.grid[k];
            if (material != EMPTY && !E.isGasMaterial(material)
                && !E.isBuoyantMedium(material)) {
              valid = false;
              if (violating) (*violating)[nodeIndex] = 1;
            }
          }
        }
      }
    }
    clearOwners();
    return valid;
  };

  if (assignmentValid(&worldRasterViolating)) {
    acceptAssignment();
    rigidOwnershipConflicts = 0;
    rigidRejectedCells = 0;
    rigidRasterProjectionFailures = 0;
    return;
  }

  worldRasterCurrentPoses.clear();
  worldRasterCurrentPoses.reserve(worldRasterNodes.size());
  for (WorldRasterNode& node : worldRasterNodes) {
    worldRasterCurrentPoses.push_back({
      node.body->px, node.body->py, node.body->angle,
    });
  }

  auto setPose = [&](WorldRasterNode& node, const MovePose& pose) {
    bool changed = node.body->px != pose.px
      || node.body->py != pose.py
      || node.body->angle != pose.angle;
    node.body->px = pose.px;
    node.body->py = pose.py;
    node.body->angle = pose.angle;
    node.body->cs = std::cos(pose.angle);
    node.body->sn = std::sin(pose.angle);
    if (changed) node.body->rasterFootprintValid = false;
    if (node.body->jointRole == 1) syncJointFollower(node.body);
  };
  worldRasterRollback = worldRasterViolating;
  std::vector<uint8_t> worldRasterMove = worldRasterRollback;
  // Every body whose exact raster touches a violation belongs to the same
  // transaction, including diagonal contacts that can receive the correction.
  std::vector<int> contactParent(worldRasterNodes.size());
  for (int index = 0; index < (int)contactParent.size(); index++)
    contactParent[index] = index;
  for (int layerIndex = 0; layerIndex < 2; layerIndex++) {
    clearOwners();
    for (int nodeIndex = 0;
         nodeIndex < (int)worldRasterNodes.size(); nodeIndex++) {
      WorldRasterNode& node = worldRasterNodes[nodeIndex];
      std::array<Body*, 2> members{{nullptr, nullptr}};
      int memberCount = 0;
      if (node.body->jointRole == 1) {
        if (node.foreground) members[memberCount++] = node.foreground;
        if (node.background) members[memberCount++] = node.background;
      } else {
        Body* member = layerIndex ? node.background : node.foreground;
        if (member) members[memberCount++] = member;
      }
      for (int memberIndex = 0; memberIndex < memberCount; memberIndex++) {
        Body* member = members[memberIndex];
        ensureBodyRaster(member);
        for (const BodyRasterCell& cell : member->rasterFootprint) {
          int k = cell.y * E.cols + cell.x;
          int previous = rasterProjectionOwner[k];
          if (previous < 0) {
            rasterProjectionOwner[k] = nodeIndex;
            rasterProjectionTouched.push_back(k);
          } else if (previous != nodeIndex) {
            ufUnite(contactParent, previous, nodeIndex);
          }
        }
      }
    }
    for (int k : rasterProjectionTouched) {
      int owner = rasterProjectionOwner[k];
      int x = k % E.cols;
      for (const auto& offset : std::array<std::pair<int, int>, 4>{{
             {1, 0}, {-1, 1}, {0, 1}, {1, 1},
           }}) {
        int nx = x + offset.first;
        int neighbor = k + offset.second * E.cols + offset.first;
        if (nx < 0 || nx >= E.cols
            || neighbor < 0 || neighbor >= E.cols * E.rows)
          continue;
        int peer = rasterProjectionOwner[neighbor];
        if (peer >= 0 && peer != owner)
          ufUnite(contactParent, owner, peer);
      }
    }
  }
  auto contactNode = [&](int layer, int id) {
    for (int index = 0; index < (int)worldRasterNodes.size(); index++) {
      Body* member = layer
        ? worldRasterNodes[index].background
        : worldRasterNodes[index].foreground;
      if (member && member->id == id) return index;
    }
    return -1;
  };
  for (const WorldContact& contact : worldContacts) {
    if (contact.bLayer < 0) continue;
    int first = contactNode(contact.aLayer, contact.aId);
    int second = contactNode(contact.bLayer, contact.bId);
    if (first >= 0 && second >= 0) ufUnite(contactParent, first, second);
  }
  clearOwners();
  std::vector<uint8_t> rollbackRoots(worldRasterNodes.size(), 0);
  for (int index = 0; index < (int)worldRasterNodes.size(); index++)
    if (worldRasterRollback[index])
      rollbackRoots[ufFind(contactParent, index)] = 1;
  for (int index = 0; index < (int)worldRasterNodes.size(); index++)
    worldRasterRollback[index] =
      rollbackRoots[ufFind(contactParent, index)];
  bool recovered = false;

  // Build both layers' claims directly from canonical-node footprints. The
  // recursive search only mutates trial poses; the sand grids remain unchanged
  // until one complete assignment has passed every claim and terrain check.
  int remainingSearchCandidates = 8192;
  size_t remainingSearchRasterCells = std::min(
    gridSize * 64, (size_t)16 * 1024 * 1024);
  auto searchBoundedAssignment = [&](
      const std::vector<uint8_t>& moving,
      const std::vector<uint8_t>& included) {
    size_t ownerSize = gridSize * 2;
    if (worldRasterSearchOwner.size() != ownerSize)
      worldRasterSearchOwner.assign(ownerSize, -1);
    for (int claim : worldRasterSearchTouched)
      worldRasterSearchOwner[claim] = -1;
    worldRasterSearchTouched.clear();

    auto releaseClaims = [&](size_t start) {
      while (worldRasterSearchTouched.size() > start) {
        int claim = worldRasterSearchTouched.back();
        worldRasterSearchTouched.pop_back();
        worldRasterSearchOwner[claim] = -1;
      }
    };
    auto rasterScanCells = [&](Body* body) {
      bool cacheValid = body->rasterFootprintValid
        && body->rasterPx == body->px
        && body->rasterPy == body->py
        && body->rasterAngle == body->angle
        && body->rasterGeometryRevision == body->geometryRevision
        && body->rasterCols == E.cols
        && body->rasterRows == E.rows;
      if (cacheValid) return (size_t)0;
      double sn = std::sin(body->angle), cs = std::cos(body->angle);
      double lx0 = body->offsetX - 0.5;
      double lx1 = body->offsetX + body->w - 0.5;
      double ly0 = body->offsetY - 0.5;
      double ly1 = body->offsetY + body->h - 0.5;
      double minWX = 1e18, minWY = 1e18;
      double maxWX = -1e18, maxWY = -1e18;
      auto includeCorner = [&](double lx, double ly) {
        double wx = body->px + lx * cs - ly * sn;
        double wy = body->py + lx * sn + ly * cs;
        minWX = std::fmin(minWX, wx);
        minWY = std::fmin(minWY, wy);
        maxWX = std::fmax(maxWX, wx);
        maxWY = std::fmax(maxWY, wy);
      };
      includeCorner(lx0, ly0);
      includeCorner(lx1, ly0);
      includeCorner(lx1, ly1);
      includeCorner(lx0, ly1);
      int x0 = imax(0, (int)std::floor(minWX));
      int y0 = imax(0, (int)std::floor(minWY));
      int x1 = imin(E.cols - 1, (int)std::floor(maxWX));
      int y1 = imin(E.rows - 1, (int)std::floor(maxWY));
      if (x1 < x0 || y1 < y0) return (size_t)0;
      return (size_t)(x1 - x0 + 1) * (y1 - y0 + 1);
    };
    auto spendRasterCells = [&](size_t cells) {
      if (cells > remainingSearchRasterCells) return false;
      remainingSearchRasterCells -= cells;
      return true;
    };
    auto claimNode = [&](int nodeIndex) {
      size_t start = worldRasterSearchTouched.size();
      WorldRasterNode& node = worldRasterNodes[nodeIndex];
      for (int layerIndex = 0; layerIndex < 2; layerIndex++) {
        Layer& layer = layerIndex ? E.bg : E.fg;
        Body* member = layerIndex ? node.background : node.foreground;
        if (!member) continue;
        if (!spendRasterCells(rasterScanCells(member))) {
          releaseClaims(start);
          return false;
        }
        ensureBodyRaster(member);
        if (!spendRasterCells(member->rasterFootprint.size())) {
          releaseClaims(start);
          return false;
        }
        for (const BodyRasterCell& cell : member->rasterFootprint) {
          int k = cell.y * E.cols + cell.x;
          int claim = layerIndex * (int)gridSize + k;
          if (worldRasterSearchOwner[claim] >= 0) {
            releaseClaims(start);
            return false;
          }
          if (!(layer.infinite
                && (cell.x == 0 || cell.x == E.cols - 1))
              && layer.bodyOwner[k] < 0) {
            uint8_t material = layer.grid[k];
            if (material != EMPTY && !E.isGasMaterial(material)
                && !E.isBuoyantMedium(material)) {
              releaseClaims(start);
              return false;
            }
          }
          worldRasterSearchOwner[claim] = nodeIndex;
          worldRasterSearchTouched.push_back(claim);
        }
      }
      return true;
    };

    std::vector<int> searchNodes;
    searchNodes.reserve(worldRasterNodes.size());
    for (int index = 0; index < (int)worldRasterNodes.size(); index++) {
      if (moving[index]) searchNodes.push_back(index);
      else if (included[index] && !claimNode(index)) {
        releaseClaims(0);
        return false;
      }
    }
    std::stable_sort(searchNodes.begin(), searchNodes.end(),
      [&](int a, int b) {
        return worldRasterMove[a] > worldRasterMove[b];
      });

    static constexpr double directions[16][2] = {
      {1, 0}, {0.9238795325112867, 0.3826834323650898},
      {0.7071067811865476, 0.7071067811865476},
      {0.3826834323650898, 0.9238795325112867}, {0, 1},
      {-0.3826834323650898, 0.9238795325112867},
      {-0.7071067811865476, 0.7071067811865476},
      {-0.9238795325112867, 0.3826834323650898}, {-1, 0},
      {-0.9238795325112867, -0.3826834323650898},
      {-0.7071067811865476, -0.7071067811865476},
      {-0.3826834323650898, -0.9238795325112867}, {0, -1},
      {0.3826834323650898, -0.9238795325112867},
      {0.7071067811865476, -0.7071067811865476},
      {0.9238795325112867, -0.3826834323650898},
    };
    // All contended islands share one candidate and raster-work budget for this
    // resolver call, including the fixed claims repeated by separate attempts.
    auto search = [&](auto&& self, int depth) -> bool {
      if (depth == (int)searchNodes.size()) return true;
      if (remainingSearchCandidates <= 0
          || remainingSearchRasterCells == 0)
        return false;
      int nodeIndex = searchNodes[depth];
      WorldRasterNode& node = worldRasterNodes[nodeIndex];
      const MovePose& current = worldRasterCurrentPoses[nodeIndex];
      auto tryPose = [&](const MovePose& pose) {
        if (remainingSearchCandidates <= 0
            || remainingSearchRasterCells == 0)
          return false;
        remainingSearchCandidates--;
        setPose(node, pose);
        size_t start = worldRasterSearchTouched.size();
        if (!claimNode(nodeIndex)) return false;
        if (self(self, depth + 1)) return true;
        releaseClaims(start);
        return false;
      };
      if (tryPose(current)) return true;
      if (node.body->acceptedRasterPoseValid) {
        Layer& layer = node.bodyLayer ? E.bg : E.fg;
        MovePose accepted{
          node.body->acceptedWorldPx - layer.worldOffsetX,
          node.body->acceptedWorldPy - layer.worldOffsetY,
          node.body->acceptedAngle,
        };
        double acceptedTranslation = std::hypot(
          accepted.px - current.px, accepted.py - current.py);
        for (int sample = 1;
             sample <= 16 && remainingSearchCandidates > 0; sample++) {
          double fraction = (double)sample / 16;
          if (acceptedTranslation * fraction > 2) break;
          if (tryPose({
                current.px + (accepted.px - current.px) * fraction,
                current.py + (accepted.py - current.py) * fraction,
                current.angle
                  + (accepted.angle - current.angle) * fraction,
              }))
            return true;
        }
      }
      for (double amount = 0.125;
           amount <= 2.0 && remainingSearchCandidates > 0; amount += 0.125) {
        for (const auto& direction : directions) {
          if (remainingSearchCandidates <= 0) break;
          if (tryPose({
                current.px + direction[0] * amount,
                current.py + direction[1] * amount,
                current.angle,
              }))
            return true;
        }
      }
      setPose(node, current);
      return false;
    };
    bool found = search(search, 0);
    releaseClaims(0);
    return found;
  };
  std::vector<int> violatingRoots;
  for (int index = 0; index < (int)worldRasterNodes.size(); index++) {
    if (!worldRasterMove[index]) continue;
    int root = ufFind(contactParent, index);
    if (std::find(violatingRoots.begin(), violatingRoots.end(), root)
        == violatingRoots.end())
      violatingRoots.push_back(root);
  }
  recovered = true;
  std::vector<uint8_t> islandMove(worldRasterNodes.size(), 0);
  std::vector<uint8_t> islandIncluded(worldRasterNodes.size(), 0);
  for (int root : violatingRoots) {
    for (int index = 0; index < (int)worldRasterNodes.size(); index++) {
      int nodeRoot = ufFind(contactParent, index);
      islandMove[index] = 0;
      islandIncluded[index] = !worldRasterRollback[index]
        || nodeRoot == root;
    }
    bool islandRecovered = false;
    for (int index = 0;
         !islandRecovered && index < (int)worldRasterNodes.size(); index++) {
      if (!worldRasterMove[index]
          || ufFind(contactParent, index) != root)
        continue;
      islandMove[index] = 1;
      islandRecovered = searchBoundedAssignment(
        islandMove, islandIncluded);
      islandMove[index] = 0;
    }
    if (!islandRecovered) {
      for (int index = 0; index < (int)worldRasterNodes.size(); index++)
        islandMove[index] = worldRasterMove[index]
          && ufFind(contactParent, index) == root;
      islandRecovered = searchBoundedAssignment(
        islandMove, islandIncluded);
    }
    if (!islandRecovered) {
      for (int index = 0; index < (int)worldRasterNodes.size(); index++)
        islandMove[index] = ufFind(contactParent, index) == root;
      islandRecovered = searchBoundedAssignment(
        islandMove, islandIncluded);
    }
    if (!islandRecovered) {
      recovered = false;
      break;
    }
  }
  if (recovered) recovered = assignmentValid(&worldRasterViolating);
  // Rollback interpolation shares a fixed number of exact whole-roster checks.
  int remainingRollbackValidations = 64;
  for (int pass = 0;
       !recovered && remainingRollbackValidations > 7
         && pass < (int)worldRasterNodes.size(); pass++) {
    bool canRollback = true;
    double maxRollbackTravel = 0;
    for (int index = 0; index < (int)worldRasterNodes.size(); index++) {
      if (!worldRasterRollback[index]) continue;
      WorldRasterNode& node = worldRasterNodes[index];
      if (!node.body->acceptedRasterPoseValid) {
        canRollback = false;
        break;
      }
      Layer& layer = node.bodyLayer ? E.bg : E.fg;
      MovePose accepted{
        node.body->acceptedWorldPx - layer.worldOffsetX,
        node.body->acceptedWorldPy - layer.worldOffsetY,
        node.body->acceptedAngle,
      };
      const MovePose& current = worldRasterCurrentPoses[index];
      maxRollbackTravel = std::fmax(maxRollbackTravel,
        std::hypot(accepted.px - current.px, accepted.py - current.py)
          + std::fabs(accepted.angle - current.angle) * node.body->maxR);
    }
    if (!canRollback) break;

    auto setRollbackFraction = [&](double fraction) {
      for (int index = 0; index < (int)worldRasterNodes.size(); index++) {
        WorldRasterNode& node = worldRasterNodes[index];
        const MovePose& current = worldRasterCurrentPoses[index];
        if (!worldRasterRollback[index]) {
          setPose(node, current);
          continue;
        }
        Layer& layer = node.bodyLayer ? E.bg : E.fg;
        MovePose accepted{
          node.body->acceptedWorldPx - layer.worldOffsetX,
          node.body->acceptedWorldPy - layer.worldOffsetY,
          node.body->acceptedAngle,
        };
        setPose(node, {
          current.px + (accepted.px - current.px) * fraction,
          current.py + (accepted.py - current.py) * fraction,
          current.angle + (accepted.angle - current.angle) * fraction,
        });
      }
    };
    int samples = imin(64, imax(
      1, (int)std::ceil(maxRollbackTravel / 0.25)));
    double lower = 0, upper = -1;
    for (int sample = 1;
         sample <= samples && remainingRollbackValidations > 7; sample++) {
      double fraction = (double)sample / samples;
      setRollbackFraction(fraction);
      remainingRollbackValidations--;
      if (assignmentValid(&worldRasterViolating)) {
        upper = fraction;
        break;
      }
      lower = fraction;
    }
    if (upper > 0) {
      for (int search = 0;
           search < 6 && remainingRollbackValidations > 1; search++) {
        double middle = (lower + upper) * 0.5;
        setRollbackFraction(middle);
        remainingRollbackValidations--;
        if (assignmentValid(nullptr)) upper = middle;
        else lower = middle;
      }
      setRollbackFraction(upper);
      remainingRollbackValidations--;
      if (!assignmentValid(&worldRasterViolating)) break;
      recovered = true;
      break;
    }
    bool expanded = false;
    for (int index = 0; index < (int)worldRasterNodes.size(); index++) {
      if (!worldRasterViolating[index] || worldRasterRollback[index])
        continue;
      worldRasterRollback[index] = 1;
      expanded = true;
    }
    if (!expanded) break;
  }
  if (!recovered) {
    worldRasterRollback.assign(worldRasterNodes.size(), 1);
    bool allAccepted = true;
    for (WorldRasterNode& node : worldRasterNodes) {
      if (!node.body->acceptedRasterPoseValid) {
        allAccepted = false;
        break;
      }
      Layer& layer = node.bodyLayer ? E.bg : E.fg;
      setPose(node, {
        node.body->acceptedWorldPx - layer.worldOffsetX,
        node.body->acceptedWorldPy - layer.worldOffsetY,
        node.body->acceptedAngle,
      });
    }
    recovered = allAccepted && assignmentValid(&worldRasterViolating);
  }
  if (!recovered) {
    for (int index = 0; index < (int)worldRasterNodes.size(); index++)
      setPose(worldRasterNodes[index], worldRasterCurrentPoses[index]);
    rigidRasterProjectionFailures = imax(
      1, rigidRasterProjectionFailures);
    worldRasterAssignmentValid = false;
    return;
  }

  int movedBodies = 0;
  for (int index = 0; index < (int)worldRasterNodes.size(); index++) {
    if (!worldRasterRollback[index]) continue;
    Body* body = worldRasterNodes[index].body;
    const MovePose& current = worldRasterCurrentPoses[index];
    double translation = std::hypot(body->px - current.px,
                                    body->py - current.py);
    double travel = translation
      + std::fabs(body->angle - current.angle) * body->maxR;
    bool poseChanged = travel > 1e-9;
    bool worldBridge = rigidWorldBridgeMode(solverMode);
    if (!poseChanged && worldBridge) continue;
    if (poseChanged) {
      movedBodies++;
      rigidRasterMaxCorrection = std::fmax(
        rigidRasterMaxCorrection, translation);
    }
    if (!preserveRasterRecoveryMotion(body, current)) {
      // A body inside the world sleep band, or a solver without a cross-layer
      // contact coordinator, parks with the completed assignment.
      body->vx = body->vy = body->omega = 0;
      body->awake = false;
      resetSleepTracking(body);
      body->stillTicks = R_SLEEP_TICKS;
    }
    body->pvx = body->pvy = body->pw = 0;
    body->hadContact = true;
    if (body->jointRole == 1) syncJointFollower(body);
  }
  rigidPositionCorrections += movedBodies;
  rigidRasterCorrections += movedBodies;
  rigidOwnershipConflicts = 0;
  rigidRejectedCells = 0;
  rigidRasterProjectionFailures = 0;
  acceptAssignment();

  auto clearLayerRasters = [&](Layer& layer) {
    Engine::ActiveLayerScope layerScope(E, &layer);
    auto clear = [&](std::vector<int>& cells) {
      for (int k : cells) {
        if (k < 0 || k >= E.cols * E.rows) continue;
        if (E.isBodyCell(k)) layer.clearVacatedCellPhases((size_t)k);
        else layer.bodyOwner[k] = -1;
      }
      cells.clear();
    };
    clear(layer.bodyCells);
    clear(layer.passiveBodyCells);
    layer.blastSparseCarryReady = false;
  };
  clearLayerRasters(E.fg);
  clearLayerRasters(E.bg);
  {
    Engine::ActiveLayerScope foreground(E, &E.fg);
    restampBodiesAfterStream(PCSO_BODY_MOTION);
  }
  {
    Engine::ActiveLayerScope background(E, &E.bg);
    restampBodiesAfterStream(PCSO_BODY_MOTION);
  }
}

void RigidBodySystem::worldPoint(Body* b, int i, double sn, double cs, double& ox, double& oy) {
  double lx = b->points[i * 2], ly = b->points[i * 2 + 1];
  ox = b->px + lx * cs - ly * sn; oy = b->py + lx * sn + ly * cs;
}
void RigidBodySystem::bodyFusePoint(Body* b, double& wx, double& wy) {
  double cs = std::cos(b->angle), sn = std::sin(b->angle);
  wx = b->px + b->fuseLocalX * cs - b->fuseLocalY * sn;
  wy = b->py + b->fuseLocalX * sn + b->fuseLocalY * cs;
}
void RigidBodySystem::setBodyFusePoint(Body* b, double wx, double wy) {
  double dx = wx - b->px, dy = wy - b->py;
  double cs = std::cos(b->angle), sn = std::sin(b->angle);
  b->fuseLocalX = dx * cs + dy * sn;
  b->fuseLocalY = -dx * sn + dy * cs;
}
uint8_t RigidBodySystem::bodyMaterialAt(Body* b, int localIndex) {
  if (localIndex < 0 || localIndex >= (int)b->occ.size() || !b->occ[localIndex]) return EMPTY;
  return b->cellMaterials.empty() ? b->material : b->cellMaterials[localIndex];
}
bool RigidBodySystem::computeDerived(Body* b, bool preserveWorld) {
  b->rasterFootprintValid = false;
  b->erodible = false;
  b->erosionBoundaryMask.assign(b->occ.size(), 0);
  for (int local = 0; local < (int)b->occ.size(); local++) {
    uint8_t material = bodyMaterialAt(b, local);
    if (material == RIGID || E.isDissolvable(material)
        || E.isFlammable(material)) {
      b->erodible = true;
    }
    if (material == EMPTY) continue;
    int i = local % b->w, j = local / b->w;
    for (int oy = -1; oy <= 1 && !b->erosionBoundaryMask[local]; oy++)
      for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int ni = i + ox, nj = j + oy;
        if (ni < 0 || ni >= b->w || nj < 0 || nj >= b->h
            || bodyMaterialAt(b, nj * b->w + ni) == EMPTY) {
          b->erosionBoundaryMask[local] = 1;
          break;
        }
      }
  }
  int nPts = 0; double sumX = 0, sumY = 0, totalMass = 0;
  for (int j = 0; j < b->h; j++) for (int i = 0; i < b->w; i++) {
    int local = j * b->w + i;
    if (!b->occ[local]) continue;
    auto materialMass = [](uint8_t material) {
      return material > EMPTY && isMaterialId(material) ? DENSITY[material] : 0.0;
    };
    double cellMass = b->jointRole
      ? materialMass(b->cellMaterials[local]) + materialMass(b->jointPeerMaterials[local])
      : (b->cellMaterials.empty() ? 1.0 : materialMass(bodyMaterialAt(b, local)));
    if (cellMass <= 0) continue;
    nPts++;
    sumX += (b->offsetX + i) * cellMass;
    sumY += (b->offsetY + j) * cellMass;
    totalMass += cellMass;
  }
  if (nPts == 0) return false;
  double divisor = b->cellMaterials.empty() && !b->jointRole ? nPts : totalMass;
  double dx = sumX / divisor, dy = sumY / divisor;
  if (preserveWorld && (dx != 0 || dy != 0)) {
    double c = std::cos(b->angle), s = std::sin(b->angle);
    double worldDx = dx * c - dy * s;
    double worldDy = dx * s + dy * c;
    b->px += worldDx;
    b->py += worldDy;
    if (b->acceptedRasterPoseValid) {
      b->acceptedWorldPx += worldDx;
      b->acceptedWorldPy += worldDy;
    }
  }
  if (b->fuseTicks > 0) {
    b->fuseLocalX -= dx;
    b->fuseLocalY -= dy;
  }
  b->offsetX -= dx; b->offsetY -= dy;
  b->points.assign((size_t)nPts * 2, 0.f); b->boundaryPts.clear();
  b->boundarySamples.clear(); b->boundarySampleRadii.clear();
  int pi = 0; double inertia = 0, maxR2 = 0;
  int shortSide = imax(1, imin(b->w, b->h));
  int longSide = imax(b->w, b->h);
  bool sampleCorners = nPts == b->w * b->h
    || longSide >= 24 || longSide >= shortSide * 8;
  auto filled = [&](int ii, int jj) { return ii >= 0 && ii < b->w && jj >= 0 && jj < b->h && b->occ[jj * b->w + ii]; };
  auto addSample = [&](double sx, double sy) {
    float sampleX = (float)sx, sampleY = (float)sy;
    b->boundarySamples.push_back(sampleX);
    b->boundarySamples.push_back(sampleY);
    b->boundarySampleRadii.push_back(std::hypot(
      (double)sampleX, (double)sampleY));
  };
  for (int j = 0; j < b->h; j++) for (int i = 0; i < b->w; i++) {
    if (!b->occ[j * b->w + i]) continue;
    double lx = b->offsetX + i, ly = b->offsetY + j;
    b->points[pi * 2] = (float)lx; b->points[pi * 2 + 1] = (float)ly;
    double cellMass = b->density;
    if (b->jointRole) {
      uint8_t own = b->cellMaterials[j * b->w + i];
      uint8_t peer = b->jointPeerMaterials[j * b->w + i];
      cellMass = (own > EMPTY && isMaterialId(own) ? DENSITY[own] : 0)
               + (peer > EMPTY && isMaterialId(peer) ? DENSITY[peer] : 0);
    } else if (!b->cellMaterials.empty()) {
      uint8_t material = bodyMaterialAt(b, j * b->w + i);
      cellMass = material > EMPTY && isMaterialId(material) ? DENSITY[material] : 0;
    }
    double r2 = lx * lx + ly * ly;
    inertia += cellMass * (r2 + 1.0 / 6.0);
    if (r2 > maxR2) maxR2 = r2;
    bool exL = !filled(i - 1, j), exR = !filled(i + 1, j), exU = !filled(i, j - 1), exD = !filled(i, j + 1);
    if (exL || exR || exU || exD) {
      b->boundaryPts.push_back(pi);
      addSample(lx, ly);                                   // cell centre
      if (exR) addSample(lx + 0.5, ly);                    // exposed face midpoints
      if (exL) addSample(lx - 0.5, ly);
      if (exD) addSample(lx, ly + 0.5);
      if (exU) addSample(lx, ly - 0.5);
      if (sampleCorners) {
        if (exL && exU) addSample(lx - 0.5, ly - 0.5);
        if (exR && exU) addSample(lx + 0.5, ly - 0.5);
        if (exL && exD) addSample(lx - 0.5, ly + 0.5);
        if (exR && exD) addSample(lx + 0.5, ly + 0.5);
      }
    }
    pi++;
  }
  b->boundarySampleBlocks.clear();
  static constexpr int BOUNDARY_SAMPLES_PER_BLOCK = 32;
  int sampleCount = (int)b->boundarySampleRadii.size();
  for (int first = 0; first < sampleCount;
       first += BOUNDARY_SAMPLES_PER_BLOCK) {
    BodyBoundarySampleBlock block;
    block.first = first;
    block.count = imin(BOUNDARY_SAMPLES_PER_BLOCK, sampleCount - first);
    block.minX = block.minY = std::numeric_limits<float>::max();
    block.maxX = block.maxY = std::numeric_limits<float>::lowest();
    for (int sample = first; sample < first + block.count; sample++) {
      float x = b->boundarySamples[sample * 2];
      float y = b->boundarySamples[sample * 2 + 1];
      block.minX = std::fmin(block.minX, x);
      block.minY = std::fmin(block.minY, y);
      block.maxX = std::fmax(block.maxX, x);
      block.maxY = std::fmax(block.maxY, y);
      block.maxRadius = std::fmax(
        block.maxRadius, b->boundarySampleRadii[sample]);
    }
    b->boundarySampleBlocks.push_back(block);
  }
  double mass = b->cellMaterials.empty() && !b->jointRole ? b->density * nPts : totalMass;
  if (!b->cellMaterials.empty() || b->jointRole) b->density = mass / nPts;
  bool coversMajorAxis = true;
  if (shortSide <= 4) {
    if (b->w >= b->h) {
      for (int i = 0; i < b->w; i++) {
        bool covered = false;
        for (int j = 0; j < b->h; j++)
          if (filled(i, j)) { covered = true; break; }
        if (!covered) { coversMajorAxis = false; break; }
      }
    } else {
      for (int j = 0; j < b->h; j++) {
        bool covered = false;
        for (int i = 0; i < b->w; i++)
          if (filled(i, j)) { covered = true; break; }
        if (!covered) { coversMajorAxis = false; break; }
      }
    }
  }
  b->tightSlenderBounds =
    (int64_t)nPts * 4 >= (int64_t)b->w * b->h * 3
    || (shortSide <= 4 && coversMajorAxis);
  b->collisionRects.clear();
  b->collisionSpans.clear();
  struct CollisionRun {
    int x0, x1, child;
  };
  std::vector<CollisionRun> previousRuns, currentRuns;
  for (int j = 0; j < b->h; j++) {
    currentRuns.clear();
    int previous = 0;
    for (int i = 0; i < b->w;) {
      while (i < b->w && !filled(i, j)) i++;
      if (i >= b->w) break;
      int x0 = i;
      while (i < b->w && filled(i, j)) i++;
      int x1 = i;
      while (previous < (int)previousRuns.size()
             && (previousRuns[previous].x0 < x0
                 || (previousRuns[previous].x0 == x0
                     && previousRuns[previous].x1 < x1)))
        previous++;
      int child = -1;
      if (previous < (int)previousRuns.size()
          && previousRuns[previous].x0 == x0
          && previousRuns[previous].x1 == x1) {
        child = previousRuns[previous].child;
        b->collisionRects[child].y1 = j + 1;
      } else {
        child = (int)b->collisionRects.size();
        BodyCollisionRect rect;
        rect.x0 = x0;
        rect.y0 = j;
        rect.x1 = x1;
        rect.y1 = j + 1;
        b->collisionRects.push_back(rect);
      }
      currentRuns.push_back({x0, x1, child});
    }
    previousRuns.swap(currentRuns);
  }
  auto addFaceSpans = [&](BodyCollisionRect& rect, BodyCollisionFace face) {
    rect.spanStart[face] = (int)b->collisionSpans.size();
    int q0 = (face == BCF_LEFT || face == BCF_RIGHT) ? rect.y0 : rect.x0;
    int q1 = (face == BCF_LEFT || face == BCF_RIGHT) ? rect.y1 : rect.x1;
    int runStart = -1;
    auto exposed = [&](int q) {
      if (face == BCF_LEFT) return !filled(rect.x0 - 1, q);
      if (face == BCF_RIGHT) return !filled(rect.x1, q);
      if (face == BCF_UP) return !filled(q, rect.y0 - 1);
      return !filled(q, rect.y1);
    };
    auto finishSpan = [&](int end) {
      if (runStart < 0) return;
      double offset = (face == BCF_LEFT || face == BCF_RIGHT)
        ? b->offsetY : b->offsetX;
      b->collisionSpans.push_back({
        (float)(offset + runStart - 0.5),
        (float)(offset + end - 0.5),
      });
      runStart = -1;
    };
    for (int q = q0; q < q1; q++) {
      if (exposed(q)) {
        if (runStart < 0) runStart = q;
      } else {
        finishSpan(q);
      }
    }
    finishSpan(q1);
    rect.spanCount[face] =
      (int)b->collisionSpans.size() - rect.spanStart[face];
  };
  for (BodyCollisionRect& rect : b->collisionRects) {
    addFaceSpans(rect, BCF_LEFT);
    addFaceSpans(rect, BCF_RIGHT);
    addFaceSpans(rect, BCF_UP);
    addFaceSpans(rect, BCF_DOWN);
  }
  b->collisionTree.clear();
  b->collisionTreeRoot = -1;
  std::vector<int> collisionOrder(b->collisionRects.size());
  for (int child = 0; child < (int)collisionOrder.size(); child++)
    collisionOrder[child] = child;
  auto buildCollisionTree = [&](auto&& self, int begin, int end) -> int {
    BodyCollisionNode node;
    node.x0 = node.y0 = INT_MAX;
    node.x1 = node.y1 = INT_MIN;
    int minCenterX = INT_MAX, maxCenterX = INT_MIN;
    int minCenterY = INT_MAX, maxCenterY = INT_MIN;
    for (int position = begin; position < end; position++) {
      const BodyCollisionRect& rect =
        b->collisionRects[collisionOrder[position]];
      node.x0 = imin(node.x0, rect.x0);
      node.y0 = imin(node.y0, rect.y0);
      node.x1 = imax(node.x1, rect.x1);
      node.y1 = imax(node.y1, rect.y1);
      int centerX = rect.x0 + rect.x1;
      int centerY = rect.y0 + rect.y1;
      minCenterX = imin(minCenterX, centerX);
      maxCenterX = imax(maxCenterX, centerX);
      minCenterY = imin(minCenterY, centerY);
      maxCenterY = imax(maxCenterY, centerY);
    }
    int nodeIndex = (int)b->collisionTree.size();
    b->collisionTree.push_back(node);
    if (end - begin == 1) {
      b->collisionTree[nodeIndex].child = collisionOrder[begin];
      return nodeIndex;
    }
    bool splitX = maxCenterX - minCenterX >= maxCenterY - minCenterY;
    std::stable_sort(collisionOrder.begin() + begin,
                     collisionOrder.begin() + end,
      [&](int first, int second) {
        const BodyCollisionRect& a = b->collisionRects[first];
        const BodyCollisionRect& c = b->collisionRects[second];
        int centerA = splitX ? a.x0 + a.x1 : a.y0 + a.y1;
        int centerC = splitX ? c.x0 + c.x1 : c.y0 + c.y1;
        return centerA != centerC ? centerA < centerC : first < second;
      });
    int middle = begin + (end - begin) / 2;
    int left = self(self, begin, middle);
    int right = self(self, middle, end);
    b->collisionTree[nodeIndex].left = left;
    b->collisionTree[nodeIndex].right = right;
    return nodeIndex;
  };
  if (!collisionOrder.empty())
    b->collisionTreeRoot = buildCollisionTree(
      buildCollisionTree, 0, (int)collisionOrder.size());
  b->nPts = nPts; b->invMass = mass > 0 ? 1 / mass : 0; b->invInertia = inertia > 0 ? 1 / inertia : 0;
  if (++b->geometryRevision == 0) b->geometryRevision = 1;
  b->maxR = std::sqrt(maxR2); b->awake = true; resetSleepTracking(b);
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
  b->acceptedWorldPx = E.L->worldOffsetX + b->px;
  b->acceptedWorldPy = E.L->worldOffsetY + b->py;
  b->acceptedAngle = b->angle;
  b->acceptedRasterGeometryRevision = b->geometryRevision;
  b->acceptedRasterPoseValid = true;
  E.L->bodies.push_back(b);
  return b;
}
Body* RigidBodySystem::spawnBodyImpl(const std::vector<std::pair<int, int>>& cells,
                                     const std::vector<uint8_t>& materials) {
  if (cells.empty() || cells.size() != materials.size()) return nullptr;
  Body* b = spawnBodyImpl(cells, materials[0], DENSITY[materials[0]]);
  if (!b) return nullptr;
  b->cellMaterials.assign(b->occ.size(), EMPTY);
  int minX = 1 << 30, minY = 1 << 30;
  for (const auto& cell : cells) {
    minX = imin(minX, cell.first);
    minY = imin(minY, cell.second);
  }
  for (size_t i = 0; i < cells.size(); i++) {
    int local = (cells[i].second - minY) * b->w + (cells[i].first - minX);
    b->cellMaterials[local] = materials[i];
  }
  computeDerived(b, true);
  return b;
}
void RigidBodySystem::bindJointBodies(Body* leader, Body* follower, int jointId) {
  if (!leader || !follower) return;
  leader->id = follower->id = jointId;
  E.fg.nextBodyId = imax(E.fg.nextBodyId, jointId + 1);
  E.bg.nextBodyId = imax(E.bg.nextBodyId, jointId + 1);
  leader->jointRole = 1;
  follower->jointRole = 2;
  leader->jointPeer = follower;
  follower->jointPeer = leader;
  E.bg.passiveBodyIds.insert(jointId);
}
void RigidBodySystem::unbindJointBodies(Body* leader, Body* follower) {
  if (!leader || !follower) return;
  E.bg.passiveBodyIds.erase(follower->id);
  leader->jointPeer = nullptr;
  follower->jointPeer = nullptr;
  leader->jointRole = 0;
  follower->jointRole = 0;
}
Body* RigidBodySystem::spawnJointBodyImpl(
    const std::vector<std::pair<int, int>>& fgCells,
    const std::vector<uint8_t>& fgMaterials,
    const std::vector<std::pair<int, int>>& bgCells,
    const std::vector<uint8_t>& bgMaterials) {
  if (fgCells.empty() || bgCells.empty()
      || fgCells.size() != fgMaterials.size()
      || bgCells.size() != bgMaterials.size()) return nullptr;
  std::vector<std::pair<int, int>> unionCells = fgCells;
  unionCells.insert(unionCells.end(), bgCells.begin(), bgCells.end());
  std::sort(unionCells.begin(), unionCells.end());
  unionCells.erase(std::unique(unionCells.begin(), unionCells.end()), unionCells.end());

  Engine::ActiveLayerScope layerScope(E, &E.fg);
  Body* leader = spawnBodyImpl(unionCells, fgMaterials[0], DENSITY[fgMaterials[0]]);
  Body* follower = nullptr;
  {
    Engine::ActiveLayerScope background(E, &E.bg);
    follower = spawnBodyImpl(unionCells, bgMaterials[0], DENSITY[bgMaterials[0]]);
  }
  if (!leader || !follower) return nullptr;
  int jointId = imax(leader->id, follower->id);
  bindJointBodies(leader, follower, jointId);

  int minX = unionCells[0].first, minY = unionCells[0].second;
  for (const auto& cell : unionCells) {
    minX = imin(minX, cell.first);
    minY = imin(minY, cell.second);
  }
  auto fillLayerMap = [&](Body* body,
                          const std::vector<std::pair<int, int>>& ownCells,
                          const std::vector<uint8_t>& ownMaterials,
                          const std::vector<std::pair<int, int>>& peerCells,
                          const std::vector<uint8_t>& peerMaterials) {
    body->cellMaterials.assign(body->occ.size(), EMPTY);
    body->jointPeerMaterials.assign(body->occ.size(), EMPTY);
    for (size_t i = 0; i < ownCells.size(); i++) {
      int local = (ownCells[i].second - minY) * body->w + ownCells[i].first - minX;
      body->cellMaterials[local] = ownMaterials[i];
    }
    for (size_t i = 0; i < peerCells.size(); i++) {
      int local = (peerCells[i].second - minY) * body->w + peerCells[i].first - minX;
      body->jointPeerMaterials[local] = peerMaterials[i];
    }
  };
  fillLayerMap(leader, fgCells, fgMaterials, bgCells, bgMaterials);
  fillLayerMap(follower, bgCells, bgMaterials, fgCells, fgMaterials);
  computeDerived(leader, true);
  computeDerived(follower, true);
  syncJointFollower(leader);
  return leader;
}

void RigidBodySystem::resolveSpawnedJointOverlaps(
    const std::vector<Body*>& newborns) {
  if (newborns.empty()) return;
  const size_t gridSize = (size_t)E.cols * E.rows;
  spawnSeparationStamp.reset(gridSize);
  spawnReservationStamp.reset(gridSize);
  std::unordered_set<Body*> newbornSet;
  newbornSet.reserve(newborns.size() * 2);
  for (Body* body : newborns) {
    if (!body) continue;
    newbornSet.insert(body);
    auto addMember = [&](Body* member) {
      ensureBodyRaster(member);
      for (const BodyRasterCell& cell : member->rasterFootprint)
        spawnSeparationStamp.add(cell.y * E.cols + cell.x);
    };
    addMember(body);
    if (body->jointRole == 1 && body->jointPeer)
      addMember(body->jointPeer);
  }

  struct ExistingBody { Body* body; int layer; };
  std::vector<ExistingBody> existing;
  existing.reserve(E.fg.bodies.size() + E.bg.bodies.size());
  for (Body* body : E.fg.bodies)
    if (body->jointRole != 2 && !newbornSet.count(body))
      existing.push_back({body, 0});
  for (Body* body : E.bg.bodies)
    if (body->jointRole == 0) existing.push_back({body, 1});

  auto ownsCell = [](const ExistingBody& entry, int layer, int owner) {
    if (owner < 0) return false;
    if (entry.body->jointRole == 1) return owner == entry.body->id;
    return entry.layer == layer && owner == entry.body->id;
  };
  auto candidateClear = [&](const ExistingBody& entry,
                            const std::vector<std::pair<int, int>>& footprint,
                            int dx, int dy) {
    Body* body = entry.body;
    for (const auto& cell : footprint) {
      int x = cell.first + dx, y = cell.second + dy;
      if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return false;
      int k = y * E.cols + x;
      if (spawnSeparationStamp.has(k) || spawnReservationStamp.has(k))
        return false;
      int fgOwner = E.fg.bodyOwner[k];
      int bgOwner = E.bg.bodyOwner[k];
      if ((fgOwner >= 0 && !ownsCell(entry, 0, fgOwner))
          || (bgOwner >= 0 && !ownsCell(entry, 1, bgOwner)))
        return false;
      auto layerClear = [&](Layer& layer, int layerIndex) {
        int owner = layer.bodyOwner[k];
        return ownsCell(entry, layerIndex, owner)
          || (owner < 0 && layer.grid[k] == EMPTY);
      };
      if (!layerClear(entry.layer ? E.bg : E.fg, entry.layer)) return false;
      if (body->jointRole == 1
          && !layerClear(entry.layer ? E.fg : E.bg, 1 - entry.layer))
        return false;
    }
    return true;
  };

  for (const ExistingBody& entry : existing) {
    Body* body = entry.body;
    std::vector<std::pair<int, int>> footprint;
    int overlap = 0;
    auto addMember = [&](Body* member) {
      ensureBodyRaster(member);
      footprint.reserve(footprint.size() + member->rasterFootprint.size());
      for (const BodyRasterCell& cell : member->rasterFootprint) {
        footprint.push_back({cell.x, cell.y});
        overlap += spawnSeparationStamp.has(cell.y * E.cols + cell.x);
      }
    };
    addMember(body);
    if (body->jointRole == 1 && body->jointPeer)
      addMember(body->jointPeer);
    if (overlap <= R_STRUCTURE_RASTER_ALIAS_CELLS) continue;

    int bestDx = 0, bestDy = 0;
    bool found = false;
    for (int radius = 1;
         radius <= R_SPAWN_SEPARATION_MAX_CELLS && !found; radius++) {
      int bestDistance2 = INT_MAX;
      double bestOpposingSpeed = -1e100;
      for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
          if (imax(std::abs(dx), std::abs(dy)) != radius) continue;
          int distance2 = dx * dx + dy * dy;
          if (distance2 > bestDistance2
              || !candidateClear(entry, footprint, dx, dy))
            continue;
          double opposingSpeed = -(dx * body->vx + dy * body->vy);
          if (distance2 < bestDistance2
              || opposingSpeed > bestOpposingSpeed + 1e-12) {
            bestDistance2 = distance2;
            bestOpposingSpeed = opposingSpeed;
            bestDx = dx;
            bestDy = dy;
            found = true;
          }
        }
      }
    }
    if (!found) {
      rigidSpawnSeparationFailures++;
      continue;
    }

    body->px += bestDx;
    body->py += bestDy;
    body->rasterFootprintValid = false;
    double length = std::hypot(bestDx, bestDy);
    if (length > 0) {
      double nx = bestDx / length, ny = bestDy / length;
      double inwardSpeed = body->vx * nx + body->vy * ny;
      if (inwardSpeed < 0) {
        body->vx -= inwardSpeed * nx;
        body->vy -= inwardSpeed * ny;
      }
    }
    body->awake = true;
    body->hadContact = true;
    resetSleepTracking(body);
    if (body->jointRole == 1) syncJointFollower(body);
    auto clearMember = [&](Layer& layer, Body* member,
                           std::vector<int>& cells) {
      Engine::ActiveLayerScope layerScope(E, &layer);
      cells.erase(std::remove_if(cells.begin(), cells.end(), [&](int k) {
        if (k < 0 || k >= E.cols * E.rows
            || layer.bodyOwner[k] != member->id)
          return false;
        E.writeGridIndexUnsafe(k, EMPTY);
        layer.bodyOwner[k] = -1;
        return true;
      }), cells.end());
    };
    auto stampMember = [&](Layer& layer, Body* member,
                           std::vector<int>& cells) {
      Engine::ActiveLayerScope layerScope(E, &layer);
      ensureBodyRaster(member);
      for (const BodyRasterCell& cell : member->rasterFootprint) {
        int k = cell.y * E.cols + cell.x;
        E.writeGridIndexUnsafe(k, bodyMaterialAt(member, cell.local));
        layer.bodyOwner[k] = member->id;
        cells.push_back(k);
        E.markLayerSimCell(&layer, k);
      }
    };
    Layer& ownLayer = entry.layer ? E.bg : E.fg;
    clearMember(ownLayer, body, ownLayer.bodyCells);
    if (body->jointRole == 1 && body->jointPeer)
      clearMember(E.bg, body->jointPeer, E.bg.passiveBodyCells);
    stampMember(ownLayer, body, ownLayer.bodyCells);
    if (body->jointRole == 1 && body->jointPeer)
      stampMember(E.bg, body->jointPeer, E.bg.passiveBodyCells);
    rigidSpawnSeparations++;
    rigidSpawnMaxSeparation = std::fmax(
      rigidSpawnMaxSeparation, std::hypot(bestDx, bestDy));
    for (const auto& cell : footprint) {
      int k = (cell.second + bestDy) * E.cols + cell.first + bestDx;
      spawnReservationStamp.add(k);
      E.markLayerSimCell(entry.layer ? &E.bg : &E.fg, k);
      if (body->jointRole == 1)
        E.markLayerSimCell(entry.layer ? &E.fg : &E.bg, k);
    }
  }
}

void RigidBodySystem::freezeCellsOntoBody(
    Layer& sourceLayer, int sourceBodyId, Layer& targetLayer,
    const std::vector<int>& cells) {
  if (cells.empty()) return;
  auto findBody = [](Layer& layer, int id) -> Body* {
    for (Body* body : layer.bodies)
      if (body->id == id) return body;
    return nullptr;
  };
  Body* source = findBody(sourceLayer, sourceBodyId);
  if (!source) return;

  struct FreezeCandidate { int i, j, waterK; };
  std::vector<FreezeCandidate> candidates;
  candidates.reserve(cells.size());
  double cs = std::cos(source->angle), sn = std::sin(source->angle);
  auto occupied = [&](int i, int j) {
    return i >= 0 && i < source->w && j >= 0 && j < source->h
        && source->occ[j * source->w + i];
  };
  for (int k : cells) {
    if (k < 0 || k >= E.cols * E.rows
        || targetLayer.grid[k] != WATER || targetLayer.bodyOwner[k] >= 0)
      continue;
    int y = k / E.cols, x = k - y * E.cols;
    double dx = x + 0.5 - source->px, dy = y + 0.5 - source->py;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - source->offsetX);
    int j = (int)std::lround(ly - source->offsetY);
    if (&sourceLayer == &targetLayer && occupied(i, j)) continue;
    if (!occupied(i, j)) {
      bool connected = false;
      for (int oy = -1; oy <= 1 && !connected; oy++)
        for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          if (occupied(i + ox, j + oy)) { connected = true; break; }
        }
      if (!connected) continue;
    }
    candidates.push_back({i, j, k});
  }
  std::sort(candidates.begin(), candidates.end(),
            [](const FreezeCandidate& a, const FreezeCandidate& b) {
              if (a.j != b.j) return a.j < b.j;
              if (a.i != b.i) return a.i < b.i;
              return a.waterK < b.waterK;
            });
  candidates.erase(
    std::unique(candidates.begin(), candidates.end(),
                [](const FreezeCandidate& a, const FreezeCandidate& b) {
                  return a.i == b.i && a.j == b.j;
                }),
    candidates.end());
  if (candidates.empty()) return;

  auto layerCellBlocks = [&](Layer& layer, int k) {
    int owner = layer.bodyOwner[k];
    if (owner >= 0) {
      bool ownCell = owner == source->id
        && (&layer == &sourceLayer || source->jointRole);
      return !ownCell;
    }
    uint8_t material = layer.grid[k];
    return material != EMPTY && !E.isGasMaterial(material)
        && !E.isBuoyantMedium(material);
  };
  auto localCellBlockedIn = [&](int i, int j, Layer& layer) {
    double lx = source->offsetX + i, ly = source->offsetY + j;
    double wx = source->px + lx * cs - ly * sn;
    double wy = source->py + lx * sn + ly * cs;
    double extent = 0.5 * (std::fabs(cs) + std::fabs(sn));
    if (wx - extent < 0 || wy - extent < 0
        || wx + extent > E.cols || wy + extent > E.rows) return true;
    int x0 = imax(0, (int)std::floor(wx - extent));
    int y0 = imax(0, (int)std::floor(wy - extent));
    int x1 = imin(E.cols - 1, (int)std::floor(wx + extent));
    int y1 = imin(E.rows - 1, (int)std::floor(wy + extent));
    constexpr double contactEpsilon = 1e-7;
    for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
      int k = y * E.cols + x;
      if (!layerCellBlocks(layer, k)) continue;
      double dx = x + 0.5 - wx, dy = y + 0.5 - wy;
      if (std::fabs(dx) >= extent + 0.5 - contactEpsilon
          || std::fabs(dy) >= extent + 0.5 - contactEpsilon
          || std::fabs(dx * cs + dy * sn)
               >= 0.5 + extent - contactEpsilon
          || std::fabs(-dx * sn + dy * cs)
               >= 0.5 + extent - contactEpsilon)
        continue;
      return true;
    }
    return false;
  };

  bool usesBothLayers = source->jointRole || &sourceLayer != &targetLayer;
  if (&sourceLayer != &targetLayer && !source->jointRole) {
    for (int j = 0; j < source->h; j++) for (int i = 0; i < source->w; i++) {
      if (!occupied(i, j)) continue;
      if (localCellBlockedIn(i, j, targetLayer)) return;
    }
  }
  candidates.erase(
    std::remove_if(candidates.begin(), candidates.end(),
      [&](const FreezeCandidate& candidate) {
        if (localCellBlockedIn(candidate.i, candidate.j, sourceLayer)) return true;
        if (!usesBothLayers) return false;
        Layer& peer = &sourceLayer == &E.fg ? E.bg : E.fg;
        return localCellBlockedIn(candidate.i, candidate.j, peer);
      }),
    candidates.end());
  if (candidates.empty()) return;

  Body* target = source;
  if (&sourceLayer != &targetLayer) {
    if (source->jointRole) {
      target = source->jointPeer;
      if (!target) return;
    } else {
      // A cross-layer attachment promotes the existing body to a shared-pose
      // pair. The missing layer starts empty and receives only the new cells.
      Body* peer = new Body(*source);
      std::vector<uint8_t> sourceMaterials(source->occ.size(), EMPTY);
      if (source->cellMaterials.empty()) {
        for (size_t i = 0; i < source->occ.size(); i++)
          if (source->occ[i]) sourceMaterials[i] = source->material;
      } else {
        sourceMaterials = source->cellMaterials;
      }
      source->cellMaterials = sourceMaterials;
      source->jointPeerMaterials.assign(source->occ.size(), EMPTY);
      peer->cellMaterials.assign(peer->occ.size(), EMPTY);
      peer->jointPeerMaterials = sourceMaterials;
      Body* leader = &sourceLayer == &E.fg ? source : peer;
      Body* follower = &sourceLayer == &E.bg ? source : peer;
      int oldId = source->id;
      int jointId = imax(E.fg.nextBodyId, E.bg.nextBodyId);
      bindJointBodies(leader, follower, jointId);
      for (int k : sourceLayer.bodyCells)
        if (sourceLayer.bodyOwner[k] == oldId)
          sourceLayer.bodyOwner[k] = jointId;
      (&sourceLayer == &E.fg ? E.bg : E.fg).bodies.push_back(peer);
      if (&sourceLayer == &E.bg) {
        std::vector<int> active;
        active.reserve(E.bg.bodyCells.size());
        for (int k : E.bg.bodyCells) {
          if (E.bg.bodyOwner[k] == jointId)
            E.bg.passiveBodyCells.push_back(k);
          else
            active.push_back(k);
        }
        E.bg.bodyCells = std::move(active);
      }
      computeDerived(leader, true);
      computeDerived(follower, true);
      syncJointFollower(leader);
      target = &targetLayer == &E.fg ? leader : follower;
    }
  }
  if (!target) return;

  Body* leader = target->jointRole == 2 ? target->jointPeer : target;
  Body* follower = leader && leader->jointRole == 1 ? leader->jointPeer : nullptr;
  Body* physical = leader ? leader : target;
  double momentumX = 0, momentumY = 0, angularMomentumOrigin = 0;
  if (physical->invMass > 0 && physical->invInertia > 0) {
    double oldMass = 1.0 / physical->invMass;
    momentumX = oldMass * physical->vx;
    momentumY = oldMass * physical->vy;
    angularMomentumOrigin = physical->omega / physical->invInertia
      + physical->px * momentumY - physical->py * momentumX;
  }
  for (const FreezeCandidate& candidate : candidates) {
    uint32_t packedVelocity = targetLayer.liquidVel.current
      ? targetLayer.liquidVel.current[candidate.waterK] : 0;
    double waterMomentumX = DENSITY[WATER]
      * E.liquidVelocityX(packedVelocity);
    double waterMomentumY = DENSITY[WATER]
      * E.liquidVelocityY(packedVelocity);
    int waterY = candidate.waterK / E.cols;
    int waterX = candidate.waterK - waterY * E.cols;
    momentumX += waterMomentumX;
    momentumY += waterMomentumY;
    angularMomentumOrigin += (waterX + 0.5) * waterMomentumY
                           - (waterY + 0.5) * waterMomentumX;
  }

  int minI = 0, minJ = 0, maxI = target->w - 1, maxJ = target->h - 1;
  for (const FreezeCandidate& candidate : candidates) {
    minI = imin(minI, candidate.i); minJ = imin(minJ, candidate.j);
    maxI = imax(maxI, candidate.i); maxJ = imax(maxJ, candidate.j);
  }

  int addLeft = -minI, addTop = -minJ;
  int newW = maxI - minI + 1, newH = maxJ - minJ + 1;
  auto resize = [&](Body* body) {
    if (newW == body->w && newH == body->h) return;
    int oldW = body->w, oldH = body->h;
    std::vector<uint8_t> occ((size_t)newW * newH, 0);
    std::vector<uint8_t> own, peer;
    if (!body->cellMaterials.empty())
      own.assign((size_t)newW * newH, EMPTY);
    if (!body->jointPeerMaterials.empty())
      peer.assign((size_t)newW * newH, EMPTY);
    for (int j = 0; j < oldH; j++) for (int i = 0; i < oldW; i++) {
      int oldLocal = j * oldW + i;
      int local = (j + addTop) * newW + i + addLeft;
      occ[local] = body->occ[oldLocal];
      if (!own.empty()) own[local] = body->cellMaterials[oldLocal];
      if (!peer.empty()) peer[local] = body->jointPeerMaterials[oldLocal];
    }
    body->occ = std::move(occ);
    if (!own.empty()) body->cellMaterials = std::move(own);
    if (!peer.empty()) body->jointPeerMaterials = std::move(peer);
    body->w = newW; body->h = newH;
    body->offsetX -= addLeft; body->offsetY -= addTop;
  };
  resize(target);
  if (follower) resize(target == leader ? follower : leader);

  for (const FreezeCandidate& candidate : candidates) {
    int local = (candidate.j + addTop) * newW + candidate.i + addLeft;
    if (target->cellMaterials.empty() && target->material != ICE) {
      target->cellMaterials.assign(target->occ.size(), EMPTY);
      for (size_t i = 0; i < target->occ.size(); i++)
        if (target->occ[i]) target->cellMaterials[i] = target->material;
    }
    target->occ[local] = 1;
    if (!target->cellMaterials.empty()) target->cellMaterials[local] = ICE;
    if (target->jointRole) {
      target->jointPeer->occ[local] = 1;
      target->jointPeer->jointPeerMaterials[local] = ICE;
    }
  }
  if (follower) {
    computeDerived(leader, true);
    computeDerived(follower, true);
    leader->vx = momentumX * leader->invMass;
    leader->vy = momentumY * leader->invMass;
    leader->omega = (angularMomentumOrigin
      - leader->px * momentumY + leader->py * momentumX)
      * leader->invInertia;
    syncJointFollower(leader);
  } else {
    computeDerived(target, true);
    target->vx = momentumX * target->invMass;
    target->vy = momentumY * target->invMass;
    target->omega = (angularMomentumOrigin
      - target->px * momentumY + target->py * momentumX)
      * target->invInertia;
  }

  Engine::ActiveLayerScope layerScope(E, &targetLayer);
  std::vector<int>& bodyCells = target->jointRole == 2
    ? targetLayer.passiveBodyCells : targetLayer.bodyCells;
  for (const FreezeCandidate& candidate : candidates) {
    int k = candidate.waterK;
    if (k < 0 || k >= E.cols * E.rows
        || targetLayer.grid[k] != WATER || targetLayer.bodyOwner[k] >= 0)
      continue;
    E.writeGridIndexUnsafe(k, ICE);
    targetLayer.bodyOwner[k] = target->id;
    bodyCells.push_back(k);
  }
  targetLayer.sleepingBodySupportDirty = true;
  if (E.bgEnabled) {
    E.comps.jointDirty = true;
    E.comps.jointBondsInvalid = true;
    E.comps.jointSupportValid = false;
  }
}
void RigidBodySystem::terrainNormalAt(Body* b, int cx, int cy, double bodyDensity, double& ox, double& oy) {
  int l = cx > 0 && isBodyTerrain(b, cx - 1, cy, bodyDensity) ? 1 : 0;
  int r = cx < E.cols - 1 && isBodyTerrain(b, cx + 1, cy, bodyDensity) ? 1 : 0;
  int u = cy > 0 && isBodyTerrain(b, cx, cy - 1, bodyDensity) ? 1 : 0;
  int d = cy < E.rows - 1 && isBodyTerrain(b, cx, cy + 1, bodyDensity) ? 1 : 0;
  double nx = l - r, ny = u - d;
  bool ambiguousSurface = (nx == 0 && ny == 0)
    || (nx != 0 && ny != 0);
  if ((solverMode == 13 || solverMode == 14 || solverMode == 16
        || (solverMode >= 20 && solverMode <= 22))
      && rigidStructureScaleBody(b) && ambiguousSurface) {
    auto solid = [&](int x, int y) {
      return x >= 0 && x < E.cols && y >= 0 && y < E.rows
        && isBodyTerrain(b, x, y, bodyDensity);
    };
    double smoothX = 0, smoothY = 0;
    if (solverMode == 13) {
      for (int q = -2; q <= 2; q++) {
        double weight = 3 - std::abs(q);
        smoothX += weight * (
            (solid(cx - 2, cy + q) ? 1 : 0)
          + 2 * (solid(cx - 1, cy + q) ? 1 : 0)
          - 2 * (solid(cx + 1, cy + q) ? 1 : 0)
          - (solid(cx + 2, cy + q) ? 1 : 0));
        smoothY += weight * (
            (solid(cx + q, cy - 2) ? 1 : 0)
          + 2 * (solid(cx + q, cy - 1) ? 1 : 0)
          - 2 * (solid(cx + q, cy + 1) ? 1 : 0)
          - (solid(cx + q, cy + 2) ? 1 : 0));
      }
    } else {
      for (int q = -1; q <= 1; q++) {
        double weight = 2 - std::abs(q);
        smoothX += weight * (
            (solid(cx - 1, cy + q) ? 1 : 0)
          - (solid(cx + 1, cy + q) ? 1 : 0));
        smoothY += weight * (
            (solid(cx + q, cy - 1) ? 1 : 0)
          - (solid(cx + q, cy + 1) ? 1 : 0));
      }
    }
    if (smoothX != 0 || smoothY != 0) {
      nx = smoothX;
      ny = smoothY;
    }
  }
  if (nx == 0 && ny == 0) {
    double bx = b->px - (cx + 0.5), by = b->py - (cy + 0.5);
    if (std::fabs(bx) > std::fabs(by)) {
      ox = bx < 0 ? -1 : 1; oy = 0;
    } else {
      ox = 0; oy = by < 0 ? -1 : 1;
    }
    return;
  }
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
  if (nlx == 0 && nly == 0) {
    double dx = wx - b->px, dy = wy - b->py;
    double lx = dx * b->cs + dy * b->sn;
    double ly = -dx * b->sn + dy * b->cs;
    int left = 1, right = 1, up = 1, down = 1;
    while (at(i - left, j)) left++;
    while (at(i + right, j)) right++;
    while (at(i, j - up)) up++;
    while (at(i, j + down)) down++;
    double dl = lx - (b->offsetX + i - left + 0.5);
    double dr = b->offsetX + i + right - 0.5 - lx;
    double du = ly - (b->offsetY + j - up + 0.5);
    double dd = b->offsetY + j + down - 0.5 - ly;
    nlx = -1; nly = 0; double nearest = dl;
    if (dr < nearest) { nearest = dr; nlx = 1; nly = 0; }
    if (du < nearest) { nearest = du; nlx = 0; nly = -1; }
    if (dd < nearest) { nlx = 0; nly = 1; }
  }
  double wx2 = nlx * b->cs - nly * b->sn, wy2 = nlx * b->sn + nly * b->cs;
  double inv = 1 / std::sqrt(wx2 * wx2 + wy2 * wy2); ox = wx2 * inv; oy = wy2 * inv;
}
double RigidBodySystem::resolveContact(Contact& c) {
  return resolveContactNormal(c) + resolveContactFriction(c);
}
double RigidBodySystem::resolveContactNormal(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double rvx = A->vx - A->omega * c.ray, rvy = A->vy + A->omega * c.rax;
  if (B) {
    rvx -= rigidContactVx(B) - rigidContactOmega(B) * c.rby;
    rvy -= rigidContactVy(B) + rigidContactOmega(B) * c.rbx;
  }
  double vn = rvx * c.nx + rvy * c.ny;
  double movedN = 0;
  if (c.normalMass > 0) {
    double delta = (c.targetVn - vn) * c.normalMass;
    double newJn = c.accJn + delta; if (newJn < 0) newJn = 0;
    double applied = newJn - c.accJn; c.accJn = newJn;
    movedN = std::fabs(applied);
    double jx = applied * c.nx, jy = applied * c.ny;
    A->vx += jx * c.aInvM; A->vy += jy * c.aInvM; A->omega += c.aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * c.bInvM; B->vy -= jy * c.bInvM; B->omega -= c.bInvI * (c.rbx * jy - c.rby * jx); }
  }
  return movedN;
}
// The soft normal impulse and bias-free relaxation use Box2D's MIT-licensed
// massScale/impulseScale contact formulation.
// https://github.com/erincatto/box2d/blob/main/src/contact_solver.c
double RigidBodySystem::resolveContactNormalSoft(Contact& c, bool useBias) {
  Body* A = c.a;
  Body* B = c.b;
  double rvx = A->vx - A->omega * c.ray;
  double rvy = A->vy + A->omega * c.rax;
  if (B) {
    rvx -= rigidContactVx(B) - rigidContactOmega(B) * c.rby;
    rvy -= rigidContactVy(B) + rigidContactOmega(B) * c.rbx;
  }
  double vn = rvx * c.nx + rvy * c.ny;
  if (c.normalMass <= 0) return 0;
  double massScale = useBias ? c.softMassScale : 1;
  double impulseScale = useBias ? c.softImpulseScale : 0;
  double bias = 0;
  if (useBias) {
    double penetration = std::fmax(0.0, c.depth - rigidContactSlop(c));
    bias = std::fmin(
      R_MAX_BIAS_VEL,
      c.softMassScale * c.softBiasRate * penetration);
  }
  double delta = c.normalMass * (bias - massScale * vn)
    - impulseScale * c.accJn;
  double next = std::fmax(0.0, c.accJn + delta);
  double applied = next - c.accJn;
  c.accJn = next;
  double jx = applied * c.nx, jy = applied * c.ny;
  A->vx += jx * c.aInvM;
  A->vy += jy * c.aInvM;
  A->omega += c.aInvI * (c.rax * jy - c.ray * jx);
  if (B) {
    B->vx -= jx * c.bInvM;
    B->vy -= jy * c.bInvM;
    B->omega -= c.bInvI * (c.rbx * jy - c.rby * jx);
  }
  return std::fabs(applied);
}
double RigidBodySystem::resolveContactFriction(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double tx = -c.ny, ty = c.nx;
  double rtvx = A->vx - A->omega * c.ray, rtvy = A->vy + A->omega * c.rax;
  if (B) {
    rtvx -= rigidContactVx(B) - rigidContactOmega(B) * c.rby;
    rtvy -= rigidContactVy(B) + rigidContactOmega(B) * c.rbx;
  }
  double vt = rtvx * tx + rtvy * ty;
  double movedT = 0;
  if (c.tangentMass > 0) {
    double candidate = c.accJt - vt * c.tangentMass;
    double coefficient = std::fabs(vt) <= R_STATIC_FRICTION_SPEED
      ? c.staticFriction : c.dynamicFriction;
    double limit = coefficient * c.accJn;
    double newJt = candidate;
    if (newJt > limit) newJt = limit;
    else if (newJt < -limit) newJt = -limit;
    double applied = newJt - c.accJt; c.accJt = newJt;
    movedT = std::fabs(applied);
    double jx = applied * tx, jy = applied * ty;
    A->vx += jx * c.aInvM; A->vy += jy * c.aInvM; A->omega += c.aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * c.bInvM; B->vy -= jy * c.bInvM; B->omega -= c.bInvI * (c.rbx * jy - c.rby * jx); }
  }
  return movedT;
}
double RigidBodySystem::resolveContactBlock(Contact& first, Contact& second) {
  Body* A = first.a;
  Body* B = first.b;
  double spanX = (A->px + first.rax) - (A->px + second.rax);
  double spanY = (A->py + first.ray) - (A->py + second.ray);
  if (second.a != A || second.b != B
      || first.nx * second.nx + first.ny * second.ny < 0.99
      || first.targetVn > 0 || second.targetVn > 0
      || spanX * spanX + spanY * spanY < R_BLOCK_SOLVE_MIN_SPAN2)
    return resolveContact(first) + resolveContact(second);
  double aInvM = first.aInvM;
  double aInvI = first.aInvI;
  double bInvM = first.bInvM;
  double bInvI = first.bInvI;
  auto normalVelocity = [&](const Contact& contact) {
    double rvx = A->vx - A->omega * contact.ray;
    double rvy = A->vy + A->omega * contact.rax;
    if (B) {
      rvx -= rigidContactVx(B) - rigidContactOmega(B) * contact.rby;
      rvy -= rigidContactVy(B) + rigidContactOmega(B) * contact.rbx;
    }
    return rvx * contact.nx + rvy * contact.ny;
  };
  double rnA1 = first.rax * first.ny - first.ray * first.nx;
  double rnA2 = second.rax * second.ny - second.ray * second.nx;
  double rnB1 = B ? first.rbx * first.ny - first.rby * first.nx : 0;
  double rnB2 = B ? second.rbx * second.ny - second.rby * second.nx : 0;
  double k11 = aInvM + bInvM + aInvI * rnA1 * rnA1 + bInvI * rnB1 * rnB1;
  double k22 = aInvM + bInvM + aInvI * rnA2 * rnA2 + bInvI * rnB2 * rnB2;
  double k12 = aInvM + bInvM + aInvI * rnA1 * rnA2 + bInvI * rnB1 * rnB2;
  double determinant = k11 * k22 - k12 * k12;
  double largestMass = std::fmax(k11, k22);
  if (k11 <= 0 || k22 <= 0
      || determinant <= 1e-3 * largestMass * largestMass)
    return resolveContact(first) + resolveContact(second);

  double old1 = first.accJn, old2 = second.accJn;
  double b1 = normalVelocity(first) - first.targetVn - k11 * old1 - k12 * old2;
  double b2 = normalVelocity(second) - second.targetVn - k12 * old1 - k22 * old2;
  double next1 = 0, next2 = 0;
  bool solved = false;

  double invDet = 1 / determinant;
  double both1 = (k12 * b2 - k22 * b1) * invDet;
  double both2 = (k12 * b1 - k11 * b2) * invDet;
  if (both1 >= 0 && both2 >= 0) {
    next1 = both1;
    next2 = both2;
    solved = true;
  }
  if (!solved) {
    double one = -b1 / k11;
    if (one >= 0 && k12 * one + b2 >= 0) {
      next1 = one;
      next2 = 0;
      solved = true;
    }
  }
  if (!solved) {
    double two = -b2 / k22;
    if (two >= 0 && k12 * two + b1 >= 0) {
      next1 = 0;
      next2 = two;
      solved = true;
    }
  }
  if (!solved && b1 >= 0 && b2 >= 0) solved = true;
  if (!solved) return resolveContact(first) + resolveContact(second);

  rigidBlockSolves++;
  double delta1 = next1 - old1;
  double delta2 = next2 - old2;
  first.accJn = next1;
  second.accJn = next2;
  double jx = delta1 * first.nx + delta2 * second.nx;
  double jy = delta1 * first.ny + delta2 * second.ny;
  A->vx += jx * aInvM;
  A->vy += jy * aInvM;
  A->omega += aInvI
    * (delta1 * (first.rax * first.ny - first.ray * first.nx)
       + delta2 * (second.rax * second.ny - second.ray * second.nx));
  if (B) {
    B->vx -= jx * bInvM;
    B->vy -= jy * bInvM;
    B->omega -= bInvI
      * (delta1 * (first.rbx * first.ny - first.rby * first.nx)
         + delta2 * (second.rbx * second.ny - second.rby * second.nx));
  }
  return std::fabs(delta1) + std::fabs(delta2)
    + resolveContactFriction(first) + resolveContactFriction(second);
}
// One bounded angular impulse per manifold opposes relative rolling without
// damping free rotation. This is the rolling-resistance constraint used by
// Box2D's MIT-licensed contact solver.
// https://github.com/erincatto/box2d/blob/main/src/contact_solver.c
double RigidBodySystem::resolveContactRolling(
    Contact& first, Contact* second) {
  Body* A = first.a;
  Body* B = first.b;
  if (solverMode != 3 || (B && B->kinematic)) return 0;
  double inverseInertia = first.aInvI + first.bInvI;
  if (inverseInertia <= 0) return 0;
  double relativeOmega = A->omega - (B ? rigidContactOmega(B) : 0);
  double normalImpulse = first.accJn
    + (second ? second->accJn : 0);
  double limit = R_ROLLING_RESISTANCE * normalImpulse;
  double next = first.accRolling - relativeOmega / inverseInertia;
  next = std::fmax(-limit, std::fmin(limit, next));
  double applied = next - first.accRolling;
  first.accRolling = next;
  A->omega += first.aInvI * applied;
  if (B) B->omega -= first.bInvI * applied;
  return std::fabs(applied);
}
void RigidBodySystem::applyWarmStart(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double tx = -c.ny, ty = c.nx;
  double jx = c.accJn * c.nx + c.accJt * tx;
  double jy = c.accJn * c.ny + c.accJt * ty;
  A->vx += jx * c.aInvM; A->vy += jy * c.aInvM;
  A->omega += c.aInvI * (c.rax * jy - c.ray * jx);
  if (B) {
    B->vx -= jx * c.bInvM; B->vy -= jy * c.bInvM;
    B->omega -= c.bInvI * (c.rbx * jy - c.rby * jx);
  }
}
double RigidBodySystem::resolveBias(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  if ((solverMode == 32 || solverMode == 40 || solverMode == 46)
      && B && !c.bIntegrated) return 0;
  double slop = rigidContactSlop(c);
  double bias = R_BAUMGARTE * std::fmax(0.0, c.depth - slop);
  if (bias <= 0) return 0; if (bias > R_MAX_BIAS_VEL) bias = R_MAX_BIAS_VEL;
  double rvx = A->pvx - A->pw * c.ray, rvy = A->pvy + A->pw * c.rax;
  if (B && c.bIntegrated) {
    rvx -= B->pvx - B->pw * c.rby;
    rvy -= B->pvy + B->pw * c.rbx;
  }
  double vn = rvx * c.nx + rvy * c.ny; if (vn >= bias) return 0;
  if (c.biasMass <= 0) return 0;
  double delta = (bias - vn) * c.biasMass;
  double newJ = c.accBias + delta; if (newJ < 0) newJ = 0;
  double applied = newJ - c.accBias; c.accBias = newJ;
  double jx = applied * c.nx, jy = applied * c.ny;
  int traceLayer = E.L == &E.bg ? 1 : 0;
  int traceKind = !B ? 0 : (c.bIntegrated ? 1 : 2);
  if (rigidTraceLayer == traceLayer && A->id == rigidTraceBodyId) {
    rigidTraceBiasByKind[traceKind][0] += jx * c.aInvM * c.dt;
    rigidTraceBiasByKind[traceKind][1] += jy * c.aInvM * c.dt;
    rigidTraceBiasByKind[traceKind][2] += c.aInvI
      * (c.rax * jy - c.ray * jx) * c.dt;
  }
  if (B && c.bIntegrated && rigidTraceLayer == traceLayer
      && B->id == rigidTraceBodyId) {
    rigidTraceBiasByKind[traceKind][0] -= jx * c.bInvM * c.dt;
    rigidTraceBiasByKind[traceKind][1] -= jy * c.bInvM * c.dt;
    rigidTraceBiasByKind[traceKind][2] -= c.bInvI
      * (c.rbx * jy - c.rby * jx) * c.dt;
  }
  A->pvx += jx * c.aInvM; A->pvy += jy * c.aInvM; A->pw += c.aInvI * (c.rax * jy - c.ray * jx);
  if (B && c.bIntegrated) {
    B->pvx -= jx * c.bInvM;
    B->pvy -= jy * c.bInvM;
    B->pw -= c.bInvI * (c.rbx * jy - c.rby * jx);
  }
  return std::fabs(applied);
}
void RigidBodySystem::resetSleepTracking(Body* b) {
  b->stillTicks = 0;
  b->worldStillTicks = 0;
  b->restProbeTicks = 0;
  b->sleepSupports.clear();
  b->bakeBlockedByBody = false;
  b->rasterAssignmentLocked = false;
  b->rasterLockCell = -1;
  b->rasterLockOwner = -2;
}
void RigidBodySystem::wakeBody(Body* b) {
  if (b->jointRole == 2 && b->jointPeer) b = b->jointPeer;
  if (!bodyFullyInsideLoadedWindow(b)) return;
  b->awake = true;
  resetSleepTracking(b);
  if (b->jointRole == 1) syncJointFollower(b);
}
void RigidBodySystem::wakeBodiesTouchingCells(
    Layer& layer, const std::vector<std::pair<int, int>>& cells) {
  std::unordered_set<int> touchingIds;
  for (const auto& cell : cells) {
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int x = cell.first + ox, y = cell.second + oy;
      if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
      int owner = layer.bodyOwner[y * E.cols + x];
      if (owner >= 0) touchingIds.insert(owner);
    }
  }
  if (touchingIds.empty()) return;
  for (Body* body : layer.bodies)
    if (touchingIds.count(body->id)) wakeBody(body);
}
void RigidBodySystem::syncJointFollower(Body* leader) {
  if (!leader || leader->jointRole != 1 || !leader->jointPeer) return;
  Body* follower = leader->jointPeer;
  follower->px = leader->px; follower->py = leader->py; follower->angle = leader->angle;
  follower->vx = leader->vx; follower->vy = leader->vy; follower->omega = leader->omega;
  follower->awake = leader->awake; follower->stillTicks = leader->stillTicks;
  follower->worldStillTicks = leader->worldStillTicks;
  follower->fuseTicks = leader->fuseTicks;
  follower->fuseLocalX = leader->fuseLocalX;
  follower->fuseLocalY = leader->fuseLocalY;
  follower->restProbePoints = leader->restProbePoints;
  follower->restProbeTicks = leader->restProbeTicks;
  follower->sleepSupports = leader->sleepSupports;
  follower->bakeSupportedPoseTicks = leader->bakeSupportedPoseTicks;
  follower->acceptedWorldPx = leader->acceptedWorldPx;
  follower->acceptedWorldPy = leader->acceptedWorldPy;
  follower->acceptedAngle = leader->acceptedAngle;
  follower->acceptedRasterPoseValid = leader->acceptedRasterPoseValid;
  follower->cs = leader->cs; follower->sn = leader->sn;
}
void RigidBodySystem::breakJointBody(Body* member) {
  if (!member || !member->jointRole || !member->jointPeer) return;
  Body* leader = member->jointRole == 1 ? member : member->jointPeer;
  Body* follower = leader->jointPeer;
  syncJointFollower(leader);
  auto keepOwnLayer = [&](Body* body) {
    for (size_t i = 0; i < body->occ.size(); i++)
      body->occ[i] = body->cellMaterials[i] != EMPTY;
    body->jointPeerMaterials.clear();
    computeDerived(body, true);
  };
  unbindJointBodies(leader, follower);
  keepOwnLayer(leader);
  keepOwnLayer(follower);
  std::vector<int> stillPassive;
  stillPassive.reserve(E.bg.passiveBodyCells.size());
  for (int k : E.bg.passiveBodyCells) {
    if (k >= 0 && k < E.cols * E.rows && E.bg.bodyOwner[k] == follower->id)
      E.bg.bodyCells.push_back(k);
    else
      stillPassive.push_back(k);
  }
  E.bg.passiveBodyCells = std::move(stillPassive);
}
void RigidBodySystem::rigidStep(double tickDt) {
  double rigidStageStart = emscripten_get_now();
#include "rigid_step_prepare.inc"
  rigidStepPrepareMs += emscripten_get_now() - rigidStageStart;
  rigidStageStart = emscripten_get_now();
#include "rigid_step_contacts.inc"
  rigidContactSetupMs += emscripten_get_now() - rigidStageStart;
  rigidStageStart = emscripten_get_now();
#include "rigid_step_substeps.inc"
  rigidStageStart = emscripten_get_now();
#include "rigid_step_finalize.inc"
  rigidStepFinalizeMs += emscripten_get_now() - rigidStageStart;
  rigidFluidReferenceTotalMs += fluidReferenceMs;
  rigidFluidDomainTotalMs += fluidDomainMs;
  rigidFluidMatrixTotalMs += fluidMatrixMs;
  rigidFluidSolveTotalMs += fluidSolveMs;
  rigidFluidWritebackTotalMs += fluidWritebackMs;
  rigidFluidNodesTotal += fluidNodeCount;
  rigidFluidFacesTotal += fluidFaceCount;
  rigidFluidIterationsTotal += fluidPressureIterations;
  // Background contacts resolve against the physical foreground leader. Mirror
  // any resulting motion into its passive background footprint.
  if (E.L == &E.bg)
    for (const auto& entry : peerJointLeaders)
      syncJointFollower(entry.second);
  if (E.reactions.acceptsRigidContacts()) {
    for (const Contact& contact : contacts) {
      if (!contact.b || !contact.bIntegrated
          || contact.a->kinematic || contact.b->kinematic) continue;
      double ax = contact.a->px + contact.rax;
      double ay = contact.a->py + contact.ray;
      double bx = contact.b->px + contact.rbx;
      double by = contact.b->py + contact.rby;
      E.reactions.recordRigidContact({
        E.L, contact.a->id, contact.b->id,
        ax, ay, bx, by, contact.impactSpeed, contact.nx, contact.ny,
      });
      E.reactions.recordRigidContact({
        E.L, contact.b->id, contact.a->id,
        bx, by, ax, ay, contact.impactSpeed, -contact.nx, -contact.ny,
      });
    }
  }
}
void RigidBodySystem::ensureBodyRaster(Body* b) {
  // Inverse rasterization: for each grid cell in the body's world AABB, map its
  // center back into occ space and stamp if filled. This is hole-free for
  // rotated E.L->bodies (forward occ->world point-sampling instead leaves gaps
  // between rotated E.rows). The body shape stays authoritative in occ.
  bool cacheValid = b->rasterFootprintValid
    && b->rasterPx == b->px
    && b->rasterPy == b->py
    && b->rasterAngle == b->angle
    && b->rasterGeometryRevision == b->geometryRevision
    && b->rasterCols == E.cols
    && b->rasterRows == E.rows;
  if (cacheValid) return;
  double sn = std::sin(b->angle), cs = std::cos(b->angle);
  double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
  double minWX = 1e18, minWY = 1e18, maxWX = -1e18, maxWY = -1e18;
  auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < minWX) minWX = wx; if (wx > maxWX) maxWX = wx; if (wy < minWY) minWY = wy; if (wy > maxWY) maxWY = wy; };
  corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
  int x0 = (int)std::floor(minWX), x1 = (int)std::floor(maxWX), y0 = (int)std::floor(minWY), y1 = (int)std::floor(maxWY);
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= E.cols) x1 = E.cols - 1; if (y1 >= E.rows) y1 = E.rows - 1;
  b->rasterFootprint.clear();
  b->rasterBoundaryFootprint.clear();
  for (int wy = y0; wy <= y1; wy++) for (int wx = x0; wx <= x1; wx++) {
    double dx = wx + 0.5 - b->px, dy = wy + 0.5 - b->py;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
    if (i < 0 || i >= b->w || j < 0 || j >= b->h) continue;
    int local = j * b->w + i;
    if (b->occ[local] && bodyMaterialAt(b, local) != EMPTY) {
      b->rasterFootprint.push_back({wx, wy, local});
      if (b->erosionBoundaryMask[local])
        b->rasterBoundaryFootprint.push_back({wx, wy, local});
    }
  }
  b->rasterPx = b->px;
  b->rasterPy = b->py;
  b->rasterAngle = b->angle;
  b->rasterGeometryRevision = b->geometryRevision;
  b->rasterCols = E.cols;
  b->rasterRows = E.rows;
  b->rasterFootprintValid = true;
}

template <class F> void RigidBodySystem::forEachBodyCell(Body* b, F cb) {
  ensureBodyRaster(b);
  for (const BodyRasterCell& cell : b->rasterFootprint)
    cb(cell.x, cell.y, cell.local);
}
int RigidBodySystem::localCellAt(Body* b, double wx, double wy) {
  double dx = wx - b->px, dy = wy - b->py;
  double cs = std::cos(b->angle), sn = std::sin(b->angle);
  double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
  int i = (int)std::lround(lx - b->offsetX);
  int j = (int)std::lround(ly - b->offsetY);
  if (i < 0 || i >= b->w || j < 0 || j >= b->h) return -1;
  int k = j * b->w + i;
  return b->occ[k] ? k : -1;
}
bool RigidBodySystem::eraseLocalCell(Body* b, int idx) {
  if (idx < 0 || idx >= (int)b->occ.size() || !b->occ[idx]) return false;
  if (b->jointRole) breakJointBody(b);
  if (!b->occ[idx]) return false;
  b->occ[idx] = 0;
  if (!b->cellMaterials.empty()) b->cellMaterials[idx] = EMPTY;
  b->rasterFootprintValid = false;
  return true;
}

// Terrain and medium queries used by free bodies.
bool RigidBodySystem::isBodyTerrain(Body* body, int x, int y, double bodyDensity) {
  (void)bodyDensity;
  // The side sentinels bound the streamed cell window, not the physical world.
  // Treating them as terrain lets wall friction pin a buoyant body that happens
  // to straddle a streaming edge.
  if (E.L->infinite && (x == 0 || x == E.cols - 1)) return false;
  int k = y * E.cols + x;
  auto solidIn = [&](Layer& lay, bool peerLayer) {
    int owner = lay.bodyOwner[k];
    if (owner >= 0) {
      if (body && owner == body->id
          && (!peerLayer || body->jointRole == 1)) return false;
      // Owner cells stay present in the grid sweep. Same-layer ordinary bodies
      // use the body/body broad phase, while rigidStep promotes peer-layer owner
      // hits to dynamic contacts after the sweep identifies their exact cells.
      // Passive followers without an active leader mapping remain terrain.
      return peerLayer || lay.passiveBodyIds.count(owner) != 0;
    }
    uint8_t material = lay.grid[k];
    if (E.isBuoyantMedium(material)) return false;
    return E.isRigidMaterialClass(material);
  };
  if (body && body->jointRole == 1)
    return solidIn(E.fg, false) || solidIn(E.bg, true);
  return solidIn(*E.L, false);
}
bool RigidBodySystem::coupleLiquids(const std::vector<Body*>& bodies, double dt) {
#include "rigid_fluid_domain.inc"
#include "rigid_fluid_projection.inc"
#include "rigid_fluid_solve.inc"
#include "rigid_fluid_writeback.inc"
}
double RigidBodySystem::granularMediumDensityAt(int x, int y) {
  if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return 0;
  uint8_t material = E.L->grid[y * E.cols + x];
  return E.isLooseSolidMaterial(material) ? DENSITY[material] : 0;
}
// Loose media are relocatable: a body submerging into liquid or powder, or
// sweeping through gas, spills that cell around its new footprint. Only liquids
// provide upward buoyancy; powders can support, but only by cancelling gravity.
bool RigidBodySystem::isBodyRelocatable(uint8_t m, int k, double bodyDensity) { (void)k; (void)bodyDensity; return E.isBuoyantMedium(m) || E.isGasMaterial(m); }
// Gas never supports or blocks a body, but is still relocated by the commit.
bool RigidBodySystem::canBodyOccupy(uint8_t m, int k, double bodyDensity) { return m == EMPTY || E.isGasMaterial(m) || isBodyRelocatable(m, k, bodyDensity); }
void RigidBodySystem::spillDisplacedBodyMaterial(
    std::vector<Disp>& displaced, const std::vector<int>& edgeFootprint,
    int32_t footprintGen, int bodyId, double bodyDensity,
    PersistentCellOperation operation,
    const std::vector<int>* vacated) {
  if (displaced.empty()) return;
  rigidSpillDisplaced += (int)displaced.size();
  (void)bodyDensity;
  // Spread displaced liquid/powder laterally and downward before upward; gas
  // searches upward first. A body plunging into a pool then distributes the rise
  // across the surface instead of firing a narrow fountain straight up out of
  // the entry column ("lava out the top").
  int offs[4] = {-1, 1, E.cols, -E.cols};
  int gasOffs[4] = {-E.cols, -1, 1, E.cols};
  int gridLen = E.cols * E.rows;
  uint8_t footprintLiquid = EMPTY;
  bool mixedLiquidFootprint = false;
  auto noteFootprintLiquid = [&](uint8_t material) {
    if (!E.isLiquidMaterial(material)) return;
    if (footprintLiquid == EMPTY)
      footprintLiquid = material;
    else if (footprintLiquid != material)
      mixedLiquidFootprint = true;
  };
  for (const Disp& cell : displaced) noteFootprintLiquid(cell.material);
  int footprintMinX = E.cols, footprintMaxX = -1, footprintMaxY = -1;
  for (int k : edgeFootprint) {
    int y = k / E.cols, x = k - y * E.cols;
    footprintMinX = imin(footprintMinX, x);
    footprintMaxX = imax(footprintMaxX, x);
    footprintMaxY = imax(footprintMaxY, y);
    if (x > 0) noteFootprintLiquid(E.L->grid[k - 1]);
    if (x + 1 < E.cols) noteFootprintLiquid(E.L->grid[k + 1]);
    if (y > 0) noteFootprintLiquid(E.L->grid[k - E.cols]);
    if (y + 1 < E.rows) noteFootprintLiquid(E.L->grid[k + E.cols]);
  }
  for (int y = footprintMaxY + 1;
       y < E.rows && y <= footprintMaxY + R_FLUID_REFERENCE_SEARCH; y++)
    for (int x = footprintMinX; x <= footprintMaxX; x++)
      noteFootprintLiquid(E.L->grid[y * E.cols + x]);
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
  auto isPassable = [&](uint8_t m, int k) { return m == EMPTY || E.isGasMaterial(m) || (E.isLiquidMaterial(m) && DENSITY[m] <= curD) || (E.isLooseSolidMaterial(m) && (E.L->groundedCell[k] != 1 || DENSITY[m] <= curD)); };
  int32_t reservedGen = E.L->nextSeenGeneration();
  auto inFootprint = [&](int k) { return E.L->rigidSpillFootprint[k] == footprintGen; };
  auto inOwnFootprint = [&](int k) { return inFootprint(k) && E.L->bodyOwner[k] == bodyId; };
  auto isDropTarget = [&](int k, uint8_t mat) { if (inFootprint(k) || E.L->rigidSpillReserved[k] == reservedGen || E.isBodyCell(k)) return false; uint8_t m = E.L->grid[k]; if (m == EMPTY) return true; return (E.isLiquidMaterial(m) || E.isGasMaterial(m) || E.isLooseSolidMaterial(m)) && DENSITY[m] < DENSITY[mat]; };
  // Footprint-edge seeds (used when a displaced cell's own neighbours are all
  // blocked). Permissive — any fluid/empty/gas/loose powder; canVisit re-filters
  // per displaced material once curD is set in the worklist loop below.
  auto seedPassable = [&](uint8_t m, int k) { (void)k; return m == EMPTY || E.isGasMaterial(m) || E.isBuoyantMedium(m); };
  std::vector<int> footprintEdgeStarts;
  bool footprintEdgesBuilt = false;
  auto buildFootprintEdgeStarts = [&]() {
    if (footprintEdgesBuilt) return;
    footprintEdgesBuilt = true;
    int32_t edgeGen = E.L->nextSeenGeneration();
    std::vector<int> sortedFootprint(
      edgeFootprint.begin(), edgeFootprint.end());
    std::sort(sortedFootprint.begin(), sortedFootprint.end());
    for (int k : sortedFootprint) for (int off : offs) {
      int nk = k + off;
      if (nk <= 0 || nk >= gridLen || E.L->seenStamp[nk] == edgeGen)
        continue;
      int y = nk / E.cols, x = nk - y * E.cols;
      if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows)
        continue;
      if (!seedPassable(E.L->grid[nk], nk)) continue;
      E.L->seenStamp[nk] = edgeGen;
      footprintEdgeStarts.push_back(nk);
    }
  };
  std::vector<int> preferredVacancies;
  if (vacated) {
    preferredVacancies.assign(vacated->begin(), vacated->end());
    std::sort(preferredVacancies.begin(), preferredVacancies.end());
  }
  // Intentionally batch by material: each density/material group gets one
  // multi-source BFS instead of clearing a queue and searching once per displaced
  // cell. Heavier groups run first so they claim spill targets before lighter
  // material; evicted lighter material is processed in later waves.
  std::vector<Disp> pending = displaced, nextPending;
  std::vector<int> queue, targets, surfaceTargets, fallbackTargets;
  for (int wave = 0; !pending.empty() && wave < MATERIAL_COUNT + 4; wave++) {
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
      const int* searchOffs = E.isGasMaterial(mat) ? gasOffs : offs;
      int need = (int)(gj - gi);
      queue.clear(); targets.clear(); surfaceTargets.clear();
      fallbackTargets.clear();
      // Exchange leading-edge displacement with the same body's trailing
      // vacancies before searching the wider pool. This keeps liquid wrapped
      // around a translating body instead of ejecting it to a distant free
      // surface and leaving an artificial dry wake.
      if (vacated) {
        for (int k : preferredVacancies) {
          if ((int)targets.size() >= need) break;
          if (!isDropTarget(k, mat)) continue;
          // Do not pump loose material into a dry trailing cell above its free
          // surface. Local exchange targets must remain connected to compatible
          // medium; otherwise the exterior search finds the real outlet.
          bool connected = E.L->grid[k] != EMPTY;
          int y = k / E.cols, x = k - y * E.cols;
          if (!connected) {
            const int offsets[4] = {-1, 1, -E.cols, E.cols};
            for (int offset : offsets) {
              if ((offset == -1 && x == 0) || (offset == 1 && x + 1 >= E.cols)
                  || (offset == -E.cols && y == 0)
                  || (offset == E.cols && y + 1 >= E.rows))
                continue;
              uint8_t neighbor = E.L->grid[k + offset];
              if (E.isBuoyantMedium(neighbor)
                  && DENSITY[neighbor] <= DENSITY[mat]) {
                connected = true;
                break;
              }
            }
          }
          if (!connected) continue;
          E.L->rigidSpillReserved[k] = reservedGen;
          targets.push_back(k);
        }
      }
      if ((int)targets.size() < need) rigidSpillSearches++;
      int32_t seenGen = E.L->nextSeenGeneration();
      auto canVisit = [&](int k) {
        if (k <= 0 || k >= gridLen || E.L->rigidSpillReserved[k] == reservedGen || E.L->seenStamp[k] == seenGen) return false;
        int y = k / E.cols, x = k - y * E.cols;
        if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return false;
        // A displaced cell can be enclosed by the body's newly rasterized
        // footprint (most often after rotation). Traverse this body's cells for
        // distance only so every source reaches its nearest exterior outlet;
        // other bodies remain barriers and isDropTarget still rejects all body
        // cells. Seeding only exterior neighbours let one exposed tip route the
        // entire batch through itself.
        if (inFootprint(k)) return inOwnFootprint(k);
        return isPassable(E.L->grid[k], k);
      };
      auto enqueue = [&](int k) { if (!canVisit(k)) return; E.L->seenStamp[k] = seenGen; queue.push_back(k); };
      for (size_t di = gi; di < gj; di++) {
        int from = pending[di].from;
        if (inOwnFootprint(from)) enqueue(from);
        else for (int oi = 0; oi < 4; oi++)
          enqueue(from + searchOffs[oi]); // density-chain eviction outside the body
      }
      if (queue.empty()) {
        buildFootprintEdgeStarts();
        for (int nk : footprintEdgeStarts) enqueue(nk);
      }
      int visitBudget = imin(gridLen, imax(4096, need * 128));
      int surfaceGoal = imax(64, need * 8);
      int visits = 0;
      size_t qi = 0;
      auto visitCell = [&](int k) {
        if (isDropTarget(k, mat)) {
          // Liquid exits at a supported free-surface cell when one is reachable.
          // Dry cells bordering the body remain a volume-preserving fallback.
          bool dryLiquidOutlet = (mixedLiquidFootprint
              || DENSITY[mat] < DENSITY[WATER] - 1e-6)
            && E.isLiquidMaterial(mat)
            && E.L->grid[k] == EMPTY;
          bool hasLiquidBelow = k + E.cols < gridLen
            && !inFootprint(k + E.cols)
            && !E.isBodyCell(k + E.cols)
            && E.isLiquidMaterial(E.L->grid[k + E.cols]);
          if (dryLiquidOutlet) {
            if (hasLiquidBelow)
              surfaceTargets.push_back(k);
            else if ((int)fallbackTargets.size() < need)
              fallbackTargets.push_back(k);
            return;
          }
          E.L->rigidSpillReserved[k] = reservedGen;
          targets.push_back(k);
        }
        for (int oi = 0; oi < 4; oi++) enqueue(k + searchOffs[oi]);
      };
      for (; qi < queue.size() && (int)targets.size() < need
           && visits < visitBudget; qi++, visits++) {
        visitCell(queue[qi]);
        if ((int)surfaceTargets.size() >= surfaceGoal) { qi++; break; }
      }
      // The visit cap is a normal-case performance bound, not a volume-loss
      // policy. Deep submersion can put the nearest free surface just beyond it;
      // continue the same deterministic search only when the capped pass has not
      // found enough destinations for every displaced cell.
      if ((int)(targets.size() + surfaceTargets.size()
                + fallbackTargets.size()) < need) {
        for (; qi < queue.size()
             && (int)(targets.size() + surfaceTargets.size()
                      + fallbackTargets.size()) < need;
             qi++, visits++) {
          visitCell(queue[qi]);
          if ((int)surfaceTargets.size() >= surfaceGoal) { qi++; break; }
        }
      }
      // Fill the lowest reachable surface row first, distributing a partial row
      // across its width so repeated body motion cannot build a narrow mound.
      std::sort(surfaceTargets.begin(), surfaceTargets.end(), [&](int a, int b) {
        int ay = a / E.cols, by = b / E.cols;
        return ay != by ? ay > by : a < b;
      });
      for (size_t first = 0; first < surfaceTargets.size()
           && (int)targets.size() < need;) {
        size_t last = first + 1;
        int row = surfaceTargets[first] / E.cols;
        while (last < surfaceTargets.size()
               && surfaceTargets[last] / E.cols == row)
          last++;
        int take = imin(need - (int)targets.size(), (int)(last - first));
        for (int i = 0; i < take; i++) {
          size_t offset = ((size_t)(i * 2 + 1) * (last - first))
                        / (size_t)(take * 2);
          int k = surfaceTargets[first + offset];
          E.L->rigidSpillReserved[k] = reservedGen;
          targets.push_back(k);
        }
        first = last;
      }
      for (int k : fallbackTargets) {
        if ((int)targets.size() >= need) break;
        E.L->rigidSpillReserved[k] = reservedGen;
        targets.push_back(k);
      }
      rigidSpillVisits += visits;
      int n = imin((int)targets.size(), need);
      for (int i = 0; i < n; i++) {
        int target = targets[i];
        uint8_t evicted = E.L->grid[target];
        if (evicted != EMPTY) nextPending.push_back({
          evicted, target, E.capturePersistentCurrentState(E.L, target),
        });
        E.writeGridIndexUnsafe(target, mat);
        E.restorePersistentCurrentState(
          E.L, target, mat, pending[gi + i].state, operation);
        // A spill target may be well outside the active material span. Mirror
        // it now so a later whole-buffer swap cannot discard that volume.
        E.L->next[target] = mat;
        E.restorePersistentNextState(
          E.L, target, mat, pending[gi + i].state, operation);
      }
      gi = gj;
    }
    pending.swap(nextPending);
  }
}
double RigidBodySystem::rigidErodeProbabilityAt(int k) {
  double p = 0; int x = k % E.cols, y = k / E.cols;
  uint8_t target = E.L->grid[k];
  auto consider = [&](int nk) {
    uint8_t medium = E.L->grid[nk];
    uint8_t profile = E.materialReactionProfile(medium);
    if (profile == MRP_ACID && (target == RIGID || E.isDissolvable(target)))
      p = std::fmax(p, ACID_DISSOLVE_P);
    else if (profile == MRP_LAVA && (target == RIGID || E.isFlammable(target)))
      p = std::fmax(p, RIGID_LAVA_ERODE_P);
    else if (profile == MRP_FIRE && (target == RIGID || E.isFlammable(target)))
      p = std::fmax(p, RIGID_FIRE_ERODE_P);
  };
  if (x < E.cols - 1) consider(k + 1); if (x > 0) consider(k - 1); if (y < E.rows - 1) consider(k + E.cols); if (y > 0) consider(k - E.cols);
  return p;
}
bool RigidBodySystem::eraseBodyCellIndex(int k, std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirty) {
  int id = E.L->bodyOwner[k]; if (id < 0) return false; // E.L->bodyOwner is authoritative (cell holds the body's real material, not RIGID)
  auto it = bodyById.find(id); if (it == bodyById.end()) return false; Body* b = it->second;
  int y = k / E.cols, x = k - y * E.cols;
  int idx = localCellAt(b, x + 0.5, y + 0.5);
  if (idx < 0) return false;
  if (b->jointRole && b->jointPeer) {
    Body* leader = b->jointRole == 1 ? b : b->jointPeer;
    Body* follower = leader->jointPeer;
    if (bodyMaterialAt(b, idx) == EMPTY) return false;
    b->cellMaterials[idx] = EMPTY;
    b->jointPeer->jointPeerMaterials[idx] = EMPTY;
    if (b->jointPeer->cellMaterials[idx] == EMPTY) {
      leader->occ[idx] = 0;
      follower->occ[idx] = 0;
    }
    leader->rasterFootprintValid = false;
    follower->rasterFootprintValid = false;
    E.writeGridIndexUnsafe(k, EMPTY);
    E.L->bodyOwner[k] = -1;
    dirty.insert(leader);
    return true;
  }
  if (!eraseLocalCell(b, idx)) return false;
  E.writeGridIndexUnsafe(k, EMPTY); E.L->bodyOwner[k] = -1; dirty.insert(b); return true;
}
bool RigidBodySystem::replaceBodyCellMaterialIndex(
    int k, uint8_t material, std::unordered_map<int, Body*>& bodyById,
    std::unordered_set<Body*>& dirty) {
  if (k < 0 || k >= E.cols * E.rows || !isMaterialId(material)
      || MAT_PLACEMENT[material] != MP_STRUCTURE) return false;
  int id = E.L->bodyOwner[k];
  auto found = bodyById.find(id);
  if (id < 0 || found == bodyById.end()) return false;
  Body* member = found->second;
  int y = k / E.cols, x = k - y * E.cols;
  int local = localCellAt(member, x + 0.5, y + 0.5);
  if (local < 0 || bodyMaterialAt(member, local) == material) return false;
  Body* leader = member->jointRole == 2 ? member->jointPeer : member;
  if (!leader) return false;
  if (member->jointRole) {
    if (member->cellMaterials.size() != member->occ.size()
        || member->jointPeer->jointPeerMaterials.size()
          != member->jointPeer->occ.size()) return false;
    member->cellMaterials[local] = material;
    member->jointPeer->jointPeerMaterials[local] = material;
    member->rasterFootprintValid = false;
    member->jointPeer->rasterFootprintValid = false;
  } else {
    if (member->cellMaterials.empty()) {
      member->cellMaterials.assign(member->occ.size(), EMPTY);
      for (size_t index = 0; index < member->occ.size(); index++)
        if (member->occ[index]) member->cellMaterials[index] = member->material;
    }
    member->cellMaterials[local] = material;
    member->rasterFootprintValid = false;
  }
  E.writeGridIndexUnsafe(k, material);
  E.L->bodyOwner[k] = id;
  dirty.insert(leader);
  return true;
}
void RigidBodySystem::finishErasedBodies(std::unordered_set<Body*>& dirty,
                                         std::vector<int>& cells,
                                         bool splitJointBodies) {
  if (dirty.empty()) {
    cells.erase(std::remove_if(cells.begin(), cells.end(), [&](int k) {
      return k < 0 || k >= E.cols * E.rows
        || E.L->bodyOwner[k] < 0 || E.L->grid[k] == EMPTY;
    }), cells.end());
    E.L->bodyCells = cells;
    return;
  }
  // Split each erased body by the connectivity of its actual WORLD grid cells
  // (the clean source of truth), not its occ grid: the occ<->world map is lossy
  // for rotated E.L->bodies, so an occ-space flood over-fragments a clean cut into
  // dozens of slivers and loses a half. A body merely chipped (one world
  // component) keeps its rotation via computeDerived; a body actually cut into
  // multiple pieces is rebuilt as axis-aligned E.L->bodies, inheriting velocity.
  std::unordered_set<int> removedIds;
  std::unordered_set<Body*> dirtyJoints;
  std::vector<Body*> orderedDirty;
  orderedDirty.reserve(dirty.size());
  for (Body* body : dirty) {
    if (body->jointRole) {
      dirtyJoints.insert(body->jointRole == 1 ? body : body->jointPeer);
    } else {
      orderedDirty.push_back(body);
    }
  }
  std::sort(orderedDirty.begin(), orderedDirty.end(), [](Body* a, Body* b) { return a->id < b->id; });
  std::unordered_map<int, int> originalIndexById;
  originalIndexById.reserve(E.L->bodies.size() * 2);
  std::vector<std::vector<int>> originalWorldCells(E.L->bodies.size());
  for (int i = 0; i < (int)E.L->bodies.size(); i++)
    originalIndexById[E.L->bodies[i]->id] = i;
  for (int k : cells) {
    auto found = originalIndexById.find(E.L->bodyOwner[k]);
    if (found != originalIndexById.end())
      originalWorldCells[found->second].push_back(k);
  }
  for (Body* b : orderedDirty) {
    auto containsFuseExplosive = [&](Body* body) {
      return body->nPts > 0
        && E.bodyContainsExplosiveProfile(body, XP_TNT_FUSE);
    };
    const std::vector<int>& wc = originalWorldCells[
      originalIndexById.find(b->id)->second];
    if (wc.empty()) { removedIds.insert(b->id); continue; }
    // Flood with the same 8-connectivity used by static structures and
    // component-to-body detachment. A rotated raster commonly turns a face
    // contact into a diagonal contact; treating that as a fracture makes a
    // chipped mixed-material object split even though its structural bond is
    // still intact.
    splitMemberStamp.reset((size_t)E.cols * E.rows);
    splitVisitedStamp.reset((size_t)E.cols * E.rows);
    for (int k : wc) splitMemberStamp.add(k);
    std::vector<std::vector<int>> groups;
    for (int seed : wc) {
      if (splitVisitedStamp.has(seed)) continue;
      int gid = (int)groups.size();
      groups.push_back({});
      std::vector<int> st{seed};
      splitVisitedStamp.add(seed);
      while (!st.empty()) { int k = st.back(); st.pop_back(); groups[gid].push_back(k); int y = k / E.cols, x = k - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          int neighbor = ny * E.cols + nx;
          if (!splitMemberStamp.has(neighbor)
              || splitVisitedStamp.has(neighbor)) continue;
          splitVisitedStamp.add(neighbor);
          st.push_back(neighbor);
        }
      }
    }
    if (groups.size() <= 1) {
      // Several rotated raster cells can map to one local cell, so world cells
      // may remain after the authoritative local shape becomes empty.
      if (!computeDerived(b, true)) {
        removedIds.insert(b->id);
        continue;
      }
      if (!containsFuseExplosive(b)) b->fuseTicks = 0;
      continue;
    } // chip: keep the body (+ rotation)
    // genuine split: rebuild each piece as an axis-aligned body with inherited motion
    double ovx = b->vx, ovy = b->vy, ow = b->omega, opx = b->px, opy = b->py;
    int inheritedFuse = b->fuseTicks;
    double fuseX = opx, fuseY = opy;
    if (inheritedFuse > 0) bodyFusePoint(b, fuseX, fuseY);
    for (auto& grp : groups) {
      std::vector<std::pair<int, int>> gc; gc.reserve(grp.size());
      std::vector<uint8_t> gm; gm.reserve(grp.size());
      for (int k : grp) {
        gc.push_back({k % E.cols, k / E.cols});
        gm.push_back(E.L->grid[k]);
      }
      Body* p = b->cellMaterials.empty()
        ? spawnBodyImpl(gc, b->material, b->density)
        : spawnBodyImpl(gc, gm);
      if (!p) continue;
      double rx = p->px - opx, ry = p->py - opy;
      p->vx = ovx - ow * ry; p->vy = ovy + ow * rx; p->omega = ow;
      p->blastDebris = b->blastDebris;
      p->fuseTicks = containsFuseExplosive(p) ? inheritedFuse : 0;
      if (p->fuseTicks > 0) setBodyFusePoint(p, fuseX, fuseY);
      p->plantType = b->plantType;
    }
    removedIds.insert(b->id);
  }
  if (!removedIds.empty()) {
    std::vector<Body*> keep;
    for (Body* b : E.L->bodies) { if (removedIds.count(b->id)) delete b; else keep.push_back(b); }
    E.L->bodies = std::move(keep);
  }
  // Re-assign ownership from scratch over the former body cells. Body cells
  // carry the body's real material; `wasBody` (the prior body-cell set) is the
  // owner set, and disambiguates a body cell from identical-looking static
  // terrain of the same material that the rebuilt footprint may overlap.
  splitWasBodyStamp.reset((size_t)E.cols * E.rows);
  splitClaimedStamp.reset((size_t)E.cols * E.rows);
  for (int k : cells) splitWasBodyStamp.add(k);
  for (int k : cells) E.L->bodyOwner[k] = -1;
  std::vector<int> kept;
  // Skip EMPTY cells: an erased cell (grid already cleared) can still fall
  // under a rotated body's re-rasterization, and claiming it would leave a
  // body-owned EMPTY cell until the next moveBodies stamp — a powder settling
  // into it that step would then be wiped by the un-stamp (silent cell loss).
  // Found by the SAND_INVARIANT_CHECKS post-step validator.
  auto claim = [&](Body* body, int k) {
    if (!splitWasBodyStamp.has(k) || splitClaimedStamp.has(k)
        || E.L->grid[k] == EMPTY) return;
    E.L->bodyOwner[k] = body->id;
    splitClaimedStamp.add(k);
    kept.push_back(k);
  };
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    forEachBodyCell(b, [&](int x, int y, int) {
      claim(b, y * E.cols + x);
    });
  }
  for (int k : cells) if (!splitClaimedStamp.has(k)) { E.writeGridIndexUnsafe(k, EMPTY); E.L->bodyOwner[k] = -1; }
  E.L->bodyCells = kept;
  if (splitJointBodies) finishErasedJointBodies(dirtyJoints);
}
void RigidBodySystem::finishErasedJointBodies(
    const std::unordered_set<Body*>& dirty) {
  if (dirty.empty()) return;
  std::unordered_set<int> dirtyIds;
  for (Body* body : dirty) {
    if (!body) continue;
    Body* leader = body->jointRole == 2 ? body->jointPeer : body;
    if (leader && leader->jointRole == 1 && leader->jointPeer)
      dirtyIds.insert(leader->id);
  }
  if (dirtyIds.empty()) return;

  std::vector<Body*> leaders;
  for (Body* body : E.fg.bodies)
    if (body->jointRole == 1 && dirtyIds.count(body->id))
      leaders.push_back(body);

  struct IndexedRosterCell { int cell; size_t position; };
  struct IndexedJointCells {
    std::vector<IndexedRosterCell> fg, bgPassive, bgActive;
  };
  std::unordered_map<int, IndexedJointCells> cellsByJoint;
  auto rebuildJointCellIndex = [&]() {
    cellsByJoint.clear();
    cellsByJoint.reserve(dirtyIds.size() * 2);
    for (int id : dirtyIds) cellsByJoint.try_emplace(id);
    auto collect = [&](Layer& layer, const std::vector<int>& roster,
                       int rosterKind) {
      for (size_t position = 0; position < roster.size(); position++) {
        int k = roster[position];
        if (k < 0 || k >= E.cols * E.rows) continue;
        auto found = cellsByJoint.find(layer.bodyOwner[k]);
        if (found == cellsByJoint.end()) continue;
        IndexedRosterCell cell{k, position};
        if (rosterKind == 0) found->second.fg.push_back(cell);
        else if (rosterKind == 1) found->second.bgPassive.push_back(cell);
        else found->second.bgActive.push_back(cell);
      }
    };
    collect(E.fg, E.fg.bodyCells, 0);
    collect(E.bg, E.bg.passiveBodyCells, 1);
    collect(E.bg, E.bg.bodyCells, 2);
  };
  rebuildJointCellIndex();

  Engine::ActiveLayerScope layerScope(E, E.L);
  for (Body* leader : leaders) {
    Body* follower = leader->jointPeer;
    if (!follower) continue;
    int oldId = leader->id;
    auto indexed = cellsByJoint.find(oldId);
    if (indexed == cellsByJoint.end()) continue;
    std::vector<int> worldCells;
    worldCells.reserve(indexed->second.fg.size()
                       + indexed->second.bgPassive.size());
    for (const IndexedRosterCell& cell : indexed->second.fg)
      worldCells.push_back(cell.cell);
    for (const IndexedRosterCell& cell : indexed->second.bgPassive)
      worldCells.push_back(cell.cell);
    std::sort(worldCells.begin(), worldCells.end());
    worldCells.erase(std::unique(worldCells.begin(), worldCells.end()),
                     worldCells.end());

    std::vector<uint8_t> layerMask(worldCells.size(), 0);
    std::unordered_map<int, int> indexOf;
    indexOf.reserve(worldCells.size());
    for (size_t i = 0; i < worldCells.size(); i++) {
      int k = worldCells[i];
      indexOf[k] = (int)i;
      if (E.fg.bodyOwner[k] == oldId) layerMask[i] |= 1;
      if (E.bg.bodyOwner[k] == oldId) layerMask[i] |= 2;
    }

    std::vector<int> component(worldCells.size(), -1);
    std::vector<std::vector<int>> groups;
    for (size_t seed = 0; seed < worldCells.size(); seed++) {
      if (component[seed] >= 0) continue;
      int group = (int)groups.size();
      groups.push_back({});
      std::vector<int> stack{(int)seed};
      component[seed] = group;
      while (!stack.empty()) {
        int ci = stack.back();
        stack.pop_back();
        int k = worldCells[ci], y = k / E.cols, x = k - y * E.cols;
        groups[group].push_back(ci);
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          auto it = indexOf.find(ny * E.cols + nx);
          if (it == indexOf.end()) continue;
          int ni = it->second;
          // The two rendered layers are adjacent depth slices of one bonded
          // assembly. Surviving cells that touch in the projected raster keep
          // that bond even when a blast removed the last exactly co-occupied
          // pixel; only a real gap in the union fractures the shared body.
          if (component[ni] >= 0) continue;
          component[ni] = group;
          stack.push_back(ni);
        }
      }
    }
    uint8_t remainingLayers = 0;
    for (uint8_t mask : layerMask) remainingLayers |= mask;
    if (groups.size() <= 1 && !worldCells.empty() && remainingLayers == 3) {
      computeDerived(leader, true);
      computeDerived(follower, true);
      syncJointFollower(leader);
      bool hasFuseExplosive = false;
      for (size_t i = 0; i < worldCells.size() && !hasFuseExplosive; i++) {
        int k = worldCells[i];
        hasFuseExplosive = ((layerMask[i] & 1)
                            && E.isFuseExplosive(E.fg.grid[k]))
                        || ((layerMask[i] & 2)
                            && E.isFuseExplosive(E.bg.grid[k]));
      }
      if (!hasFuseExplosive) leader->fuseTicks = follower->fuseTicks = 0;
      continue;
    }

    struct JointPiece {
      std::vector<std::pair<int, int>> fgCells, bgCells;
      std::vector<uint8_t> fgMaterials, bgMaterials;
    };
    std::vector<JointPiece> pieces(groups.size());
    for (size_t group = 0; group < groups.size(); group++) {
      JointPiece& piece = pieces[group];
      for (int ci : groups[group]) {
        int k = worldCells[ci], y = k / E.cols, x = k - y * E.cols;
        if (layerMask[ci] & 1) {
          piece.fgCells.push_back({x, y});
          piece.fgMaterials.push_back(E.fg.grid[k]);
        }
        if (layerMask[ci] & 2) {
          piece.bgCells.push_back({x, y});
          piece.bgMaterials.push_back(E.bg.grid[k]);
        }
      }
    }

    double oldPx = leader->px, oldPy = leader->py;
    double oldVx = leader->vx, oldVy = leader->vy, oldOmega = leader->omega;
    bool blastDebris = leader->blastDebris;
    int fuseTicks = leader->fuseTicks;
    double fuseX = oldPx, fuseY = oldPy;
    if (fuseTicks > 0) bodyFusePoint(leader, fuseX, fuseY);
    uint8_t fgPlantType = leader->plantType;
    uint8_t bgPlantType = follower->plantType;
    auto retireOwnedCells = [&](Layer& layer, std::vector<int>& roster,
                                const std::vector<IndexedRosterCell>& cells) {
      for (const IndexedRosterCell& entry : cells) {
        int k = entry.cell;
        if (layer.bodyOwner[k] == oldId) layer.bodyOwner[k] = -1;
        if (entry.position < roster.size() && roster[entry.position] == k)
          roster[entry.position] = -1;
      }
    };
    retireOwnedCells(E.fg, E.fg.bodyCells, indexed->second.fg);
    retireOwnedCells(E.bg, E.bg.passiveBodyCells,
                     indexed->second.bgPassive);
    retireOwnedCells(E.bg, E.bg.bodyCells, indexed->second.bgActive);
    E.bg.passiveBodyIds.erase(oldId);
    E.fg.bodies.erase(std::remove(E.fg.bodies.begin(), E.fg.bodies.end(), leader),
                      E.fg.bodies.end());
    E.bg.bodies.erase(std::remove(E.bg.bodies.begin(), E.bg.bodies.end(), follower),
                      E.bg.bodies.end());
    delete leader;
    delete follower;

    auto inheritMotion = [&](Body* body) {
      double rx = body->px - oldPx, ry = body->py - oldPy;
      body->vx = oldVx - oldOmega * ry;
      body->vy = oldVy + oldOmega * rx;
      body->omega = oldOmega;
      body->blastDebris = blastDebris;
    };
    std::vector<Body*> spawnedJoints;
    spawnedJoints.reserve(pieces.size());
    for (JointPiece& piece : pieces) {
      bool hasFuseExplosive = std::any_of(
        piece.fgMaterials.begin(), piece.fgMaterials.end(),
        [&](uint8_t material) { return E.isFuseExplosive(material); });
      hasFuseExplosive = hasFuseExplosive || std::any_of(
        piece.bgMaterials.begin(), piece.bgMaterials.end(),
        [&](uint8_t material) { return E.isFuseExplosive(material); });
      if (!piece.fgCells.empty() && !piece.bgCells.empty()) {
        Body* body = spawnJointBodyImpl(piece.fgCells, piece.fgMaterials,
                                        piece.bgCells, piece.bgMaterials);
        if (!body || !body->jointPeer) continue;
        spawnedJoints.push_back(body);
        inheritMotion(body);
        body->fuseTicks = hasFuseExplosive ? fuseTicks : 0;
        if (body->fuseTicks > 0) setBodyFusePoint(body, fuseX, fuseY);
        body->plantType = fgPlantType;
        body->jointPeer->blastDebris = blastDebris;
        body->jointPeer->fuseTicks = body->fuseTicks;
        body->jointPeer->fuseLocalX = body->fuseLocalX;
        body->jointPeer->fuseLocalY = body->fuseLocalY;
        body->jointPeer->plantType = bgPlantType;
        syncJointFollower(body);
        for (const auto& cell : piece.fgCells) {
          int k = cell.second * E.cols + cell.first;
          E.fg.bodyOwner[k] = body->id;
          E.fg.bodyCells.push_back(k);
        }
        for (const auto& cell : piece.bgCells) {
          int k = cell.second * E.cols + cell.first;
          E.bg.bodyOwner[k] = body->jointPeer->id;
          E.bg.passiveBodyCells.push_back(k);
        }
      } else if (!piece.fgCells.empty()) {
        Engine::ActiveLayerScope foreground(E, &E.fg);
        Body* body = spawnBodyImpl(piece.fgCells, piece.fgMaterials);
        if (!body) continue;
        inheritMotion(body);
        body->fuseTicks = hasFuseExplosive ? fuseTicks : 0;
        if (body->fuseTicks > 0) setBodyFusePoint(body, fuseX, fuseY);
        body->plantType = fgPlantType;
        for (const auto& cell : piece.fgCells) {
          int k = cell.second * E.cols + cell.first;
          E.fg.bodyOwner[k] = body->id;
          E.fg.bodyCells.push_back(k);
        }
      } else if (!piece.bgCells.empty()) {
        Engine::ActiveLayerScope background(E, &E.bg);
        Body* body = spawnBodyImpl(piece.bgCells, piece.bgMaterials);
        if (!body) continue;
        inheritMotion(body);
        body->fuseTicks = hasFuseExplosive ? fuseTicks : 0;
        if (body->fuseTicks > 0) setBodyFusePoint(body, fuseX, fuseY);
        body->plantType = bgPlantType;
        for (const auto& cell : piece.bgCells) {
          int k = cell.second * E.cols + cell.first;
          E.bg.bodyOwner[k] = body->id;
          E.bg.bodyCells.push_back(k);
        }
      }
    }
    {
      Engine::ActiveLayerScope foreground(E, &E.fg);
      int separationsBefore = rigidSpawnSeparations;
      resolveSpawnedJointOverlaps(spawnedJoints);
      if (rigidSpawnSeparations != separationsBefore)
        rebuildJointCellIndex();
    }
    E.fg.sleepingBodySupportDirty = true;
    E.bg.sleepingBodySupportDirty = true;
  }
  auto pruneRoster = [&](Layer& layer, std::vector<int>& cells) {
    cells.erase(std::remove_if(cells.begin(), cells.end(), [&](int k) {
      return k < 0 || k >= E.cols * E.rows
        || layer.bodyOwner[k] < 0 || layer.grid[k] == EMPTY;
    }), cells.end());
  };
  pruneRoster(E.fg, E.fg.bodyCells);
  pruneRoster(E.bg, E.bg.bodyCells);
  pruneRoster(E.bg, E.bg.passiveBodyCells);
}
void RigidBodySystem::erodeBodies(
    std::vector<int>& cells, bool passiveJointBodies) {
  if (cells.empty()) {
    if (!passiveJointBodies) E.L->bodyCells = cells;
    return;
  }
  std::unordered_map<int, Body*> bodyById; for (Body* b : E.L->bodies) bodyById[b->id] = b;
  std::unordered_set<Body*> dirty;
  std::vector<int> acidSmoke;
  for (Body* body : E.L->bodies) {
    if ((passiveJointBodies ? body->jointRole != 2 : body->jointRole == 2)
        || !body->erodible) continue;
    ensureBodyRaster(body);
    for (const BodyRasterCell& cell : body->rasterBoundaryFootprint) {
      int k = cell.y * E.cols + cell.x;
      if (E.L->bodyOwner[k] != body->id) continue;
      double p = rigidErodeProbabilityAt(k);
      if (p <= 0 || E.rand() >= p) continue;
      int x = cell.x, y = cell.y;
      auto isAcid = [&](int neighbor) {
        return E.hasMaterialReactionProfile(
          E.L->grid[neighbor], MRP_ACID);
      };
      bool byAcid = (x < E.cols - 1 && isAcid(k + 1))
                 || (x > 0 && isAcid(k - 1))
                 || (y < E.rows - 1 && isAcid(k + E.cols))
                 || (y > 0 && isAcid(k - E.cols));
      if (eraseBodyCellIndex(k, bodyById, dirty) && byAcid) {
        E.audio.noteAcidDissolve(x, y);
        if (E.rand() < ACRID_SMOKE_P) acidSmoke.push_back(k);
      }
    }
  }
  if (passiveJointBodies) finishErasedJointBodies(dirty);
  else finishErasedBodies(dirty, cells);
  for (int k : acidSmoke) {
    if (E.L->grid[k] != EMPTY || E.L->bodyOwner[k] >= 0) continue;
    E.writeGridIndexUnsafe(k, ACRID_SMOKE);
    E.markCellIndex(k);
  }
}
int RigidBodySystem::bodyFootprintBlocked(Body* b) {
  int blocked = 0;
  auto blockedIn = [&](Layer& lay, int k) {
    if (lay.bodyOwner[k] == b->id) return false;
    uint8_t material = lay.grid[k];
    return material != EMPTY && !E.isGasMaterial(material)
      && !E.isBuoyantMedium(material);
  };
  auto probe = [&](int x, int y, int) {
    if (E.L->infinite && (x == 0 || x == E.cols - 1)) return;
    int k = y * E.cols + x;
    if (occStamp.has(k)) return;
    occStamp.add(k);
    if (blockedIn(*E.L, k)
        || (b->jointRole == 1 && blockedIn(E.bg, k))) blocked++;
  };
  occStamp.reset((size_t)E.cols * E.rows);
  forEachBodyCell(b, probe);
  if (b->jointRole == 1 && b->jointPeer) forEachBodyCell(b->jointPeer, probe);
  return blocked;
}
bool RigidBodySystem::bodyFootprintOverlapsSolid(Body* b) {
  auto blockedIn = [&](Layer& layer, int k) {
    if (layer.bodyOwner[k] == b->id) return false;
    uint8_t material = layer.grid[k];
    return material != EMPTY && !E.isGasMaterial(material)
      && !E.isBuoyantMedium(material);
  };
  auto blockedBody = [&](Body* member) {
    ensureBodyRaster(member);
    for (const BodyRasterCell& cell : member->rasterFootprint) {
      if (E.L->infinite && (cell.x == 0 || cell.x == E.cols - 1))
        continue;
      int k = cell.y * E.cols + cell.x;
      if (blockedIn(*E.L, k)
          || (b->jointRole == 1 && blockedIn(E.bg, k))) return true;
    }
    return false;
  };
  return blockedBody(b)
      || (b->jointRole == 1 && b->jointPeer && blockedBody(b->jointPeer));
}
int RigidBodySystem::bodyTerrainBlocked(Body* b) {
  int blocked = 0;
  forEachBodyCell(b, [&](int x, int y, int) {
    if (E.L->infinite && (x == 0 || x == E.cols - 1)) return;
    int k = y * E.cols + x;
    auto staticIn = [&](Layer& layer) {
      if (layer.bodyOwner[k] >= 0) return false;
      uint8_t material = layer.grid[k];
      return material != EMPTY && !E.isGasMaterial(material)
        && !E.isBuoyantMedium(material);
    };
    if (staticIn(*E.L)
        || (b->jointRole == 1 && staticIn(E.bg))) blocked++;
  });
  return blocked;
}
bool RigidBodySystem::sleepingBodyTouchesMovingLiquid(Body* b) {
  bool moving = false;
  int previousTick = E.tick - 1;
  auto movingLiquidAt = [&](int x, int y) {
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return false;
    int k = y * E.cols + x;
    if (!E.isLiquidMaterial(E.L->grid[k])) return false;
    uint32_t packed = E.L->liquidVel.current[k];
    double vx = E.liquidVelocityX(packed);
    double vy = E.liquidVelocityY(packed);
    if (vx * vx + vy * vy >= R_FLUID_WAKE_LIN * R_FLUID_WAKE_LIN
        || E.L->fallSpeed.current[k] > 0
        || E.L->vacatedStamp[k] == previousTick)
      return true;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      int xx = x + ox, yy = y + oy;
      if (xx < 0 || xx >= E.cols || yy < 0 || yy >= E.rows) continue;
      if (E.L->vacatedStamp[yy * E.cols + xx] == previousTick) return true;
    }
    return false;
  };
  forEachBodyCell(b, [&](int x, int y, int) {
    if (moving) return;
    moving = movingLiquidAt(x - 1, y)
          || movingLiquidAt(x + 1, y)
          || movingLiquidAt(x, y - 1)
          || movingLiquidAt(x, y + 1);
  });
  return moving;
}
// A sleeping body keeps support while the solved load-bearing anchors or its
// current underside still touch a medium, terrain, a sleeping body, or the
// world floor. The anchors preserve valid diagonal and frictional support on
// irregular shapes without treating an unrelated nearby wall as ground.
bool RigidBodySystem::sleepingBodyHasSupport(Body* b, double probe) {
  auto stableBodyOwner = [](Layer& layer, int owner) {
    for (Body* support : layer.bodies)
      if (support->id == owner) return !support->awake;
    return false;
  };
  if (b->rasterAssignmentLocked
      && b->rasterLockCell >= 0
      && b->rasterLockCell < E.cols * E.rows) {
    int k = b->rasterLockCell;
    int owner = E.L->bodyOwner[k];
    bool retained = b->rasterLockOwner >= 0
      ? owner == b->rasterLockOwner
        && stableBodyOwner(*E.L, owner)
      : owner < 0
        && !canBodyOccupy(E.L->grid[k], k, b->density);
    if (retained) return true;
    b->rasterAssignmentLocked = false;
    b->rasterLockCell = -1;
    b->rasterLockOwner = -2;
  }
  if (bodyHasLooseSupport(b)) return true;
  int radius = imax(1, (int)std::ceil(probe));
  for (const BodySleepSupport& support : b->sleepSupports) {
    Layer& layer = support.layer ? E.bg : E.fg;
    Engine::ActiveLayerScope layerScope(E, &layer);
    int cx = (int)std::floor(support.x);
    int cy = (int)std::floor(support.y);
    int anchorRadius = support.owner >= 0 ? radius + 5 : radius + 2;
    for (int oy = -anchorRadius; oy <= anchorRadius; oy++) {
      for (int ox = -anchorRadius; ox <= anchorRadius; ox++) {
        int x = cx + ox, y = cy + oy;
        if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
        int k = y * E.cols + x;
        int owner = layer.bodyOwner[k];
        if (support.owner >= 0 && owner == support.owner
            && stableBodyOwner(layer, owner)) return true;
        if (support.owner < 0 && owner < 0
            && !canBodyOccupy(layer.grid[k], k, b->density)) return true;
      }
    }
  }
  occStamp.reset((size_t)(E.cols * E.rows)); occCells.clear();
  forEachBodyCell(b, [&](int x, int y, int) {
    int k = y * E.cols + x;
    if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); }
  });
  for (int k : occCells) {
    int y = k / E.cols;
    if (y + 1 >= E.rows) return true;
    int below = k + E.cols;
    if (occStamp.has(below)) continue;
    if (E.L->bodyOwner[below] >= 0) {
      int owner = E.L->bodyOwner[below];
      if (owner != b->id && stableBodyOwner(*E.L, owner)) return true;
      continue;
    }
    if (!canBodyOccupy(E.L->grid[below], below, b->density)) return true;
  }
  return false;
}
bool RigidBodySystem::findTerrainClearAdjustment(
    Body* b, double& dx, double& dy) {
  static constexpr double directions[16][2] = {
    {0, -1}, {-0.3826834323650898, -0.9238795325112867},
    {0.3826834323650898, -0.9238795325112867},
    {-0.7071067811865476, -0.7071067811865476},
    {0.7071067811865476, -0.7071067811865476},
    {-0.9238795325112867, -0.3826834323650898},
    {0.9238795325112867, -0.3826834323650898},
    {-1, 0}, {1, 0},
    {-0.9238795325112867, 0.3826834323650898},
    {0.9238795325112867, 0.3826834323650898},
    {-0.7071067811865476, 0.7071067811865476},
    {0.7071067811865476, 0.7071067811865476},
    {-0.3826834323650898, 0.9238795325112867},
    {0.3826834323650898, 0.9238795325112867},
    {0, 1},
  };
  const double savedPx = b->px, savedPy = b->py;
  int minX = E.cols, minY = E.rows, maxX = -1, maxY = -1;
  auto includeRaster = [&](Body* member) {
    forEachBodyCell(member, [&](int x, int y, int) {
      minX = imin(minX, x); minY = imin(minY, y);
      maxX = imax(maxX, x); maxY = imax(maxY, y);
    });
  };
  includeRaster(b);
  if (b->jointRole == 1 && b->jointPeer) includeRaster(b->jointPeer);

  // Translation keeps the body's angle fixed, so every possible blocker lies
  // in this small swept AABB. Reuse those terrain cell centers for all probes.
  std::vector<int> blockingCells;
  if (maxX >= minX && maxY >= minY) {
    minX = imax(0, minX - 3); minY = imax(0, minY - 3);
    maxX = imin(E.cols - 1, maxX + 3); maxY = imin(E.rows - 1, maxY + 3);
    blockingCells.reserve((size_t)(maxX - minX + 1) * 2);
    auto blockedIn = [&](Layer& layer, int k) {
      int owner = layer.bodyOwner[k];
      if (owner >= 0) return false;
      uint8_t material = layer.grid[k];
      return material != EMPTY && !E.isGasMaterial(material)
        && !E.isBuoyantMedium(material);
    };
    for (int y = minY; y <= maxY; y++) {
      for (int x = minX; x <= maxX; x++) {
        if (E.L->infinite && (x == 0 || x == E.cols - 1)) continue;
        int k = y * E.cols + x;
        if (blockedIn(*E.L, k)
            || (b->jointRole == 1 && blockedIn(E.bg, k)))
          blockingCells.push_back(k);
      }
    }
  }
  auto place = [&](double ox, double oy) {
    b->px = savedPx + ox;
    b->py = savedPy + oy;
    b->cs = std::cos(b->angle);
    b->sn = std::sin(b->angle);
    if (b->jointRole == 1) syncJointFollower(b);
  };
  auto overlapsBlockingCell = [&]() {
    for (int k : blockingCells) {
      int y = k / E.cols, x = k - y * E.cols;
      if (insideBodyIndex(b, x + 0.5, y + 0.5) >= 0
          || (b->jointRole == 1 && b->jointPeer
            && insideBodyIndex(b->jointPeer, x + 0.5, y + 0.5) >= 0))
        return true;
    }
    return false;
  };
  const double step = 0.125;
  auto clearAlong = [&](const double* direction) {
    for (double radius = step; radius <= 2.0 + 1e-9; radius += step) {
      place(direction[0] * radius, direction[1] * radius);
      if (overlapsBlockingCell()) continue;
      double blockedRadius = radius - step;
      double clearRadius = radius;
      for (int iteration = 0; iteration < 6; iteration++) {
        double middle = (blockedRadius + clearRadius) * 0.5;
        place(direction[0] * middle, direction[1] * middle);
        if (!overlapsBlockingCell()) clearRadius = middle;
        else blockedRadius = middle;
      }
      place(0, 0);
      dx = direction[0] * clearRadius;
      dy = direction[1] * clearRadius;
      return true;
    }
    place(0, 0);
    return false;
  };

  // Follow the blocking terrain's outward normal so raster clearance cannot
  // undo the solver's tangential travel along a slope.
  double normalX = 0, normalY = 0;
  occStamp.reset((size_t)E.cols * E.rows);
  auto accumulateNormal = [&](int x, int y, int) {
    int k = y * E.cols + x;
    if (occStamp.has(k)) return;
    occStamp.add(k);
    auto blockedIn = [&](Layer& layer) {
      int owner = layer.bodyOwner[k];
      if (owner >= 0) return false;
      uint8_t material = layer.grid[k];
      return material != EMPTY && !E.isGasMaterial(material)
        && !E.isBuoyantMedium(material);
    };
    if (!blockedIn(*E.L)
        && !(b->jointRole == 1 && blockedIn(E.bg))) return;
    double nx = 0, ny = 0;
    terrainNormalAt(b, x, y, b->density, nx, ny);
    normalX += nx;
    normalY += ny;
  };
  forEachBodyCell(b, accumulateNormal);
  if (b->jointRole == 1 && b->jointPeer)
    forEachBodyCell(b->jointPeer, accumulateNormal);
  double normalLength = std::hypot(normalX, normalY);
  if (normalLength > 1e-9) {
    normalX /= normalLength;
    normalY /= normalLength;
    std::array<int, 16> order;
    for (int i = 0; i < (int)order.size(); i++) order[i] = i;
    std::stable_sort(order.begin(), order.end(), [&](int a, int c) {
      double alignmentA = directions[a][0] * normalX
                        + directions[a][1] * normalY;
      double alignmentC = directions[c][0] * normalX
                        + directions[c][1] * normalY;
      return alignmentA > alignmentC;
    });
    for (int directionIndex : order)
      if (clearAlong(directions[directionIndex])) return true;
    dx = dy = 0;
    return false;
  }

  // A balanced obstruction has no reliable normal. Use the shortest local
  // translation without changing the solver's rotation.
  for (double radius = step; radius <= 2.0 + 1e-9; radius += step) {
    bool found = false;
    double bestRadius = radius, bestX = 0, bestY = 0;
    for (const auto& direction : directions) {
      place(direction[0] * radius, direction[1] * radius);
      if (overlapsBlockingCell()) continue;
      double blockedRadius = radius - step;
      double clearRadius = radius;
      for (int iteration = 0; iteration < 6; iteration++) {
        double middle = (blockedRadius + clearRadius) * 0.5;
        place(direction[0] * middle, direction[1] * middle);
        if (!overlapsBlockingCell()) clearRadius = middle;
        else blockedRadius = middle;
      }
      if (!found || clearRadius < bestRadius) {
        found = true;
        bestRadius = clearRadius;
        bestX = direction[0] * clearRadius;
        bestY = direction[1] * clearRadius;
      }
    }
    place(0, 0);
    if (!found) continue;
    dx = bestX;
    dy = bestY;
    return true;
  }
  place(0, 0);
  dx = dy = 0;
  return false;
}

// ===== Body material identity & solidify-on-rest =====
// (See the BODY-MATERIAL INVARIANT block in members.inc.) A free body stamps its
// real material into the grid; when a component-backed body's raster stays fixed
// it bakes into a normal static component here. RIGID bodies stay free forever.
void RigidBodySystem::bakeBodyToGrid(
    Body* b, int assemblyId, const StampSet* reservedByOtherBody) {
  // The body's cells were just cleared to EMPTY (moveBodies). Restore each
  // rasterized material. Each material stays an isolated component carrying the
  // same baked-assembly id, so support and cuts use the component graph without
  // merging the old body into adjacent same-material terrain.
  std::array<std::vector<int>, TABLE> baked;
  occStamp.reset((size_t)(E.cols * E.rows));
  occCells.clear();
  double rasterStart = emscripten_get_now();
  forEachBodyCell(b, [&](int x, int y, int local) {
    int k = y * E.cols + x;
    if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); }
    if (reservedByOtherBody && reservedByOtherBody->has(k)) return;
    // Dynamic stamping has already assigned this lattice cell to exactly one
    // body. Preserve that assignment when a neighboring body becomes static;
    // otherwise baking can resurrect a rejected alias cell as terrain inside
    // the live owner.
    if (E.L->bodyOwner[k] >= 0 && E.L->bodyOwner[k] != b->id) return;
    if (E.L->grid[k] != EMPTY && !E.componentDisplaceable(E.L->grid[k])) return; // never clobber solid terrain it came to rest against
    uint8_t material = bodyMaterialAt(b, local);
    if (material == EMPTY || !isMaterialId(material)) return;
    if (E.L->grid[k] == EMPTY) {
      E.L->grid[k] = material;
      if (material == NEUTRONIUM) {
        E.L->forceSourcePresent = true;
      }
    } else {
      E.writeGridIndexUnsafe(k, material);
    }
    baked[material].push_back(k);
    rigidBakedCells++;
  });
  rigidBakeRasterMs += emscripten_get_now() - rasterStart;
  double registerStart = emscripten_get_now();
  std::vector<int> bakedPlantCells;
  for (uint8_t material : DEFINED_MATERIAL_IDS) {
    if (!E.isPlantMaterial((uint8_t)material)) continue;
    bakedPlantCells.insert(bakedPlantCells.end(), baked[material].begin(),
                           baked[material].end());
  }
  bool registeredPlantCells = false;
  for (uint8_t material : DEFINED_MATERIAL_IDS) {
    if (baked[material].empty()) continue;
    if (E.isPlantMaterial((uint8_t)material)) {
      if (!registeredPlantCells) {
        E.comps.registerBakedCells(bakedPlantCells, assemblyId, false,
                                   b->plantType);
        registeredPlantCells = true;
      }
      continue;
    }
    E.comps.registerBakedCells(baked[material], assemblyId,
                               E.isIceMaterial(material), b->plantType);
  }
  rigidBakeRegisterMs += emscripten_get_now() - registerStart;
  if (b->fuseTicks > 0) {
    double fuseX, fuseY;
    bodyFusePoint(b, fuseX, fuseY);
    int nearest = -1;
    double nearestDistance = 1e30;
    for (uint8_t material : DEFINED_MATERIAL_IDS) {
      if (!E.isFuseExplosive(material)) continue;
      for (int k : baked[material]) {
        int y = k / E.cols, x = k - y * E.cols;
        double dx = x + 0.5 - fuseX, dy = y + 0.5 - fuseY;
        double distance = dx * dx + dy * dy;
        if (distance < nearestDistance
            || (distance == nearestDistance
                && (nearest < 0 || k < nearest))) {
          nearest = k;
          nearestDistance = distance;
        }
      }
    }
    if (nearest >= 0) E.explosives.queueDetonation(nearest, b->fuseTicks);
  }
}
// Every component material has a static representation. Generic RIGID has none
// and therefore remains a body.
bool RigidBodySystem::bodySolidifies(Body* b) {
  return E.bodySolidifiesToComponents(b);
}
// A static component that survived this tick's assembly-motion pass is valid
// support even when its own equilibrium comes from powder. Side contact and
// another free body do not convert a resting body into static terrain.
bool RigidBodySystem::bodyTouchesStaticSupport(Body* b) {
  occStamp.reset((size_t)(E.cols * E.rows)); occCells.clear();
  forEachBodyCell(b, [&](int x, int y, int) {
    int k = y * E.cols + x;
    if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); }
  });
  for (int k : occCells) {
    int y = k / E.cols;
    if (y + 1 >= E.rows) return true;
    int neighbor = k + E.cols;
    if (occStamp.has(neighbor) || E.L->bodyOwner[neighbor] >= 0) continue;
    uint8_t material = E.L->grid[neighbor];
    if (E.isRigidMaterialClass(material)
        || (E.isLooseSolidMaterial(material) && E.L->groundedCell[neighbor]))
      return true;
  }
  // A solved diagonal or frictional terrain support can lie several raster
  // cells from the contact anchor inside a thick irregular mask.
  for (const BodySleepSupport& support : b->sleepSupports) {
    if (support.owner >= 0) continue;
    Layer& layer = support.layer ? E.bg : E.fg;
    Engine::ActiveLayerScope layerScope(E, &layer);
    int cx = (int)std::floor(support.x);
    int cy = (int)std::floor(support.y);
    for (int oy = -3; oy <= 3; oy++) {
      for (int ox = -3; ox <= 3; ox++) {
        int x = cx + ox, y = cy + oy;
        if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
        int k = y * E.cols + x;
        if (layer.bodyOwner[k] >= 0) continue;
        uint8_t material = layer.grid[k];
        if (E.isRigidMaterialClass(material)
            || (E.isLooseSolidMaterial(material)
              && layer.groundedCell[k]))
          return true;
      }
    }
  }
  return false;
}
bool RigidBodySystem::bodyHasLooseSupport(Body* b) {
  occStamp.reset((size_t)(E.cols * E.rows)); occCells.clear();
  forEachBodyCell(b, [&](int x, int y, int) { int k = y * E.cols + x; if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); } });
  int solidBelow = 0, mediumBelow = 0;
  for (int k : occCells) {
    int y = k / E.cols, x = k - y * E.cols, bk = (y + 1) * E.cols + x;
    if (y + 1 < E.rows && occStamp.has(bk)) continue;
    if (y + 1 >= E.rows) { solidBelow++; continue; }
    uint8_t m = E.L->grid[bk];
    if (E.isBuoyantMedium(m)) mediumBelow++;
    else if (m != EMPTY && !E.isGasMaterial(m)) solidBelow++;
  }
  return mediumBelow > 0 && mediumBelow > solidBelow;
}
bool RigidBodySystem::rasterStableForBake(Body* b) {
  ensureBodyRaster(b);
  uint8_t sampleTag = (uint8_t)E.tick;
  if (b->bakeRasterSampleTag == sampleTag)
    return b->bakeRasterStableTicks >= R_BAKE_RASTER_TICKS;
  uint32_t signature = 2166136261u;
  for (const BodyRasterCell& cell : b->rasterFootprint) {
    signature ^= (uint32_t)(cell.y * E.cols + cell.x);
    signature *= 16777619u;
    signature ^= bodyMaterialAt(b, cell.local);
    signature *= 16777619u;
  }
  signature ^= (uint32_t)b->rasterFootprint.size();
  signature *= 16777619u;
  if (b->bakeRasterSignature == signature) {
    if (b->bakeRasterStableTicks < R_BAKE_RASTER_TICKS)
      b->bakeRasterStableTicks++;
  } else {
    b->bakeRasterSignature = signature;
    b->bakeRasterStableTicks = 1;
  }
  b->bakeRasterSampleTag = sampleTag;
  return b->bakeRasterStableTicks >= R_BAKE_RASTER_TICKS;
}
void RigidBodySystem::bakeRestingBodies() {
  bool liveFuseBody = false;
  for (Body* b : E.L->bodies)
    if (E.bodyContainsExplosiveProfile(b, XP_TNT_FUSE)) {
      liveFuseBody = true;
      break;
    }
  bool mayBake = liveFuseBody;
  for (Body* body : E.L->bodies)
    mayBake = mayBake || (body->jointRole != 2
      && (!body->awake || body->rasterMayOverlapSolid
        || (body->jointPeer && (!body->jointPeer->awake
          || body->jointPeer->rasterMayOverlapSolid))));
  std::array<std::unordered_map<int, std::vector<int>>, 2> stampedBodyCells;
  std::array<bool, 2> stampedBodyCellsReady = {false, false};
  if (mayBake) {
    size_t gridSize = (size_t)E.cols * E.rows;
    if (rasterProjectionOwner.size() != gridSize)
      rasterProjectionOwner.assign(gridSize, -1);
    auto collectLayerOverlaps = [&](Layer& layer, int layerIndex) {
      StampSet& aliases = bakeRasterAliases[layerIndex];
      aliases.reset(gridSize);
      for (Body* body : layer.bodies) body->bakeBlockedByBody = false;
      rasterProjectionTouched.clear();
      std::unordered_map<uint64_t, int> overlapCounts;
      for (int bi = 0; bi < (int)layer.bodies.size(); bi++) {
        Body* body = layer.bodies[bi];
        ensureBodyRaster(body);
        for (const BodyRasterCell& cell : body->rasterFootprint) {
          int k = cell.y * E.cols + cell.x;
          int previous = rasterProjectionOwner[k];
          if (previous < 0) {
            rasterProjectionOwner[k] = bi;
            rasterProjectionTouched.push_back(k);
          } else if (previous != bi) {
            aliases.add(k);
            int first = imin(previous, bi);
            int second = imax(previous, bi);
            uint64_t key = ((uint64_t)(uint32_t)first << 32)
                         | (uint32_t)second;
            overlapCounts[key]++;
          }
        }
      }
      for (const auto& entry : overlapCounts) {
        if (entry.second <= R_STRUCTURE_RASTER_ALIAS_CELLS) continue;
        int first = (int)(entry.first >> 32);
        int second = (int)(uint32_t)entry.first;
        layer.bodies[first]->bakeBlockedByBody = true;
        layer.bodies[second]->bakeBlockedByBody = true;
      }
      for (int k : rasterProjectionTouched) rasterProjectionOwner[k] = -1;
    };
    collectLayerOverlaps(*E.L, E.L == &E.bg ? 1 : 0);
    if (E.L == &E.fg && E.bgEnabled) collectLayerOverlaps(E.bg, 1);
  }
  bool baked = false;
  // Converted bodies remain valid until the roster has been rebuilt at the end
  // of this pass because overlap metadata still refers to their raster poses.
  std::vector<Body*> keep, retired, retiredFollowers;
  std::array<std::vector<int>, 2> clearedBodyCells;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) {
      keep.push_back(b);
      continue;
    }
    bool explosiveBody = b->blastDebris
      || (liveFuseBody && E.bodyContainsExplosiveProfile(b, XP_TNT_FUSE));
    if ((liveFuseBody || explosiveBody) && b->awake) {
      keep.push_back(b);
      continue;
    }
    double supportStart = emscripten_get_now();
    bool iceBody = E.bodyContainsMaterial(b, ICE);
    bool quietPose = b->vx * b->vx + b->vy * b->vy
                       < R_SLEEP_LIN * R_SLEEP_LIN
                  && std::fabs(b->omega) < R_SLEEP_ANG;
    bool terrainContact = b->rasterMayOverlapSolid;
    if (b->jointRole == 1 && b->jointPeer)
      terrainContact = terrainContact || b->jointPeer->rasterMayOverlapSolid;
    bool supportedOwn = false, supportedPeer = false;
    bool sampledIceSupport = iceBody && quietPose && terrainContact;
    if (sampledIceSupport) {
      supportedOwn = bodyTouchesStaticSupport(b);
      if (b->jointRole == 1 && b->jointPeer) {
        Engine::ActiveLayerScope layerScope(E, &E.bg);
        supportedPeer = bodyTouchesStaticSupport(b->jointPeer);
      }
    }
    if (sampledIceSupport && (supportedOwn || supportedPeer)) {
      if (b->bakeSupportedPoseTicks < R_BAKE_RASTER_TICKS)
        b->bakeSupportedPoseTicks++;
    } else {
      b->bakeSupportedPoseTicks = 0;
    }
    if (b->jointRole == 1) syncJointFollower(b);
    bool supportedPoseBake =
      b->bakeSupportedPoseTicks >= R_BAKE_RASTER_TICKS;
    rigidBakeSupportMs += emscripten_get_now() - supportStart;

    bool rasterBakeCandidate = !b->awake || b->rasterMayOverlapSolid
                            || supportedPoseBake;
    if (b->jointRole == 1 && b->jointPeer)
      rasterBakeCandidate = rasterBakeCandidate
        || !b->jointPeer->awake || b->jointPeer->rasterMayOverlapSolid;
    if (!liveFuseBody && !rasterBakeCandidate) {
      keep.push_back(b);
      continue;
    }
    bool stableRaster = liveFuseBody || supportedPoseBake
                     || rasterStableForBake(b);
    bool peerStableRaster = true;
    if (!liveFuseBody && b->jointRole == 1 && b->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      peerStableRaster = supportedPoseBake
        || rasterStableForBake(b->jointPeer);
    }
    bool canBake = bodyFullyInsideLoadedWindow(b)
      && stableRaster && peerStableRaster
      && bodySolidifies(b) && (!b->jointPeer || bodySolidifies(b->jointPeer));
    b->bakeBlockedByBody = b->bakeBlockedByBody
      || (b->jointRole == 1 && b->jointPeer
        && b->jointPeer->bakeBlockedByBody);
    if (b->jointRole == 1) syncJointFollower(b);
    if (canBake && b->bakeBlockedByBody) canBake = false;
    if (canBake && bodyFootprintOverlapsSolid(b)) canBake = false;
    supportStart = emscripten_get_now();
    bool groundedContact = canBake
      && (sampledIceSupport ? supportedOwn : bodyTouchesStaticSupport(b));
    bool growthOrigin = canBake && E.bodyContainsGrowthOrigin(b);
    bool peerGroundedContact = false;
    bool peerGrowthOrigin = false;
    if (canBake && b->jointRole == 1 && b->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      peerGroundedContact = sampledIceSupport
        ? supportedPeer : bodyTouchesStaticSupport(b->jointPeer);
      peerGrowthOrigin = E.bodyContainsGrowthOrigin(b->jointPeer);
    }
    rigidBakeSupportMs += emscripten_get_now() - supportStart;
    if (canBake && (groundedContact || peerGroundedContact
                    || growthOrigin || peerGrowthOrigin)) {
      int assemblyId = E.nextBakedAssemblyId++;
      auto clearBodyStamp = [&](Layer& layer, Body* body, int layerIndex) {
        Engine::ActiveLayerScope layerScope(E, &layer);
        if (!stampedBodyCellsReady[layerIndex]) {
          auto& stamped = stampedBodyCells[layerIndex];
          stamped.reserve(layer.bodies.size() * 2);
          auto collectStamped = [&](const std::vector<int>& cells) {
            for (int k : cells) {
              if (k < 0 || k >= E.cols * E.rows) continue;
              int owner = layer.bodyOwner[k];
              if (owner >= 0) stamped[owner].push_back(k);
            }
          };
          collectStamped(layer.bodyCells);
          collectStamped(layer.passiveBodyCells);
          stampedBodyCellsReady[layerIndex] = true;
        }
        auto found = stampedBodyCells[layerIndex].find(body->id);
        if (found == stampedBodyCells[layerIndex].end()) return;
        for (int k : found->second) {
          if (layer.bodyOwner[k] != body->id) continue;
          E.writeGridIndexUnsafe(k, EMPTY);
          layer.bodyOwner[k] = -1;
          clearedBodyCells[layerIndex].push_back(k);
        }
      };
      if (b->jointRole == 1 && b->jointPeer) {
        Body* follower = b->jointPeer;
        syncJointFollower(b);
        clearBodyStamp(E.fg, b, 0);
        clearBodyStamp(E.bg, follower, 1);
        {
          Engine::ActiveLayerScope foreground(E, &E.fg);
          bakeBodyToGrid(b, assemblyId, &bakeRasterAliases[0]);
        }
        {
          Engine::ActiveLayerScope background(E, &E.bg);
          bakeBodyToGrid(follower, assemblyId, &bakeRasterAliases[1]);
        }
        E.bg.passiveBodyIds.erase(follower->id);
        retiredFollowers.push_back(follower);
      } else {
        int layerIndex = E.L == &E.bg ? 1 : 0;
        clearBodyStamp(*E.L, b, layerIndex);
        bakeBodyToGrid(b, assemblyId, &bakeRasterAliases[layerIndex]);
      }
      retired.push_back(b);
      baked = true;
    }
    else keep.push_back(b);
  }
  if (baked) {
    auto pruneBakedBodyCells = [&](Layer& layer, int layerIndex) {
      if (clearedBodyCells[layerIndex].empty()) return;
      StampSet& cleared = bakeRasterAliases[layerIndex];
      cleared.reset((size_t)E.cols * E.rows);
      for (int k : clearedBodyCells[layerIndex]) cleared.add(k);
      auto prune = [&](std::vector<int>& cells) {
        cells.erase(std::remove_if(cells.begin(), cells.end(), [&](int k) {
          return k >= 0 && k < E.cols * E.rows && cleared.has(k);
        }), cells.end());
      };
      prune(layer.bodyCells);
      prune(layer.passiveBodyCells);
    };
    pruneBakedBodyCells(E.fg, 0);
    if (E.bgEnabled) pruneBakedBodyCells(E.bg, 1);
    if (!retiredFollowers.empty()) {
      std::unordered_set<Body*> retiredSet(
        retiredFollowers.begin(), retiredFollowers.end());
      E.bg.bodies.erase(
        std::remove_if(E.bg.bodies.begin(), E.bg.bodies.end(),
          [&](Body* body) { return retiredSet.count(body) != 0; }),
        E.bg.bodies.end());
    }
    E.L->bodies = std::move(keep);
    for (Body* body : retired) delete body;
    for (Body* follower : retiredFollowers) delete follower;
    if (E.L == &E.fg && E.bgEnabled)
      E.comps.jointBakeNeedsGroundRefresh = true;
  }
}

void RigidBodySystem::bakeWorldBodies(
    bool foregroundActive, bool backgroundActive) {
  if (foregroundActive) {
    Engine::ActiveLayerScope foreground(E, &E.fg);
    double start = emscripten_get_now();
    bakeRestingBodies();
    rigidBakeMs += emscripten_get_now() - start;
  }
  if (E.bgEnabled && backgroundActive) {
    Engine::ActiveLayerScope background(E, &E.bg);
    double start = emscripten_get_now();
    bakeRestingBodies();
    rigidBakeMs += emscripten_get_now() - start;
  }
}
void RigidBodySystem::stampJointFollower(
    Body* leader, PersistentCellOperation operation) {
  if (!leader || leader->jointRole != 1 || !leader->jointPeer) return;
  Body* follower = leader->jointPeer;
  syncJointFollower(leader);
  Engine::ActiveLayerScope layerScope(E, &E.bg);
  std::vector<Disp> displaced;
  std::vector<int> footprint;
  forEachBodyCell(follower, [&](int x, int y, int local) {
    int k = y * E.cols + x;
    int owner = E.bg.bodyOwner[k];
    if (owner != -1) {
      if (owner != follower->id) rigidOwnershipConflicts++;
      return;
    }
    uint8_t material = E.bg.grid[k];
    if (!canBodyOccupy(material, k, follower->density)) {
      rigidRejectedCells++;
      return;
    }
    if (isBodyRelocatable(material, k, follower->density))
      displaced.push_back({
        material, k, E.capturePersistentCurrentState(&E.bg, k),
      });
    E.writeGridIndexUnsafe(k, bodyMaterialAt(follower, local));
    E.bg.bodyOwner[k] = follower->id;
    E.bg.passiveBodyCells.push_back(k);
    footprint.push_back(k);
  });
  E.bg.reserveSeenGenerations(SPILL_GENERATION_BUDGET);
  int32_t footprintGen = E.bg.nextSeenGeneration();
  for (int k : footprint) E.bg.rigidSpillFootprint[k] = footprintGen;
  spillDisplacedBodyMaterial(displaced, footprint, footprintGen,
                             follower->id, follower->density, operation);
}
// World streaming clears body rasters before saving and translating tiles.
// Rebuild each body's current footprint immediately after both layers have
// loaded so sleeping bodies remain visible and interactive without requiring a
// simulation tick.
void RigidBodySystem::restampBodiesAfterStream(
    PersistentCellOperation operation) {
  std::vector<int> cells, footprint;
  std::unordered_map<int, std::pair<std::vector<Disp>, std::vector<int>>> perBody;
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    auto& stamped = perBody[body->id];
    forEachBodyCell(body, [&](int x, int y, int local) {
      int k = y * E.cols + x;
      if (E.L->bodyOwner[k] != -1) return;
      uint8_t material = E.L->grid[k];
      if (!canBodyOccupy(material, k, body->density)) return;
      if (isBodyRelocatable(material, k, body->density))
        stamped.first.push_back({
          material, k, E.capturePersistentCurrentState(E.L, k),
        });
      E.writeGridIndexUnsafe(k, bodyMaterialAt(body, local));
      E.L->bodyOwner[k] = body->id;
      if (body->blastDebris) E.L->groundedCell[k] = 0;
      cells.push_back(k);
      footprint.push_back(k);
      stamped.second.push_back(k);
    });
  }
  E.L->reserveSeenGenerations(
    SPILL_GENERATION_BUDGET * std::max<size_t>(1, perBody.size()));
  int32_t footprintGen = E.L->nextSeenGeneration();
  for (int k : footprint) E.L->rigidSpillFootprint[k] = footprintGen;
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    auto it = perBody.find(body->id);
    if (it == perBody.end()) continue;
    spillDisplacedBodyMaterial(it->second.first, it->second.second,
                               footprintGen, body->id, body->density,
                               operation);
  }
  E.L->bodyCells = std::move(cells);
  if (E.L == &E.fg) {
    for (Body* body : E.fg.bodies)
      if (body->jointRole == 1)
        stampJointFollower(body, operation);
  }
  E.L->sleepingBodySupportDirty = true;
}

void RigidBodySystem::resolveStructureRasterOverlaps(
    bool allowPreviousPoseRollback) {
  rasterProjectionBodies.clear();
  bool hasStructure = false;
  for (Body* body : E.L->bodies)
    hasStructure = hasStructure || rigidStructureScaleBody(body);
  if (!hasStructure) return;
  for (Body* body : E.L->bodies)
    if (rigidWorldBridgeMode(solverMode) || rigidStructureScaleBody(body))
      rasterProjectionBodies.push_back(body);
  if ((int)rasterProjectionBodies.size() < R_STRUCTURE_RASTER_MIN_BODIES)
    return;

  size_t gridSize = (size_t)E.cols * E.rows;
  if (rasterProjectionOwner.size() != gridSize) {
    rasterProjectionOwner.assign(gridSize, -1);
    rasterProjectionTouched.clear();
  }
  auto clearOwners = [&]() {
    for (int k : rasterProjectionTouched) rasterProjectionOwner[k] = -1;
    rasterProjectionTouched.clear();
  };
  auto pairKey = [](int aId, int bId) {
    return ((uint64_t)(uint32_t)aId << 32) | (uint32_t)bId;
  };
  auto allowedOverlap = [&](Body* a, Body* b) {
    (void)a;
    (void)b;
    return R_STRUCTURE_RASTER_ALIAS_CELLS;
  };
  auto overlapCount = [&](Body* A, Body* B) {
    occStamp.reset(gridSize);
    ensureBodyRaster(A);
    for (const BodyRasterCell& cell : A->rasterFootprint)
      occStamp.add(cell.y * E.cols + cell.x);
    int count = 0;
    ensureBodyRaster(B);
    for (const BodyRasterCell& cell : B->rasterFootprint)
      count += occStamp.has(cell.y * E.cols + cell.x);
    return count;
  };
  auto terrainOverlapCount = [&](Body* body) {
    int count = bodyTerrainBlocked(body);
    if (body->jointRole != 1 || !body->jointPeer) return count;
    Engine::ActiveLayerScope layerScope(E, &E.bg);
    return count + bodyTerrainBlocked(body->jointPeer);
  };
  auto terrainClear = [&](Body* body) {
    return terrainOverlapCount(body) == 0;
  };
  auto supported = [&](Body* body) {
    bool result = bodyTouchesStaticSupport(body);
    if (!result && body->jointRole == 1 && body->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      result = bodyTouchesStaticSupport(body->jointPeer);
    }
    return result;
  };
  auto syncPose = [&](Body* body) {
    body->cs = std::cos(body->angle);
    body->sn = std::sin(body->angle);
    if (body->jointRole == 1) syncJointFollower(body);
  };
  // Continuous contacts carry impulses, friction, and torque. This final
  // position constraint only resolves integer-raster aliasing at the exact pose
  // that will be committed to the sand grid. Ground-supported lower bodies stay
  // fixed when the separating direction would push them into their support.
  for (int pass = 0; pass < 4; pass++) {
    bool corrected = false;
    for (Body* body : rasterProjectionBodies) {
      bool peerTerrainRisk = body->jointRole == 1
        || (E.L == &E.bg && !E.L->passiveBodyIds.empty());
      if (body->jointRole == 2
          || (!body->awake && body->rasterAssignmentLocked)
          || !peerTerrainRisk || terrainClear(body))
        continue;
      double dx = 0, dy = 0;
      if (!findTerrainClearAdjustment(body, dx, dy)) continue;
      body->px += dx;
      body->py += dy;
      syncPose(body);
      rigidDepenetrations++;
      rigidPositionCorrections++;
      rigidRasterCorrections++;
      rigidRasterMaxCorrection = std::fmax(
        rigidRasterMaxCorrection, std::hypot(dx, dy));
      corrected = true;
    }
    clearOwners();
    rasterProjectionPairs.clear();
    for (int bi = 0; bi < (int)rasterProjectionBodies.size(); bi++) {
      Body* body = rasterProjectionBodies[bi];
      ensureBodyRaster(body);
      for (const BodyRasterCell& cell : body->rasterFootprint) {
        int k = cell.y * E.cols + cell.x;
        int previous = rasterProjectionOwner[k];
        if (previous < 0) {
          rasterProjectionOwner[k] = bi;
          rasterProjectionTouched.push_back(k);
        } else if (previous != bi) {
          rasterProjectionPairs.push_back({
            imin(previous, bi), imax(previous, bi),
          });
        }
      }
    }
    if (rasterProjectionPairs.empty()) {
      if (!corrected) break;
      continue;
    }
    std::sort(rasterProjectionPairs.begin(), rasterProjectionPairs.end());
    rasterProjectionPairs.erase(
      std::unique(rasterProjectionPairs.begin(), rasterProjectionPairs.end()),
      rasterProjectionPairs.end());

    std::vector<int> overlapParent(rasterProjectionBodies.size());
    for (int body = 0; body < (int)overlapParent.size(); body++)
      overlapParent[body] = body;
    for (const auto& pair : rasterProjectionPairs)
      ufUnite(overlapParent, pair.first, pair.second);
    std::vector<uint8_t> structureOverlap(overlapParent.size(), 0);
    for (int body = 0; body < (int)rasterProjectionBodies.size(); body++)
      if (rigidStructureScaleBody(rasterProjectionBodies[body]))
        structureOverlap[ufFind(overlapParent, body)] = 1;

    int activeLayer = E.L == &E.bg ? 1 : 0;
    auto& axes = pairAxes[activeLayer];
    for (const auto& pair : rasterProjectionPairs) {
      Body* A = rasterProjectionBodies[pair.first];
      Body* B = rasterProjectionBodies[pair.second];
      int allowedAliasCells = allowedOverlap(A, B);
      int pairOverlap = overlapCount(A, B);
      if (pairOverlap <= allowedAliasCells) continue;
      // A body cannot enter or remain in a sleeping island while its committed
      // raster still violates a body contact. Keep both sides active so the
      // continuous solver and this final lattice constraint can converge
      // together on the next substep.
      auto wakeRasterContact = [&](Body* body) {
        uint16_t retainedWorldStill = body->worldStillTicks;
        if (!body->awake) wakeBody(body);
        if (solverMode == 30
            && pairOverlap <= allowedAliasCells + 1)
          body->worldStillTicks = retainedWorldStill;
      };
      bool protectSleepingA = solverMode == 34 && !A->awake
        && rigidStructureScaleBody(A) && B->nPts < 256;
      bool protectSleepingB = solverMode == 34 && !B->awake
        && rigidStructureScaleBody(B) && A->nPts < 256;
      if (!protectSleepingA) wakeRasterContact(A);
      if (!protectSleepingB) wakeRasterContact(B);
      bool structureComponent =
        structureOverlap[ufFind(overlapParent, pair.first)];
      if (rigidWorldBridgeMode(solverMode)
          && !structureComponent && pairOverlap <= 3)
        continue;

      double nx = 0, ny = 0;
      auto axis = axes.find(pairKey(A->id, B->id));
      if (axis != axes.end()
          && axis->second.aRevision == A->geometryRevision
          && axis->second.bRevision == B->geometryRevision) {
        nx = axis->second.nx;
        ny = axis->second.ny;
      } else {
        axis = axes.find(pairKey(B->id, A->id));
        if (axis != axes.end()
            && axis->second.aRevision == B->geometryRevision
            && axis->second.bRevision == A->geometryRevision) {
          nx = -axis->second.nx;
          ny = -axis->second.ny;
        }
      }
      double centerX = A->px - B->px, centerY = A->py - B->py;
      if (nx * nx + ny * ny < 1e-12) {
        nx = centerX;
        ny = centerY;
      }
      double length = std::hypot(nx, ny);
      if (length < 1e-9) {
        nx = 0;
        ny = -1;
      } else {
        nx /= length;
        ny /= length;
      }
      if (nx * centerX + ny * centerY < 0) {
        nx = -nx;
        ny = -ny;
      }

      MovePose aStart{A->px, A->py, A->angle};
      MovePose bStart{B->px, B->py, B->angle};
      bool aSupported = A->jointRole == 2 || supported(A);
      bool bSupported = B->jointRole == 2 || supported(B);
      auto setTrial = [&](double amount, double direction,
                          double& aWeight, double& bWeight) {
        double sx = nx * direction, sy = ny * direction;
        bool bothSleeping = !A->awake && !B->awake;
        bool aSleepingMove = bothSleeping && !A->rasterAssignmentLocked
          && (sy < -0.1
            || (std::fabs(sy) <= 0.1 && A->id > B->id));
        bool bSleepingMove = bothSleeping && !B->rasterAssignmentLocked
          && (sy > 0.1
            || (std::fabs(sy) <= 0.1 && B->id > A->id));
        bool aMovable = A->jointRole != 2 && (A->awake || aSleepingMove)
          && !(aSupported && sy > 0);
        bool bMovable = B->jointRole != 2 && (B->awake || bSleepingMove)
          && !(bSupported && -sy > 0);
        double aMass = aMovable ? A->invMass : 0;
        double bMass = bMovable ? B->invMass : 0;
        double mass = aMass + bMass;
        aWeight = mass > 0 ? aMass / mass : 0;
        bWeight = mass > 0 ? bMass / mass : 0;
        A->px = aStart.px + sx * amount * aWeight;
        A->py = aStart.py + sy * amount * aWeight;
        B->px = bStart.px - sx * amount * bWeight;
        B->py = bStart.py - sy * amount * bWeight;
        syncPose(A);
        syncPose(B);
      };
      auto trialClear = [&](double amount, double direction,
                            double& aWeight, double& bWeight) {
        setTrial(amount, direction, aWeight, bWeight);
        if (aWeight <= 0 && bWeight <= 0) return false;
        int overlap = overlapCount(A, B);
        if (overlap > allowedAliasCells) return false;
        bool clearTerrain = (aWeight <= 0 || terrainClear(A))
          && (bWeight <= 0 || terrainClear(B));
        return clearTerrain;
      };

      std::array<std::array<double, 2>, 2> candidateAxes{{
        {nx, ny}, {centerX, centerY},
      }};
      double bestAmount = 1e18, bestDirection = 0;
      double bestAxisX = 0, bestAxisY = 0;
      for (const auto& candidate : candidateAxes) {
        double candidateLength = std::hypot(candidate[0], candidate[1]);
        if (candidateLength < 1e-9) continue;
        nx = candidate[0] / candidateLength;
        ny = candidate[1] / candidateLength;
        for (double direction : {1.0, -1.0}) {
          double lower = 0, upper = 0;
          double aWeight = 0, bWeight = 0;
          for (double amount = 0.125; amount <= 2.0; amount += 0.125) {
            if (trialClear(amount, direction, aWeight, bWeight)) {
              upper = amount;
              break;
            }
            lower = amount;
          }
          if (upper > 0) {
            for (int search = 0; search < 6; search++) {
              double middle = (lower + upper) * 0.5;
              if (trialClear(middle, direction, aWeight, bWeight))
                upper = middle;
              else
                lower = middle;
            }
            if (upper < bestAmount) {
              bestAmount = upper;
              bestDirection = direction;
              bestAxisX = nx;
              bestAxisY = ny;
            }
          }
          A->px = aStart.px;
          A->py = aStart.py;
          B->px = bStart.px;
          B->py = bStart.py;
          syncPose(A);
          syncPose(B);
        }
      }
      if (bestDirection == 0) {
        auto rollbackAcceptedPose = [&](Body* candidate) {
          if (!allowPreviousPoseRollback) return false;
          if (!candidate->awake || candidate->jointRole == 2) return false;
          auto slot = moveBodySlotById.find(candidate->id);
          if (slot == moveBodySlotById.end()) return false;
          const MovePose& previous = movePreviousPoses[slot->second];
          MovePose current{
            candidate->px, candidate->py, candidate->angle,
          };
          double travel = std::hypot(
              current.px - previous.px, current.py - previous.py)
            + std::fabs(current.angle - previous.angle) * candidate->maxR;
          if (travel <= 1e-9) return false;
          int currentTerrain = terrainOverlapCount(candidate);
          std::vector<int> currentOverlaps;
          currentOverlaps.reserve(rasterProjectionBodies.size());
          for (Body* other : rasterProjectionBodies)
            currentOverlaps.push_back(other == candidate ? 0
              : overlapCount(candidate, other));
          candidate->px = previous.px;
          candidate->py = previous.py;
          candidate->angle = previous.angle;
          syncPose(candidate);
          int previousTerrain = terrainOverlapCount(candidate);
          bool improved = previousTerrain < currentTerrain;
          bool accepted = previousTerrain <= currentTerrain;
          for (int i = 0; accepted
               && i < (int)rasterProjectionBodies.size(); i++) {
            Body* other = rasterProjectionBodies[i];
            if (other == candidate) continue;
            int previousOverlap = overlapCount(candidate, other);
            int allowed = allowedOverlap(candidate, other);
            if (previousOverlap > currentOverlaps[i]
                && previousOverlap > allowed)
              accepted = false;
            if (previousOverlap < currentOverlaps[i]) improved = true;
          }
          if (!accepted || !improved) {
            candidate->px = current.px;
            candidate->py = current.py;
            candidate->angle = current.angle;
            syncPose(candidate);
            return false;
          }
          if (!preserveRasterRecoveryMotion(candidate, current)) {
            candidate->vx = candidate->vy = candidate->omega = 0;
            candidate->pvx = candidate->pvy = candidate->pw = 0;
          }
          candidate->hadContact = true;
          rigidPositionCorrections++;
          rigidRasterCorrections++;
          rigidRasterMaxCorrection = std::fmax(
            rigidRasterMaxCorrection, travel);
          return true;
        };
        Body* first = A->awake && !B->awake ? A
          : B->awake && !A->awake ? B : A;
        Body* second = first == A ? B : A;
        if (rollbackAcceptedPose(first)
            || rollbackAcceptedPose(second)) {
          corrected = true;
          continue;
        }
        auto rollbackPairAcceptedPose = [&]() {
          if (!allowPreviousPoseRollback) return false;
          if (A->jointRole == 2 || B->jointRole == 2) return false;
          auto aSlot = moveBodySlotById.find(A->id);
          auto bSlot = moveBodySlotById.find(B->id);
          if (aSlot == moveBodySlotById.end()
              || bSlot == moveBodySlotById.end())
            return false;
          const MovePose& aPrevious = movePreviousPoses[aSlot->second];
          const MovePose& bPrevious = movePreviousPoses[bSlot->second];
          MovePose aCurrent{A->px, A->py, A->angle};
          MovePose bCurrent{B->px, B->py, B->angle};
          double aTravel = std::hypot(
              aCurrent.px - aPrevious.px, aCurrent.py - aPrevious.py)
            + std::fabs(aCurrent.angle - aPrevious.angle) * A->maxR;
          double bTravel = std::hypot(
              bCurrent.px - bPrevious.px, bCurrent.py - bPrevious.py)
            + std::fabs(bCurrent.angle - bPrevious.angle) * B->maxR;
          if (aTravel <= 1e-9 && bTravel <= 1e-9) return false;
          int aCurrentTerrain = terrainOverlapCount(A);
          int bCurrentTerrain = terrainOverlapCount(B);
          std::vector<int> aCurrentOverlaps;
          std::vector<int> bCurrentOverlaps;
          aCurrentOverlaps.reserve(rasterProjectionBodies.size());
          bCurrentOverlaps.reserve(rasterProjectionBodies.size());
          for (Body* other : rasterProjectionBodies) {
            aCurrentOverlaps.push_back(
              other == A || other == B ? 0 : overlapCount(A, other));
            bCurrentOverlaps.push_back(
              other == A || other == B ? 0 : overlapCount(B, other));
          }
          int currentPairOverlap = overlapCount(A, B);
          A->px = aPrevious.px;
          A->py = aPrevious.py;
          A->angle = aPrevious.angle;
          B->px = bPrevious.px;
          B->py = bPrevious.py;
          B->angle = bPrevious.angle;
          syncPose(A);
          syncPose(B);
          int aPreviousTerrain = terrainOverlapCount(A);
          int bPreviousTerrain = terrainOverlapCount(B);
          int previousPairOverlap = overlapCount(A, B);
          bool improved = aPreviousTerrain < aCurrentTerrain
            || bPreviousTerrain < bCurrentTerrain
            || previousPairOverlap < currentPairOverlap;
          bool accepted = aPreviousTerrain <= aCurrentTerrain
            && bPreviousTerrain <= bCurrentTerrain
            && (previousPairOverlap <= currentPairOverlap
              || previousPairOverlap <= allowedAliasCells);
          for (int i = 0; accepted
               && i < (int)rasterProjectionBodies.size(); i++) {
            Body* other = rasterProjectionBodies[i];
            if (other == A || other == B) continue;
            int aPreviousOverlap = overlapCount(A, other);
            int bPreviousOverlap = overlapCount(B, other);
            if ((aPreviousOverlap > aCurrentOverlaps[i]
                  && aPreviousOverlap > allowedOverlap(A, other))
                || (bPreviousOverlap > bCurrentOverlaps[i]
                  && bPreviousOverlap > allowedOverlap(B, other)))
              accepted = false;
            if (aPreviousOverlap < aCurrentOverlaps[i]
                || bPreviousOverlap < bCurrentOverlaps[i])
              improved = true;
          }
          if (!accepted || !improved) {
            A->px = aCurrent.px;
            A->py = aCurrent.py;
            A->angle = aCurrent.angle;
            B->px = bCurrent.px;
            B->py = bCurrent.py;
            B->angle = bCurrent.angle;
            syncPose(A);
            syncPose(B);
            return false;
          }
          if (!preserveRasterRecoveryMotion(A, aCurrent)) {
            A->vx = A->vy = A->omega = 0;
            A->pvx = A->pvy = A->pw = 0;
          }
          if (!preserveRasterRecoveryMotion(B, bCurrent)) {
            B->vx = B->vy = B->omega = 0;
            B->pvx = B->pvy = B->pw = 0;
          }
          A->hadContact = true;
          B->hadContact = true;
          rigidPositionCorrections += 2;
          rigidRasterCorrections += 2;
          rigidRasterMaxCorrection = std::fmax(
            rigidRasterMaxCorrection, std::fmax(aTravel, bTravel));
          return true;
        };
        if (rollbackPairAcceptedPose()) {
          corrected = true;
          continue;
        }
        if (solverMode == 34) {
          if (protectSleepingA) wakeRasterContact(A);
          if (protectSleepingB) wakeRasterContact(B);
        }
        rigidRasterProjectionFailures++;
        continue;
      }
      nx = bestAxisX;
      ny = bestAxisY;
      double finalAWeight = 0, finalBWeight = 0;
      setTrial(bestAmount, bestDirection, finalAWeight, finalBWeight);
      rigidPositionCorrections++;
      rigidRasterCorrections++;
      rigidRasterMaxCorrection = std::fmax(
        rigidRasterMaxCorrection, bestAmount);
      corrected = true;
    }
    if (!corrected) break;
  }
  clearOwners();
}

void RigidBodySystem::moveBodies() {
  double bodyPhaseStart = emscripten_get_now();
  if (E.reactions.acceptsRigidContacts()) E.reactions.beginRigidContacts(*E.L);
  if (E.L == &E.fg) {
    rigidRejectedCells = rigidDepenetrations = 0;
    rigidOwnershipConflicts = rigidRecoveryBodies = 0;
    rigidTerrainRecoveryBodies = rigidStampRecoveryBodies = 0;
    rigidRasterPlaceholderBodies = 0;
    rigidRasterCorrections = rigidRasterProjectionFailures = 0;
    rigidRasterMaxCorrection = 0;
    rigidCoreMs = rigidClearMs = rigidDepenMs = rigidBakeMs = 0;
    rigidBakeSupportMs = rigidBakeRasterMs = rigidBakeRegisterMs = 0;
    rigidBakedCells = 0;
    rigidStampMs = rigidSpillMs = 0;
    rigidPrepareMs = rigidFinalizeMs = 0;
    rigidContactMs = rigidSolveMs = 0;
    rigidPairContactMs = rigidTerrainContactMs = 0;
    rigidMotionPrepMs = rigidIntegrateMs = 0;
    rigidStepPrepareMs = rigidContactSetupMs = rigidStepFinalizeMs = 0;
    rigidOccupancyBuildMs = rigidCadenceMs = 0;
    rigidFluidCoupleMs = 0;
    rigidFluidReferenceTotalMs = rigidFluidDomainTotalMs = 0;
    rigidFluidMatrixTotalMs = rigidFluidSolveTotalMs = 0;
    rigidFluidWritebackTotalMs = 0;
    rigidFluidNodesTotal = rigidFluidFacesTotal = 0;
    rigidFluidIterationsTotal = rigidFluidDryReferencesSkipped = 0;
  }
  // Joint followers inherit their leader's pose and skip background integration,
  // but their stamped material still participates in background reactions.
  if (E.L == &E.bg) erodeBodies(E.bg.passiveBodyCells, true);
  bool hasSimulatedBody = false;
  for (Body* b : E.L->bodies)
    if (b->jointRole != 2) { hasSimulatedBody = true; break; }
  if (!hasSimulatedBody && E.L->bodyCells.empty()) {
    E.L->sleepingBodySupportDirty = false;
    return;
  }
  // stepLayer already grounded the live grid before assembly motion. Repeat that
  // full-grid work only if an assembly/loose-support change dirtied it afterward,
  // or if a sleeping body needs its support revalidated. This matters for blast
  // rubble: a long fuse-profile chain otherwise pays two grounding floods on
  // every flight tick even though its awake chunks cannot need a wake probe.
  // A single-layer computeGrounded() re-flood peels dual-layer joint stamps; if
  // the next tick then skips joint, co-supported terrain sloughs off. Preserve
  // stamps when joint already ran this tick OR a prior joint closure is valid.
  bool hasSleepingBody = false;
  bool hasAwakeBody = false;
  bool hasPendingBakeRaster = false;
  bool bakeRetryDeferred = E.layerBakeRetryDeferred(E.L);
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    if (b->awake) hasAwakeBody = true;
    else hasSleepingBody = true;
    if (!bakeRetryDeferred && E.bodyNeedsBakeTick(b))
      hasPendingBakeRaster = true;
  }
  bool needsGroundRefresh = E.L->groundDirty || E.L->groundContentDirty || E.L->looseGroundDirty;
  auto awaitingStableBakeRaster = [&]() {
    bool awaiting = false;
    for (Body* b : E.L->bodies) {
      if (bakeRetryDeferred || !E.bodyNeedsBakeTick(b)) continue;
      if (!rasterStableForBake(b)) awaiting = true;
      if (b->jointRole == 1 && b->jointPeer) {
        Engine::ActiveLayerScope layerScope(E, &E.bg);
        if (!rasterStableForBake(b->jointPeer)) awaiting = true;
      }
    }
    return awaiting;
  };
  if (!hasAwakeBody && hasPendingBakeRaster
      && !needsGroundRefresh && !E.L->sleepingBodySupportDirty
      && awaitingStableBakeRaster()) return;
  // Stable sleeping bodies remain stamped in the live grid. Support/topology
  // invalidation wakes this path even when the preceding grounding pass consumed
  // the source dirty flags.
  if (!hasAwakeBody && !hasPendingBakeRaster
      && !needsGroundRefresh && !E.L->sleepingBodySupportDirty) return;
  if (hasSleepingBody || needsGroundRefresh) {
    if (E.bgEnabled && (E.comps.jointGroundReady || E.comps.jointSupportValid)) {
      // joint stamps intact; body wake probes do not need a re-flood
    } else {
      E.comps.computeGrounded();
      if (E.bgEnabled) E.comps.jointDirty = true;
    }
  }
  // Revalidate sleeping bodies before their grid cells are cleared. Lost
  // support wakes a falling stack from the bottom up, while fresh liquid motion
  // wakes a fluid-supported body without disturbing rigidly grounded bodies.
  for (Body* b : E.L->bodies) if (b->jointRole != 2 && !b->awake) {
    if (!bodyFullyInsideLoadedWindow(b)) continue;
    bool movingLiquid = sleepingBodyTouchesMovingLiquid(b);
    if (!movingLiquid && b->jointRole == 1 && b->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      movingLiquid = sleepingBodyTouchesMovingLiquid(b->jointPeer);
    }
    if (movingLiquid) {
      bool rigidlySupported = bodyTouchesStaticSupport(b);
      if (!rigidlySupported && b->jointRole == 1 && b->jointPeer) {
        Engine::ActiveLayerScope layerScope(E, &E.bg);
        rigidlySupported = bodyTouchesStaticSupport(b->jointPeer);
      }
      if (!rigidlySupported) {
        wakeBody(b);
        continue;
      }
    }
    bool supported = sleepingBodyHasSupport(b, 1.0);
    if (!supported && b->jointRole == 1 && b->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      supported = sleepingBodyHasSupport(b->jointPeer, 1.0);
    }
    if (!supported) wakeBody(b);
  }
  E.L->sleepingBodySupportDirty = false;
  if (!hasAwakeBody && hasPendingBakeRaster) {
    bool wokeDuringSupportCheck = false;
    for (Body* b : E.L->bodies)
      if (b->jointRole != 2 && b->awake) { wokeDuringSupportCheck = true; break; }
    if (!wokeDuringSupportCheck && awaitingStableBakeRaster()) return;
  }
  if (E.L == &E.fg) {
    {
      Engine::ActiveLayerScope background(E, &E.bg);
      for (int k : E.bg.passiveBodyCells) {
        if (k < 0 || k >= E.cols * E.rows) continue;
        int owner = E.bg.bodyOwner[k];
        if (owner >= 0 && E.bg.passiveBodyIds.count(owner)) {
          E.writeGridIndexUnsafe(k, EMPTY);
          E.bg.bodyOwner[k] = -1;
        }
      }
    }
    E.bg.passiveBodyCells.clear();
  }
  bool rosterChanged = false;
  size_t simulatedBodyCount = 0;
  for (Body* b : E.L->bodies) if (b->jointRole != 2) {
    if (simulatedBodyCount >= moveBodyIds.size()
        || moveBodyIds[simulatedBodyCount] != b->id)
      rosterChanged = true;
    simulatedBodyCount++;
  }
  if (simulatedBodyCount != moveBodyIds.size()) rosterChanged = true;
  if (rosterChanged) {
    moveBodyIds.clear();
    moveBodySlotById.clear();
    moveBodyIds.reserve(simulatedBodyCount);
    moveBodySlotById.reserve(simulatedBodyCount * 2);
    for (Body* b : E.L->bodies) if (b->jointRole != 2) {
      int slot = (int)moveBodyIds.size();
      moveBodyIds.push_back(b->id);
      moveBodySlotById[b->id] = slot;
    }
    movePreviousPoses.resize(simulatedBodyCount);
    movePreviousFootprints.resize(simulatedBodyCount);
    movePreviousMaterials.resize(simulatedBodyCount);
    moveDisplaced.resize(simulatedBodyCount);
    moveStamped.resize(simulatedBodyCount);
  }
  for (size_t slot = 0; slot < simulatedBodyCount; slot++) {
    movePreviousFootprints[slot].clear();
    movePreviousMaterials[slot].clear();
    moveDisplaced[slot].clear();
    moveStamped[slot].clear();
  }
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    int slot = moveBodySlotById.find(body->id)->second;
    movePreviousPoses[slot] = {
      body->px, body->py, body->angle,
    };
  }
  bool batchRasterRestore = E.L->bodyCells.size()
                         >= (size_t)R_BODY_RASTER_BATCH_THRESHOLD;
  if (batchRasterRestore) {
    size_t gridSize = (size_t)E.cols * E.rows;
    if (movePreviousMaterialGrid.size() != gridSize) {
      movePreviousMaterialGrid.assign(gridSize, EMPTY);
      movePreviousOwnerGrid.assign(gridSize, -1);
    }
  }
  double clearStart = emscripten_get_now();
  rigidPrepareMs = rigidPrepareMs + (clearStart - bodyPhaseStart);
  for (int k : E.L->bodyCells) {
    int owner = E.L->bodyOwner[k];
    auto slot = moveBodySlotById.find(owner);
    if (slot != moveBodySlotById.end()) {
      movePreviousFootprints[slot->second].push_back(k);
      movePreviousMaterials[slot->second].push_back(E.L->grid[k]);
    }
    if (batchRasterRestore) {
      movePreviousMaterialGrid[k] = E.L->grid[k];
      movePreviousOwnerGrid[k] = owner;
      E.L->grid[k] = EMPTY;
      E.clearPersistentCurrentState(E.L, k);
      E.L->bodyOwner[k] = -1;
      E.markLayerSimCell(E.L, k);
    } else {
      if (E.isBodyCell(k)) E.writeGridIndexUnsafe(k, EMPTY);
      E.L->bodyOwner[k] = -1;
    }
  }
  double clearElapsed = emscripten_get_now() - clearStart;
  rigidClearMs = rigidClearMs + clearElapsed;
  double coreStart = emscripten_get_now();
  rigidStep(1.0);
  if (rigidTraceLayer == (E.L == &E.bg ? 1 : 0)) captureTracePose(6);
  double coreElapsed = emscripten_get_now() - coreStart;
  rigidCoreMs = rigidCoreMs + coreElapsed;
  // First reconcile integer-raster body contacts so terrain recovery starts
  // from a pose whose neighboring structure bodies are already separated.
  resolveStructureRasterOverlaps();
  if (rigidTraceLayer == (E.L == &E.bg ? 1 : 0)) captureTracePose(7);
  double depenStart = emscripten_get_now();
  bool terrainPoseChanged = false;
  terrainAdjustmentParents.resize(simulatedBodyCount);
  auto adjustmentRoot = [&](int slot) {
    int root = slot;
    while (terrainAdjustmentParents[root] != root)
      root = terrainAdjustmentParents[root];
    while (terrainAdjustmentParents[slot] != slot) {
      int next = terrainAdjustmentParents[slot];
      terrainAdjustmentParents[slot] = root;
      slot = next;
    }
    return root;
  };
  auto bodyOverlapsTerrain = [&](Body* body) {
    if (bodyTerrainBlocked(body) > 0) return true;
    if (body->jointRole != 1 || !body->jointPeer) return false;
    Engine::ActiveLayerScope layerScope(E, &E.bg);
    return bodyTerrainBlocked(body->jointPeer) > 0;
  };
  for (int slot = 0; slot < (int)simulatedBodyCount; slot++)
    terrainAdjustmentParents[slot] = slot;
  for (const auto& pair : terrainContactPairs) {
    auto first = moveBodySlotById.find(pair.first);
    auto second = moveBodySlotById.find(pair.second);
    if (first == moveBodySlotById.end()
        || second == moveBodySlotById.end())
      continue;
    int a = adjustmentRoot(first->second);
    int b = adjustmentRoot(second->second);
    if (a != b) terrainAdjustmentParents[b] = a;
  }
  static constexpr uint8_t ROOT_ACTIVE = 1 << 0;
  static constexpr uint8_t ROOT_EXACT = 1 << 1;
  static constexpr uint8_t ROOT_VISITED = 1 << 2;
  static constexpr uint8_t ROOT_RECOVERED = 1 << 3;
  std::vector<uint8_t> adjustmentRootState(simulatedBodyCount, 0);
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    int slot = moveBodySlotById.find(body->id)->second;
    int root = adjustmentRoot(slot);
    if (body->rasterMayOverlapSolid)
      adjustmentRootState[root] |= ROOT_ACTIVE;
    // Structure-scale bodies receive an exact final-raster probe. Their long,
    // sparse boundary can pass every sampled contact while one remote arm enters
    // terrain, and peer-layer contacts are outside this layer's final position
    // projection. Quiet irregular bodies and tiny debris use the same guard.
    bool exactStructureProbe =
      body->maxR >= R_EXACT_RASTER_BODY_RADIUS
      || body->nPts >= R_EXACT_RASTER_BODY_CELLS;
    bool exactQuietProbe = exactStructureProbe
      || (!rigidLargeSlenderBody(body)
      && (!body->awake
        || (body->nPts <= R_QUIET_TERRAIN_PROBE_MAX_CELLS
          && body->vx * body->vx + body->vy * body->vy
              < R_SLEEP_LIN * R_SLEEP_LIN
          && std::fabs(body->omega) < R_SLEEP_ANG)));
    if (exactQuietProbe && bodyOverlapsTerrain(body))
      adjustmentRootState[root] |= ROOT_ACTIVE | ROOT_EXACT;
  }
  // Translate a complete final-contact island together so terrain correction
  // cannot pull a resting stack apart. Material and bake lifetime are irrelevant.
  for (int pass = 0; pass < 8; pass++) {
    bool adjusted = false;
    for (Body* body : E.L->bodies) {
      if (body->jointRole == 2) continue;
      int slot = moveBodySlotById.find(body->id)->second;
      int root = adjustmentRoot(slot);
      uint8_t rootState = adjustmentRootState[root];
      if (!(rootState & ROOT_ACTIVE)
          || !(rootState & ROOT_EXACT
            ? bodyOverlapsTerrain(body)
            : bodyFootprintOverlapsSolid(body))) continue;
      double dx = 0, dy = 0;
      if (!findTerrainClearAdjustment(body, dx, dy)) continue;
      for (Body* member : E.L->bodies) {
        if (member->jointRole == 2) continue;
        int memberSlot = moveBodySlotById.find(member->id)->second;
        if (adjustmentRoot(memberSlot) != root) continue;
        member->px += dx;
        member->py += dy;
        if (member->jointRole == 1) syncJointFollower(member);
      }
      rigidDepenetrations++;
      terrainPoseChanged = true;
      adjusted = true;
      break;
    }
    if (!adjusted) break;
  }
  // A structure-scale or already-quiet contact island must never keep a pose
  // whose raster is inside static terrain. If local translation cannot clear
  // the proposed pose, retain the complete island's last stamped pose.
  // Restoring the island together preserves its body-body contacts, while the
  // next support check wakes any member that is not actually resting there.
  for (Body* seed : E.L->bodies) {
    if (seed->jointRole == 2) continue;
    int seedSlot = moveBodySlotById.find(seed->id)->second;
    int root = adjustmentRoot(seedSlot);
    uint8_t& rootState = adjustmentRootState[root];
    if (!(rootState & ROOT_ACTIVE) || (rootState & ROOT_VISITED)) continue;
    rootState |= ROOT_VISITED;
    if (!(rootState & ROOT_EXACT)) continue;

    bool overlapsTerrain = false;
    bool structureScale = false;
    bool quietIsland = true;
    for (Body* member : E.L->bodies) {
      if (member->jointRole == 2) continue;
      int memberSlot = moveBodySlotById.find(member->id)->second;
      if (adjustmentRoot(memberSlot) != root) continue;
      structureScale = structureScale
        || member->maxR >= R_EXACT_RASTER_BODY_RADIUS
        || member->nPts >= R_EXACT_RASTER_BODY_CELLS;
      quietIsland = quietIsland
        && (!member->awake
          || (member->vx * member->vx + member->vy * member->vy
                < R_SLEEP_LIN * R_SLEEP_LIN
              && std::fabs(member->omega) < R_SLEEP_ANG));
      overlapsTerrain = overlapsTerrain
        || bodyOverlapsTerrain(member);
    }
    if ((!structureScale && !quietIsland) || !overlapsTerrain) continue;

    std::vector<std::pair<Body*, MovePose>> proposed;
    std::vector<int> proposedTerrain;
    for (Body* member : E.L->bodies) {
      if (member->jointRole == 2) continue;
      int memberSlot = moveBodySlotById.find(member->id)->second;
      if (adjustmentRoot(memberSlot) != root) continue;
      proposed.push_back({member, {
        member->px, member->py, member->angle,
      }});
      int blocked = bodyTerrainBlocked(member);
      if (member->jointRole == 1 && member->jointPeer) {
        Engine::ActiveLayerScope layerScope(E, &E.bg);
        blocked += bodyTerrainBlocked(member->jointPeer);
      }
      proposedTerrain.push_back(blocked);
      const MovePose& previous = movePreviousPoses[memberSlot];
      member->px = previous.px;
      member->py = previous.py;
      member->angle = previous.angle;
      member->cs = std::cos(member->angle);
      member->sn = std::sin(member->angle);
      if (member->jointRole == 1) syncJointFollower(member);
    }

    bool previousPoseAccepted = true;
    bool previousPoseImproved = false;
    for (int i = 0; i < (int)proposed.size(); i++) {
      Body* member = proposed[i].first;
      int blocked = bodyTerrainBlocked(member);
      if (member->jointRole == 1 && member->jointPeer) {
        Engine::ActiveLayerScope layerScope(E, &E.bg);
        blocked += bodyTerrainBlocked(member->jointPeer);
      }
      if (blocked > proposedTerrain[i]) previousPoseAccepted = false;
      if (blocked < proposedTerrain[i]) previousPoseImproved = true;
    }
    if (!previousPoseAccepted || !previousPoseImproved) {
      for (const auto& entry : proposed) {
        Body* member = entry.first;
        member->px = entry.second.px;
        member->py = entry.second.py;
        member->angle = entry.second.angle;
        member->cs = std::cos(member->angle);
        member->sn = std::sin(member->angle);
        if (member->jointRole == 1) syncJointFollower(member);
      }
      continue;
    }

    for (const auto& entry : proposed) {
      Body* member = entry.first;
      if (!preserveRasterRecoveryMotion(member, entry.second)) {
        member->vx = member->vy = member->omega = 0;
        member->pvx = member->pvy = member->pw = 0;
        member->awake = false;
        resetSleepTracking(member);
      }
      member->hadContact = true;
      member->rasterMayOverlapSolid = false;
      if (member->jointRole == 1) syncJointFollower(member);
      rigidRecoveryBodies++;
      rigidTerrainRecoveryBodies++;
    }
    rootState |= ROOT_RECOVERED;
    terrainPoseChanged = true;
  }
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    int slot = moveBodySlotById.find(body->id)->second;
    int root = adjustmentRoot(slot);
    uint8_t rootState = adjustmentRootState[root];
    if (!(rootState & ROOT_ACTIVE) || (rootState & ROOT_RECOVERED)
        || !(rootState & ROOT_EXACT
          ? bodyOverlapsTerrain(body)
          : bodyFootprintOverlapsSolid(body))) continue;
    body->awake = true;
    resetSleepTracking(body);
  }
  // Terrain recovery can translate a complete support island. Reconcile body
  // pairs again only after such a move, so that translation cannot leave one
  // island inside a neighbor; accepted corrections are checked against the
  // final terrain raster before they are committed.
  if (terrainPoseChanged) resolveStructureRasterOverlaps();
  if (rigidTraceLayer == (E.L == &E.bg ? 1 : 0)) captureTracePose(8);
  double depenElapsed = emscripten_get_now() - depenStart;
  rigidDepenMs = rigidDepenMs + depenElapsed;
  moveCells.clear();
  moveFootprint.clear();
  double stampStart = emscripten_get_now();
  // A body whose last proposed raster was wholly rejected already has a unique,
  // accepted cell assignment in its previous footprint. Reclaim those cells
  // before the ordinary body-order pass when they are still inside the current
  // shape. This is the raster equivalent of persistent contact features: an
  // unrelated active body cannot repeatedly steal a settled one-cell fragment's
  // only representable cell and force it through rollback every tick.
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2 || !body->rasterAssignmentLocked) continue;
    int slot = moveBodySlotById.find(body->id)->second;
    for (int k : movePreviousFootprints[slot]) {
      body->stampPreclaimAttempts++;
      if (k < 0 || k >= E.cols * E.rows) {
        body->stampPreclaimOutside++;
        continue;
      }
      if (E.L->bodyOwner[k] >= 0 || E.L->grid[k] != EMPTY) {
        body->stampPreclaimBlocked++;
        continue;
      }
      int y = k / E.cols, x = k - y * E.cols;
      int local = localCellAt(body, x + 0.5, y + 0.5);
      if (local < 0) {
        body->stampPreclaimOutside++;
        const MovePose& previous = movePreviousPoses[slot];
        double cs = std::cos(previous.angle);
        double sn = std::sin(previous.angle);
        double dx = x + 0.5 - previous.px;
        double dy = y + 0.5 - previous.py;
        int i = (int)std::lround(
          dx * cs + dy * sn - body->offsetX);
        int j = (int)std::lround(
          -dx * sn + dy * cs - body->offsetY);
        bool previousInside = i >= 0 && i < body->w
          && j >= 0 && j < body->h
          && body->occ[j * body->w + i];
        if (previousInside) body->stampPreclaimMovedOutside++;
        else body->stampPreclaimStartedOutside++;
        continue;
      }
      uint8_t material = bodyMaterialAt(body, local);
      E.writeGridIndexUnsafe(k, material);
      E.L->bodyOwner[k] = body->id;
      if (body->blastDebris) E.L->groundedCell[k] = 0;
      moveCells.push_back(k);
      moveFootprint.push_back(k);
      moveStamped[slot].push_back(k);
      body->stampPreclaimSuccesses++;
    }
  }
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    int slot = moveBodySlotById.find(b->id)->second;
    if (!b->rasterAssignmentLocked) {
      b->rasterLockCell = -1;
      b->rasterLockOwner = -2;
    }
    std::vector<Disp>& displaced = moveDisplaced[slot];
    std::vector<int>& stamped = moveStamped[slot];
    forEachBodyCell(b, [&](int x, int y, int local) {
      int k = y * E.cols + x;
      int owner = E.L->bodyOwner[k];
      uint8_t material = bodyMaterialAt(b, local);
      if (batchRasterRestore && owner == -1 && E.L->grid[k] == EMPTY
          && movePreviousOwnerGrid[k] == b->id
          && movePreviousMaterialGrid[k] == material) {
        E.L->grid[k] = material;
        E.clearPersistentCurrentState(E.L, k);
        E.L->bodyOwner[k] = b->id;
        if (material == NEUTRONIUM) {
          E.L->forceSourcePresent = true;
        }
        E.noteLooseGroundTouch2At(k, material, EMPTY);
        if (E.isHeatSource(material))
          E.L->heatAddedAfterPrepare = true;
        if (b->blastDebris) E.L->groundedCell[k] = 0;
        moveCells.push_back(k);
        moveFootprint.push_back(k);
        stamped.push_back(k);
        return;
      }
      if (owner == b->id) return;
      if (owner != -1) {
        if (b->rasterLockCell < 0) {
          b->rasterLockCell = k;
          b->rasterLockOwner = owner;
        }
        rigidOwnershipConflicts++;
        return;
      }
      uint8_t m = E.L->grid[k];
      if (!canBodyOccupy(m, k, b->density)) {
        if (b->rasterLockCell < 0) {
          b->rasterLockCell = k;
          b->rasterLockOwner = -1;
        }
        rigidRejectedCells++;
        return;
      }
      if (isBodyRelocatable(m, k, b->density)) displaced.push_back({
        m, k, E.capturePersistentCurrentState(E.L, k),
      });
      E.writeGridIndexUnsafe(k, material); E.L->bodyOwner[k] = b->id;
      if (b->blastDebris) E.L->groundedCell[k] = 0;
      moveCells.push_back(k); moveFootprint.push_back(k); stamped.push_back(k); // body-material invariant: stamp the body's REAL material so it renders/mines/reacts as that material
    });
  }
  if (batchRasterRestore)
    for (int k : E.L->bodyCells) {
      if (E.L->grid[k] != movePreviousMaterialGrid[k]
          || E.L->bodyOwner[k] != movePreviousOwnerGrid[k])
        E.markCellIndex(k);
      movePreviousMaterialGrid[k] = EMPTY;
      movePreviousOwnerGrid[k] = -1;
    }
  double stampElapsed = emscripten_get_now() - stampStart;
  rigidStampMs = rigidStampMs + stampElapsed;
  // A rotated cell-sized shape can pass between lattice sample centres even
  // though its continuous square still exists. Keep its last visible cell while
  // the continuous pose and velocity advance; once a sample centre re-enters
  // the shape, the ordinary stamp resumes at the new location.
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    int slot = moveBodySlotById.find(body->id)->second;
    if (!moveStamped[slot].empty() || movePreviousFootprints[slot].empty())
      continue;
    ensureBodyRaster(body);
    if (!body->rasterFootprint.empty()) continue;
    const std::vector<int>& previous = movePreviousFootprints[slot];
    const std::vector<uint8_t>& materials = movePreviousMaterials[slot];
    for (int index = 0; index < (int)previous.size(); index++) {
      int k = previous[index];
      if (k < 0 || k >= E.cols * E.rows
          || E.L->bodyOwner[k] >= 0 || E.L->grid[k] != EMPTY) continue;
      uint8_t material = index < (int)materials.size()
        ? materials[index] : body->material;
      if (material == EMPTY) continue;
      E.writeGridIndexUnsafe(k, material);
      E.L->bodyOwner[k] = body->id;
      if (body->blastDebris) E.L->groundedCell[k] = 0;
      moveCells.push_back(k);
      moveFootprint.push_back(k);
      moveStamped[slot].push_back(k);
    }
    if (!moveStamped[slot].empty()) rigidRasterPlaceholderBodies++;
  }
  // A sub-cell body can have its entire proposed raster rejected at a solid or
  // fluid boundary. Restore its last accepted pose and raster; deleting it here
  // would make one-cell bodies such as seeds vanish on first contact.
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    int slot = moveBodySlotById.find(body->id)->second;
    if (!moveStamped[slot].empty() || movePreviousFootprints[slot].empty()) continue;
    const MovePose& pose = movePreviousPoses[slot];
    int lockCell = body->rasterLockCell;
    int lockOwner = body->rasterLockOwner;
    body->px = pose.px; body->py = pose.py; body->angle = pose.angle;
    body->vx = body->vy = body->omega = 0;
    body->awake = false;
    resetSleepTracking(body);
    body->rasterAssignmentLocked = true;
    body->rasterLockCell = lockCell;
    body->rasterLockOwner = lockOwner;
    body->cs = std::cos(body->angle); body->sn = std::sin(body->angle);
    if (body->jointRole == 1) syncJointFollower(body);
    for (int k : movePreviousFootprints[slot]) {
      if (k < 0 || k >= E.cols * E.rows
          || E.L->bodyOwner[k] >= 0 || E.L->grid[k] != EMPTY) continue;
      int y = k / E.cols, x = k - y * E.cols;
      int local = localCellAt(body, x + 0.5, y + 0.5);
      if (local < 0) continue;
      uint8_t material = bodyMaterialAt(body, local);
      E.writeGridIndexUnsafe(k, material);
      E.L->bodyOwner[k] = body->id;
      moveCells.push_back(k);
      moveFootprint.push_back(k);
      moveStamped[slot].push_back(k);
    }
    if (!moveStamped[slot].empty()) {
      body->stampRecoveryStreak = body->stampRecoveryTick == E.tick - 1
        ? (uint16_t)imin((int)UINT16_MAX,
                         (int)body->stampRecoveryStreak + 1)
        : 1;
      body->stampRecoveryTick = E.tick;
      body->stampRecoveryTotal++;
      rigidRecoveryBodies++;
      rigidStampRecoveryBodies++;
    }
  }
  {
    std::vector<Body*> keep;
    keep.reserve(E.L->bodies.size());
    for (Body* b : E.L->bodies) {
      if (b->jointRole == 2) { keep.push_back(b); continue; }
      int slot = moveBodySlotById.find(b->id)->second;
      if (moveStamped[slot].empty()) {
        if (b->jointRole == 1 && b->jointPeer) {
          bool hasUnionCell = false;
          for (uint8_t occupied : b->occ)
            if (occupied) { hasUnionCell = true; break; }
          if (hasUnionCell) {
            keep.push_back(b);
            continue;
          }
          Body* follower = b->jointPeer;
          E.bg.passiveBodyIds.erase(follower->id);
          E.bg.bodies.erase(
            std::remove(E.bg.bodies.begin(), E.bg.bodies.end(), follower),
            E.bg.bodies.end());
          delete follower;
        }
        delete b;
        continue;
      }
      keep.push_back(b);
    }
    if (keep.size() != E.L->bodies.size()) E.L->bodies = std::move(keep);
  }
  E.L->reserveSeenGenerations(
    SPILL_GENERATION_BUDGET * std::max<size_t>(1, E.L->bodies.size()));
  int32_t footprintGen = E.L->nextSeenGeneration();
  for (int k : moveFootprint) E.L->rigidSpillFootprint[k] = footprintGen;
  double spillStart = emscripten_get_now();
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    int slot = moveBodySlotById.find(b->id)->second;
    const std::vector<int>* vacated = movePreviousFootprints[slot].empty()
      ? nullptr : &movePreviousFootprints[slot];
    spillDisplacedBodyMaterial(moveDisplaced[slot], moveStamped[slot],
                               footprintGen, b->id, b->density,
                               PCSO_BODY_MOTION, vacated);
  }
  double spillElapsed = emscripten_get_now() - spillStart;
  rigidSpillMs = rigidSpillMs + spillElapsed;
  double finalizeStart = emscripten_get_now();
  if (E.L == &E.fg) {
    // Joint erosion rebuilds pieces from the two live owner rasters. Restore
    // the follower before acid/fire can erase the leader so the splitter sees
    // both layer maps instead of interpreting the temporarily-cleared
    // background footprint as a foreground-only body.
    std::vector<Body*> leaders;
    for (Body* b : E.fg.bodies) if (b->jointRole == 1) leaders.push_back(b);
    for (Body* leader : leaders)
      stampJointFollower(leader, PCSO_BODY_MOTION);
  }
  erodeBodies(moveCells);
  if (E.L == &E.bg)
    for (Body* leader : E.fg.bodies)
      if (leader->jointRole == 1) syncJointFollower(leader);
  rigidFinalizeMs = rigidFinalizeMs
                  + (emscripten_get_now() - finalizeStart);
  if (rigidTraceLayer == (E.L == &E.bg ? 1 : 0)) captureTracePose(9);
}

void RigidBodySystem::collectPlacementTouchingBodyIds(
    const std::vector<std::pair<int, int>>& cells,
    std::unordered_set<int>& touchingIds) {
  Layer* peer = E.bgEnabled ? (E.L == &E.fg ? &E.bg : &E.fg) : nullptr;
  std::unordered_map<int, Body*> peerById;
  if (peer) {
    peerById.reserve(peer->bodies.size() * 2);
    for (Body* body : peer->bodies) peerById[body->id] = body;
  }
  auto addPeerJoint = [&](int owner) {
    auto found = peerById.find(owner);
    if (found == peerById.end()) return;
    Body* member = found->second;
    if (!member->jointRole || !member->jointPeer) return;
    touchingIds.insert(member->jointPeer->id);
  };
  int minX = E.cols, minY = E.rows, maxX = -1, maxY = -1;
  for (const auto& cell : cells) {
    if (cell.first < 0 || cell.first >= E.cols
        || cell.second < 0 || cell.second >= E.rows) continue;
    minX = imin(minX, cell.first); minY = imin(minY, cell.second);
    maxX = imax(maxX, cell.first); maxY = imax(maxY, cell.second);
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      int x = cell.first + ox, y = cell.second + oy;
      if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
      int k = y * E.cols + x;
      int owner = E.L->bodyOwner[k];
      if (owner >= 0) touchingIds.insert(owner);
      if (peer && peer->bodyOwner[k] >= 0)
        addPeerJoint(peer->bodyOwner[k]);
    }
  }
  if (maxX < minX || maxY < minY) return;
  auto addContinuousContacts = [&](const std::vector<Body*>& bodies,
                                   bool peerJointsOnly) {
    for (Body* member : bodies) {
      if (peerJointsOnly && (!member->jointRole || !member->jointPeer)) continue;
      Body* activeMember = peerJointsOnly ? member->jointPeer : member;
      if (touchingIds.count(activeMember->id)) continue;
      double closestX = std::fmax(minX + 0.5,
        std::fmin(member->px, maxX + 0.5));
      double closestY = std::fmax(minY + 0.5,
        std::fmin(member->py, maxY + 0.5));
      double dx = closestX - member->px, dy = closestY - member->py;
      double reach = member->maxR + 1.0;
      if (dx * dx + dy * dy > reach * reach) continue;
      member->cs = std::cos(member->angle);
      member->sn = std::sin(member->angle);
      for (const auto& cell : cells) {
        if (insideBodyIndex(member, cell.first + 0.5, cell.second + 0.5) < 0)
          continue;
        touchingIds.insert(activeMember->id);
        break;
      }
    }
  };
  addContinuousContacts(E.L->bodies, false);
  if (peer) addContinuousContacts(peer->bodies, true);
}

bool RigidBodySystem::anchorPlacementToStatic(
    const std::vector<std::pair<int, int>>& cells, uint8_t material,
    uint8_t plantType) {
  // Static contact anchors the whole touched component-backed assembly. The
  // placed cells share its baked assembly id across both simulated layers.
  std::unordered_set<int> touchingIds;
  collectPlacementTouchingBodyIds(cells, touchingIds);
  if (touchingIds.empty()) return false;

  Layer* placementLayer = E.L;
  std::array<std::vector<Body*>, 2> selected;
  std::array<std::unordered_set<Body*>, 2> selectedSet;
  auto select = [&](int layerIndex, Body* body) {
    if (selectedSet[layerIndex].insert(body).second)
      selected[layerIndex].push_back(body);
  };
  for (Body* member : placementLayer->bodies) {
    if (!touchingIds.count(member->id)) continue;
    Body* leader = member->jointRole == 2 ? member->jointPeer : member;
    if (!leader || !bodyFullyInsideLoadedWindow(leader)
        || !bodySolidifies(leader)
        || (leader->jointPeer && !bodySolidifies(leader->jointPeer)))
      return false;
    if (leader->jointRole == 1 && leader->jointPeer) {
      syncJointFollower(leader);
      select(0, leader);
      select(1, leader->jointPeer);
    } else {
      int layerIndex = placementLayer == &E.bg ? 1 : 0;
      select(layerIndex, member);
    }
  }
  if (selected[0].empty() && selected[1].empty()) return false;

  auto clearSelected = [&](Layer& layer, int layerIndex) {
    Engine::ActiveLayerScope layerScope(E, &layer);
    std::unordered_set<int> ids;
    ids.reserve(selected[layerIndex].size() * 2);
    for (Body* body : selected[layerIndex]) ids.insert(body->id);
    auto clearCells = [&](std::vector<int>& bodyCells) {
      std::vector<int> kept;
      kept.reserve(bodyCells.size());
      for (int k : bodyCells) {
        if (k >= 0 && k < E.cols * E.rows
            && ids.count(layer.bodyOwner[k])) {
          E.writeGridIndexUnsafe(k, EMPTY);
          layer.bodyOwner[k] = -1;
        } else {
          kept.push_back(k);
        }
      }
      bodyCells = std::move(kept);
    };
    clearCells(layer.bodyCells);
    clearCells(layer.passiveBodyCells);
    for (int id : ids) layer.passiveBodyIds.erase(id);
  };
  clearSelected(E.fg, 0);
  clearSelected(E.bg, 1);

  int assemblyId = E.nextBakedAssemblyId++;
  for (int layerIndex = 0; layerIndex < 2; layerIndex++) {
    Layer& layer = layerIndex ? E.bg : E.fg;
    Engine::ActiveLayerScope layerScope(E, &layer);
    for (Body* body : selected[layerIndex])
      bakeBodyToGrid(body, assemblyId);
  }

  std::vector<int> placed;
  {
    Engine::ActiveLayerScope layerScope(E, placementLayer);
    placed.reserve(cells.size());
    for (const auto& cell : cells) {
      if (!E.isInBounds(cell.first, cell.second)) continue;
      int k = cell.second * E.cols + cell.first;
      if (placementLayer->grid[k] != EMPTY) continue;
      E.writeGridIndexUnsafe(k, material);
      placed.push_back(k);
    }
    E.comps.registerBakedCells(placed, assemblyId,
                               E.isIceMaterial(material), plantType);
  }

  for (int layerIndex = 0; layerIndex < 2; layerIndex++) {
    Layer& layer = layerIndex ? E.bg : E.fg;
    std::vector<Body*> kept;
    kept.reserve(layer.bodies.size() - selected[layerIndex].size());
    for (Body* body : layer.bodies) {
      if (!selectedSet[layerIndex].count(body)) kept.push_back(body);
    }
    layer.bodies = std::move(kept);
    layer.sleepingBodySupportDirty = true;
  }
  for (const auto& layerBodies : selected)
    for (Body* body : layerBodies) delete body;
  E.comps.jointBakeNeedsGroundRefresh = E.bgEnabled;
  E.comps.jointDirty = E.bgEnabled;
  E.comps.jointBondsInvalid = E.bgEnabled;
  E.comps.jointSupportValid = false;
  return true;
}

Body* RigidBodySystem::finishSpawn(const std::vector<std::pair<int, int>>& cells,
                                   uint8_t material, bool attachTouchingBodies) {
  if (cells.empty() || material == EMPTY || !isMaterialId(material)) return nullptr;

  // A single placement gesture may contain disconnected islands. Each island
  // starts as its own body unless contact with an existing body welds them.
  std::map<int, std::pair<int, int>> orderedCells;
  for (const auto& cell : cells) {
    if (cell.first < 0 || cell.first >= E.cols || cell.second < 0 || cell.second >= E.rows)
      continue;
    orderedCells[cell.second * E.cols + cell.first] = cell;
  }
  if (orderedCells.empty()) return nullptr;
  std::unordered_set<int> unvisited;
  unvisited.reserve(orderedCells.size() * 2);
  for (const auto& entry : orderedCells) unvisited.insert(entry.first);
  std::vector<std::vector<std::pair<int, int>>> islands;
  std::vector<int> stack;
  for (const auto& entry : orderedCells) {
    if (!unvisited.erase(entry.first)) continue;
    islands.push_back({});
    stack.clear();
    stack.push_back(entry.first);
    while (!stack.empty()) {
      int k = stack.back();
      stack.pop_back();
      islands.back().push_back({k % E.cols, k / E.cols});
      int x = k % E.cols, y = k / E.cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int nk = ny * E.cols + nx;
        if (unvisited.erase(nk)) stack.push_back(nk);
      }
    }
    std::sort(islands.back().begin(), islands.back().end(),
              [&](const auto& a, const auto& b) {
                return a.second * E.cols + a.first < b.second * E.cols + b.first;
              });
  }
  if (islands.size() > 1) {
    Body* last = nullptr;
    for (const auto& island : islands) {
      Body* spawned = finishSpawn(island, material, attachTouchingBodies);
      if (spawned) last = spawned;
    }
    return last;
  }
  const std::vector<std::pair<int, int>>& spawnCells = islands[0];

  std::unordered_set<int> touchingIds;
  if (attachTouchingBodies)
    collectPlacementTouchingBodyIds(spawnCells, touchingIds);

  std::vector<Body*> touching;
  bool touchesJoint = false;
  if (!touchingIds.empty()) {
    for (Body* body : E.L->bodies)
      if (touchingIds.count(body->id)) {
        touching.push_back(body);
        touchesJoint = touchesJoint || body->jointRole != 0;
      }
    std::sort(touching.begin(), touching.end(),
              [](Body* a, Body* b) { return a->id < b->id; });
  }

  Layer* placementLayer = E.L;
  Body* body = nullptr;
  struct WeldMotion {
    double mass, inertia, px, py, vx, vy, omega;
  };
  auto captureWeldMotion = [](Body* source,
                              std::vector<WeldMotion>& motion) {
    if (!source || source->invMass <= 0 || source->invInertia <= 0) return;
    motion.push_back({1.0 / source->invMass, 1.0 / source->invInertia,
                      source->px, source->py, source->vx, source->vy,
                      source->omega});
  };
  auto applyWeldMotion = [](Body* merged,
                            const std::vector<WeldMotion>& motion) {
    if (!merged || merged->invMass <= 0 || merged->invInertia <= 0) return;
    double momentumX = 0, momentumY = 0;
    for (const WeldMotion& source : motion) {
      momentumX += source.mass * source.vx;
      momentumY += source.mass * source.vy;
    }
    merged->vx = momentumX * merged->invMass;
    merged->vy = momentumY * merged->invMass;
    double angularMomentum = 0;
    for (const WeldMotion& source : motion) {
      double sourceMomentumX = source.mass * source.vx;
      double sourceMomentumY = source.mass * source.vy;
      angularMomentum += source.inertia * source.omega
        + (source.px - merged->px) * sourceMomentumY
        - (source.py - merged->py) * sourceMomentumX;
    }
    merged->omega = angularMomentum * merged->invInertia;
  };
  if (touching.empty()) {
    body = spawnBodyImpl(spawnCells, material, DENSITY[material]);
  } else if (touchesJoint) {
    // Preserve the two-layer object when a placement welds to either half.
    // This path is placement-only; ordinary single-layer welds retain the
    // smaller layer-local merge below.
    std::map<int, uint8_t> activeMaterialAt, peerMaterialAt;
    std::array<std::unordered_set<int>, 2> removedIds;
    std::array<std::unordered_set<Body*>, 2> removedBodies;
    int activeLayer = placementLayer == &E.bg ? 1 : 0;
    int peerLayer = 1 - activeLayer;
    std::vector<WeldMotion> motion;
    std::unordered_set<Body*> capturedPhysical;
    int fuseTicks = 0;
    double fuseX = 0, fuseY = 0;
    auto collectRaster = [&](Body* source, std::map<int, uint8_t>& materialAt) {
      forEachBodyCell(source, [&](int x, int y, int local) {
        materialAt.emplace(y * E.cols + x, bodyMaterialAt(source, local));
      });
    };
    for (Body* source : touching) {
      Body* physical = source->jointRole == 2 ? source->jointPeer : source;
      if (physical) {
        if (capturedPhysical.insert(physical).second)
          captureWeldMotion(physical, motion);
        if (physical->fuseTicks > 0
            && (!fuseTicks || physical->fuseTicks < fuseTicks)) {
          fuseTicks = physical->fuseTicks;
          bodyFusePoint(physical, fuseX, fuseY);
        }
      }
      collectRaster(source, activeMaterialAt);
      removedIds[activeLayer].insert(source->id);
      removedBodies[activeLayer].insert(source);
      if (source->jointRole && source->jointPeer) {
        collectRaster(source->jointPeer, peerMaterialAt);
        removedIds[peerLayer].insert(source->jointPeer->id);
        removedBodies[peerLayer].insert(source->jointPeer);
      }
    }
    for (const auto& cell : spawnCells)
      activeMaterialAt[cell.second * E.cols + cell.first] = material;

    auto clearRemoved = [&](Layer& layer, int layerIndex) {
      Engine::ActiveLayerScope layerScope(E, &layer);
      auto clearCells = [&](std::vector<int>& cells) {
        std::vector<int> kept;
        kept.reserve(cells.size());
        for (int k : cells) {
          if (k >= 0 && k < E.cols * E.rows
              && removedIds[layerIndex].count(layer.bodyOwner[k])) {
            E.writeGridIndexUnsafe(k, EMPTY);
            layer.bodyOwner[k] = -1;
          } else {
            kept.push_back(k);
          }
        }
        cells = std::move(kept);
      };
      clearCells(layer.bodyCells);
      clearCells(layer.passiveBodyCells);
      for (Body* removed : removedBodies[layerIndex])
        if (removed->jointRole == 2) layer.passiveBodyIds.erase(removed->id);
      std::vector<Body*> kept;
      kept.reserve(layer.bodies.size());
      for (Body* candidate : layer.bodies)
        if (!removedBodies[layerIndex].count(candidate)) kept.push_back(candidate);
      layer.bodies = std::move(kept);
    };
    clearRemoved(E.fg, 0);
    clearRemoved(E.bg, 1);
    std::unordered_set<Body*> deleted;
    for (const auto& layerBodies : removedBodies)
      for (Body* removed : layerBodies)
        if (deleted.insert(removed).second) delete removed;

    auto unpack = [&](const std::map<int, uint8_t>& materialAt,
                      std::vector<std::pair<int, int>>& cells,
                      std::vector<uint8_t>& materials) {
      cells.reserve(materialAt.size());
      materials.reserve(materialAt.size());
      for (const auto& entry : materialAt) {
        cells.push_back({entry.first % E.cols, entry.first / E.cols});
        materials.push_back(entry.second);
      }
    };
    std::vector<std::pair<int, int>> activeCells, peerCells;
    std::vector<uint8_t> activeMaterials, peerMaterials;
    unpack(activeMaterialAt, activeCells, activeMaterials);
    unpack(peerMaterialAt, peerCells, peerMaterials);
    Body* leader = placementLayer == &E.fg
      ? spawnJointBodyImpl(activeCells, activeMaterials,
                           peerCells, peerMaterials)
      : spawnJointBodyImpl(peerCells, peerMaterials,
                           activeCells, activeMaterials);
    if (leader && leader->jointPeer) {
      applyWeldMotion(leader, motion);
      leader->blastDebris = false;
      leader->fuseTicks = fuseTicks;
      if (fuseTicks > 0) setBodyFusePoint(leader, fuseX, fuseY);
      leader->jointPeer->blastDebris = false;
      leader->jointPeer->fuseTicks = fuseTicks;
      leader->jointPeer->fuseLocalX = leader->fuseLocalX;
      leader->jointPeer->fuseLocalY = leader->fuseLocalY;
      syncJointFollower(leader);
      body = leader;
    }
  } else {
    // Placement welds every contacted body and the new cells into one raster.
    // Existing bodies may be rotated, so their current world raster is the
    // authoritative shape at the instant of attachment.
    std::map<int, uint8_t> materialAt;
    std::vector<WeldMotion> motion;
    int fuseTicks = 0;
    double fuseX = 0, fuseY = 0;
    for (Body* source : touching) {
      captureWeldMotion(source, motion);
      if (source->fuseTicks > 0 && (!fuseTicks || source->fuseTicks < fuseTicks)) {
        fuseTicks = source->fuseTicks;
        bodyFusePoint(source, fuseX, fuseY);
      }
      forEachBodyCell(source, [&](int x, int y, int local) {
        materialAt.emplace(y * E.cols + x, bodyMaterialAt(source, local));
      });
    }
    for (const auto& cell : spawnCells)
      materialAt[cell.second * E.cols + cell.first] = material;

    std::unordered_set<int> removedIds(touchingIds.begin(), touchingIds.end());
    std::vector<int> keptCells;
    keptCells.reserve(E.L->bodyCells.size());
    for (int k : E.L->bodyCells) {
      if (removedIds.count(E.L->bodyOwner[k])) {
        E.writeGridIndexUnsafe(k, EMPTY);
        E.L->bodyOwner[k] = -1;
      } else {
        keptCells.push_back(k);
      }
    }
    E.L->bodyCells = std::move(keptCells);

    std::vector<Body*> keptBodies;
    keptBodies.reserve(E.L->bodies.size() - touching.size());
    for (Body* candidate : E.L->bodies) {
      if (!removedIds.count(candidate->id)) {
        keptBodies.push_back(candidate);
        continue;
      }
      delete candidate;
    }
    E.L->bodies = std::move(keptBodies);

    std::vector<std::pair<int, int>> mergedCells;
    std::vector<uint8_t> mergedMaterials;
    mergedCells.reserve(materialAt.size());
    mergedMaterials.reserve(materialAt.size());
    for (const auto& entry : materialAt) {
      mergedCells.push_back({entry.first % E.cols, entry.first / E.cols});
      mergedMaterials.push_back(entry.second);
    }
    body = spawnBodyImpl(mergedCells, mergedMaterials);
    if (body) {
      applyWeldMotion(body, motion);
      body->blastDebris = false;
      body->fuseTicks = fuseTicks;
      if (fuseTicks > 0) setBodyFusePoint(body, fuseX, fuseY);
    }
  }

  if (!body) return nullptr;
  auto stampSpawned = [&](Layer& layer, Body* spawned, bool passive) {
    Engine::ActiveLayerScope layerScope(E, &layer);
    int minX = E.cols - 1, minY = E.rows - 1, maxX = 0, maxY = 0;
    std::vector<Disp> displaced;
    std::vector<int> footprint;
    forEachBodyCell(spawned, [&](int x, int y, int local) {
      int k = y * E.cols + x;
      if (layer.bodyOwner[k] >= 0 && layer.bodyOwner[k] != spawned->id) return;
      uint8_t existing = layer.grid[k];
      if (!canBodyOccupy(existing, k, spawned->density)) return;
      if (isBodyRelocatable(existing, k, spawned->density))
        displaced.push_back({
          existing, k, E.capturePersistentCurrentState(&layer, k),
        });
      E.writeGridIndexUnsafe(k, bodyMaterialAt(spawned, local));
      layer.bodyOwner[k] = spawned->id;
      (passive ? layer.passiveBodyCells : layer.bodyCells).push_back(k);
      footprint.push_back(k);
      minX = imin(minX, x); minY = imin(minY, y);
      maxX = imax(maxX, x); maxY = imax(maxY, y);
    });
    if (!footprint.empty()) {
      layer.reserveSeenGenerations(SPILL_GENERATION_BUDGET);
      int32_t footprintGen = layer.nextSeenGeneration();
      for (int k : footprint) layer.rigidSpillFootprint[k] = footprintGen;
      spillDisplacedBodyMaterial(displaced, footprint, footprintGen,
                                 spawned->id, spawned->density,
                                 PCSO_BODY_DISPLACE);
      E.markDirtyRect(minX, minY, maxX, maxY);
    }
    layer.sleepingBodySupportDirty = true;
  };
  Body* result = body;
  if (body->jointRole == 1 && body->jointPeer) {
    stampSpawned(E.fg, body, false);
    stampSpawned(E.bg, body->jointPeer, true);
    result = placementLayer == &E.fg ? body : body->jointPeer;
  } else {
    stampSpawned(*placementLayer, body, false);
  }
  if (E.bgEnabled) {
    E.comps.jointDirty = true;
    E.comps.jointBondsInvalid = true;
    E.comps.jointSupportValid = false;
  }
  return result;
}
Body* RigidBodySystem::spawnBody(const std::vector<std::pair<int, int>>& cells) { return finishSpawn(cells, RIGID); }

// Primitive body shapes built engine-side. Cells are clipped like the cube tool:
// dx in [-halfW, halfW), dy in [-halfH, halfH) for the box.
Body* RigidBodySystem::spawnBox(int cx, int cy, int halfW, int halfH, uint8_t material) {
  if (!isMaterialId(material)) material = RIGID;
  std::vector<std::pair<int, int>> cells;
  int x0 = (int)std::max<int64_t>(1, (int64_t)cx - halfW);
  int x1 = (int)std::min<int64_t>(E.cols - 1, (int64_t)cx + halfW);
  int y0 = (int)std::max<int64_t>(1, (int64_t)cy - halfH);
  int y1 = (int)std::min<int64_t>(E.rows - 1, (int64_t)cy + halfH);
  if (x1 > x0 && y1 > y0)
    cells.reserve((size_t)(x1 - x0) * (size_t)(y1 - y0));
  for (int x = x0; x < x1; x++)
    for (int y = y0; y < y1; y++) cells.push_back({x, y});
  return finishSpawn(cells, material);
}
Body* RigidBodySystem::spawnDisc(int cx, int cy, int radius, uint8_t material) {
  if (!isMaterialId(material)) material = RIGID;
  std::vector<std::pair<int, int>> cells;
  int y0 = (int)std::max<int64_t>(1, (int64_t)cy - radius);
  int y1 = (int)std::min<int64_t>(E.rows - 2, (int64_t)cy + radius);
  int x0 = (int)std::max<int64_t>(1, (int64_t)cx - radius);
  int x1 = (int)std::min<int64_t>(E.cols - 2, (int64_t)cx + radius);
  int64_t radius2 = (int64_t)radius * radius;
  for (int y = y0; y <= y1; y++) {
    int64_t dy = (int64_t)y - cy;
    for (int x = x0; x <= x1; x++) {
      int64_t dx = (int64_t)x - cx;
      if (dx * dx + dy * dy <= radius2) cells.push_back({x, y});
    }
  }
  return finishSpawn(cells, material);
}
