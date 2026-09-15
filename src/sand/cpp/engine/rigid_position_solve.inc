void RigidBodySystem::projectRigidContacts(
    const StepState& step, SubstepState& state, ContactGeometry& geometry, int sub) {
  auto& contacts = solverContactScratch;
  // Project residual overlap at the final integrated pose for sustained-force
  // islands and pairs of structure-scale bodies. A body supported by terrain
  // stays fixed while the load above it moves clear.
  state.positionPairs.clear();
  bool structureProjection = sub + 1 == step.substeps;
  bool hasStructurePair = false;
  auto structureProjectionPair = [&](Body* A, Body* B) {
    return rigidStructureScaleBody(A) || rigidStructureScaleBody(B);
  };
  if (structureProjection) {
    std::vector<std::pair<int, int>> finalContactPairs;
    std::vector<int> positionParent(step.n);
    for (int bi = 0; bi < step.n; bi++) positionParent[bi] = bi;
    for (const auto& pair : broadphasePairScratch) {
      Body* A = step.solverBodies[pair.first];
      Body* B = step.solverBodies[pair.second];
      bool penetrating = false;
      uint8_t sharedLayers = bodyLayerMask(A) & bodyLayerMask(B);
      for (int layer = 0; layer < 2 && !penetrating; layer++) {
        if (!(sharedLayers & (1 << layer))) continue;
        Body* shapeA = collisionShape(A, layer);
        Body* shapeB = collisionShape(B, layer);
        if (!shapeA || !shapeB) continue;
        if (geometry.collectChildContacts(shapeA, shapeB, 0,
              shapeA == A ? pair.first : step.n + pair.first * 2 + layer,
              shapeB == B ? pair.second : step.n + pair.second * 2 + layer)
            != ContactGeometry::CCS_CURRENT)
          continue;
        for (const ContactGeometry::ChildManifold& manifold : geometry.childManifoldScratch)
          for (int point = 0; point < manifold.count; point++)
            penetrating = penetrating || manifold.points[point].depth > 0;
      }
      if (!penetrating) continue;
      finalContactPairs.push_back(pair);
      ufUnite(positionParent, pair.first, pair.second);
    }
    std::vector<uint8_t> structureIsland(step.n, 0);
    for (int bi = 0; bi < step.n; bi++)
      if (rigidStructureScaleBody(step.solverBodies[bi]))
        structureIsland[ufFind(positionParent, bi)] = 1;
    state.positionPairs.clear();
    for (const auto& pair : finalContactPairs)
      if (structureIsland[ufFind(positionParent, pair.first)])
        state.positionPairs.push_back(pair);
    hasStructurePair = !state.positionPairs.empty();
  }
  if ((E.fg.forceActive || E.bg.forceActive) || hasStructurePair) {
    state.spatialForceIsland.assign(step.n, 0);
    bool hasForceDrivenIsland = false;
    if ((E.fg.forceActive || E.bg.forceActive))
      for (int bi = 0; bi < step.n; bi++) {
        if (!step.solverBodies[bi]->spatialForceApplied) continue;
        state.spatialForceIsland[ufFind(state.solveParent, bi)] = 1;
        hasForceDrivenIsland = true;
      }
    state.terrainAnchored.assign(step.n, 0);
    for (const Contact& contact : contacts) {
      int root = ufFind(state.solveParent, contact.a->idx);
      bool forcePair = hasForceDrivenIsland && state.spatialForceIsland[root];
      if (!contact.b) {
        if (contact.depth > 0
            && (forcePair || contact.ny < -0.1))
          state.terrainAnchored[contact.a->idx] = 1;
        continue;
      }
      if (!contact.bIntegrated) continue;
      bool structurePair = hasStructurePair
        && structureProjectionPair(contact.a, contact.b);
      if (forcePair || structurePair) {
        int a = contact.a->idx, b = contact.b->idx;
        state.positionPairs.push_back({imin(a, b), imax(a, b)});
      }
    }
  }
  if (!state.positionPairs.empty()) {
    std::sort(state.positionPairs.begin(), state.positionPairs.end());
    state.positionPairs.erase(
      std::unique(state.positionPairs.begin(), state.positionPairs.end()),
      state.positionPairs.end());
    std::vector<MovePose> positionStart(step.n);
    for (int bi = 0; bi < step.n; bi++)
      positionStart[bi] = {
        step.solverBodies[bi]->px,
        step.solverBodies[bi]->py,
        step.solverBodies[bi]->angle,
      };
    auto correctionScale = [&](int index, Body* body,
                               double dpx, double dpy, double dangle) {
      if (dpx == 0 && dpy == 0 && dangle == 0)
        return 1.0;
      const MovePose& start = positionStart[index];
      double translationLimit = std::fmax(
        1e-9, worldPositionMotionLimit);
      auto normalizedMotion = [&](double scale) {
        double translation = std::hypot(
            body->px + scale * dpx - start.px,
            body->py + scale * dpy - start.py)
          / translationLimit;
        double rotation = std::fabs(
            body->angle + scale * dangle - start.angle)
          / 0.01;
        return std::fmax(translation, rotation);
      };
      double current = normalizedMotion(0);
      double candidate = normalizedMotion(1);
      if (candidate <= 1 || candidate < current) return 1.0;
      if (current >= 1) return 0.0;
      double low = 0, high = 1;
      for (int step = 0; step < 12; step++) {
        double middle = 0.5 * (low + high);
        if (normalizedMotion(middle) <= 1) low = middle;
        else high = middle;
      }
      return low;
    };
    for (int iteration = 0; iteration < R_BODY_POSITION_SLENDER_ITERS;
         iteration++) {
      bool corrected = false;
      for (const auto& pair : state.positionPairs) {
        Body* A = step.solverBodies[pair.first];
        Body* B = step.solverBodies[pair.second];
        uint8_t sharedLayers = bodyLayerMask(A) & bodyLayerMask(B);
        for (int layer = 0; layer < 2; layer++) {
          if (!(sharedLayers & (1 << layer))) continue;
          Body* shapeA = collisionShape(A, layer);
          Body* shapeB = collisionShape(B, layer);
          if (!shapeA || !shapeB) continue;
          // Large slender pairs receive two extra projection passes because
          // their long angular lever arms make scalar correction converge more
          // slowly.
          if (iteration >= R_BODY_POSITION_ITERS
              && (!rigidLargeSlenderBody(A)
                  || !rigidLargeSlenderBody(B)))
            continue;
          int shapeIndexA = shapeA == A ? pair.first : step.n + pair.first * 2 + layer;
          int shapeIndexB = shapeB == B ? pair.second : step.n + pair.second * 2 + layer;
          if (geometry.collectChildContacts(
                shapeA, shapeB, 0, shapeIndexA, shapeIndexB) != ContactGeometry::CCS_CURRENT)
            continue;
          ContactGeometry::PenPt deepest{};
          bool hasPenetration = false;
          double deepestX = 0, deepestY = 0;
          int deepestCount = 0;
          // Co-depth, co-normal samples describe one contact face. Project at
          // their centroid so correction does not depend on an endpoint.
          for (const ContactGeometry::ChildManifold& manifold : geometry.childManifoldScratch) {
            for (int pi = 0; pi < manifold.count; pi++) {
              const ContactGeometry::PenPt& point = manifold.points[pi];
              if (point.depth <= 0) continue;
              if (!hasPenetration
                  || point.depth > deepest.depth + 1e-6) {
                deepest = point;
                deepestX = point.wx;
                deepestY = point.wy;
                deepestCount = 1;
                hasPenetration = true;
              } else if (std::fabs(point.depth - deepest.depth) <= 1e-6
                         && point.nx * deepest.nx
                              + point.ny * deepest.ny > 0.999) {
                deepestX += point.wx;
                deepestY += point.wy;
                deepestCount++;
              }
            }
          }
          if (!hasPenetration) continue;
          deepest.wx = deepestX / deepestCount;
          deepest.wy = deepestY / deepestCount;
          double aInvM = A->awake && !state.terrainAnchored[pair.first]
            ? A->invMass : 0;
          double aInvI = A->awake && !state.terrainAnchored[pair.first]
            ? A->invInertia : 0;
          double bInvM = B->awake && !state.terrainAnchored[pair.second]
            ? B->invMass : 0;
          double bInvI = B->awake && !state.terrainAnchored[pair.second]
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
          double dx = deepest.nx * impulse;
          double dy = deepest.ny * impulse;
          double aAngle = aCross * impulse * aInvI;
          double bAngle = -bCross * impulse * bInvI;
          double scale = std::fmin(
            correctionScale(
              pair.first, A, dx * aInvM, dy * aInvM, aAngle),
            correctionScale(
              pair.second, B, -dx * bInvM, -dy * bInvM, bAngle));
          if (scale < 1) rigidWorldPositionLimitHits++;
          if (scale <= 0) continue;
          if (rigidTraceLayer == A->solverLayer && A->id == rigidTraceBodyId) {
            rigidTraceProjectionMotion[0] += dx * aInvM * scale;
            rigidTraceProjectionMotion[1] += dy * aInvM * scale;
            rigidTraceProjectionMotion[2] += aAngle * scale;
          }
          if (rigidTraceLayer == B->solverLayer && B->id == rigidTraceBodyId) {
            rigidTraceProjectionMotion[0] -= dx * bInvM * scale;
            rigidTraceProjectionMotion[1] -= dy * bInvM * scale;
            rigidTraceProjectionMotion[2] += bAngle * scale;
          }
          A->px += dx * aInvM * scale;
          A->py += dy * aInvM * scale;
          A->angle += aAngle * scale;
          B->px -= dx * bInvM * scale;
          B->py -= dy * bInvM * scale;
          B->angle += bAngle * scale;
          rigidPositionCorrections++;
          corrected = true;
        }
      }
      if (!corrected) break;
    }
    for (const auto& pair : state.positionPairs) {
      Body* A = step.solverBodies[pair.first];
      Body* B = step.solverBodies[pair.second];
      A->cs = std::cos(A->angle);
      A->sn = std::sin(A->angle);
      B->cs = std::cos(B->angle);
      B->sn = std::sin(B->angle);
      if (A->jointRole == 1) syncJointFollower(A);
      if (B->jointRole == 1) syncJointFollower(B);
    }
  }
}

