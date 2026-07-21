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

void ProjectileSystem::spawnArrow(Player& p, double charge) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  double sx = p.px + p.w * .5, sy = p.py + p.h * .42;
  double dx = p.aimX - sx, dy = p.aimY - sy, d = std::hypot(dx, dy);
  if (d < 1e-6) { dx = p.facing; dy = 0; d = 1; }
  double speed = 2.5 + 4.5 * charge;
  Projectile arrow; arrow.id = nextId++; arrow.owner = p.id; arrow.px = sx; arrow.py = sy;
  arrow.vx = dx / d * speed; arrow.vy = dy / d * speed; arrow.charge = charge;
  projectiles.push_back(arrow);
  E.audio.emit(SE_BOW, sx, sy, 0.55 + charge * .45, EMPTY);
}

void ProjectileSystem::updateProjectiles() {
  size_t write = 0;
  for (size_t i = 0; i < projectiles.size(); i++) {
    Projectile arrow = projectiles[i];
    bool hit = false; double distance = std::hypot(arrow.vx, arrow.vy);
    int steps = imax(1, (int)std::ceil(distance / ARROW_SWEEP_STEP));
    double sx = arrow.vx / steps, sy = arrow.vy / steps;
    for (int step = 0; step < steps && !hit; step++) {
      arrow.px += sx; arrow.py += sy;
      int x = (int)std::floor(arrow.px), y = (int)std::floor(arrow.py);
      if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) { hit = true; break; }
      if (E.isBlockingForPlayer(E.fg.grid[E.I(x, y)])) { hit = true; break; }
      int damage = 8 + (int)std::lround(22 * arrow.charge);
      if (E.damageCreaturesAt(x, y, 1, damage)) hit = true;
    }
    if (hit) {
      E.spawnParticle(STONE, arrow.px, arrow.py, -arrow.vx * .08, -0.15, 12);
      E.audio.emit(SE_ARROW_HIT, arrow.px, arrow.py, 0.45 + arrow.charge * .55, STONE);
      continue;
    }
    arrow.vy += ARROW_GRAVITY;
    if (--arrow.life <= 0) continue;
    projectiles[write++] = arrow;
  }
  projectiles.resize(write);
}

int ProjectileSystem::buildSnapshot() {
  snapshot.assign(projectiles.size() * PRS_STRIDE, 0.0f);
  for (size_t i = 0; i < projectiles.size(); i++) {
    const Projectile& p = projectiles[i]; float* o = snapshot.data() + i * PRS_STRIDE;
    o[PRS_ID] = p.id; o[PRS_OWNER] = p.owner; o[PRS_X] = p.px; o[PRS_Y] = p.py;
    o[PRS_VX] = p.vx; o[PRS_VY] = p.vy; o[PRS_CHARGE] = p.charge;
  }
  return (int)projectiles.size();
}
