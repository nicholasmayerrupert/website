// Navigation reads the live foreground. Plans hold movement intent for a few
// actor ticks; collision and environmental safety are checked every step.
bool CreatureSystem::clearTargetLine(const Creature& c, double tx, double ty) const {
  const auto& s = species(c);
  double x = c.wx + s.w * .5, y = c.wy + s.h * .5;
  double dx = tx - x, dy = ty - y, length = std::hypot(dx, dy);
  int samples = imin(256, (int)std::ceil(length));
  for (int i = 1; i < samples; i++) {
    int lx = (int)std::floor(x + dx * i / samples - E.fg.worldOffsetX);
    int ly = (int)std::floor(y + dy * i / samples - E.fg.worldOffsetY);
    if (lx < 0 || ly < 0 || lx >= E.cols || ly >= E.rows ||
        E.isBlockingForActor(E.fg.grid[E.I(lx, ly)])) return false;
  }
  return true;
}

double CreatureSystem::targetWalkWish(Creature& c, const CreatureSpecies& s, double tx, double ty) {
  auto& n = c.navigation;
  double dx = tx - (c.wx + s.w * .5), dy = ty - (c.wy + s.h * .5);
  if (c.attackState != CAS_IDLE) return 0;
  const auto& behavior = creatureBehavior(s);
  const auto* attack = E.planetId == PL_FRONTIER ? enemyAttackProfile(c.species, c.attackPattern) : nullptr;
  bool ranged = attack ? attack->move >= EM_RUNE : behavior.farRange > 0;
  double near = ranged ? (attack ? attack->reach * .35 : behavior.nearRange) : 0;
  double far = attack ? attack->reach * (ranged ? .80 : .72)
                      : ranged ? behavior.farRange : s.w * .5 + s.attackRange + 1;
  double distance = std::hypot(dx, dy);
  bool clear = clearTargetLine(c, tx, ty);
  double margin = std::max(1.5, s.walkSpeed * 8);
  if (n.arrived) n.arrived = clear && distance <= far + margin && (!ranged || distance >= near - margin);
  else n.arrived = clear && distance <= far && (!ranged || distance >= near);
  if (n.arrived) return 0;
  if (std::fabs(dx) < 1) return dy < -s.h * .5 ? c.facing * s.walkSpeed : 0;
  double speed = std::min(s.walkSpeed, std::fabs(dx) * .12);
  // Retreat only with a firing lane; a wall must not pin a ranged actor at its
  // preferred distance from an unseen target.
  if (ranged && clear && distance < near) speed = -speed;
  return dx > 0 ? speed : -speed;
}

void CreatureSystem::updateFacing(Creature& c, double movedX) {
  auto& n = c.navigation;
  if (c.attackState != CAS_IDLE || n.turnCooldown > 0) return;
  double tx, ty;
  double direction = movedX;
  if (targetPoint(c, tx, ty, nullptr, nullptr)) {
    direction = tx - (c.wx + species(c).w * .5);
    if (std::fabs(direction) < 2) return;
  } else if (std::fabs(direction) < .025) return;
  int facing = direction > 0 ? 1 : -1;
  if (facing != c.facing) { c.facing = facing; n.turnCooldown = 12; }
}

double CreatureSystem::navigateGround(Creature& c, const CreatureSpecies& s,
                                      double wish, double tx, double ty, bool hasTarget) {
  auto& n = c.navigation;
  if (!c.grounded && n.airborneDir != 0 && c.attackState == CAS_IDLE)
    return n.airborneDir * s.walkSpeed;
  if (c.grounded) n.airborneDir = 0;
  if (c.attackState != CAS_IDLE || std::fabs(wish) < .001) return 0;
  if (!c.grounded) return wish;
  int dir = wish > 0 ? 1 : -1;
  double speed = std::fabs(wish);
  auto dangerous = [&](double x, double y) {
    if (!boxInsideLoadedWindow(x, y, s.w, s.h)) return true;
    uint8_t hazard = contactHazardAtBox(x, y, s.w, s.h + 1, 0);
    if (hazard == CHP_NONE) return false;
    if (c.species == CS_LAVA_TOAD && (hazard == CHP_FIRE || hazard == CHP_LAVA)) return false;
    return !(c.species == CS_BONE_DINOSAUR && hazard == CHP_FIRE);
  };
  double ahead = c.wx + dir * std::max(2.0, speed * 8);
  bool obstacle = boxHitsSolid(ahead, c.wy - 1.25, s.w, s.h);
  bool ledge = !boxHitsSolid(ahead, c.wy + 2, s.w, s.h);
  bool hazard = dangerous(ahead, c.wy);
  bool climbTarget = hasTarget && ty < c.wy && std::fabs(tx - (c.wx + s.w * .5)) < 18;
  if (!obstacle && !ledge && !hazard && !climbTarget) {
    n.blockedTicks = 0; n.escapeTicks = 0; n.moveDir = dir;
    return wish;
  }
  if (n.escapeTicks > 0) {
    double back = c.wx + n.moveDir * 2;
    return !boxHitsSolid(back, c.wy - 1, s.w, s.h) &&
      boxHitsSolid(back, c.wy + 2, s.w, s.h) && !dangerous(back, c.wy) ? n.moveDir * speed : 0;
  }
  if (n.planTicks > 0) {
    double next = c.wx + n.moveDir * std::max(2.0, speed * 8);
    if (n.moveDir == 0 || dangerous(next, c.wy) || boxHitsSolid(next, c.wy - 1.25, s.w, s.h)) return 0;
    for (int drop = 0; drop <= std::max(12, s.h); drop++)
      if (!boxHitsSolid(next, c.wy + drop, s.w, s.h) &&
          boxHitsSolid(next, c.wy + drop + 1, s.w, s.h) && !dangerous(next, c.wy + drop)) return n.moveDir * speed;
    return 0;
  }
  n.planTicks = 12 + c.id % 5;
  n.moveDir = 0;
  // Probe the species' own ballistic motion, including its complete body and
  // ceiling collisions. Four bounded candidates cover walking and jumping in
  // either direction; only safe landings can become a movement commitment.
  double goalX = hasTarget ? tx - s.w * .5 : c.wx + dir * 32;
  double goalY = hasTarget ? ty - s.h * .5 : c.wy;
  auto cost = [&](double x, double y) { return std::fabs(goalX - x) + std::fabs(goalY - y) * 1.25; };
  double best = cost(c.wx, c.wy) - .75;
  bool jump = false;
  for (int jumpChoice = 0; jumpChoice < 2; jumpChoice++) {
    if (jumpChoice && (s.jumpSpeed <= 0 || n.jumpCooldown > 0)) continue;
    for (int direction : {dir, -dir}) {
      Creature probe = c;
      probe.vx = c.vx;
      probe.vy = jumpChoice ? -s.jumpSpeed : 0;
      bool landed = false;
      for (int tick = 0; tick < 64; tick++) {
        auto blocked = [&](double x, double y) { return boxHitsSolid(x, y, s.w, s.h); };
        probe.vx = accelerateToward(probe.vx, direction * speed, s.accel);
        bool moved = moveCreatureAxis(probe, probe.wx, probe.vx, true, blocked);
        if (!moved) probe.vx = 0;
        if (!moved && !jumpChoice) break;
        probe.vy = std::min(2.4, probe.vy + E.scaledGravity(s.gravity));
        bool descending = probe.vy >= 0;
        if (!moveCreatureAxis(probe, probe.wy, probe.vy, false, blocked)) {
          landed = descending;
          probe.vy = 0;
          if (landed && jumpChoice) break;
        } else landed = false;
        if ((tick % 8) == 0 && dangerous(probe.wx, probe.wy)) { landed = false; break; }
        if (probe.wy > c.wy + std::max(12, s.h) || !boxInsideLoadedWindow(probe.wx, probe.wy, s.w, s.h)) break;
      }
      if (!landed || dangerous(probe.wx, probe.wy)) continue;
      double score = cost(probe.wx, probe.wy) + (jumpChoice ? 1 : 0) + (direction != dir ? 2 : 0);
      if (score < best) { best = score; n.moveDir = direction; jump = jumpChoice; }
    }
  }
  if (jump) { c.vy = -s.jumpSpeed; n.jumpCooldown = 24; n.airborneDir = n.moveDir; }
  if (n.moveDir == 0) {
    n.blockedTicks += n.planTicks;
    n.planTicks = 30 + c.id % 7;
    if (!hasTarget && n.blockedTicks >= 30) {
      n.moveDir = -dir; c.wanderDir = -dir; c.wanderTicks = 90;
      n.escapeTicks = 45; n.blockedTicks = 0;
    }
  } else n.blockedTicks = 0;
  return n.moveDir * speed;
}

void CreatureSystem::steerFree(Creature& c, double& desiredX, double& desiredY, bool aquatic, bool submerged) {
  const auto& s = species(c);
  double speed = std::hypot(desiredX, desiredY);
  if (speed < 1e-6) return;
  auto clear = [&](double dx, double dy) {
    for (int i = 1; i <= 4; i++) {
      double x = c.wx + dx * i * 3, y = c.wy + dy * i * 3;
      if (boxHitsSolid(x, y, s.w, s.h)) return false;
      if (aquatic ? fluidCoverage(x, y, s.w, s.h) < s.fluidThreshold
                  : !submerged && boxTouchesLiquid(x, y, s.w, s.h)) return false;
    }
    return true;
  };
  if (clear(desiredX, desiredY)) { c.navigation.avoidTurn = 0; return; }
  double best = -1e9, selectedX = 0, selectedY = 0;
  int selectedTurn = c.navigation.avoidTurn;
  for (int turn : {1, -1, 2, -2, 3, -3, 4}) {
    double angle = turn * .7853981633974483;
    double x = desiredX * std::cos(angle) - desiredY * std::sin(angle);
    double y = desiredX * std::sin(angle) + desiredY * std::cos(angle);
    if (!clear(x, y)) continue;
    double score = (x * desiredX + y * desiredY) / (speed * speed)
      + (c.navigation.avoidTurn != 0 && turn * c.navigation.avoidTurn > 0 ? .4 : 0);
    if (score > best) { best = score; selectedX = x; selectedY = y; selectedTurn = turn; }
  }
  c.navigation.avoidTurn = selectedTurn;
  desiredX = selectedX; desiredY = selectedY;
}
