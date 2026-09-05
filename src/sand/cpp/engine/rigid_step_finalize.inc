void RigidBodySystem::finalizeRigidStep(StepState& step) {
  using LoadedWindowFreezeState = StepState::LoadedWindowFreezeState;
  auto& solverBodies = step.solverBodies;
  auto& n = step.n;
  auto& liquidContact = step.liquidContact;
  auto& fluidOnlySleep = step.fluidOnlySleep;
  auto& fluidStartPose = step.fluidStartPose;
  auto& loadedWindowFreeze = step.loadedWindowFreeze;
  auto& contacts = solverContactScratch;
  int nc = (int)contacts.size();
  int activeLayer = E.L == &E.fg ? 0 : 1;
  auto& broadphaseOrder = broadphaseOrderScratch;
  std::vector<int> islandParent(n);
  std::vector<double> islandMinStill(n);
  std::vector<int> islandMinRestProbe(n);
  // Fast liquid entry is projected at the advected pose immediately. Sustained
  // interface slip is corrected periodically while the primary projection
  // continues every tick, and unrelated wet bodies stay outside the regional
  // pressure domain.
  std::vector<Body*> fluidCorrectorBodies;
  fluidCorrectorBodies.reserve(n);
  int correctorCadence =
    n >= R_DENSE_RIGID_CARGO_BODIES
      ? R_FLUID_DENSE_CORRECTOR_CADENCE
    : n >= R_FLUID_CORRECTOR_BATCH_BODIES
      ? R_FLUID_CORRECTOR_CADENCE : 1;
  for (int bi = 0; bi < n; bi++) {
    Body* body = solverBodies[bi];
    if (!body->awake) continue;
    const std::array<double, 3>& start = fluidStartPose[bi];
    double travel = std::hypot(body->px - start[0], body->py - start[1])
                  + std::fabs(body->angle - start[2]) * body->maxR;
    if (travel <= R_FLUID_CORRECTOR_TRAVEL) continue;
    bool enteringLiquid = !liquidContact[bi];
    bool slipping = bi < (int)fluidBodyMaxSlip.size()
                 && fluidBodyMaxSlip[bi] >= R_FLUID_CORRECTOR_SLIP;
    bool correctionDue = correctorCadence == 1
      || body->id % correctorCadence == E.tick % correctorCadence;
    if (!enteringLiquid && (!slipping
        || !correctionDue))
      continue;
    fluidCorrectorBodies.push_back(body);
  }
  if (!fluidCorrectorBodies.empty()) {
    fluidCorrectorBodyCount = (int)fluidCorrectorBodies.size();
    std::vector<std::array<double, 3>> beforeCorrection(
      fluidCorrectorBodies.size());
    for (int bi = 0; bi < (int)fluidCorrectorBodies.size(); bi++) {
      Body* body = fluidCorrectorBodies[bi];
      body->cs = std::cos(body->angle);
      body->sn = std::sin(body->angle);
      beforeCorrection[bi] = {body->vx, body->vy, body->omega};
    }
    double fluidCorrectorStart = emscripten_get_now();
    bool correctedLiquid = coupleLiquids(fluidCorrectorBodies, 0);
    fluidCorrectorMs = emscripten_get_now() - fluidCorrectorStart;
    rigidFluidCoupleMs += fluidCorrectorMs;
    if (correctedLiquid) {
      fluidCorrectorPasses++;
      for (int bi = 0; bi < (int)fluidCorrectorBodies.size(); bi++) {
        Body* body = fluidCorrectorBodies[bi];
        const std::array<double, 3>& before = beforeCorrection[bi];
        double dvx = body->vx - before[0];
        double dvy = body->vy - before[1];
        double dw = (body->omega - before[2]) * body->maxR;
        if (dvx * dvx + dvy * dvy + dw * dw > 1e-10) {
          body->stillTicks = 0;
          body->restProbeTicks = 0;
        }
      }
    }
  }
  finalizeActorStep(step);
  std::vector<int>& savedBroadphaseIds = broadphaseBodyIds[activeLayer];
  savedBroadphaseIds.resize(broadphaseOrder.size());
  for (size_t i = 0; i < broadphaseOrder.size(); i++)
    savedBroadphaseIds[i] = solverBodies[broadphaseOrder[i]]->id;
  for (int bi = 0; bi < n; bi++) islandParent[bi] = bi;
  for (int ci = 0; ci < nc; ci++) {
    Contact& c = contacts[ci];
    if (!c.b || !c.bIntegrated || !c.a->awake || !c.b->awake) continue;
    ufUnite(islandParent, c.a->idx, c.b->idx);
  }
  auto updateRestProbe = [](Body* body) {
    double cs = std::cos(body->angle), sn = std::sin(body->angle);
    double lx0 = body->offsetX - 0.5;
    double lx1 = body->offsetX + body->w - 0.5;
    double ly0 = body->offsetY - 0.5;
    double ly1 = body->offsetY + body->h - 0.5;
    double lx = std::fabs(lx0) >= std::fabs(lx1) ? lx0 : lx1;
    double ly = std::fabs(ly0) >= std::fabs(ly1) ? ly0 : ly1;
    const std::array<double, 6> points = {
      body->px, body->py,
      body->px + lx * cs, body->py + lx * sn,
      body->px - ly * sn, body->py + ly * cs,
    };
    if (body->restProbeTicks == 0) {
      body->restProbePoints = points;
      body->restProbeTicks = 1;
      return;
    }
    double radius2 = R_REST_PROBE_RADIUS * R_REST_PROBE_RADIUS;
    for (int point = 0; point < 3; point++) {
      double dx = points[point * 2] - body->restProbePoints[point * 2];
      double dy = points[point * 2 + 1] - body->restProbePoints[point * 2 + 1];
      if (dx * dx + dy * dy <= radius2) continue;
      body->restProbePoints = points;
      body->restProbeTicks = 1;
      return;
    }
    if (body->restProbeTicks < R_REST_PROBE_TICKS)
      body->restProbeTicks++;
  };
  for (int bi = 0; bi < n; bi++) {
    Body* body = solverBodies[bi];
    if (!body->awake || loadedWindowFreeze[bi].frozen) continue;
    double pointSpeed = std::hypot(body->vx, body->vy)
                      + std::fabs(body->omega) * body->maxR;
    // Keep an established rest probe across brief raster-manifold gaps. A body
    // that is truly unsupported accelerates past the speed band or leaves the
    // pose envelope long before the sleep interval; a resting irregular face
    // should not restart its entire timer when its contact anchors change cell.
    bool eligible = (body->hadContact || body->restProbeTicks > 0)
      && !fluidOnlySleep[bi]
      && !body->spatialForceApplied
      && pointSpeed < R_REST_PROBE_MAX_POINT_SPEED;
    if (eligible) updateRestProbe(body);
    else body->restProbeTicks = 0;
  }
  for (int bi = 0; bi < n; bi++) islandMinStill[bi] = 1e18;
  for (int bi = 0; bi < n; bi++) islandMinRestProbe[bi] = INT_MAX;
  for (int bi = 0; bi < n; bi++) {
    Body* b = solverBodies[bi];
    if (!b->awake) continue;
    int r = ufFind(islandParent, bi);
    double st = b->hadContact ? b->stillTicks : 0;
    if (fluidOnlySleep[bi])
      st *= (double)R_SLEEP_TICKS / R_FLUID_SLEEP_TICKS;
    if (st < islandMinStill[r]) islandMinStill[r] = st;
    if ((int)b->restProbeTicks < islandMinRestProbe[r])
      islandMinRestProbe[r] = b->restProbeTicks;
  }
  // Build contact adjacency only when a body is ready to sleep. Preserve the
  // solver's contact order because the first eight distinct supports are kept.
  std::vector<int> sleepContactOffsets, sleepContactIndices;
  auto indexSleepContacts = [&]() {
    sleepContactOffsets.assign(n + 1, 0);
    for (const Contact& c : contacts) {
      sleepContactOffsets[c.a->idx + 1]++;
      if (c.b && c.bIntegrated && c.b != c.a)
        sleepContactOffsets[c.b->idx + 1]++;
    }
    for (int i = 1; i <= n; i++)
      sleepContactOffsets[i] += sleepContactOffsets[i - 1];
    sleepContactIndices.resize(sleepContactOffsets[n]);
    std::vector<int> cursor = sleepContactOffsets;
    for (int i = 0; i < (int)contacts.size(); i++) {
      const Contact& c = contacts[i];
      sleepContactIndices[cursor[c.a->idx]++] = i;
      if (c.b && c.bIntegrated && c.b != c.a)
        sleepContactIndices[cursor[c.b->idx]++] = i;
    }
  };
  for (int bi = 0; bi < n; bi++) {
    Body* b = solverBodies[bi];
    if (!b->awake) continue;
    int root = ufFind(islandParent, bi);
    bool sleep = islandMinStill[root] >= R_SLEEP_TICKS
              || islandMinRestProbe[root] >= R_REST_PROBE_TICKS;
    if (!sleep) continue;
    if (sleepContactOffsets.empty()) indexSleepContacts();
    b->sleepSupports.clear();
    int currentLayer = E.L == &E.bg ? 1 : 0;
    auto addSupport = [&](double x, double y, int owner, int layer) {
      if (b->sleepSupports.size() >= 8) return;
      for (const BodySleepSupport& support : b->sleepSupports)
        if (support.owner == owner && support.layer == layer
            && std::fabs(support.x - x) <= 0.5
            && std::fabs(support.y - y) <= 0.5)
          return;
      b->sleepSupports.push_back({x, y, owner, (uint8_t)layer});
    };
    uint8_t bodyTerrainSideDirections = 0;
    for (int i = sleepContactOffsets[bi]; i < sleepContactOffsets[bi + 1]; i++) {
      const Contact& contact = contacts[sleepContactIndices[i]];
      if (contact.a == b && !contact.b && std::fabs(contact.ny) < 0.1)
        bodyTerrainSideDirections |= contact.nx < 0 ? 1 : 2;
    }
    for (int i = sleepContactOffsets[bi]; i < sleepContactOffsets[bi + 1]; i++) {
      const Contact& contact = contacts[sleepContactIndices[i]];
      if (contact.b && contact.b->actorProxy) continue;
      double impulseY = contact.accJn * contact.ny
                      + contact.accJt * contact.nx;
      bool unloadedTerrainSide = !contact.b && std::fabs(contact.ny) < 0.1
        && b->jointRole == 0 && !b->blastDebris
        && b->nPts >= R_WALL_RELEASE_MIN_CELLS
        && bodyTerrainSideDirections != 3;
      // Tangential impact friction can point upward at a terrain wall, but
      // a one-sided wall is not a load-bearing anchor after the solver sleeps.
      if (contact.a == b && impulseY < -1e-8
          && !unloadedTerrainSide) {
        int layer = contact.b && !contact.bIntegrated
          && !contact.b->actorProxy ? 1 - currentLayer : currentLayer;
        addSupport(b->px + contact.rax, b->py + contact.ray,
                   contact.b ? contact.b->id : -1, layer);
      }
      if (contact.b == b && contact.bIntegrated && impulseY > 1e-8)
        addSupport(b->px + contact.rbx, b->py + contact.rby,
                   contact.a->id, currentLayer);
    }
    // A dual-layer cut island can sit still on other free debris. That is not
    // a load-bearing anchor; keep the joint leader awake until it has terrain,
    // loose-medium, or fluid rest.
    if (b->jointRole == 1 && b->nPts > 800
        && b->sleepSupports.empty() && !fluidOnlySleep[bi]
        && !bodyHasLooseSupport(b)) {
      b->sleepSupports.clear();
      continue;
    }
    b->awake = false;
    b->vx = 0;
    b->vy = 0;
    b->omega = 0;
    if (b->jointRole == 1) syncJointFollower(b);
  }
  for (int bi = 0; bi < n; bi++) {
    const LoadedWindowFreezeState& freeze = loadedWindowFreeze[bi];
    if (!freeze.frozen) continue;
    Body* body = solverBodies[bi];
    body->awake = freeze.awake;
    body->hadContact = freeze.hadContact;
    body->rasterMayOverlapSolid = freeze.rasterMayOverlapSolid;
    body->stillTicks = freeze.stillTicks;
    body->recentImpactSpeed = freeze.recentImpactSpeed;
    body->denseMicrostepTicks = freeze.denseMicrostepTicks;
    body->loadedWindowParked = false;
    if (body->jointRole == 1) syncJointFollower(body);
  }
}
