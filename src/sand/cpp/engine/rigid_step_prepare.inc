  rigidSubsteps = rigidContacts = rigidWarmStarted = 0;
  rigidVelocityIterations = rigidBiasIterations = 0;
  rigidVelocityConstraintEvals = rigidBiasConstraintEvals = 0;
  rigidShockIslands = rigidShockConstraintEvals = 0;
  rigidShockFallbacks = rigidShockMaxLayers = rigidShockSkipped = 0;
  rigidIslands = rigidBlockSolves = 0;
  rigidIslandBodySteps = rigidGlobalBodySteps = 0;
  rigidChildPairs = rigidChildManifolds = rigidSweepFallbacks = 0;
  rigidMaxChildren = rigidChildTransforms = 0;
  rigidCoherentIslands = rigidDenseFallbackIslands = 0;
  rigidTerrainRiskBodies = rigidImpactRiskBodies = 0;
  rigidTerrainSamples = rigidTerrainSamplesSkipped = 0;
  rigidGranularBodiesSkipped = 0;
  rigidPositionCorrections = 0;
  rigidMaxRelativeSpeed = 0;
  fluidNodeCount = fluidFaceCount = fluidPressureIterations = 0;
  fluidCorrectorPasses = fluidCorrectorBodyCount = 0;
  fluidInitialMs = fluidCorrectorMs = 0;
  fluidReferenceMs = fluidDomainMs = fluidMatrixMs = 0;
  fluidSolveMs = fluidWritebackMs = 0;
  rigidSpillDisplaced = rigidSpillVisits = rigidSpillSearches = 0;
  rigidMaxContactDepth = 0;
  rigidMaxVelocityResidual = rigidMaxBiasResidual = 0;
  rigidMaxPenetrationResidual = 0;
  if ((E.tick & 255) == 0) {
    for (auto it = shockAttemptCache.begin(); it != shockAttemptCache.end();) {
      if (it->second.lastTick + 512 < E.tick)
        it = shockAttemptCache.erase(it);
      else
        ++it;
    }
  }
  terrainContactPairs.clear();
  std::vector<Body*> solverBodies;
  solverBodies.reserve(E.L->bodies.size());
  for (Body* body : E.L->bodies)
    if (body->jointRole != 2) solverBodies.push_back(body);
  for (Body* body : solverBodies)
    rigidMaxChildren = imax(rigidMaxChildren, (int)body->collisionRects.size());
  int n = (int)solverBodies.size();
  bool terrainOccupancyReady = n >= 16;
  if (!terrainOccupancyReady)
    for (Body* body : solverBodies)
      if (body->nPts >= 4096
          || body->boundarySamples.size() >= 2048
          || body->boundaryPts.size() >= 2048) {
        terrainOccupancyReady = true;
        break;
      }
  double occupancyBuildStart = emscripten_get_now();
  static constexpr int TERRAIN_RIGID_BIN_SHIFT = 3;
  static constexpr int TERRAIN_RIGID_BIN_SIZE = 1 << TERRAIN_RIGID_BIN_SHIFT;
  terrainRigidBinCols = (E.cols + TERRAIN_RIGID_BIN_SIZE - 1)
                      >> TERRAIN_RIGID_BIN_SHIFT;
  terrainRigidBinRows = (E.rows + TERRAIN_RIGID_BIN_SIZE - 1)
                      >> TERRAIN_RIGID_BIN_SHIFT;
  if (terrainOccupancyReady) {
    terrainRigidBins.assign(
      (size_t)terrainRigidBinCols * terrainRigidBinRows, 0);
    terrainGranularBins.assign(
      (size_t)terrainRigidBinCols * terrainRigidBinRows, 0);
    for (int binY = 0; binY < terrainRigidBinRows; binY++) {
      int y0 = binY * TERRAIN_RIGID_BIN_SIZE;
      int y1 = imin(E.rows, y0 + TERRAIN_RIGID_BIN_SIZE);
      for (int binX = 0; binX < terrainRigidBinCols; binX++) {
        int x0 = binX * TERRAIN_RIGID_BIN_SIZE;
        int x1 = imin(E.cols, x0 + TERRAIN_RIGID_BIN_SIZE);
        bool occupied = false, granular = false;
        for (int y = y0; y < y1 && !(occupied && granular); y++) {
          const uint8_t* row = E.L->grid + y * E.cols;
          for (int x = x0; x < x1; x++) {
            int k = y * E.cols + x;
            granular = granular || E.isLooseSolidMaterial(row[x]);
            bool peerRigid = E.L == &E.fg && E.bgEnabled
              && (E.bg.bodyOwner[k] >= 0
                  || E.isRigidMaterialClass(E.bg.grid[k]));
            if (E.isRigidMaterialClass(row[x]) || peerRigid)
              occupied = true;
            if (occupied && granular) break;
          }
        }
        int bin = binY * terrainRigidBinCols + binX;
        terrainRigidBins[bin] = occupied;
        terrainGranularBins[bin] = granular;
      }
    }
  }
  rigidOccupancyBuildMs += emscripten_get_now() - occupancyBuildStart;
  std::vector<int> islandParent(n);
  std::vector<uint8_t> priorRasterRisk(n, 0);
  std::vector<double> priorImpactSpeed(n, 0);
  std::vector<double> islandMinStill(n);
  std::vector<uint8_t> liquidContact(n, 0);
  std::vector<uint8_t> liquidSurfaceContact(n, 0);
  std::vector<uint8_t> liquidDensityEquilibrium(n, 0);
  std::vector<uint8_t> fluidOnlySleep(n, 0);
  std::vector<uint8_t> awakeBeforeLiquid(n, 0);
  std::vector<double> vyBeforeLiquid(n, 0), predictedLiquidVy(n, 0);
  std::vector<std::array<double, 3>> fluidStartPose(n);
  struct LoadedWindowFreezeState {
    bool frozen = false;
    bool awake = false;
    bool hadContact = false;
    bool rasterMayOverlapSolid = false;
    int stillTicks = 0;
    double recentImpactSpeed = 0;
    uint8_t denseMicrostepTicks = 0;
  };
  std::vector<LoadedWindowFreezeState> loadedWindowFreeze(n);
  for (int bi = 0; bi < n; bi++) {
    Body* body = solverBodies[bi];
    LoadedWindowFreezeState& freeze = loadedWindowFreeze[bi];
    freeze.frozen = !bodyFullyInsideLoadedWindow(body);
    freeze.awake = body->awake;
    freeze.hadContact = body->hadContact;
    freeze.rasterMayOverlapSolid = body->rasterMayOverlapSolid;
    freeze.stillTicks = body->stillTicks;
    freeze.recentImpactSpeed = body->recentImpactSpeed;
    freeze.denseMicrostepTicks = body->denseMicrostepTicks;
    priorRasterRisk[bi] = body->rasterMayOverlapSolid ? 1 : 0;
    priorImpactSpeed[bi] = body->recentImpactSpeed;
    if (body->denseMicrostepTicks > 0) body->denseMicrostepTicks--;
    awakeBeforeLiquid[bi] = body->awake ? 1 : 0;
    vyBeforeLiquid[bi] = body->vy;
    fluidStartPose[bi] = {body->px, body->py, body->angle};
    if (freeze.frozen) body->awake = false;
    if (body->awake) body->vy += E.scaledGravity(R_GRAVITY) * tickDt;
    predictedLiquidVy[bi] = body->vy;
    body->cs = std::cos(body->angle);
    body->sn = std::sin(body->angle);
    body->hadContact = false;
    body->rasterMayOverlapSolid = false;
    body->recentImpactSpeed = 0;
    body->idx = bi;
  }
  double fluidInitialStart = emscripten_get_now();
  bool coupledLiquid = coupleLiquids(solverBodies, tickDt);
  fluidInitialMs = emscripten_get_now() - fluidInitialStart;
  rigidFluidCoupleMs += fluidInitialMs;
  for (int bi = 0; bi < n; bi++) {
    Body* body = solverBodies[bi];
    liquidContact[bi] = body->hadContact;
    if (bi < (int)fluidBodySurface.size())
      liquidSurfaceContact[bi] = fluidBodySurface[bi];
    if (bi < (int)fluidBodyDensityEquilibrium.size())
      liquidDensityEquilibrium[bi] = fluidBodyDensityEquilibrium[bi];
    if (!coupledLiquid)
      body->vy = vyBeforeLiquid[bi];
    else if (awakeBeforeLiquid[bi])
      body->vy = vyBeforeLiquid[bi] + (body->vy - predictedLiquidVy[bi]);
  }
  auto bodyBounds = [](Body* body, double margin,
                       double& x0, double& y0, double& x1, double& y1) {
    double cs = body->cs, sn = body->sn;
    double lx0 = body->offsetX - 0.5;
    double lx1 = body->offsetX + body->w - 0.5;
    double ly0 = body->offsetY - 0.5;
    double ly1 = body->offsetY + body->h - 0.5;
    x0 = y0 = 1e18;
    x1 = y1 = -1e18;
    auto include = [&](double lx, double ly) {
      double wx = body->px + lx * cs - ly * sn;
      double wy = body->py + lx * sn + ly * cs;
      x0 = std::fmin(x0, wx);
      x1 = std::fmax(x1, wx);
      y0 = std::fmin(y0, wy);
      y1 = std::fmax(y1, wy);
    };
    include(lx0, ly0);
    include(lx1, ly0);
    include(lx1, ly1);
    include(lx0, ly1);
    x0 -= margin;
    y0 -= margin;
    x1 += margin;
    y1 += margin;
  };
  struct ActorProxy {
    Body body;
    Player* player = nullptr;
    Creature* creature = nullptr;
    double crushImpulse = 0;
  };
  std::vector<ActorProxy> actorProxies;
  if (E.L == &E.fg) {
    actorProxies.reserve(
      E.psys.players.size() + E.creatures.creatures.size());
    auto addProxy = [&](double x, double y, int w, int h,
                        double vx, double vy, int id,
                        Player* player, Creature* creature) {
      actorProxies.emplace_back();
      ActorProxy& proxy = actorProxies.back();
      proxy.player = player;
      proxy.creature = creature;
      Body& body = proxy.body;
      body.id = id;
      body.w = w;
      body.h = h;
      body.occ.assign((size_t)w * h, 1);
      body.offsetX = -(w - 1) * 0.5;
      body.offsetY = -(h - 1) * 0.5;
      body.px = x + w * 0.5;
      body.py = y + h * 0.5;
      body.angle = 0;
      body.vx = body.vy = body.omega = 0;
      body.material = RIGID;
      body.density = 1;
      body.nPts = w * h;
      body.geometryRevision = 1;
      body.maxR = std::hypot((w - 1) * 0.5, (h - 1) * 0.5);
      body.tightSlenderBounds = true;
      BodyCollisionRect rect;
      rect.x1 = w;
      rect.y1 = h;
      body.collisionSpans = {
        {(float)(body.offsetY - 0.5),
         (float)(body.offsetY + h - 0.5)},
        {(float)(body.offsetY - 0.5),
         (float)(body.offsetY + h - 0.5)},
        {(float)(body.offsetX - 0.5),
         (float)(body.offsetX + w - 0.5)},
        {(float)(body.offsetX - 0.5),
         (float)(body.offsetX + w - 0.5)},
      };
      for (int face = 0; face < 4; face++) {
        rect.spanStart[face] = face;
        rect.spanCount[face] = 1;
      }
      body.collisionRects.push_back(rect);
      double left = -w * 0.5, right = w * 0.5;
      double top = -h * 0.5, bottom = h * 0.5;
      const double samples[8][2] = {
        {left, top}, {right, top}, {right, bottom}, {left, bottom},
        {0, top}, {right, 0}, {0, bottom}, {left, 0},
      };
      for (const auto& sample : samples) {
        body.boundarySamples.push_back((float)sample[0]);
        body.boundarySamples.push_back((float)sample[1]);
        body.boundarySampleRadii.push_back(
          std::hypot(sample[0], sample[1]));
      }
      body.kinematic = true;
      body.kinematicVx = vx;
      body.kinematicVy = vy;
      body.kinematicOmega = 0;
      body.awake = false;
      body.stillTicks = 0;
      body.idx = -1;
      body.cs = 1;
      body.sn = 0;
      bodyBounds(&body, R_CONTACT_SKIN + 0.5,
                 body.aabbX0, body.aabbY0, body.aabbX1, body.aabbY1);
    };
    for (size_t i = 0; i < E.psys.players.size(); i++) {
      Player& player = E.psys.players[i];
      if (!player.active || !player.alive) continue;
      addProxy(player.px, player.py, player.w, player.h,
               player.vx, player.vy, -1000000000 - player.id,
               &player, nullptr);
    }
    for (size_t i = 0; i < E.creatures.creatures.size(); i++) {
      Creature& creature = E.creatures.creatures[i];
      if (!creature.alive) continue;
      const CreatureSpecies& species = E.creatures.species(creature);
      addProxy(creature.wx - E.fg.worldOffsetX,
               creature.wy - E.fg.worldOffsetY,
               species.w, species.h, creature.vx, creature.vy,
               -1500000000 - creature.id, nullptr, &creature);
    }
  }
  std::unordered_map<Body*, int> actorProxyIndex;
  actorProxyIndex.reserve(actorProxies.size() * 2);
  std::vector<int> actorProxyOrder(actorProxies.size());
  for (int i = 0; i < (int)actorProxies.size(); i++) {
    actorProxyIndex[&actorProxies[i].body] = i;
    actorProxyOrder[i] = i;
  }
  std::sort(actorProxyOrder.begin(), actorProxyOrder.end(),
            [&](int a, int b) {
    const Body& first = actorProxies[a].body;
    const Body& second = actorProxies[b].body;
    if (first.aabbX0 != second.aabbX0)
      return first.aabbX0 < second.aabbX0;
    return first.id < second.id;
  });
  // Build conservative tick islands before sub-stepping. Candidate bodies share
  // one cadence; unrelated slow islands no longer inherit the fastest body's
  // rotational or translational substep count.
  double cadenceStart = emscripten_get_now();
  std::vector<int> stepIslandParent(n), bodySubsteps(n, 1);
  double globalPointSpeed = 0;
  double denseFrameVx = 0, denseFrameVy = 0;
  int denseFrameBodyCount = 0, wetSolverBodyCount = 0;
  for (int bi = 0; bi < n; bi++) {
    stepIslandParent[bi] = bi;
    Body* body = solverBodies[bi];
    if (liquidContact[bi]) wetSolverBodyCount++;
    if (body->awake) {
      denseFrameVx += body->vx;
      denseFrameVy += body->vy;
      denseFrameBodyCount++;
    }
    double pointSpeed = body->awake
      ? std::hypot(body->vx, body->vy)
        + std::fabs(body->omega) * std::fmax(1.0, body->maxR)
      : 0;
    globalPointSpeed = std::fmax(globalPointSpeed, pointSpeed);
  }
  bool denseWetScene =
    n >= R_DENSE_RIGID_CARGO_BODIES
    && wetSolverBodyCount >= R_FLUID_DENSE_BATCH_BODIES;
  if (denseFrameBodyCount > 0) {
    denseFrameVx /= denseFrameBodyCount;
    denseFrameVy /= denseFrameBodyCount;
  }
  bool denseGlobalTerrainRisk = false;
  bool denseGlobalImpactRisk = false;
  bool denseGlobalCooldown = false;
  double denseGlobalMaxRelativeSpeed = 0;
  // The common case is one co-moving cargo frame. Prove it coherent in O(n)
  // before building contact islands; any risk falls through to per-island
  // cadence selection below.
  if (denseWetScene) {
    for (int bi = 0; bi < n; bi++) {
      Body* body = solverBodies[bi];
      double pointSpeed = body->awake
        ? std::hypot(body->vx, body->vy)
          + std::fabs(body->omega) * std::fmax(1.0, body->maxR)
        : 0;
      double reach =
        (pointSpeed + R_MAX_SPEED + E.scaledGravity(R_GRAVITY) * tickDt)
          * tickDt
        + R_CONTACT_SKIN + 0.5;
      double riskX0, riskY0, riskX1, riskY1;
      bodyBounds(body, reach, riskX0, riskY0, riskX1, riskY1);
      bool terrainRisk =
        priorRasterRisk[bi]
        || riskX0 <= 0 || riskY0 <= 0
        || riskX1 >= E.cols || riskY1 >= E.rows;
      denseGlobalTerrainRisk = denseGlobalTerrainRisk || terrainRisk;
      denseGlobalImpactRisk =
        denseGlobalImpactRisk
        || priorImpactSpeed[bi] > R_DENSE_COHERENT_IMPACT_SPEED;
      denseGlobalCooldown =
        denseGlobalCooldown || body->denseMicrostepTicks > 0;
      if (terrainRisk) rigidTerrainRiskBodies++;
      if (priorImpactSpeed[bi] > R_DENSE_COHERENT_IMPACT_SPEED)
        rigidImpactRiskBodies++;
      if (!body->awake) continue;
      double relativeSpeed =
        std::hypot(body->vx - denseFrameVx, body->vy - denseFrameVy)
        + std::fabs(body->omega) * std::fmax(1.0, body->maxR);
      denseGlobalMaxRelativeSpeed = std::fmax(
        denseGlobalMaxRelativeSpeed, relativeSpeed);
    }
    rigidMaxRelativeSpeed = denseGlobalMaxRelativeSpeed;
  }
  bool denseGlobalNewRisk =
    denseGlobalMaxRelativeSpeed > R_DENSE_COHERENT_RELATIVE_SPEED
    || denseGlobalTerrainRisk || denseGlobalImpactRisk;
  bool denseGlobalCoherent =
    denseWetScene && !denseGlobalNewRisk && !denseGlobalCooldown;
  double initialSafeSubstep = denseGlobalCoherent
    ? R_SAFE_SUBSTEP * R_MAX_SUBSTEPS : R_SAFE_SUBSTEP;
  int substeps = (int)std::ceil(
    (globalPointSpeed + E.scaledGravity(R_GRAVITY) * tickDt)
      / initialSafeSubstep);
  substeps = imax(1, imin(R_MAX_SUBSTEPS, substeps));
  if (substeps == 1) {
    rigidIslands = n;
    if (denseWetScene) {
      if (denseGlobalCoherent) rigidCoherentIslands++;
      else rigidDenseFallbackIslands++;
      if (denseGlobalNewRisk)
        for (Body* body : solverBodies)
          body->denseMicrostepTicks = R_DENSE_MICROSTEP_HYSTERESIS;
    }
  } else {
    std::vector<int> islandOrder(n);
    std::vector<double> tickX0(n), tickY0(n), tickX1(n), tickY1(n);
    for (int bi = 0; bi < n; bi++) {
      islandOrder[bi] = bi;
      Body* body = solverBodies[bi];
      double pointSpeed = body->awake
        ? std::hypot(body->vx, body->vy)
          + std::fabs(body->omega) * std::fmax(1.0, body->maxR)
        : 0;
      double reach = (pointSpeed + R_MAX_SPEED + E.scaledGravity(R_GRAVITY) * tickDt) * tickDt
        + R_CONTACT_SKIN + 0.5;
      bodyBounds(body, reach,
                 tickX0[bi], tickY0[bi], tickX1[bi], tickY1[bi]);
    }
    std::sort(islandOrder.begin(), islandOrder.end(), [&](int a, int b) {
      if (tickX0[a] != tickX0[b]) return tickX0[a] < tickX0[b];
      return a < b;
    });
    for (int oi = 0; oi < n; oi++) {
      int a = islandOrder[oi];
      for (int oj = oi + 1; oj < n; oj++) {
        int b = islandOrder[oj];
        if (tickX0[b] > tickX1[a]) break;
        if (tickY1[a] < tickY0[b] || tickY1[b] < tickY0[a]) continue;
        ufUnite(stepIslandParent, a, b);
      }
    }
    std::vector<double> islandPointSpeed(n, 0);
    std::vector<double> islandVxSum(n, 0), islandVySum(n, 0);
    std::vector<double> islandMaxRelativeSpeed(n, 0);
    std::vector<double> islandMaxPriorImpact(n, 0);
    std::vector<int> islandBodyCount(n, 0), islandAwakeCount(n, 0);
    std::vector<int> islandSubsteps(n, 1);
    std::vector<uint8_t> islandTerrainRisk(n, 0);
    std::vector<uint8_t> islandCooldown(n, 0), islandRefreshCooldown(n, 0);
    for (int bi = 0; bi < n; bi++) {
      int root = ufFind(stepIslandParent, bi);
      Body* body = solverBodies[bi];
      islandBodyCount[root]++;
      islandTerrainRisk[root] =
        islandTerrainRisk[root] || priorRasterRisk[bi]
        || tickX0[bi] <= 0 || tickY0[bi] <= 0
        || tickX1[bi] >= E.cols || tickY1[bi] >= E.rows;
      islandMaxPriorImpact[root] = std::fmax(
        islandMaxPriorImpact[root], priorImpactSpeed[bi]);
      islandCooldown[root] =
        islandCooldown[root] || body->denseMicrostepTicks > 0;
      if (!body->awake) continue;
      double pointSpeed = std::hypot(body->vx, body->vy)
        + std::fabs(body->omega) * std::fmax(1.0, body->maxR);
      islandPointSpeed[root] = std::fmax(islandPointSpeed[root], pointSpeed);
      islandVxSum[root] += body->vx;
      islandVySum[root] += body->vy;
      islandAwakeCount[root]++;
    }
    for (int bi = 0; bi < n; bi++) {
      Body* body = solverBodies[bi];
      if (!body->awake) continue;
      int root = ufFind(stepIslandParent, bi);
      double meanVx = denseWetScene
        ? denseFrameVx : islandVxSum[root] / islandAwakeCount[root];
      double meanVy = denseWetScene
        ? denseFrameVy : islandVySum[root] / islandAwakeCount[root];
      double relativeSpeed =
        std::hypot(body->vx - meanVx, body->vy - meanVy)
        + std::fabs(body->omega) * std::fmax(1.0, body->maxR);
      islandMaxRelativeSpeed[root] = std::fmax(
        islandMaxRelativeSpeed[root], relativeSpeed);
      rigidMaxRelativeSpeed = std::fmax(
        rigidMaxRelativeSpeed, relativeSpeed);
    }
    substeps = 1;
    for (int root = 0; root < n; root++) {
      if (islandBodyCount[root] == 0) continue;
      rigidIslands++;
      bool denseWetIsland = denseWetScene;
      bool newDenseRisk =
        islandMaxRelativeSpeed[root] > R_DENSE_COHERENT_RELATIVE_SPEED
        || islandTerrainRisk[root]
        || islandMaxPriorImpact[root] > R_DENSE_COHERENT_IMPACT_SPEED;
      bool coherentDenseIsland =
        denseWetIsland && !newDenseRisk && !islandCooldown[root];
      if (denseWetIsland) {
        if (coherentDenseIsland) rigidCoherentIslands++;
        else rigidDenseFallbackIslands++;
      }
      if (denseWetIsland && newDenseRisk)
        islandRefreshCooldown[root] = 1;
      double safeSubstep = coherentDenseIsland
        ? R_SAFE_SUBSTEP * R_MAX_SUBSTEPS : R_SAFE_SUBSTEP;
      int count = (int)std::ceil(
        (islandPointSpeed[root] + E.scaledGravity(R_GRAVITY) * tickDt)
          / safeSubstep);
      count = imax(1, imin(R_MAX_SUBSTEPS, count));
      islandSubsteps[root] = count;
      substeps = imax(substeps, count);
    }
    for (int bi = 0; bi < n; bi++) {
      int root = ufFind(stepIslandParent, bi);
      bodySubsteps[bi] = islandSubsteps[root];
      if (islandRefreshCooldown[root])
        solverBodies[bi]->denseMicrostepTicks =
          R_DENSE_MICROSTEP_HYSTERESIS;
    }
  }
  rigidSubsteps = substeps;
  rigidCadenceMs += emscripten_get_now() - cadenceStart;
  rigidGlobalBodySteps = n * substeps;
  std::vector<Contact>& contacts = solverContactScratch;
  contacts.clear();
  int nc = 0;
  std::vector<uint8_t> actorContact(n, 0);
  std::vector<uint8_t> solidContact(n, 0);
  std::vector<int> solveParent(n), solveBodyCount(n);
  std::vector<int> contactOrder, contactRoot;
  std::vector<double> solveMaxRadius(n);
  std::vector<double> solveMinX(n), solveMinY(n), solveMaxX(n), solveMaxY(n);
  std::vector<uint64_t> solveShockKey(n);
  std::vector<uint8_t> solveHasGeneral(n);
  std::vector<uint8_t> solveHasPeerContacts(n);
  std::vector<uint8_t> solveHasSpatialForce(n);
  std::vector<uint8_t> solveHasJointBody(n);
  struct PenPt {
    double wx, wy, nx, ny, depth;
    int bk = 0;
    int childA = -1, childB = -1;
    int featureA = -1, featureB = -1;
  };
  struct TerrainGroup { Body* peer; std::vector<PenPt> points; };
  std::vector<PenPt> penAcc, terrAcc;
  std::vector<Body*> terrPeers;
  std::vector<TerrainGroup> terrGroups;
