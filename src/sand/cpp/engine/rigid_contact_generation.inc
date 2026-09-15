void RigidBodySystem::buildRigidBroadphase(
    const StepState& step, const SubstepState& state) {
  auto broadphaseLess = [&](int a, int b) {
    if (step.solverBodies[a]->aabbX0 != step.solverBodies[b]->aabbX0)
      return step.solverBodies[a]->aabbX0 < step.solverBodies[b]->aabbX0;
    return a < b;
  };
  // Body order is coherent across substeps and ticks. Insertion repair makes
  // the common nearly-sorted broadphase linear while preserving deterministic
  // index ordering for equal AABB starts.
  for (int i = 1; i < step.n; i++) {
    int value = broadphaseOrderScratch[i];
    int j = i;
    while (j > 0 && broadphaseLess(value, broadphaseOrderScratch[j - 1])) {
      broadphaseOrderScratch[j] = broadphaseOrderScratch[j - 1];
      j--;
    }
    broadphaseOrderScratch[j] = value;
  }
  broadphasePairScratch.clear();
  for (int oi = 0; oi < step.n; oi++) {
    int a = broadphaseOrderScratch[oi];
    Body* A = step.solverBodies[a];
    if (!state.activeBody[a]) continue;
    for (int oj = oi + 1; oj < step.n; oj++) {
      int b = broadphaseOrderScratch[oj];
      Body* B = step.solverBodies[b];
      if (B->aabbX0 > A->aabbX1) break;
      if (!state.activeBody[b]) continue;
      if (A->aabbY1 < B->aabbY0 || B->aabbY1 < A->aabbY0) continue;
      if (bodyLayerMask(A) & bodyLayerMask(B))
        broadphasePairScratch.push_back({imin(a, b), imax(a, b)});
    }
  }
  // Contact order is part of deterministic sequential impulse behavior.
  // Restore the original nested-loop order after sweep-and-prune culling.
  std::sort(broadphasePairScratch.begin(), broadphasePairScratch.end());
}

void RigidBodySystem::generateRigidContacts(
    StepState& step, SubstepState& state, ContactGeometry& geometry) {
  auto& contacts = solverContactScratch;
  auto& penAcc = geometry.sweepPoints;
  auto& terrAcc = geometry.terrainPoints;
  contacts.clear();
  state.previousRestoreKeyValid = false;
  double pairContactStart = emscripten_get_now();
  buildRigidBroadphase(step, state);
  for (const auto& pair : broadphasePairScratch) {
    Body* physicalA = step.solverBodies[pair.first];
    Body* physicalB = step.solverBodies[pair.second];
    uint8_t sharedLayers = bodyLayerMask(physicalA) & bodyLayerMask(physicalB);
    for (int layer = 0; layer < 2; layer++) {
      if (!(sharedLayers & (1 << layer))) continue;
      Engine::ActiveLayerScope scope(E, layer == 0 ? &E.fg : &E.bg);
      Body* A = collisionShape(physicalA, layer);
      Body* B = collisionShape(physicalB, layer);
      if (!A || !B) continue;
      auto& activePairAxes = pairAxes[layer * 4 + physicalA->solverLayer * 2
                                    + physicalB->solverLayer];
      if (!physicalA->awake && !physicalB->awake) continue;
      double pairDt = std::fmin(state.bodyDt[pair.first], state.bodyDt[pair.second]);
      bool aMoving = A->awake && (A->vx * A->vx + A->vy * A->vy > R_WAKE_LIN2 || A->omega * A->omega > R_WAKE_ANG2);
      bool bMoving = B->awake && (B->vx * B->vx + B->vy * B->vy > R_WAKE_LIN2 || B->omega * B->omega > R_WAKE_ANG2);
      ContactGeometry::ChildContactState childContactState =
        geometry.collectPotentialContacts(A, B, pairDt,
          A == physicalA ? pair.first : step.n + pair.first * 2 + layer,
          B == physicalB ? pair.second : step.n + pair.second * 2 + layer);
      if (childContactState == ContactGeometry::CCS_SEPARATED) continue;
      uint64_t pairKey = rigidBodyPairKey(A->id, B->id);
      auto remembered = activePairAxes.find(pairKey);
      if (remembered != activePairAxes.end()
          && (remembered->second.aRevision != A->geometryRevision
              || remembered->second.bRevision != B->geometryRevision)) {
        activePairAxes.erase(remembered);
        remembered = activePairAxes.end();
      }
      double scratchNormalX = 0, scratchNormalY = 0;
      int scratchPointCount = 0;
      for (const ContactGeometry::ChildManifold& manifold : geometry.childManifoldScratch)
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
      if (childContactState != ContactGeometry::CCS_NONE
          && remembered != activePairAxes.end())
        remembered->second.age = 0;
      if (childContactState != ContactGeometry::CCS_CURRENT) {
        rigidSweepFallbacks++;
        penAcc.clear();
        collectBodySweep(geometry, A, B, 1, pairDt, penAcc);
        collectBodySweep(geometry, B, A, -1, pairDt, penAcc);
        double fbx, fby;
        bool hasSlenderObb = geometry.addSlenderObbManifold(
          A, B, penAcc, fbx, fby);
        if (!penAcc.empty()) {
          if (!A->awake && bMoving) wakeBody(physicalA);
          if (!B->awake && aMoving) wakeBody(physicalB);
          if (!physicalA->awake && !physicalB->awake) continue;
          if (!hasSlenderObb)
            geometry.pairSeparatingDirection(A, B, fbx, fby);
          emitRigidManifold(step, state, penAcc, A, B, fbx, fby, pairDt);
          continue;
        }
        if (childContactState == ContactGeometry::CCS_NONE) continue;
      }
      if (!A->awake && bMoving) wakeBody(physicalA);
      if (!B->awake && aMoving) wakeBody(physicalB);
      if (!physicalA->awake && !physicalB->awake) continue;
      double preferredX = 0, preferredY = 0;
      bool hasPreferredNormal = false;
      if (remembered != activePairAxes.end()) {
        preferredX = remembered->second.nx;
        preferredY = remembered->second.ny;
        hasPreferredNormal = true;
      }
      penAcc.clear();
      for (const ContactGeometry::ChildManifold& manifold : geometry.childManifoldScratch) {
        for (int pi = 0; pi < manifold.count; pi++) {
          const ContactGeometry::PenPt& point = manifold.points[pi];
          if (hasPreferredNormal
              && point.nx * preferredX + point.ny * preferredY < -0.25)
            continue;
          penAcc.push_back(point);
        }
      }
      emitRigidManifold(step, state, penAcc, A, B, 0, -1, pairDt);
    }
  }
  for (int ai = 0; ai < step.n; ai++) {
    if (!state.activeBody[ai]) continue;
    Body* physicalA = step.solverBodies[ai];
    Body* A = collisionShape(physicalA, 0);
    if (!A) continue;
    int shapeIndex = A == physicalA ? ai : step.n + ai * 2;
    Engine::ActiveLayerScope actorLayer(E, &E.fg);
    for (int proxyIndex : step.actorProxyOrder) {
      Body* B = &step.actorProxies[proxyIndex].body;
      if (B->aabbX0 > A->aabbX1) break;
      if (B->aabbX1 < A->aabbX0
          || A->aabbY1 < B->aabbY0
          || B->aabbY1 < A->aabbY0)
        continue;
      double pairDt = state.bodyDt[ai];
      ContactGeometry::ChildContactState childContactState =
        geometry.collectPotentialContacts(A, B, pairDt, shapeIndex, -1);
      if (childContactState == ContactGeometry::CCS_SEPARATED) continue;
      if (childContactState != ContactGeometry::CCS_CURRENT) {
        rigidSweepFallbacks++;
        penAcc.clear();
        collectBodySweep(geometry, A, B, 1, pairDt, penAcc);
        collectBodySweep(geometry, B, A, -1, pairDt, penAcc);
        double fbx, fby;
        bool hasSlenderObb = geometry.addSlenderObbManifold(
          A, B, penAcc, fbx, fby);
        if (!penAcc.empty()) {
          if (!A->awake) wakeBody(A);
          if (!hasSlenderObb)
            geometry.pairSeparatingDirection(A, B, fbx, fby);
          emitRigidManifold(step, state, penAcc, A, B, fbx, fby, pairDt);
          continue;
        }
        if (childContactState == ContactGeometry::CCS_NONE) continue;
      }
      penAcc.clear();
      for (const ContactGeometry::ChildManifold& manifold : geometry.childManifoldScratch)
        for (int pi = 0; pi < manifold.count; pi++)
          penAcc.push_back(manifold.points[pi]);
      emitRigidManifold(step, state, penAcc, A, B, 0, -1, pairDt);
    }
  }
  rigidPairContactMs += emscripten_get_now() - pairContactStart;
  double terrainContactStart = emscripten_get_now();
  for (int bi = 0; bi < step.n; bi++) {
    Body* body = step.solverBodies[bi];
    if (!state.activeBody[bi] || !body->awake) continue;
    for (int layer = 0; layer < 2; layer++) {
      Body* shape = collisionShape(body, layer);
      if (!shape) continue;
      Engine::ActiveLayerScope scope(E, layer == 0 ? &E.fg : &E.bg);
      terrAcc.clear();
      collectTerrainSweep(geometry, step.terrainOccupancyReady,
                          shape, state.bodyDt[bi], terrAcc);
      body->rasterMayOverlapSolid |= shape->rasterMayOverlapSolid;
      emitRigidManifold(step, state, terrAcc, shape, nullptr, 0, -1, state.bodyDt[bi]);
    }
  }
  rigidTerrainContactMs += emscripten_get_now() - terrainContactStart;
}

void RigidBodySystem::classifyRigidContacts(StepState& step, SubstepState& state) {
  auto& contacts = solverContactScratch;
  for (auto& flags : state.contact) {
    flags.upward = flags.body = flags.terrainSides = 0;
  }
  for (const Contact& contact : contacts) {
    if (contact.b && contact.b->actorProxy) continue;
    if (contact.ny < -0.1) state.contact[contact.a->idx].upward = 1;
    if (contact.b) state.contact[contact.a->idx].body = 1;
    if (!contact.b && std::fabs(contact.ny) < 0.1)
      state.contact[contact.a->idx].terrainSides
        |= contact.nx < 0 ? 1 : 2;
    if (contact.b && contact.bIntegrated
        && contact.b->idx >= 0 && contact.b->idx < step.n) {
      state.contact[contact.b->idx].body = 1;
      if (contact.ny > 0.1) state.contact[contact.b->idx].upward = 1;
    }
  }
  // An isolated body beside terrain keeps impact friction, but an unloaded
  // resting wall cannot supply the persistent tangent force that holds it up.
  for (Contact& contact : contacts) {
    bool unloadedSideContact = !contact.b
      && std::fabs(contact.ny) < 0.1
      && contact.impactSpeed < R_BOUNCE_MIN_SPEED
      && contact.a->jointRole == 0
      && !contact.a->blastDebris
      && contact.a->nPts >= R_WALL_RELEASE_MIN_CELLS
      && !state.contact[contact.a->idx].upward
      && !state.contact[contact.a->idx].body
      && state.contact[contact.a->idx].terrainSides != 3;
    if (!unloadedSideContact) continue;
    contact.staticFriction = 0;
    contact.dynamicFriction = 0;
    contact.accJt = 0;
  }
}

