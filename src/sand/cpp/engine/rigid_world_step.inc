// Collision shapes retain the canonical body's local origin. Each layer has
// its own occupancy, while impulses and integration use one physical body.
Layer* RigidBodySystem::bodyLayer(const Body* body) const {
  return body->solverLayer == 0 ? &E.fg : &E.bg;
}
RigidBodySystem::MovementState& RigidBodySystem::movement() {
  return movements[E.L == &E.bg ? 1 : 0];
}
Body* RigidBodySystem::collisionShape(Body* body, int layer) {
  if (!(bodyLayerMask(body) & (1 << layer))) return nullptr;
  if (body->jointRole != 1) return body;
  uint64_t key = ((uint64_t)(uint32_t)body->id << 1) | layer;
  LayerShape& cached = layerShapes[key];
  Body& shape = cached.body;
  if (cached.revision != body->geometryRevision) {
    shape = Body{};
    shape.id = body->id;
    shape.w = body->w; shape.h = body->h;
    shape.offsetX = body->offsetX; shape.offsetY = body->offsetY;
    shape.material = body->material;
    shape.density = body->density;
    shape.cellMaterials = layer == 0
      ? body->cellMaterials : body->jointPeerMaterials;
    shape.occ.resize(shape.cellMaterials.size());
    for (size_t i = 0; i < shape.occ.size(); i++)
      shape.occ[i] = shape.cellMaterials[i] != EMPTY;
    computeDerived(&shape, false, false);
    cached.revision = body->geometryRevision;
  }
  if (shape.points.empty()) return nullptr;
  shape.geometryRevision = body->geometryRevision;
  shape.solverBody = body;
  shape.solverLayer = body->solverLayer;
  shape.idx = body->idx;
  shape.px = body->px; shape.py = body->py; shape.angle = body->angle;
  shape.vx = body->vx; shape.vy = body->vy; shape.omega = body->omega;
  shape.cs = std::cos(body->angle); shape.sn = std::sin(body->angle);
  shape.awake = body->awake;
  shape.invMass = body->invMass; shape.invInertia = body->invInertia;
  shape.sweepMargin = body->sweepMargin;
  shape.aabbX0 = body->aabbX0; shape.aabbY0 = body->aabbY0;
  shape.aabbX1 = body->aabbX1; shape.aabbY1 = body->aabbY1;
  shape.rasterMayOverlapSolid = body->rasterMayOverlapSolid;
  return &shape;
}

void RigidBodySystem::moveWorldBodies() {
  bool active = false;
  for (int layer = 0; layer < (E.bgEnabled ? 2 : 1); layer++) {
    Layer* lay = layer == 0 ? &E.fg : &E.bg;
    for (Body* body : lay->bodies) {
      body->solverLayer = layer;
      active = active || (body->jointRole != 2 && body->awake);
    }
    active = active || lay->sleepingBodySupportDirty
      || lay->groundDirty || lay->groundContentDirty || lay->looseGroundDirty;
  }
  if (!active) return;
  for (auto it = layerShapes.begin(); it != layerShapes.end();) {
    int id = (int)(it->first >> 1);
    bool live = false;
    for (Body* body : E.fg.bodies)
      if (body->id == id && body->jointRole == 1) { live = true; break; }
    if (!live) it = layerShapes.erase(it);
    else ++it;
  }
  for (int layer = 0; layer < (E.bgEnabled ? 2 : 1); layer++) {
    Engine::ActiveLayerScope scope(E, layer == 0 ? &E.fg : &E.bg);
    prepareBodyMovement();
  }
  {
    Engine::ActiveLayerScope scope(E, &E.fg);
    double start = emscripten_get_now();
    rigidStep(1.0);
    rigidCoreMs += emscripten_get_now() - start;
    captureTracePose(6);
  }
  for (Body* body : E.fg.bodies)
    if (body->jointRole == 1) syncJointFollower(body);
  for (int layer = 0; layer < (E.bgEnabled ? 2 : 1); layer++) {
    Engine::ActiveLayerScope scope(E, layer == 0 ? &E.fg : &E.bg);
    commitBodyMovement();
  }
  // Erosion may split a joint object. Both owner rasters must be committed
  // before any operation can change its component membership or body roster.
  for (int layer = 0; layer < (E.bgEnabled ? 2 : 1); layer++) {
    Engine::ActiveLayerScope scope(E, layer == 0 ? &E.fg : &E.bg);
    if (movement().prepared) erodeBodies(movement().moveCells);
    if (layer == 1) erodeBodies(E.bg.passiveBodyCells, true);
  }
}
