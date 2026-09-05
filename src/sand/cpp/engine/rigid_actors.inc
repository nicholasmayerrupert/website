// Gameplay advances actors first. Proxies add finite-mass contact impulses and
// swept displacement without integrating that gameplay movement a second time.
bool RigidBodySystem::actorBoxBlocked(
    double x, double y, int w, int h, bool bodies) const {
  int x0 = (int)std::floor(x), x1 = (int)std::floor(x + w - 1e-6);
  int y0 = (int)std::floor(y), y1 = (int)std::floor(y + h - 1e-6);
  for (int cy = y0; cy <= y1; cy++) for (int cx = x0; cx <= x1; cx++) {
    if (cy >= E.rows) return true;
    if (cx < 0 || cx >= E.cols || cy < 0) continue;
    int k = cy * E.cols + cx;
    if (!bodies && E.fg.bodyOwner[k] >= 0) continue;
    if (E.isBlockingForActor(E.fg.grid[k])) return true;
  }
  return false;
}

bool RigidBodySystem::moveActorBox(
    double& x, double& y, int w, int h, double dx, double dy) {
  bool blocked = false;
  int steps = imax(1, (int)std::ceil(std::fmax(std::fabs(dx), std::fabs(dy)) / 0.25));
  dx /= steps;
  dy /= steps;
  for (int i = 0; i < steps; i++) {
    if (dx != 0 && !actorBoxBlocked(x + dx, y, w, h, false)) x += dx;
    else if (dx != 0) { blocked = true; dx = 0; }
    if (dy != 0 && !actorBoxBlocked(x, y + dy, w, h, false)) y += dy;
    else if (dy != 0) { blocked = true; dy = 0; }
  }
  return blocked;
}

void RigidBodySystem::prepareActorSubstep(StepState& step, double dt) {
  for (auto& proxy : step.actorProxies) {
    Body& body = proxy.body;
    body.pvx = body.pvy = body.pw = 0;
    double margin = std::hypot(body.vx, body.vy) * dt + R_CONTACT_SKIN + 0.5;
    body.sweepMargin = margin;
    rigidBodyBounds(&body, margin, body.aabbX0, body.aabbY0,
                    body.aabbX1, body.aabbY1);
  }
  std::sort(step.actorProxyOrder.begin(), step.actorProxyOrder.end(),
            [&](int a, int b) {
    const Body& first = step.actorProxies[a].body;
    const Body& second = step.actorProxies[b].body;
    return first.aabbX0 != second.aabbX0 ? first.aabbX0 < second.aabbX0
                                       : first.id < second.id;
  });
}

void RigidBodySystem::integrateActorSubstep(StepState& step, double dt) {
  for (auto& proxy : step.actorProxies) {
    Body& body = proxy.body;
    double dx = (body.vx + body.pvx) * dt;
    double dy = (body.vy + body.pvy) * dt;
    if (proxy.support) {
      Body* support = proxy.support;
      double cs = std::cos(support->angle), sn = std::sin(support->angle);
      double wx = support->px + proxy.supportX * cs - proxy.supportY * sn;
      double wy = support->py + proxy.supportX * sn + proxy.supportY * cs;
      dx += wx - proxy.supportWorldX;
      dy += wy - proxy.supportWorldY;
      proxy.supportWorldX = wx;
      proxy.supportWorldY = wy;
    }
    double x = body.px - body.w * 0.5, y = body.py - body.h * 0.5;
    proxy.blocked |= moveActorBox(x, y, body.w, body.h, dx, dy);
    body.px = x + body.w * 0.5;
    body.py = y + body.h * 0.5;
  }
}

void RigidBodySystem::finalizeActorStep(StepState& step) {
  for (auto& proxy : step.actorProxies) {
    Body& body = proxy.body;
    double x = body.px - body.w * 0.5, y = body.py - body.h * 0.5;
    double vx = rigidContactVx(&body) - proxy.supportVx;
    double vy = rigidContactVy(&body) - proxy.supportVy;
    bool crush = proxy.blocked && proxy.crushImpulse >= ACTOR_CRUSH_IMPULSE;
    if (proxy.player) {
      Player& player = *proxy.player;
      player.px = x;
      player.py = y;
      player.vx = vx;
      player.vy = vy;
      if (proxy.support) player.grounded = true;
      if (crush) E.psys.crushPlayer(player);
    } else {
      Creature& creature = *proxy.creature;
      creature.wx = x + E.fg.worldOffsetX;
      creature.wy = y + E.fg.worldOffsetY;
      creature.vx = vx;
      creature.vy = vy;
      if (proxy.support) creature.grounded = true;
      if (crush) E.creatures.crushCreature(creature);
    }
  }
}

// Final raster correction belongs to the actor, never the terrain. A trapped
// actor takes bounded crush damage and searches for a clear nearby AABB.
void RigidBodySystem::resolveActorRasterContacts() {
  if (E.fg.bodies.empty()) return;
  auto resolve = [&](double& x, double& y, int w, int h,
                     Player* player, Creature* creature) {
    bool overlap = false;
    int x0 = (int)std::floor(x), y0 = (int)std::floor(y);
    int x1 = (int)std::floor(x + w - 1e-6);
    int y1 = (int)std::floor(y + h - 1e-6);
    for (int cy = imax(0, y0); cy <= imin(E.rows - 1, y1); cy++)
      for (int cx = imax(0, x0); cx <= imin(E.cols - 1, x1); cx++)
        overlap |= E.fg.bodyOwner[cy * E.cols + cx] >= 0;
    if (!overlap) return;
    auto clear = [&](double nx, double ny) {
      if (actorBoxBlocked(nx, ny, w, h, true)) return false;
      x = nx;
      y = ny;
      return true;
    };
    // Sub-cell raster rounding is corrected before treating contact as crush.
    for (double distance = 0.25; distance <= 1.0; distance += 0.25)
      if (clear(x, y - distance) || clear(x - distance, y)
          || clear(x + distance, y) || clear(x, y + distance)) return;
    if (player) E.psys.crushPlayer(*player);
    else E.creatures.crushCreature(*creature);
    int reach = imax(w, h) * 4;
    for (int radius = 1; radius <= reach; radius++) {
      if (clear(x, y - radius) || clear(x - radius, y)
          || clear(x + radius, y) || clear(x, y + radius)) return;
      for (int offset = 1; offset < radius; offset++)
        if (clear(x - offset, y - radius) || clear(x + offset, y - radius)
            || clear(x - radius, y - offset) || clear(x + radius, y - offset)
            || clear(x - radius, y + offset) || clear(x + radius, y + offset)
            || clear(x - offset, y + radius) || clear(x + offset, y + radius)) return;
    }
  };
  for (Player& player : E.psys.players) {
    if (!player.active || !player.alive) continue;
    resolve(player.px, player.py, player.w, player.h, &player, nullptr);
  }
  for (Creature& creature : E.creatures.creatures) {
    if (!creature.alive || !E.creatures.inLoadedWindow(creature, 0)) continue;
    const CreatureSpecies& species = E.creatures.species(creature);
    double x = creature.wx - E.fg.worldOffsetX;
    double y = creature.wy - E.fg.worldOffsetY;
    resolve(x, y, species.w, species.h, nullptr, &creature);
    creature.wx = x + E.fg.worldOffsetX;
    creature.wy = y + E.fg.worldOffsetY;
  }
}
