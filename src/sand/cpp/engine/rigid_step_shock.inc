bool RigidBodySystem::solveSupportShock(const StepState& step, SubstepState& state,
    int root, int islandStart, int islandEnd, int solverIters, uint64_t shockIslandKey) {
  auto& contacts = solverContactScratch;
  const int nc = (int)contacts.size();
  bool shockVelocityConverged = false;
  // Direct support edges run from the lower body to the upper body. SCCs
  // keep cyclic contact groups on one level while terrain-rooted longest
  // paths define the bottom-to-top solve order.
  shockGraphScratch.resize(step.n);
  for (std::vector<int>& edges : shockGraphScratch) edges.clear();
  shockTerrainRootScratch.assign(step.n, 0);
  shockBottomScratch.assign(nc, -2);
  shockTopIsAScratch.assign(nc, 1);
  auto& shockGraph = shockGraphScratch;
  auto& shockTerrainRoot = shockTerrainRootScratch;
  auto& shockBottom = shockBottomScratch;
  auto& shockTopIsA = shockTopIsAScratch;
  for (int oi = islandStart; oi < islandEnd; oi++) {
    int ci = state.contactOrder[oi];
    Contact& contact = contacts[ci];
    int a = contact.a->idx;
    if (!contact.b) {
      if (contact.ny < -0.1) {
        shockBottom[ci] = -1;
        shockTerrainRoot[a] = 1;
      }
      continue;
    }
    if (!contact.bIntegrated || contact.b->idx < 0) continue;
    int b = contact.b->idx;
    bool topIsA = contact.ny < 0;
    int bottom = topIsA ? b : a;
    int top = topIsA ? a : b;
    shockBottom[ci] = bottom;
    shockTopIsA[ci] = topIsA;
    shockGraph[bottom].push_back(top);
  }

  shockIndexScratch.assign(step.n, -1);
  shockLowScratch.assign(step.n, 0);
  shockStackScratch.clear();
  shockComponentScratch.assign(step.n, -1);
  shockOnStackScratch.assign(step.n, 0);
  auto& shockIndex = shockIndexScratch;
  auto& shockLow = shockLowScratch;
  auto& shockStack = shockStackScratch;
  auto& shockComponent = shockComponentScratch;
  auto& shockOnStack = shockOnStackScratch;
  int shockNextIndex = 0, shockComponentCount = 0;
  auto shockStrongConnect = [&](auto&& self, int bodyIndex) -> void {
    shockIndex[bodyIndex] = shockLow[bodyIndex] = shockNextIndex++;
    shockStack.push_back(bodyIndex);
    shockOnStack[bodyIndex] = 1;
    for (int top : shockGraph[bodyIndex]) {
      if (shockIndex[top] < 0) {
        self(self, top);
        shockLow[bodyIndex] = imin(shockLow[bodyIndex], shockLow[top]);
      } else if (shockOnStack[top]) {
        shockLow[bodyIndex] = imin(
          shockLow[bodyIndex], shockIndex[top]);
      }
    }
    if (shockLow[bodyIndex] != shockIndex[bodyIndex]) return;
    while (!shockStack.empty()) {
      int member = shockStack.back();
      shockStack.pop_back();
      shockOnStack[member] = 0;
      shockComponent[member] = shockComponentCount;
      if (member == bodyIndex) break;
    }
    shockComponentCount++;
  };
  for (int bi = 0; bi < step.n; bi++)
    if (ufFind(state.solveParent, bi) == root && shockIndex[bi] < 0)
      shockStrongConnect(shockStrongConnect, bi);

  shockLevelScratch.assign(shockComponentCount, -1);
  auto& shockLevel = shockLevelScratch;
  for (int bi = 0; bi < step.n; bi++)
    if (shockTerrainRoot[bi] && shockComponent[bi] >= 0)
      shockLevel[shockComponent[bi]] = 0;
  for (int pass = 0; pass < shockComponentCount; pass++) {
    bool changed = false;
    for (int bottom = 0; bottom < step.n; bottom++) {
      int bottomComponent = shockComponent[bottom];
      if (bottomComponent < 0 || shockLevel[bottomComponent] < 0)
        continue;
      for (int top : shockGraph[bottom]) {
        int topComponent = shockComponent[top];
        if (topComponent == bottomComponent) continue;
        int nextLevel = shockLevel[bottomComponent] + 1;
        if (shockLevel[topComponent] < nextLevel) {
          shockLevel[topComponent] = nextLevel;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  int shockLayerCount = 0;
  shockBodyLevelScratch.assign(step.n, -1);
  auto& shockBodyLevel = shockBodyLevelScratch;
  for (int bi = 0; bi < step.n; bi++) {
    int component = shockComponent[bi];
    if (component < 0) continue;
    shockBodyLevel[bi] = shockLevel[component];
    shockLayerCount = imax(shockLayerCount, shockBodyLevel[bi] + 1);
  }
  shockLayersScratch.resize(shockLayerCount);
  for (std::vector<int>& layerContacts : shockLayersScratch)
    layerContacts.clear();
  auto& shockLayers = shockLayersScratch;
  for (int oi = islandStart; oi < islandEnd; oi++) {
    int ci = state.contactOrder[oi];
    int bottom = shockBottom[ci];
    if (bottom == -1) {
      shockLayers[0].push_back(ci);
      continue;
    }
    if (bottom < 0 || shockBodyLevel[bottom] < 0) continue;
    Contact& contact = contacts[ci];
    int top = shockTopIsA[ci] ? contact.a->idx : contact.b->idx;
    if (shockComponent[top] == shockComponent[bottom]) continue;
    shockLayers[shockBodyLevel[top]].push_back(ci);
  }

  int shockContactCount = 0;
  for (const std::vector<int>& layer : shockLayers)
    shockContactCount += (int)layer.size();
  if (shockLayerCount > 1 && shockContactCount >= 4) {
    rigidShockIslands++;
    rigidShockMaxLayers = imax(rigidShockMaxLayers, shockLayerCount);
    // The support solve is a trial. Its infinite-mass layer approximation
    // must converge before its velocities and contact impulses are accepted.
    shockVelocityScratch.resize(step.n);
    for (int bi = 0; bi < step.n; bi++) {
      if (shockComponent[bi] < 0) continue;
      Body* body = step.solverBodies[bi];
      shockVelocityScratch[bi] = {body->vx, body->vy, body->omega};
    }
    shockImpulseScratch.resize(nc);
    for (int oi = islandStart; oi < islandEnd; oi++) {
      int ci = state.contactOrder[oi];
      shockImpulseScratch[ci] = {contacts[ci].accJn, contacts[ci].accJt};
    }
    shockDeferredScratch.assign(nc, {0, 0, 0});
    auto& deferred = shockDeferredScratch;
    // A layer solve treats the lower body as infinite mass. The omitted
    // equal-and-opposite velocity change is retained per contact so the
    // downward pass can transmit it before solving the next lower layer.
    auto solveShockContact = [&](int ci) {
      Contact& contact = contacts[ci];
      Body* A = contact.a;
      Body* B = contact.b;
      bool topIsA = shockTopIsA[ci] != 0;
      Body* top = topIsA ? A : B;
      int bottomIndex = shockBottom[ci];
      Body* bottom = bottomIndex >= 0 ? step.solverBodies[bottomIndex] : nullptr;
      if (!top || !top->awake) return 0.0;
      double topInvM = top->invMass;
      double topInvI = top->invInertia;
      double rvx = A->vx - A->omega * contact.ray;
      double rvy = A->vy + A->omega * contact.rax;
      if (B) {
        rvx -= rigidContactVx(B) - rigidContactOmega(B) * contact.rby;
        rvy -= rigidContactVy(B) + rigidContactOmega(B) * contact.rbx;
      }
      double topRx = topIsA ? contact.rax : contact.rbx;
      double topRy = topIsA ? contact.ray : contact.rby;
      double topSign = topIsA ? 1.0 : -1.0;
      double motionChange = 0;
      auto applyImpulse = [&](double jx, double jy) {
        double signedJx = topSign * jx;
        double signedJy = topSign * jy;
        double topTorque = topRx * signedJy - topRy * signedJx;
        top->vx += signedJx * topInvM;
        top->vy += signedJy * topInvM;
        top->omega += topTorque * topInvI;
        motionChange += std::hypot(
          signedJx * topInvM, signedJy * topInvM)
          + std::fabs(topTorque * topInvI)
            * std::fmax(1.0, top->maxR);
        if (!bottom || !bottom->awake) return;
        double bottomSign = -topSign;
        double bottomRx = topIsA ? contact.rbx : contact.rax;
        double bottomRy = topIsA ? contact.rby : contact.ray;
        double bottomJx = bottomSign * jx;
        double bottomJy = bottomSign * jy;
        deferred[ci][0] += bottomJx * bottom->invMass;
        deferred[ci][1] += bottomJy * bottom->invMass;
        deferred[ci][2] += bottom->invInertia
          * (bottomRx * bottomJy - bottomRy * bottomJx);
      };

      double rn = topRx * contact.ny - topRy * contact.nx;
      double normalK = topInvM + topInvI * rn * rn;
      if (normalK > 0) {
        double vn = rvx * contact.nx + rvy * contact.ny;
        double delta = (contact.targetVn - vn) / normalK;
        double next = std::fmax(0.0, contact.accJn + delta);
        double applied = next - contact.accJn;
        contact.accJn = next;
        applyImpulse(applied * contact.nx, applied * contact.ny);
      }

      rvx = A->vx - A->omega * contact.ray;
      rvy = A->vy + A->omega * contact.rax;
      if (B) {
        rvx -= rigidContactVx(B) - rigidContactOmega(B) * contact.rby;
        rvy -= rigidContactVy(B) + rigidContactOmega(B) * contact.rbx;
      }
      double tx = -contact.ny, ty = contact.nx;
      double rt = topRx * ty - topRy * tx;
      double tangentK = topInvM + topInvI * rt * rt;
      if (tangentK > 0) {
        double vt = rvx * tx + rvy * ty;
        double coefficient = std::fabs(vt) <= R_STATIC_FRICTION_SPEED
          ? contact.staticFriction : contact.dynamicFriction;
        double limit = coefficient * contact.accJn;
        double next = contact.accJt - vt / tangentK;
        next = std::fmax(-limit, std::fmin(limit, next));
        double applied = next - contact.accJt;
        contact.accJt = next;
        applyImpulse(applied * tx, applied * ty);
      }
      return motionChange;
    };
    auto solveShockLayer = [&](const std::vector<int>& layer) {
      for (int iteration = 0; iteration < solverIters; iteration++) {
        double changed = 0;
        rigidShockConstraintEvals += (int)layer.size();
        for (int ci : layer)
          changed += solveShockContact(ci);
        if (changed <= solverResidualTolerance) break;
      }
    };

    for (int layer = 0; layer < shockLayerCount; layer++)
      solveShockLayer(shockLayers[layer]);
    for (int layer = shockLayerCount - 1; layer >= 0; layer--) {
      solveShockLayer(shockLayers[layer]);
      for (int ci : shockLayers[layer]) {
        int bottomIndex = shockBottom[ci];
        if (bottomIndex < 0) continue;
        Body* body = step.solverBodies[bottomIndex];
        body->vx += deferred[ci][0];
        body->vy += deferred[ci][1];
        body->omega += deferred[ci][2];
        deferred[ci] = {0, 0, 0};
      }
    }
    double shockResidual = 0;
    for (int oi = islandStart; oi < islandEnd; oi++)
      shockResidual = std::fmax(shockResidual,
        contactVelocityResidual(contacts[state.contactOrder[oi]]));
    shockVelocityConverged =
      shockResidual <= solverResidualTolerance;
    if (!shockVelocityConverged) {
      rigidShockFallbacks++;
      // The ordinary finite-mass solve starts from the same warm-started
      // state, without retaining an unconverged trial's artificial motion.
      for (int bi = 0; bi < step.n; bi++) {
        if (shockComponent[bi] < 0) continue;
        Body* body = step.solverBodies[bi];
        body->vx = shockVelocityScratch[bi][0];
        body->vy = shockVelocityScratch[bi][1];
        body->omega = shockVelocityScratch[bi][2];
      }
      for (int oi = islandStart; oi < islandEnd; oi++) {
        int ci = state.contactOrder[oi];
        contacts[ci].accJn = shockImpulseScratch[ci][0];
        contacts[ci].accJt = shockImpulseScratch[ci][1];
      }
    }
    ShockAttemptState& history = shockAttemptCache[shockIslandKey];
    history.lastTick = E.tick;
    if (shockVelocityConverged) {
      history.consecutiveFailures = 0;
      history.retryTick = E.tick;
    } else {
      history.consecutiveFailures = (uint8_t)imin(
        255, history.consecutiveFailures + 1);
      if (history.consecutiveFailures >= 2)
        history.retryTick = E.tick + 8;
    }
  }
  return shockVelocityConverged;
}
