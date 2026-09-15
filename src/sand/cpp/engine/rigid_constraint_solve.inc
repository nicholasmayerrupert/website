double RigidBodySystem::contactVelocityResidual(const Contact& contact) {
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
}

double RigidBodySystem::contactBiasResidual(const Contact& contact) {
  double rvx = contact.a->pvx - contact.a->pw * contact.ray;
  double rvy = contact.a->pvy + contact.a->pw * contact.rax;
  if (contact.b && (contact.bIntegrated || contact.b->actorProxy)) {
    rvx -= contact.b->pvx - contact.b->pw * contact.rby;
    rvy -= contact.b->pvy + contact.b->pw * contact.rbx;
  }
  double vn = rvx * contact.nx + rvy * contact.ny;
  return contact.accBias > 1e-12
    ? std::fabs(contact.targetBias - vn)
    : std::fmax(0.0, contact.targetBias - vn);
}

void RigidBodySystem::prepareRigidConstraints(const StepState& step, int sub) {
  auto& contacts = solverContactScratch;
  if (sub + 1 == step.substeps) {
    for (const Contact& contact : contacts) {
      if (!contact.b || !contact.bIntegrated
          || contact.a->idx < 0 || contact.b->idx < 0)
        continue;
      if (contact.a->solverLayer == contact.b->solverLayer)
        movements[contact.a->solverLayer].terrainContactPairs.push_back(
          {contact.a->id, contact.b->id});
    }
  }
  rigidContacts += (int)contacts.size();
  for (Contact& contact : contacts) {
    Body* A = contact.a;
    Body* B = contact.b;
    double aInvM = A->awake ? A->invMass : 0;
    double aInvI = A->awake ? A->invInertia : 0;
    double bInvM = B && B->awake ? B->invMass : 0;
    double bInvI = B && B->awake ? B->invInertia : 0;
    contact.aInvM = aInvM;
    contact.aInvI = aInvI;
    contact.bInvM = bInvM;
    contact.bInvI = bInvI;
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
    contact.normalMass = normalK > 0 ? 1 / normalK : 0;
    contact.tangentMass = tangentK > 0 ? 1 / tangentK : 0;
    contact.biasMass = contact.normalMass;
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
    auto& impactTicks = impactContactTicks[contact.layer * 4
      + contact.a->solverLayer * 2 + (contact.b ? contact.b->solverLayer : 0)];
    auto previous = impactTicks.find(soundKey);
    bool contactStarted = previous == impactTicks.end()
      || previous->second < E.tick - R_IMPACT_SOUND_SEPARATION_TICKS;
    impactTicks[soundKey] = E.tick;
    bool fluidImpact = step.liquidContact[contact.a->idx]
      || (contact.b && contact.b->idx >= 0 && contact.b->idx < step.n
          && step.liquidContact[contact.b->idx]);
    double audibleSpeed = fluidImpact
      ? R_FLUID_IMPACT_SOUND_MIN_SPEED : R_BOUNCE_MIN_SPEED;
    if (!contactStarted || contact.impactSpeed < audibleSpeed)
      continue;
    E.audio.emit(
      SE_IMPACT, contact.a->px, contact.a->py,
      std::min(1.8, 0.25 + contact.impactSpeed * 0.55),
      contact.a->material);
  }
}

void RigidBodySystem::buildRigidIslands(const StepState& step, SubstepState& state) {
  auto& contacts = solverContactScratch;
  const int nc = (int)contacts.size();
  state.solveParent = step.stepIslandParent;
  for (const Contact& contact : contacts)
    if (contact.b && contact.bIntegrated)
      ufUnite(state.solveParent, contact.a->idx, contact.b->idx);
  for (auto& island : state.islands) island = SubstepState::Island{};
  for (int bi = 0; bi < step.n; bi++) {
    int root = ufFind(state.solveParent, bi);
    auto& island = state.islands[root];
    Body* body = step.solverBodies[bi];
    island.bodyCount++;
    island.maxRadius = std::fmax(island.maxRadius, body->maxR);
    island.minX = std::fmin(island.minX, body->aabbX0);
    island.minY = std::fmin(island.minY, body->aabbY0);
    island.maxX = std::fmax(island.maxX, body->aabbX1);
    island.maxY = std::fmax(island.maxY, body->aabbY1);
    island.shockKey ^= rigidBodyKey(body);
    island.shockKey *= 0x100000001b3ULL;
    if (!body->blastDebris) island.hasGeneral = 1;
    if (body->spatialForceApplied) island.hasSpatialForce = 1;
    if (body->jointRole != 0) island.hasJointBody = 1;
  }
  state.contactOrder.resize(nc);
  state.contactRoot.resize(nc);
  for (int ci = 0; ci < nc; ci++) {
    state.contactOrder[ci] = ci;
    state.contactRoot[ci] = ufFind(state.solveParent, contacts[ci].a->idx);
    const Contact& contact = contacts[ci];
    if (contact.b && contact.bIntegrated
        && contact.a->solverLayer != contact.b->solverLayer)
      state.islands[state.contactRoot[ci]].hasPeerContacts = 1;
  }
  std::sort(state.contactOrder.begin(), state.contactOrder.end(), [&](int a, int b) {
      if (state.contactRoot[a] != state.contactRoot[b])
        return state.contactRoot[a] < state.contactRoot[b];
      double ay = contacts[a].a->py + contacts[a].ray;
      double by = contacts[b].a->py + contacts[b].ray;
      if (ay != by) return ay > by;
      return a < b;
  });
}

void RigidBodySystem::solveRigidIslands(const StepState& step, SubstepState& state) {
  auto& contacts = solverContactScratch;
  const int nc = (int)contacts.size();
  for (int islandStart = 0; islandStart < nc;) {
    int root = state.contactRoot[state.contactOrder[islandStart]];
    const auto& island = state.islands[root];
    int islandEnd = islandStart + 1;
    while (islandEnd < nc
           && state.contactRoot[state.contactOrder[islandEnd]] == root)
      islandEnd++;
    int solverIters = R_BLAST_DEBRIS_SOLVER_ITERS;
    if (island.hasGeneral) {
      solverIters = R_SOLVER_BASE_ITERS
        + R_SOLVER_ITERS_PER_BODY * island.bodyCount;
      if (island.maxRadius >= 24)
        solverIters = imax(solverIters, R_SOLVER_LARGE_BODY_ITERS);
      solverIters = imin(R_SOLVER_ITERS, solverIters);
    }
    bool hasImpactTarget = false;
    for (int oi = islandStart; oi < islandEnd; oi++)
      if (contacts[state.contactOrder[oi]].targetVn > 0) {
        hasImpactTarget = true;
        break;
      }
    if (hasImpactTarget) solverIters = R_SOLVER_ITERS;
    // A small residual on one pass can move a far-away point visibly on a
    // structure-scale body as its compound contact patch changes. Give those
    // islands two more coherence passes before allowing residual early-out.
    int islandMinIterations = solverMinIterations;
    if (island.maxRadius >= R_SOLVER_HUGE_BODY_RADIUS)
      islandMinIterations = imax(
        islandMinIterations, R_SOLVER_HUGE_BODY_MIN_ITERS);
    bool separateImpactPhase = hasImpactTarget
      && island.bodyCount >= 16
      && !island.hasPeerContacts
      && !(E.fg.forceActive || E.bg.forceActive)
      && island.maxY - island.minY
        >= 2 * (island.maxX - island.minX);
    auto solveVelocity = [&](int ci) {
      Contact& contact = contacts[ci];
      int mate = contact.blockMate;
      if (mate >= 0) {
        if (ci > mate) return 0.0;
        return resolveContactBlock(contact, contacts[mate]);
      }
      return resolveContact(contact);
    };
    bool shockVelocityConverged = false;
    uint64_t shockIslandKey = island.shockKey;
    bool shockSupportEligible = (island.bodyCount >= 8
        && island.maxY - island.minY
          >= island.maxX - island.minX)
      || (island.bodyCount >= 4
        && island.maxRadius >= R_SOLVER_HUGE_BODY_RADIUS);
    bool shockAttemptAllowed = true;
    auto previousAttempt = shockAttemptCache.find(shockIslandKey);
    if (previousAttempt != shockAttemptCache.end()
        && previousAttempt->second.retryTick > E.tick) {
      shockAttemptAllowed = false;
      previousAttempt->second.lastTick = E.tick;
      rigidShockSkipped++;
    }
    if (!hasImpactTarget && island.bodyCount >= 4
        && !(E.fg.forceActive || E.bg.forceActive) && shockAttemptAllowed
        && shockSupportEligible) {
      shockVelocityConverged = solveSupportShock(
        step, state, root, islandStart, islandEnd, solverIters, shockIslandKey);
    }
    // The first passes run from the lowest contact upward so support impulses
    // propagate through tall stacks promptly. Later passes alternate direction
    // to remove a permanent ordering bias. Large single-layer spatial-force
    // islands run to a no-op or the cap so sustained acceleration reaches one
    // stable network solution instead of repeatedly reactivating marginal
    // contacts. Joint islands retain residual convergence because both layer
    // rasters must remain exactly aligned.
    for (int it = 0; it < solverIters && !shockVelocityConverged; it++) {
      rigidVelocityIterations++;
      rigidVelocityConstraintEvals += islandEnd - islandStart;
      double moved = 0;
      bool bottomUp = it < R_SHOCK_ORDER_ITERS || !(it & 1);
      if (separateImpactPhase && bottomUp) {
        for (int oi = islandStart; oi < islandEnd; oi++)
          if (contacts[state.contactOrder[oi]].targetVn > 0)
            moved += solveVelocity(state.contactOrder[oi]);
        for (int oi = islandStart; oi < islandEnd; oi++)
          if (contacts[state.contactOrder[oi]].targetVn <= 0)
            moved += solveVelocity(state.contactOrder[oi]);
      } else if (separateImpactPhase) {
        for (int oi = islandEnd - 1; oi >= islandStart; oi--)
          if (contacts[state.contactOrder[oi]].targetVn > 0)
            moved += solveVelocity(state.contactOrder[oi]);
        for (int oi = islandEnd - 1; oi >= islandStart; oi--)
          if (contacts[state.contactOrder[oi]].targetVn <= 0)
            moved += solveVelocity(state.contactOrder[oi]);
      } else if (bottomUp) {
        for (int oi = islandStart; oi < islandEnd; oi++)
          moved += solveVelocity(state.contactOrder[oi]);
      } else {
        for (int oi = islandEnd - 1; oi >= islandStart; oi--)
          moved += solveVelocity(state.contactOrder[oi]);
      }
      if (moved == 0.0) break;
      if ((!island.hasSpatialForce
              || island.hasJointBody
              || island.bodyCount < forceFullSolveBodies)
          && it + 1 >= islandMinIterations
          && ((it + 1 - islandMinIterations) & 1) == 0) {
        double residual = 0;
        for (int oi = islandStart; oi < islandEnd; oi++)
          residual = std::fmax(residual, contactVelocityResidual(
            contacts[state.contactOrder[oi]]));
        if (residual <= solverResidualTolerance) break;
      }
    }
    for (int oi = islandStart; oi < islandEnd; oi++)
      rigidMaxVelocityResidual = std::fmax(
        rigidMaxVelocityResidual,
        contactVelocityResidual(contacts[state.contactOrder[oi]]));
    for (int oi = islandStart; oi < islandEnd; oi++) {
      Contact& contact = contacts[state.contactOrder[oi]];
      contact.targetBias = std::fmin(R_MAX_BIAS_VEL, R_BAUMGARTE
        * std::fmax(0.0, contact.depth - rigidContactSlop(contact)));
    }
    for (int it = 0; it < solverIters; it++) {
      rigidBiasIterations++;
      rigidBiasConstraintEvals += islandEnd - islandStart;
      double moved = 0;
      bool bottomUp = it < R_SHOCK_ORDER_ITERS || !(it & 1);
      if (bottomUp) {
        for (int oi = islandStart; oi < islandEnd; oi++)
          moved += resolveBias(contacts[state.contactOrder[oi]]);
      } else {
        for (int oi = islandEnd - 1; oi >= islandStart; oi--)
          moved += resolveBias(contacts[state.contactOrder[oi]]);
      }
      if (moved == 0.0) break;
      if (it + 1 >= islandMinIterations
          && ((it + 1 - islandMinIterations) & 1) == 0) {
        double residual = 0;
        for (int oi = islandStart; oi < islandEnd; oi++)
          residual = std::fmax(residual, contactBiasResidual(
            contacts[state.contactOrder[oi]]));
        if (residual <= solverResidualTolerance) break;
      }
    }
    for (int oi = islandStart; oi < islandEnd; oi++) {
      const Contact& contact = contacts[state.contactOrder[oi]];
      rigidMaxBiasResidual = std::fmax(
        rigidMaxBiasResidual, contactBiasResidual(contact));
      double slop = rigidContactSlop(contact);
      rigidMaxPenetrationResidual = std::fmax(
        rigidMaxPenetrationResidual,
        std::fmax(0.0, contact.depth - slop));
    }
    islandStart = islandEnd;
  }
}

void RigidBodySystem::limitRigidBiasMotion(
    const StepState& step, SubstepState& state, const std::array<std::array<double, 3>, 3>& priorTraceBiasByKind) {
  // Bound aggregate translation plus angular perimeter travel, rather than
  // each contact's target alone. Scale the whole contact island together.
  for (auto& island : state.islands) island.biasScale = 1.0;
  for (int bi = 0; bi < step.n; bi++) {
    Body* body = step.solverBodies[bi];
    if (!state.activeBody[bi] || !body->awake) continue;
    double pointSpeed = std::hypot(body->pvx, body->pvy)
      + std::fabs(body->pw) * body->maxR;
    if (pointSpeed <= R_MAX_BIAS_POINT_SPEED) continue;
    int root = ufFind(state.solveParent, bi);
    state.islands[root].biasScale = std::fmin(state.islands[root].biasScale,
      R_MAX_BIAS_POINT_SPEED / pointSpeed);
  }
  for (int bi = 0; bi < step.n; bi++) {
    Body* body = step.solverBodies[bi];
    if (!state.activeBody[bi] || !body->awake) continue;
    double scale = state.islands[ufFind(state.solveParent, bi)].biasScale;
    if (scale >= 1) continue;
    body->pvx *= scale; body->pvy *= scale; body->pw *= scale;
    body->denseMicrostepTicks = R_DENSE_MICROSTEP_HYSTERESIS;
    if (rigidTraceLayer == body->solverLayer && body->id == rigidTraceBodyId)
      for (int kind = 0; kind < 3; kind++)
        for (int axis = 0; axis < 3; axis++)
          rigidTraceBiasByKind[kind][axis] = priorTraceBiasByKind[kind][axis]
            + (rigidTraceBiasByKind[kind][axis]
              - priorTraceBiasByKind[kind][axis]) * scale;
  }
}

