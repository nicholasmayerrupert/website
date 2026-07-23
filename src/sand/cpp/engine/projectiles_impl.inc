void ProjectileSystem::applyBowInput(Player& p, int previousInput) {
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  E.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p);
  if (primary) {
    if (p.bowChargeTicks < BOW_CHARGE_MAX) p.bowChargeTicks++;
    return;
  }
  if (!wasPrimary || p.bowChargeTicks <= 0) { p.bowChargeTicks = 0; return; }
  int ammo = -1;
  for (int i = 0; i < INV_SLOTS; i++) if (p.inv[i].itemKind == IK_ARROW && p.inv[i].count > 0) { ammo = i; break; }
  if (ammo >= 0) {
    double charge = std::max(0.0, std::min(1.0, p.bowChargeTicks / (double)BOW_CHARGE_MAX));
    if (--p.inv[ammo].count <= 0) p.inv[ammo] = InvSlot();
    spawnArrow(p, charge);
  }
  p.bowChargeTicks = 0;
}

void ProjectileSystem::applyBlastGunInput(Player& p) {
  E.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  if (!(p.input & PI_PRIMARY) || p.toolCooldown > 0) return;
  spawnBlastRound(p);
  p.toolCooldown = BLAST_GUN_COOLDOWN;
  E.playerActionCount++;
}

void ProjectileSystem::spawnArrow(Player& p, double charge) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  double sx = p.px + p.w * .5, sy = p.py + p.h * .42;
  double dx = p.aimX - sx, dy = p.aimY - sy, d = std::hypot(dx, dy);
  if (d < 1e-6) { dx = p.facing; dy = 0; d = 1; }
  double speed = 2.5 + 4.5 * charge;
  Projectile arrow; arrow.id = nextId++; arrow.owner = p.id; arrow.kind = PK_ARROW;
  arrow.px = sx; arrow.py = sy; arrow.vx = dx / d * speed; arrow.vy = dy / d * speed;
  arrow.charge = charge; arrow.rotation = std::atan2(arrow.vy, arrow.vx);
  projectiles.push_back(arrow);
  E.audio.emit(SE_BOW, sx, sy, 0.55 + charge * .45, EMPTY);
}

void ProjectileSystem::spawnBlastRound(Player& p) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  double cx = p.px + p.w * .5, cy = p.py + p.h * .42;
  double dx = p.aimX - cx, dy = p.aimY - cy, d = std::hypot(dx, dy);
  if (d < 1e-6) { dx = p.facing; dy = 0; d = 1; }
  dx /= d; dy /= d;
  Projectile round; round.id = nextId++; round.owner = p.id; round.kind = PK_BLAST_ROUND;
  // Begin at the actor-space muzzle origin so the swept path also tests the
  // cells between the player and the visible barrel. Owner immunity prevents a
  // close impact from turning this into self-damage.
  round.px = cx; round.py = cy;
  round.vx = dx * BLAST_ROUND_SPEED; round.vy = dy * BLAST_ROUND_SPEED;
  round.life = BLAST_ROUND_LIFE; round.charge = 1.0; round.rotation = std::atan2(dy, dx);
  projectiles.push_back(round);
  E.audio.emit(SE_BLAST_GUN, round.px, round.py, 0.9, GUNPOWDER, 0);
}

void ProjectileSystem::spawnDynamite(const Creature& thrower, double targetX, double targetY) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  const CreatureSpecies& s = E.creatures.species(thrower);
  double localX = thrower.wx - E.fg.worldOffsetX;
  double localY = thrower.wy - E.fg.worldOffsetY;
  Projectile dynamite; dynamite.id = nextId++; dynamite.owner = -thrower.id; dynamite.kind = PK_DYNAMITE;
  // Start inside the thrower's actor space. The next actor step sweeps the
  // complete throw path, so a wall touching the actor cannot be bypassed by a
  // pre-offset visual muzzle position.
  dynamite.px = localX + s.w * .5;
  dynamite.py = localY + s.h * .35;
  double dx = targetX - dynamite.px, dy = targetY - dynamite.py;
  double flight = std::max(34.0, std::min(58.0, std::fabs(dx) * .72 + 24.0));
  dynamite.vx = std::max(-2.45, std::min(2.45, dx / flight));
  dynamite.vy = std::max(-2.35, std::min(0.25, (dy - .5 * DYNAMITE_GRAVITY * flight * flight) / flight));
  dynamite.fuse = DYNAMITE_FUSE_TICKS;
  dynamite.life = DYNAMITE_FUSE_TICKS + 30;
  dynamite.rotation = std::atan2(dynamite.vy, dynamite.vx);
  projectiles.push_back(dynamite);
  E.audio.emit(SE_FUSE, dynamite.px, dynamite.py, 0.9, TNT, 0);
}

void ProjectileSystem::updateProjectiles() {
  auto hitsCreature = [&](double px, double py, double radius) {
    double wx = E.fg.worldOffsetX + px, wy = E.fg.worldOffsetY + py;
    double r2 = radius * radius;
    for (const Creature& c : E.creatures.creatures) {
      if (!c.alive) continue;
      const CreatureSpecies& s = E.creatures.species(c);
      double nx = std::max(c.wx, std::min(wx, c.wx + s.w));
      double ny = std::max(c.wy, std::min(wy, c.wy + s.h));
      double dx = wx - nx, dy = wy - ny;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  };
  auto hitsPlayer = [&](double px, double py, double radius, int owner) {
    double r2 = radius * radius;
    for (const Player& player : E.psys.players) {
      if (!player.active || !player.alive || player.id == owner) continue;
      double nx = std::max(player.px, std::min(px, player.px + player.w));
      double ny = std::max(player.py, std::min(py, player.py + player.h));
      double dx = px - nx, dy = py - ny;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  };
  auto blocksPoint = [&](double px, double py) {
    int x = (int)std::floor(px), y = (int)std::floor(py);
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return true;
    return E.isBlockingForPlayer(E.fg.grid[E.I(x, y)]);
  };

  size_t write = 0;
  for (size_t i = 0; i < projectiles.size(); i++) {
    Projectile p = projectiles[i];
    if (p.kind == PK_DYNAMITE) {
      bool outside = p.px < 1 || p.px >= E.cols - 1 || p.py < 1 || p.py >= E.rows - 1;
      if (!outside) {
        double distance = std::hypot(p.vx, p.vy);
        int steps = imax(1, (int)std::ceil(distance / PROJECTILE_SWEEP_STEP));
        double sx = p.vx / steps, sy = p.vy / steps;
        bool blockX = false, blockY = false;
        for (int step = 0; step < steps; step++) {
          if (!blockX) {
            double nx = p.px + sx;
            if (blocksPoint(nx, p.py)) { p.vx = -p.vx * DYNAMITE_BOUNCE; blockX = true; }
            else p.px = nx;
          }
          if (!blockY) {
            double ny = p.py + sy;
            if (blocksPoint(p.px, ny)) {
              p.vy = -p.vy * DYNAMITE_BOUNCE;
              p.vx *= DYNAMITE_FRICTION;
              blockY = true;
            } else p.py = ny;
          }
        }
        int cx = (int)std::floor(p.px), cy = (int)std::floor(p.py);
        if (cx >= 0 && cx < E.cols && cy >= 0 && cy < E.rows && E.isLiquidMaterial(E.fg.grid[E.I(cx, cy)])) {
          p.vx *= 0.91; p.vy *= 0.88;
        }
        p.vy = std::min(DYNAMITE_MAX_FALL, p.vy + DYNAMITE_GRAVITY);
        p.rotation += p.vx * .22;
      }
      if (--p.fuse <= 0 && !outside) {
        int x = imax(1, imin(E.cols - 2, (int)std::lround(p.px)));
        int y = imax(1, imin(E.rows - 2, (int)std::lround(p.py)));
        uint32_t seed = (uint32_t)p.id * 2654435761u ^ (uint32_t)p.kind * 2246822519u;
        E.detonate(x, y, ExplosivesSystem::TNT_BLAST_RADIUS, ExplosivesSystem::TNT_BLAST_POWER, 0, TNT, seed);
        continue;
      }
      if (outside || --p.life <= 0) continue;
      projectiles[write++] = p;
      continue;
    }

    bool hit = false;
    double distance = std::hypot(p.vx, p.vy);
    int steps = imax(1, (int)std::ceil(distance / PROJECTILE_SWEEP_STEP));
    double sx = p.vx / steps, sy = p.vy / steps;
    for (int step = 0; step < steps && !hit; step++) {
      p.px += sx; p.py += sy;
      int x = (int)std::floor(p.px), y = (int)std::floor(p.py);
      if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) { hit = true; break; }
      uint8_t material = E.fg.grid[E.I(x, y)];
      if (p.kind == PK_BLAST_ROUND) {
        if ((!E.isEmptyMaterial(material) && !E.isGasMaterial(material)) ||
            hitsCreature(p.px, p.py, 0.8) || hitsPlayer(p.px, p.py, 0.8, p.owner)) hit = true;
      } else {
        if (E.isBlockingForPlayer(material)) { hit = true; break; }
        int damage = 8 + (int)std::lround(22 * p.charge);
        if (E.damageCreaturesAt(x, y, 1, damage)) hit = true;
      }
    }
    if (hit) {
      if (p.kind == PK_BLAST_ROUND && p.px >= 1 && p.px < E.cols - 1 && p.py >= 1 && p.py < E.rows - 1) {
        int x = (int)std::floor(p.px), y = (int)std::floor(p.py);
        uint32_t seed = (uint32_t)p.id * 2654435761u ^ (uint32_t)p.kind * 2246822519u;
        E.detonate(x, y, BLAST_ROUND_RADIUS, BLAST_ROUND_POWER, p.owner, GUNPOWDER, seed);
      } else if (p.kind == PK_ARROW) {
        E.spawnParticle(STONE, p.px, p.py, -p.vx * .08, -0.15, 12);
        E.audio.emit(SE_ARROW_HIT, p.px, p.py, 0.45 + p.charge * .55, STONE);
      }
      continue;
    }
    if (p.kind == PK_ARROW) {
      p.vy += ARROW_GRAVITY;
      p.rotation = std::atan2(p.vy, p.vx);
    }
    if (--p.life <= 0) continue;
    projectiles[write++] = p;
  }
  projectiles.resize(write);
}

int ProjectileSystem::buildSnapshot() {
  snapshot.assign(projectiles.size() * PRS_STRIDE, 0.0f);
  for (size_t i = 0; i < projectiles.size(); i++) {
    const Projectile& p = projectiles[i]; float* o = snapshot.data() + i * PRS_STRIDE;
    o[PRS_ID] = p.id; o[PRS_OWNER] = p.owner; o[PRS_X] = p.px; o[PRS_Y] = p.py;
    o[PRS_VX] = p.vx; o[PRS_VY] = p.vy; o[PRS_CHARGE] = p.charge;
    o[PRS_KIND] = p.kind; o[PRS_FUSE] = p.fuse; o[PRS_ROTATION] = p.rotation;
  }
  return (int)projectiles.size();
}
