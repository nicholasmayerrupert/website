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
    if (correctedLiquid) {
      fluidCorrectorPasses++;
      for (int bi = 0; bi < (int)fluidCorrectorBodies.size(); bi++) {
        Body* body = fluidCorrectorBodies[bi];
        const std::array<double, 3>& before = beforeCorrection[bi];
        double dvx = body->vx - before[0];
        double dvy = body->vy - before[1];
        double dw = (body->omega - before[2]) * body->maxR;
        if (dvx * dvx + dvy * dvy + dw * dw > 1e-10)
          body->stillTicks = 0;
      }
    }
  }
  for (ActorProxy& proxy : actorProxies) {
    if (proxy.crushImpulse < ACTOR_CRUSH_IMPULSE) continue;
    if (proxy.player) {
      Player& player = *proxy.player;
      if (E.psys.playerBoxHits(
            player.px, player.py + 0.25, player.w, player.h))
        E.psys.crushPlayer(player);
      continue;
    }
    Creature& creature = *proxy.creature;
    const CreatureSpecies& species = E.creatures.species(creature);
    if (E.creatures.boxHitsSolid(
          creature.wx, creature.wy + 0.25, species.w, species.h))
      E.creatures.crushCreature(creature);
  }
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
  for (int bi = 0; bi < n; bi++) islandMinStill[bi] = 1e18;
  for (int bi = 0; bi < n; bi++) {
    Body* b = solverBodies[bi];
    if (!b->awake) continue;
    int r = ufFind(islandParent, bi);
    double st = b->hadContact ? b->stillTicks : 0;
    if (fluidOnlySleep[bi])
      st *= (double)R_SLEEP_TICKS / R_FLUID_SLEEP_TICKS;
    if (st < islandMinStill[r]) islandMinStill[r] = st;
  }
  for (int bi = 0; bi < n; bi++) { Body* b = solverBodies[bi]; if (!b->awake) continue; if (islandMinStill[ufFind(islandParent, bi)] >= R_SLEEP_TICKS) { b->awake = false; b->vx = 0; b->vy = 0; b->omega = 0; if (b->jointRole == 1) syncJointFollower(b); } }
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
    if (body->jointRole == 1) syncJointFollower(body);
  }
