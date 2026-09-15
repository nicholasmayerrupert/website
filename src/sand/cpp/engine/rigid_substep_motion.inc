void RigidBodySystem::prepareRigidSubstep(
    StepState& step, SubstepState& state, int sub, double tickDt) {
  double wpx, wpy;
  for (int bi = 0; bi < step.n; bi++) {
    int cadence = step.bodySubsteps[bi];
    int before = sub * cadence / step.substeps;
    int after = (sub + 1) * cadence / step.substeps;
    state.activeBody[bi] = after != before;
    state.bodyDt[bi] = state.activeBody[bi] ? tickDt / cadence : 0;
    if (state.activeBody[bi]) rigidIslandBodySteps++;
  }
  prepareActorSubstep(step, tickDt / step.substeps);
  for (auto& flags : state.contact) flags.solid = 0;
  auto bodyMayTouchGranular = [&](Body* body) {
    if (!step.terrainOccupancyReady) return true;
    double minX, minY, maxX, maxY;
    rigidBodyBounds(body, 1.5, minX, minY, maxX, maxY);
    int binX0 = imax(0, (int)std::floor(minX))
              >> TERRAIN_RIGID_BIN_SHIFT;
    int binY0 = imax(0, (int)std::floor(minY))
              >> TERRAIN_RIGID_BIN_SHIFT;
    int binX1 = imin(E.cols - 1, (int)std::floor(maxX))
              >> TERRAIN_RIGID_BIN_SHIFT;
    int binY1 = imin(E.rows - 1, (int)std::floor(maxY))
              >> TERRAIN_RIGID_BIN_SHIFT;
    if (binX1 < binX0 || binY1 < binY0) return false;
    for (int binY = binY0; binY <= binY1; binY++)
      for (int binX = binX0; binX <= binX1; binX++)
        if (terrainGranularBins[binY * terrainRigidBinCols + binX])
          return true;
    return false;
  };
  for (int bi = 0; bi < step.n; bi++) {
    Body* b = step.solverBodies[bi];
    Engine::ActiveLayerScope scope(E, bodyLayer(b));
    double dt = state.bodyDt[bi];
    b->cs = std::cos(b->angle);
    b->sn = std::sin(b->angle);
    if (!state.activeBody[bi]) {
      rigidBodyBounds(b, R_CONTACT_SKIN + 0.5,
                 b->aabbX0, b->aabbY0, b->aabbX1, b->aabbY1);
      continue;
    }
    if (b->awake) b->vy += E.forces.bodyGravity(b) * dt;
    b->pvx = 0; b->pvy = 0; b->pw = 0;
    b->hadContact = step.liquidContact[bi] != 0;
    b->maxDepth = 0;
    bool mayTouchGranular = b->awake && !b->boundaryPts.empty()
      && bodyMayTouchGranular(b);
    if (b->awake && !b->boundaryPts.empty() && !mayTouchGranular)
      rigidGranularBodiesSkipped++;
    if (mayTouchGranular) {
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
        b->vy -= E.forces.bodyGravity(b) * powderSupport * dt;
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
    rigidBodyBounds(b, b->sweepMargin,
               b->aabbX0, b->aabbY0, b->aabbX1, b->aabbY1);
    b->omegaPre = b->omega;                                  // spin entering this substep's contact solve
  }
}

void RigidBodySystem::integrateRigidSubstep(
    StepState& step, SubstepState& state, int sub, double tickDt) {
  auto& contacts = solverContactScratch;
  // A level support cannot balance gravity with the centre of mass
  // outside its contact span. Side contacts, unequal support heights and
  // external loads retain the general solver's settling policy.
  for (auto& support : state.support) support = SubstepState::Support{};
  for (auto& island : state.islands) {
    island.supportMass = island.supportMomentX = 0;
    island.terrainMinX = 1e18;
    island.terrainMaxX = -1e18;
  }
  for (int bi = 0; bi < step.n; bi++) {
    Body* body = step.solverBodies[bi];
    if (body->invMass <= 0) continue;
    int root = ufFind(state.solveParent, bi);
    double mass = 1 / body->invMass;
    state.islands[root].supportMass += mass;
    state.islands[root].supportMomentX += mass * body->px;
  }
  auto noteSupport = [&](Body* body, double rx, double ry, double ny) {
    int i = body->idx;
    if (i < 0 || i >= step.n || step.solverBodies[i] != body) return;
    if (ny >= -0.1 || ry <= 0) { state.support[i].other = 1; return; }
    state.support[i].minX = std::fmin(state.support[i].minX, rx);
    state.support[i].maxX = std::fmax(state.support[i].maxX, rx);
    state.support[i].minY = std::fmin(state.support[i].minY, ry);
    state.support[i].maxY = std::fmax(state.support[i].maxY, ry);
  };
  for (const Contact& contact : contacts) {
    // Touching anchors can carry zero impulse in a particular solve while
    // still limiting the body's next motion.
    if (contact.depth < -R_CONTACT_SKIN * 0.5 && contact.accJn <= 1e-8) continue;
    if (!contact.b) {
      int root = ufFind(state.solveParent, contact.a->idx);
      double x = contact.a->px + contact.rax;
      state.islands[root].terrainMinX = std::fmin(state.islands[root].terrainMinX, x);
      state.islands[root].terrainMaxX = std::fmax(state.islands[root].terrainMaxX, x);
    }
    noteSupport(contact.a, contact.rax, contact.ray, contact.ny);
    if (contact.b && contact.bIntegrated)
      noteSupport(contact.b, contact.rbx, contact.rby, -contact.ny);
  }
  for (int bi = 0; bi < step.n; bi++) {
    Body* b = step.solverBodies[bi];
    Engine::ActiveLayerScope scope(E, bodyLayer(b));
    if (!state.activeBody[bi] || !b->awake) continue;
    double dt = state.bodyDt[bi];
    if (rigidTraceLayer == b->solverLayer && b->id == rigidTraceBodyId) {
      rigidTraceVelocityMotion[0] += b->vx * dt;
      rigidTraceVelocityMotion[1] += b->vy * dt;
      rigidTraceVelocityMotion[2] += b->omega * dt;
      rigidTraceBiasMotion[0] += b->pvx * dt;
      rigidTraceBiasMotion[1] += b->pvy * dt;
      rigidTraceBiasMotion[2] += b->pw * dt;
    }
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
        && !step.liquidContact[bi]
        && bodyHasLooseSupport(b)) {
      b->hadContact = true;
      looseContact = true;
    }
    if (!b->hadContact) { b->stillTicks = 0; continue; }
    bool frictionalContact = state.contact[bi].solid || looseContact;
    int supportRoot = ufFind(state.solveParent, bi);
    const auto& island = state.islands[supportRoot];
    const auto& support = state.support[bi];
    double islandX = island.supportMass > 0
      ? island.supportMomentX / island.supportMass : b->px;
    // Coupled bodies may counterbalance one another. Preserve their general
    // settling policy while the whole pile lies over its terrain supports.
    bool islandOverhang = island.terrainMinX <= island.terrainMaxX
      && (islandX < island.terrainMinX - 0.5
        || islandX > island.terrainMaxX + 0.5);
    bool unbalancedSupport = b->vx * b->vx + b->vy * b->vy < R_SLEEP_LIN * R_SLEEP_LIN
      && (island.bodyCount == 1 || islandOverhang)
      && !support.other && !looseContact
      && !step.liquidContact[bi] && !b->spatialForceApplied
      && E.scaledGravity(R_GRAVITY) > 0
      && support.minX <= support.maxX
      && support.maxY - support.minY <= 1.0
      && (support.minX > 0.5 || support.maxX < -0.5)
      && b->omega * (support.minX > 0.5 ? -1 : 1) > 1e-8;
    if (unbalancedSupport) {
      b->stillTicks = 0;
      b->restProbeTicks = 0;
    }
    dampSolidContact(b, unbalancedSupport, frictionalContact,
                     state.contact[bi].upward, state.contact[bi].body);
    bool fluidOnlyContact = step.liquidContact[bi] && !frictionalContact;
    bool fluidRestContact = step.liquidSurfaceContact[bi]
                         || step.liquidDensityEquilibrium[bi];
    step.fluidOnlySleep[bi] =
      fluidOnlyContact && !step.liquidDensityEquilibrium[bi] ? 1 : 0;
    dampFluidContact(b, fluidOnlyContact, fluidRestContact,
                     step.liquidDensityEquilibrium[bi]);
    // Sleep age advances once per world tick, independently of substeps.
    if (sub + 1 == step.substeps)
      updateSleepAge(b, unbalancedSupport, step.liquidContact[bi],
                     fluidOnlyContact, fluidRestContact);
  }
  integrateActorSubstep(step, tickDt / step.substeps);
}

