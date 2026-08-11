namespace {
constexpr float BOX_SCALE = 0.1f;
constexpr float BOX_DT = 1.0f / 60.0f;
constexpr double BOX_BULLET_MAX_RADIUS = 192.0;

bool boxUsesBullet(const Body* body, double tipSpeed) {
  return tipSpeed > R_SAFE_SUBSTEP
      && body->maxR <= BOX_BULLET_MAX_RADIUS
      && body->collisionRects.size() <= 128;
}

constexpr float boxCellToMeters(double cells) {
  return (float)(cells * BOX_SCALE);
}

constexpr float boxCellVelocityToMeters(double cellsPerTick) {
  return (float)(cellsPerTick * BOX_SCALE / BOX_DT);
}

constexpr double boxMetersToCells(float meters) {
  return meters / BOX_SCALE;
}

constexpr double boxMetersVelocityToCells(float metersPerSecond) {
  return metersPerSecond * BOX_DT / BOX_SCALE;
}

uint64_t boxTerrainRunKey(int x0, int x1) {
  return (uint64_t)(uint32_t)x0 << 32 | (uint32_t)x1;
}

float boxRestitution(float restitutionA, int materialA,
                     float restitutionB, int materialB) {
  (void)restitutionA;
  (void)restitutionB;
  if (materialA == 1 || materialB == 1)
    return (float)R_TERRAIN_RESTITUTION;
  if (materialA == 2 && materialB == 2)
    return (float)R_BODY_RESTITUTION;
  if (materialA == 3 || materialB == 3) return 0.0f;
  return 0.05f;
}
} // namespace

RigidBodySystem::~RigidBodySystem() {
  resetBox2D();
}

void RigidBodySystem::resetBox2D() {
  boxActors.clear();
  boxContactScratch.clear();
  boxBodies.clear();
  boxWetBodies.clear();
  boxFluidRestBodies.clear();
  boxFluidDensityBodies.clear();
  boxGranularBodies.clear();
  boxGranularQuietTicks.clear();
  boxFluidSlip.clear();
  boxTerrainBodies = {{b2_nullBodyId, b2_nullBodyId}};
  boxTerrainRevisions = {{0, 0}};
  if (B2_IS_NON_NULL(boxWorld)) b2DestroyWorld(boxWorld);
  boxWorld = b2_nullWorldId;
  boxStepTick = -1;
}

void RigidBodySystem::ensureBoxWorld() {
  if (B2_IS_NON_NULL(boxWorld)) return;
  b2WorldDef worldDef = b2DefaultWorldDef();
  worldDef.gravity = {
    0.0f,
    (float)(E.scaledGravity(R_GRAVITY) * BOX_METERS_PER_CELL
            / (BOX_TICK_SECONDS * BOX_TICK_SECONDS)),
  };
  worldDef.maximumLinearSpeed = boxCellVelocityToMeters(R_MAX_SPEED);
  worldDef.restitutionThreshold =
    boxCellVelocityToMeters(R_BOUNCE_MIN_SPEED);
  worldDef.contactHertz = 60.0f;
  worldDef.contactDampingRatio = 1.0f;
  worldDef.maxContactPushSpeed = boxCellVelocityToMeters(1.5);
  worldDef.enableSleep = true;
  worldDef.enableContinuous = true;
  worldDef.restitutionCallback = boxRestitution;
  boxWorld = b2CreateWorld(&worldDef);
  b2World_EnableWarmStarting(boxWorld, true);
}

void RigidBodySystem::syncBoxTerrain(Layer& layer, int layerIndex) {
  if (boxTerrainRevisions[layerIndex] == layer.rigidTerrainRevision
      && B2_IS_NON_NULL(boxTerrainBodies[layerIndex])) return;
  if (B2_IS_NON_NULL(boxTerrainBodies[layerIndex]))
    b2DestroyBody(boxTerrainBodies[layerIndex]);

  b2BodyDef bodyDef = b2DefaultBodyDef();
  bodyDef.type = b2_staticBody;
  boxTerrainBodies[layerIndex] = b2CreateBody(boxWorld, &bodyDef);

  std::vector<BoxTerrainRect> rectangles;
  std::unordered_map<uint64_t, int> previousRuns;
  std::unordered_map<uint64_t, int> currentRuns;
  previousRuns.reserve((size_t)E.cols / 2 + 1);
  currentRuns.reserve((size_t)E.cols / 2 + 1);
  for (int y = 0; y < E.rows; y++) {
    currentRuns.clear();
    int x = layer.infinite ? 1 : 0;
    int xEnd = layer.infinite ? E.cols - 1 : E.cols;
    while (x < xEnd) {
      int k = y * E.cols + x;
      bool solid = layer.bodyOwner[k] < 0
                && E.isRigidMaterialClass(layer.grid[k]);
      if (!solid) {
        x++;
        continue;
      }
      int x0 = x;
      do {
        x++;
        if (x >= xEnd) break;
        k = y * E.cols + x;
      } while (layer.bodyOwner[k] < 0
               && E.isRigidMaterialClass(layer.grid[k]));
      int x1 = x;
      uint64_t key = boxTerrainRunKey(x0, x1);
      auto prior = previousRuns.find(key);
      if (prior != previousRuns.end()) {
        rectangles[prior->second].y1 = y + 1;
        currentRuns.emplace(key, prior->second);
      } else {
        int rectangleIndex = (int)rectangles.size();
        rectangles.push_back({x0, y, x1, y + 1});
        currentRuns.emplace(key, rectangleIndex);
      }
    }
    previousRuns.swap(currentRuns);
  }

  b2ShapeDef shapeDef = b2DefaultShapeDef();
  shapeDef.material.friction = 0.62f;
  shapeDef.material.restitution = 0.02f;
  shapeDef.material.userMaterialId = 1;
  shapeDef.filter.categoryBits = layerIndex == 0
    ? BOX_FG_TERRAIN : BOX_BG_TERRAIN;
  shapeDef.filter.maskBits = layerIndex == 0
    ? BOX_FG_BODY | BOX_JOINT_BODY
    : BOX_BG_BODY | BOX_JOINT_BODY;
  shapeDef.updateBodyMass = false;
  for (const BoxTerrainRect& rectangle : rectangles) {
    float halfWidth = boxCellToMeters(
      (rectangle.x1 - rectangle.x0) * 0.5);
    float halfHeight = boxCellToMeters(
      (rectangle.y1 - rectangle.y0) * 0.5);
    b2Vec2 center = {
      boxCellToMeters((rectangle.x0 + rectangle.x1) * 0.5),
      boxCellToMeters((rectangle.y0 + rectangle.y1) * 0.5),
    };
    b2Polygon polygon = b2MakeOffsetBox(
      halfWidth, halfHeight, center, b2MakeRot(0.0f));
    b2CreatePolygonShape(boxTerrainBodies[layerIndex], &shapeDef, &polygon);
  }
  if (!layer.infinite) {
    const BoxTerrainRect boundaries[4] = {
      {-1, -1, 0, E.rows + 1},
      {E.cols, -1, E.cols + 1, E.rows + 1},
      {0, -1, E.cols, 0},
      {0, E.rows, E.cols, E.rows + 1},
    };
    for (int boundaryIndex = 0; boundaryIndex < 4; boundaryIndex++) {
      const BoxTerrainRect& boundary = boundaries[boundaryIndex];
      b2Vec2 center = {
        boxCellToMeters((boundary.x0 + boundary.x1) * 0.5),
        boxCellToMeters((boundary.y0 + boundary.y1) * 0.5),
      };
      b2Polygon polygon = b2MakeOffsetBox(
        boxCellToMeters((boundary.x1 - boundary.x0) * 0.5),
        boxCellToMeters((boundary.y1 - boundary.y0) * 0.5),
        center, b2MakeRot(0.0f));
      b2CreatePolygonShape(
        boxTerrainBodies[layerIndex], &shapeDef, &polygon);
    }
  }
  boxTerrainRevisions[layerIndex] = layer.rigidTerrainRevision;
}

RigidBodySystem::BoxBodyBinding RigidBodySystem::createBoxBody(
    Body* body, int layerIndex) {
  b2BodyDef bodyDef = b2DefaultBodyDef();
  bodyDef.type = b2_dynamicBody;
  bodyDef.position = {
    boxCellToMeters(body->px), boxCellToMeters(body->py),
  };
  bodyDef.rotation = b2MakeRot((float)body->angle);
  bodyDef.linearVelocity = {
    boxCellVelocityToMeters(body->vx),
    boxCellVelocityToMeters(body->vy),
  };
  bodyDef.angularVelocity = (float)(body->omega / BOX_TICK_SECONDS);
  bodyDef.linearDamping = 0.03f;
  bodyDef.angularDamping = 0.08f;
  bodyDef.gravityScale = 1.0f;
  bodyDef.sleepThreshold = boxCellVelocityToMeters(R_SLEEP_LIN);
  bodyDef.userData = body;
  bodyDef.enableSleep = true;
  bodyDef.isAwake = body->awake;
  double tipSpeed = std::hypot(body->vx, body->vy)
                  + std::fabs(body->omega) * body->maxR;
  bodyDef.isBullet = boxUsesBullet(body, tipSpeed);
  b2BodyId bodyId = b2CreateBody(boxWorld, &bodyDef);

  uint64_t category = body->jointRole == 1
    ? BOX_JOINT_BODY : layerIndex == 0 ? BOX_FG_BODY : BOX_BG_BODY;
  uint64_t mask = body->jointRole == 1
    ? BOX_FG_TERRAIN | BOX_BG_TERRAIN | BOX_FG_BODY | BOX_BG_BODY
      | BOX_JOINT_BODY | BOX_ACTOR
    : layerIndex == 0
      ? BOX_FG_TERRAIN | BOX_FG_BODY | BOX_JOINT_BODY | BOX_ACTOR
      : BOX_BG_TERRAIN | BOX_BG_BODY | BOX_JOINT_BODY;
  bool icy = body->material == ICE;
  if (!body->cellMaterials.empty()) {
    int iceCells = 0, materialCells = 0;
    for (uint8_t material : body->cellMaterials) {
      if (material == EMPTY) continue;
      materialCells++;
      if (material == ICE) iceCells++;
    }
    icy = materialCells > 0 && iceCells * 2 >= materialCells;
  }
  b2ShapeDef shapeDef = b2DefaultShapeDef();
  shapeDef.userData = body;
  shapeDef.material.friction = icy ? 0.08f : 0.52f;
  shapeDef.material.restitution = (float)R_BODY_RESTITUTION;
  shapeDef.material.userMaterialId = 2;
  shapeDef.filter.categoryBits = category;
  shapeDef.filter.maskBits = mask;
  shapeDef.density = 1.0f;
  shapeDef.updateBodyMass = false;
  for (const BodyCollisionRect& rectangle : body->collisionRects) {
    double width = rectangle.x1 - rectangle.x0;
    double height = rectangle.y1 - rectangle.y0;
    b2Vec2 center = {
      boxCellToMeters(body->offsetX
        + (rectangle.x0 + rectangle.x1) * 0.5 - 0.5),
      boxCellToMeters(body->offsetY
        + (rectangle.y0 + rectangle.y1) * 0.5 - 0.5),
    };
    b2Polygon polygon = b2MakeOffsetBox(
      boxCellToMeters(width * 0.5 + R_CONTACT_SKIN),
      boxCellToMeters(height * 0.5 + R_CONTACT_SKIN),
      center, b2MakeRot(0.0f));
    b2CreatePolygonShape(bodyId, &shapeDef, &polygon);
  }
  // Let Box2D derive its per-body shape extents for speculative contacts and
  // CCD, then replace only the aggregate mass properties with the material-
  // weighted values from the sand body.
  b2Body_ApplyMassFromShapes(bodyId);
  b2MassData massData{};
  massData.mass = body->invMass > 0 ? (float)(1.0 / body->invMass) : 1.0f;
  massData.center = {0.0f, 0.0f};
  massData.rotationalInertia = body->invInertia > 0
    ? (float)((1.0 / body->invInertia)
              * BOX_METERS_PER_CELL * BOX_METERS_PER_CELL)
    : 1.0f;
  b2Body_SetMassData(bodyId, massData);
  return {
    bodyId, body->id, body->geometryRevision,
    (uint8_t)layerIndex, body->jointRole,
    body->px, body->py, body->angle,
    body->vx, body->vy, body->omega,
  };
}

void RigidBodySystem::syncBoxBodies() {
  std::unordered_map<Body*, int> activeBodies;
  activeBodies.reserve(E.fg.bodies.size() + E.bg.bodies.size());
  for (Body* body : E.fg.bodies)
    if (body->jointRole != 2) activeBodies.emplace(body, 0);
  if (E.bgEnabled)
    for (Body* body : E.bg.bodies)
      if (body->jointRole != 2) activeBodies.emplace(body, 1);

  bool rosterChanged = false;
  for (auto binding = boxBodies.begin(); binding != boxBodies.end();) {
    if (activeBodies.count(binding->first) == 0) {
      boxGranularQuietTicks.erase(binding->first);
      if (B2_IS_NON_NULL(binding->second.id)
          && b2Body_IsValid(binding->second.id))
        b2DestroyBody(binding->second.id);
      binding = boxBodies.erase(binding);
      rosterChanged = true;
    } else {
      ++binding;
    }
  }

  for (const auto& active : activeBodies) {
    Body* body = active.first;
    int layerIndex = active.second;
    auto found = boxBodies.find(body);
    bool recreate = found == boxBodies.end()
      || found->second.bodyId != body->id
      || found->second.geometryRevision != body->geometryRevision
      || found->second.layer != layerIndex
      || found->second.jointRole != body->jointRole;
    if (recreate) {
      boxGranularQuietTicks.erase(body);
      if (found != boxBodies.end()) {
        if (B2_IS_NON_NULL(found->second.id)
            && b2Body_IsValid(found->second.id))
          b2DestroyBody(found->second.id);
        boxBodies.erase(found);
      }
      BoxBodyBinding binding = createBoxBody(body, layerIndex);
      if (!bodyFullyInsideLoadedWindow(body)) b2Body_Disable(binding.id);
      boxBodies.emplace(body, binding);
      rosterChanged = true;
      continue;
    }
    BoxBodyBinding& box = found->second;
    bool complete = bodyFullyInsideLoadedWindow(body);
    if (!complete) {
      if (b2Body_IsEnabled(box.id)) b2Body_Disable(box.id);
      continue;
    }
    bool wasDisabled = !b2Body_IsEnabled(box.id);
    if (wasDisabled) b2Body_Enable(box.id);
    if (wasDisabled || box.px != body->px || box.py != body->py
        || box.angle != body->angle) {
      b2Body_SetTransform(box.id,
        {boxCellToMeters(body->px), boxCellToMeters(body->py)},
        b2MakeRot((float)body->angle));
    }
    if (wasDisabled || box.vx != body->vx || box.vy != body->vy) {
      b2Body_SetLinearVelocity(box.id, {
        boxCellVelocityToMeters(body->vx),
        boxCellVelocityToMeters(body->vy),
      });
    }
    if (wasDisabled || box.omega != body->omega)
      b2Body_SetAngularVelocity(
        box.id, (float)(body->omega / BOX_TICK_SECONDS));
    bool dampStructureContact = body->maxR > BOX_BULLET_MAX_RADIUS
      && body->rasterMayOverlapSolid;
    b2Body_SetLinearDamping(
      box.id, dampStructureContact ? 1.0f : 0.03f);
    b2Body_SetAngularDamping(
      box.id, dampStructureContact ? 2.5f : 0.08f);
    double tipSpeed = std::hypot(body->vx, body->vy)
                    + std::fabs(body->omega) * body->maxR;
    b2Body_SetBullet(box.id, boxUsesBullet(body, tipSpeed));
    if (body->awake != b2Body_IsAwake(box.id))
      b2Body_SetAwake(box.id, body->awake);
    box.px = body->px;
    box.py = body->py;
    box.angle = body->angle;
    box.vx = body->vx;
    box.vy = body->vy;
    box.omega = body->omega;
  }
  if (rosterChanged) boxTerrainRevisions = {{0, 0}};
}

void RigidBodySystem::createBoxActors() {
  boxActors.clear();
  size_t actorCount = 0;
  for (const Player& player : E.psys.players)
    if (player.active && player.alive) actorCount++;
  for (const Creature& creature : E.creatures.creatures)
    if (creature.alive) actorCount++;
  boxActors.reserve(actorCount);

  auto addActor = [&](double x, double y, double width, double height,
                      double vx, double vy, Player* player,
                      Creature* creature) {
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_kinematicBody;
    bodyDef.position = {
      boxCellToMeters(x + width * 0.5),
      boxCellToMeters(y + height * 0.5),
    };
    bodyDef.linearVelocity = {
      boxCellVelocityToMeters(vx), boxCellVelocityToMeters(vy),
    };
    bodyDef.fixedRotation = true;
    b2BodyId bodyId = b2CreateBody(boxWorld, &bodyDef);
    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.material.friction = 0.60f;
    shapeDef.material.userMaterialId = 3;
    shapeDef.filter.categoryBits = BOX_ACTOR;
    shapeDef.filter.maskBits = BOX_FG_BODY | BOX_JOINT_BODY;
    shapeDef.updateBodyMass = false;
    constexpr double actorSkin = 0.25;
    b2Polygon polygon = b2MakeBox(
      boxCellToMeters(width * 0.5 + actorSkin),
      boxCellToMeters(height * 0.5 + actorSkin));
    b2CreatePolygonShape(bodyId, &shapeDef, &polygon);
    boxActors.push_back({bodyId, player, creature});
  };

  for (Player& player : E.psys.players) {
    if (!player.active || !player.alive) continue;
    addActor(player.px, player.py, player.w, player.h,
             player.vx, player.vy, &player, nullptr);
  }
  for (Creature& creature : E.creatures.creatures) {
    if (!creature.alive) continue;
    const CreatureSpecies& species = E.creatures.species(creature);
    addActor(creature.wx - E.fg.worldOffsetX,
             creature.wy - E.fg.worldOffsetY,
             species.w, species.h, creature.vx, creature.vy,
             nullptr, &creature);
  }
}

void RigidBodySystem::finishBoxActors() {
  for (const BoxActorBinding& actor : boxActors) {
    int capacity = b2Body_GetContactCapacity(actor.id);
    boxContactScratch.resize((size_t)capacity);
    int contactCount = capacity > 0
      ? b2Body_GetContactData(
          actor.id, boxContactScratch.data(), capacity)
      : 0;
    double crushImpulse = 0;
    for (int contactIndex = 0; contactIndex < contactCount; contactIndex++) {
      const b2Manifold& manifold = boxContactScratch[contactIndex].manifold;
      for (int pointIndex = 0; pointIndex < manifold.pointCount; pointIndex++)
        crushImpulse += manifold.points[pointIndex].totalNormalImpulse
                      / (BOX_METERS_PER_CELL / BOX_TICK_SECONDS);
    }
    if (crushImpulse >= ACTOR_CRUSH_IMPULSE) {
      if (actor.player) {
        Player& player = *actor.player;
        if (E.psys.playerBoxHits(
              player.px, player.py + 0.25, player.w, player.h))
          E.psys.crushPlayer(player);
      } else if (actor.creature) {
        Creature& creature = *actor.creature;
        const CreatureSpecies& species = E.creatures.species(creature);
        if (E.creatures.boxHitsSolid(
              creature.wx, creature.wy + 0.25, species.w, species.h))
          E.creatures.crushCreature(creature);
      }
    }
    b2DestroyBody(actor.id);
  }
  boxActors.clear();
}

void RigidBodySystem::applyBoxFluidCoupling() {
  double gravityPerTick = E.scaledGravity(R_GRAVITY);
  b2World_SetGravity(boxWorld, {
    0.0f,
    (float)(gravityPerTick * BOX_METERS_PER_CELL
            / (BOX_TICK_SECONDS * BOX_TICK_SECONDS)),
  });
  struct PriorMotion {
    double vx, vy, omega;
  };
  std::unordered_map<Body*, PriorMotion> priorMotion;
  priorMotion.reserve(boxBodies.size());
  std::vector<Body*> foregroundBodies;
  std::vector<Body*> backgroundBodies;
  boxWetBodies.clear();
  boxFluidRestBodies.clear();
  boxFluidDensityBodies.clear();
  boxGranularBodies.clear();
  boxFluidSlip.clear();
  foregroundBodies.reserve(E.fg.bodies.size());
  backgroundBodies.reserve(E.bg.bodies.size());
  for (Body* body : E.fg.bodies) {
    if (body->jointRole == 2) continue;
    if (!bodyFullyInsideLoadedWindow(body)) continue;
    priorMotion.emplace(body,
      PriorMotion{body->vx, body->vy, body->omega});
    if (body->awake) body->vy += gravityPerTick;
    body->hadContact = false;
    foregroundBodies.push_back(body);
  }
  if (E.bgEnabled)
    for (Body* body : E.bg.bodies) {
      if (body->jointRole == 2) continue;
      if (!bodyFullyInsideLoadedWindow(body)) continue;
      priorMotion.emplace(body,
        PriorMotion{body->vx, body->vy, body->omega});
      if (body->awake) body->vy += gravityPerTick;
      body->hadContact = false;
      backgroundBodies.push_back(body);
    }

  double fluidStart = emscripten_get_now();
  bool coupled = false;
  Layer* savedLayer = E.L;
  if (!foregroundBodies.empty()) {
    E.useLayer(&E.fg);
    bool layerCoupled = coupleLiquids(foregroundBodies, 1.0);
    coupled = layerCoupled || coupled;
    if (layerCoupled) {
      for (int bodyIndex = 0;
           bodyIndex < (int)foregroundBodies.size(); bodyIndex++) {
        Body* body = foregroundBodies[bodyIndex];
        if (body->hadContact) boxWetBodies.insert(body);
        bool densityEquilibrium =
          bodyIndex < (int)fluidBodyDensityEquilibrium.size()
          && fluidBodyDensityEquilibrium[bodyIndex];
        if ((bodyIndex < (int)fluidBodySurface.size()
             && fluidBodySurface[bodyIndex]) || densityEquilibrium)
          boxFluidRestBodies.insert(body);
        if (densityEquilibrium) boxFluidDensityBodies.insert(body);
        if (bodyIndex < (int)fluidBodyMaxSlip.size())
          boxFluidSlip[body] = fluidBodyMaxSlip[bodyIndex];
      }
    }
  }
  if (!backgroundBodies.empty()) {
    E.useLayer(&E.bg);
    bool layerCoupled = coupleLiquids(backgroundBodies, 1.0);
    coupled = layerCoupled || coupled;
    if (layerCoupled) {
      for (int bodyIndex = 0;
           bodyIndex < (int)backgroundBodies.size(); bodyIndex++) {
        Body* body = backgroundBodies[bodyIndex];
        if (body->hadContact) boxWetBodies.insert(body);
        bool densityEquilibrium =
          bodyIndex < (int)fluidBodyDensityEquilibrium.size()
          && fluidBodyDensityEquilibrium[bodyIndex];
        if ((bodyIndex < (int)fluidBodySurface.size()
             && fluidBodySurface[bodyIndex]) || densityEquilibrium)
          boxFluidRestBodies.insert(body);
        if (densityEquilibrium) boxFluidDensityBodies.insert(body);
        if (bodyIndex < (int)fluidBodyMaxSlip.size())
          boxFluidSlip[body] = fluidBodyMaxSlip[bodyIndex];
      }
    }
  }
  E.useLayer(savedLayer);
  auto coupleGranularSupport = [&](Body* body, Layer& layer) {
    double supportedFraction = granularBearingFraction(body, layer);
    if (supportedFraction <= 0) return false;
    body->vy -= gravityPerTick * supportedFraction;
    body->vx *= 1.0 - R_GRANULAR_DRAG * supportedFraction;
    body->omega *= 1.0 - R_GRANULAR_ANG_DRAG * supportedFraction;
    boxGranularBodies.insert(body);
    body->hadContact = true;
    if (supportedFraction >= 1.0 - 1e-9) {
      if (body->vy > -R_GRANULAR_REST_BAND)
        body->vy *= R_GRANULAR_REST_DAMP;
      if (std::fabs(body->vy) < R_GRANULAR_ZERO_VY) body->vy = 0;
    }
    return true;
  };
  for (Body* body : foregroundBodies)
    coupled = coupleGranularSupport(body, E.fg) || coupled;
  for (Body* body : backgroundBodies)
    coupled = coupleGranularSupport(body, E.bg) || coupled;
  fluidInitialMs = emscripten_get_now() - fluidStart;
  rigidFluidCoupleMs += fluidInitialMs;

  for (const auto& prior : priorMotion) {
    Body* body = prior.first;
    double predictedVy = prior.second.vy
      + (body->awake ? gravityPerTick : 0);
    double coupledDelta = coupled ? body->vy - predictedVy : 0;
    double coupledVx = body->vx;
    double coupledVy = prior.second.vy + coupledDelta;
    double coupledOmega = body->omega;
    bool motionChanged = coupledVx != prior.second.vx
      || coupledVy != prior.second.vy
      || coupledOmega != prior.second.omega;
    body->vx = coupledVx;
    body->vy = coupledVy;
    body->omega = coupledOmega;
    auto box = boxBodies.find(body);
    if (box == boxBodies.end() || !motionChanged) continue;
    b2Body_SetLinearVelocity(box->second.id, {
      boxCellVelocityToMeters(body->vx),
      boxCellVelocityToMeters(body->vy),
    });
    b2Body_SetAngularVelocity(
      box->second.id, (float)(body->omega / BOX_TICK_SECONDS));
    b2Body_SetAwake(box->second.id, body->awake);
  }
}

void RigidBodySystem::writeBackBoxBodies() {
  rigidContacts = 0;
  rigidMaxContactDepth = 0;
  std::array<std::vector<Body*>, 2> correctorBodies;
  for (auto& entry : boxBodies) {
    Body* body = entry.first;
    BoxBodyBinding& box = entry.second;
    if (!b2Body_IsEnabled(box.id)) continue;
    bool wasAwake = body->awake;
    b2Vec2 position = b2Body_GetPosition(box.id);
    b2Rot rotation = b2Body_GetRotation(box.id);
    b2Vec2 velocity = b2Body_GetLinearVelocity(box.id);
    float angularVelocity = b2Body_GetAngularVelocity(box.id);
    Layer& layer = box.layer == 0 ? E.fg : E.bg;
    if (layer.infinite) {
      double px = boxMetersToCells(position.x);
      double minX = E.cols, maxX = 0;
      for (const BodyCollisionRect& rectangle : body->collisionRects) {
        double lx0 = body->offsetX + rectangle.x0 - 0.5;
        double lx1 = body->offsetX + rectangle.x1 - 0.5;
        double ly0 = body->offsetY + rectangle.y0 - 0.5;
        double ly1 = body->offsetY + rectangle.y1 - 0.5;
        auto includeX = [&](double lx, double ly) {
          double x = px + lx * rotation.c - ly * rotation.s;
          minX = std::fmin(minX, x);
          maxX = std::fmax(maxX, x);
        };
        includeX(lx0, ly0);
        includeX(lx1, ly0);
        includeX(lx1, ly1);
        includeX(lx0, ly1);
      }
      constexpr double edgeInset = 1e-3;
      double correctionX = minX < edgeInset ? edgeInset - minX
        : maxX > E.cols - edgeInset ? E.cols - edgeInset - maxX : 0;
      if (correctionX != 0) {
        px += correctionX;
        position.x = boxCellToMeters(px);
        if ((correctionX > 0 && velocity.x < 0)
            || (correctionX < 0 && velocity.x > 0))
          velocity.x = 0;
        b2Body_SetTransform(box.id, position, rotation);
        b2Body_SetLinearVelocity(box.id, velocity);
      }
    }
    body->px = boxMetersToCells(position.x);
    body->py = boxMetersToCells(position.y);
    body->angle = b2Rot_GetAngle(rotation);
    body->vx = boxMetersVelocityToCells(velocity.x);
    body->vy = boxMetersVelocityToCells(velocity.y);
    body->omega = angularVelocity * BOX_TICK_SECONDS;
    body->awake = b2Body_IsAwake(box.id);
    auto resetBakeSampling = [&]() {
      body->bakeRasterStableTicks = 0;
      body->bakeRasterSignature = 0;
      body->bakeRasterSampleTag = UINT8_MAX;
    };
    if (wasAwake && !body->awake) resetBakeSampling();
    body->cs = rotation.c;
    body->sn = rotation.s;
    bool granularContact = boxGranularBodies.count(body) != 0;
    body->hadContact = boxWetBodies.count(body) != 0 || granularContact;
    body->rasterMayOverlapSolid = false;
    body->maxDepth = 0;
    body->sleepSupports.clear();

    int capacity = b2Body_GetContactCapacity(box.id);
    boxContactScratch.resize((size_t)capacity);
    int contactCount = capacity > 0
      ? b2Body_GetContactData(box.id, boxContactScratch.data(), capacity)
      : 0;
    rigidContacts += contactCount;
    for (int contactIndex = 0; contactIndex < contactCount; contactIndex++) {
      const b2ContactData& contact = boxContactScratch[contactIndex];
      b2Filter filterA = b2Shape_GetFilter(contact.shapeIdA);
      b2Filter filterB = b2Shape_GetFilter(contact.shapeIdB);
      b2BodyId bodyAId = b2Shape_GetBody(contact.shapeIdA);
      bool bodyIsA = b2Body_GetUserData(bodyAId) == body;
      b2ShapeId otherShape = bodyIsA ? contact.shapeIdB : contact.shapeIdA;
      b2Filter otherFilter = bodyIsA ? filterB : filterA;
      b2BodyId otherBodyId = b2Shape_GetBody(otherShape);
      Body* otherBody = static_cast<Body*>(b2Body_GetUserData(otherBodyId));
      bool solidContact = (otherFilter.categoryBits
        & (BOX_FG_TERRAIN | BOX_BG_TERRAIN | BOX_FG_BODY
           | BOX_BG_BODY | BOX_JOINT_BODY)) != 0;
      if (solidContact) body->rasterMayOverlapSolid = true;
      for (int pointIndex = 0;
           pointIndex < contact.manifold.pointCount; pointIndex++) {
        const b2ManifoldPoint& point = contact.manifold.points[pointIndex];
        body->hadContact = body->hadContact
          || point.totalNormalImpulse > 0 || point.separation <= 0;
        double depth = std::fmax(0.0,
          -boxMetersToCells(point.separation));
        body->maxDepth = std::fmax(body->maxDepth, depth);
        rigidMaxContactDepth = std::fmax(rigidMaxContactDepth, depth);
        if (body->sleepSupports.size() >= 8 || !solidContact) continue;
        int owner = otherBody ? otherBody->id : -1;
        uint8_t supportLayer = (otherFilter.categoryBits
          & (BOX_BG_TERRAIN | BOX_BG_BODY)) != 0 ? 1 : 0;
        body->sleepSupports.push_back({
          boxMetersToCells(point.point.x),
          boxMetersToCells(point.point.y), owner, supportLayer,
        });
      }
    }
    bool granularRest = granularContact;
    double speedSquared = body->vx * body->vx + body->vy * body->vy;
    bool fluidRest = boxFluidRestBodies.count(body) != 0;
    if (boxFluidDensityBodies.count(body) != 0
        && speedSquared < R_BOUNCE_MIN_SPEED * R_BOUNCE_MIN_SPEED
        && std::fabs(body->omega) < R_SETTLE_ANG * 2) {
      body->vx *= 0.25;
      body->vy *= 0.25;
      body->omega *= 0.25;
      speedSquared = body->vx * body->vx + body->vy * body->vy;
    }
    if (fluidRest && std::fabs(body->vy) < R_SETTLE_LIN
        && body->maxDepth <= R_REST_DEPTH) {
      body->vy *= R_FLUID_REST_DAMP;
      int shortSide = imin(body->w, body->h);
      int longSide = imax(body->w, body->h);
      if (shortSide > 0 && longSide >= shortSide * 8
          && std::fabs(body->vx) < R_SETTLE_LIN
          && std::fabs(body->omega) < R_SETTLE_ANG) {
        body->vx *= R_FLUID_SLENDER_REST_DAMP;
        body->vy *= R_FLUID_SLENDER_REST_DAMP;
        body->omega *= R_FLUID_REST_DAMP;
      }
      speedSquared = body->vx * body->vx + body->vy * body->vy;
    }
    if (!body->awake) {
      body->vx = body->vy = body->omega = 0;
      body->stillTicks = imax(body->stillTicks, R_SLEEP_TICKS);
    } else if (fluidRest
               && speedSquared < R_SETTLE_LIN * R_SETTLE_LIN
               && std::fabs(body->omega) < R_SETTLE_ANG) {
      body->stillTicks++;
    } else if (fluidRest && body->stillTicks > 0) {
      body->stillTicks--;
    } else if (body->hadContact
               && speedSquared < (boxWetBodies.count(body)
                    ? R_FLUID_SLEEP_LIN * R_FLUID_SLEEP_LIN
                    : R_SLEEP_LIN * R_SLEEP_LIN)
               && std::fabs(body->omega) < R_SLEEP_ANG) {
      body->stillTicks++;
    } else {
      body->stillTicks = 0;
    }
    bool granularQuiet = speedSquared < R_GRANULAR_REST_BAND
        * R_GRANULAR_REST_BAND
      && std::fabs(body->omega) < R_SETTLE_ANG;
    int& granularTicks = boxGranularQuietTicks[body];
    if (granularRest && granularQuiet)
      granularTicks = imin(R_SLEEP_TICKS, granularTicks + 1);
    else if (granularTicks > 0 && granularQuiet)
      granularTicks--;
    else
      granularTicks = 0;
    if ((fluidRest && body->stillTicks >= R_FLUID_SLEEP_TICKS)
        || granularTicks >= R_SLEEP_TICKS) {
      if (granularTicks >= R_SLEEP_TICKS)
        body->bakeSupportedPoseTicks = R_BAKE_RASTER_TICKS;
      if (body->awake) resetBakeSampling();
      body->awake = false;
      body->vx = body->vy = body->omega = 0;
      b2Body_SetAwake(box.id, false);
    }
    double travel = std::hypot(body->px - box.px, body->py - box.py)
                  + std::fabs(body->angle - box.angle) * body->maxR;
    if (body->awake && travel > R_FLUID_CORRECTOR_TRAVEL) {
      bool wasWet = boxWetBodies.count(body) != 0;
      double slip = 0;
      auto slipEntry = boxFluidSlip.find(body);
      if (slipEntry != boxFluidSlip.end()) slip = slipEntry->second;
      int cadence = boxBodies.size() >= (size_t)R_DENSE_RIGID_CARGO_BODIES
        ? R_FLUID_DENSE_CORRECTOR_CADENCE
        : boxBodies.size() >= (size_t)R_FLUID_CORRECTOR_BATCH_BODIES
          ? R_FLUID_CORRECTOR_CADENCE : 1;
      bool correctionDue = cadence == 1
        || body->id % cadence == E.tick % cadence;
      if (!wasWet || (slip >= R_FLUID_CORRECTOR_SLIP && correctionDue))
        correctorBodies[box.layer].push_back(body);
    }
    box.px = body->px;
    box.py = body->py;
    box.angle = body->angle;
    box.vx = body->vx;
    box.vy = body->vy;
    box.omega = body->omega;
    if (body->jointRole == 1) syncJointFollower(body);
  }
  Layer* savedLayer = E.L;
  for (int layerIndex = 0; layerIndex < 2; layerIndex++) {
    if (correctorBodies[layerIndex].empty()) continue;
    E.useLayer(layerIndex == 0 ? &E.fg : &E.bg);
    double correctorStart = emscripten_get_now();
    if (coupleLiquids(correctorBodies[layerIndex], 0)) {
      fluidCorrectorPasses++;
      fluidCorrectorBodyCount += (int)correctorBodies[layerIndex].size();
      for (Body* body : correctorBodies[layerIndex]) {
        auto box = boxBodies.find(body);
        if (box == boxBodies.end()) continue;
        b2Body_SetLinearVelocity(box->second.id, {
          boxCellVelocityToMeters(body->vx),
          boxCellVelocityToMeters(body->vy),
        });
        b2Body_SetAngularVelocity(
          box->second.id, (float)(body->omega / BOX_TICK_SECONDS));
        box->second.vx = body->vx;
        box->second.vy = body->vy;
        box->second.omega = body->omega;
      }
    }
    fluidCorrectorMs += emscripten_get_now() - correctorStart;
  }
  E.useLayer(savedLayer);
  b2Counters counters = b2World_GetCounters(boxWorld);
  b2Profile profile = b2World_GetProfile(boxWorld);
  rigidContacts = counters.contactCount;
  rigidIslands = counters.islandCount;
  rigidGlobalBodySteps = counters.bodyCount;
  rigidContactMs += profile.pairs + profile.collide;
  rigidPairContactMs += profile.pairs;
  rigidTerrainContactMs += profile.collide;
  rigidIntegrateMs += profile.integrateVelocities + profile.integratePositions;
  rigidWarmStarted = b2World_IsWarmStartingEnabled(boxWorld)
    ? counters.contactCount : 0;
}
