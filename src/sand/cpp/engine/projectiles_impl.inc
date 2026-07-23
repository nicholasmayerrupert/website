// Tunables for the three captured enemy weapons live with their actor-clock
// implementation. Their inventory/ABI identities are generated separately.
// Thrown dynamite is deliberately more destructive than static TNT: the
// satchel and dynamiteer share this projectile path and therefore the same
// readable danger radius.
static constexpr int DYNAMITE_PROJECTILE_BLAST_RADIUS_LOCAL = 32;
static constexpr double DYNAMITE_PROJECTILE_BLAST_POWER_LOCAL = 30.0;
static constexpr int ACID_MORTAR_COOLDOWN_LOCAL = 75;
static constexpr int ACID_SHELL_LIFE_LOCAL = 180;
static constexpr double ACID_SHELL_GRAVITY_LOCAL = 0.055;
// Nine cells is a little over twice the old six-cell footprint. The falling-sand
// reactions quickly roughen that initial disc into a natural corrosive pool.
static constexpr int ACID_SPLASH_RADIUS_LOCAL = 9;
static constexpr int ACID_SPLASH_DAMAGE_LOCAL = 16;
static constexpr int CLUSTER_LAUNCHER_COOLDOWN_LOCAL = 90;
static constexpr int CLUSTER_CARRIER_FUSE_LOCAL = 120;
static constexpr int CLUSTER_BOMBLET_COUNT_LOCAL = 16;
static constexpr int CLUSTER_BOMBLET_FUSE_MIN_LOCAL = 20;
static constexpr int CLUSTER_BOMBLET_FUSE_SPAN_LOCAL = 21;
static constexpr int CLUSTER_BOMBLET_FUSE_STRIDE_LOCAL = 13;
static constexpr double CLUSTER_GRAVITY_LOCAL = 0.075;
static constexpr double CLUSTER_BOUNCE_LOCAL = 0.54;
static constexpr double CLUSTER_FRICTION_LOCAL = 0.58;
static constexpr int CLUSTER_BLAST_RADIUS_LOCAL = 10;
static constexpr double CLUSTER_BLAST_POWER_LOCAL = 13.0;
static constexpr int MINIGUN_COOLDOWN_LOCAL = 2;
static constexpr int MINIGUN_ROUND_LIFE_LOCAL = 40;
static constexpr double MINIGUN_ROUND_SPEED_LOCAL = 15.5;
static constexpr int MINIGUN_BLAST_RADIUS_LOCAL = 2;
// Radius, not a weak visual-only puff, is what keeps these explosions tiny.
// Just over stone durability lets a direct hit chip one hard cell while the
// steep two-cell falloff prevents each high-rate round from opening a crater.
static constexpr double MINIGUN_BLAST_POWER_LOCAL = 8.2;

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

void ProjectileSystem::applyDynamiteSatchelInput(Player& p, int previousInput) {
  E.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  if (!primary || wasPrimary || p.toolCooldown > 0) return;
  spawnDynamite(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_DYNAMITE_SATCHEL);
  p.toolCooldown = DYNAMITE_SATCHEL_COOLDOWN;
  E.playerActionCount++;
}

void ProjectileSystem::applyBoreCannonInput(Player& p, int previousInput) {
  E.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p);
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  if (!primary || p.toolCooldown > 0) { p.bowChargeTicks = 0; return; }
  if (!wasPrimary) E.audio.emit(SE_BORE_CHARGE, p.px + p.w * .5, p.py + p.h * .42, 0.82, STONE, 0);
  if (++p.bowChargeTicks < BORE_CANNON_CHARGE_TICKS) return;
  E.creatures.fireBore(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_BORE_CANNON);
  p.bowChargeTicks = 0;
  p.toolCooldown = BORE_CANNON_COOLDOWN;
  E.playerActionCount++;
}

void ProjectileSystem::applyAcidMortarInput(Player& p, int previousInput) {
  E.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  if (!primary || wasPrimary || p.toolCooldown > 0) return;
  spawnAcidShell(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_ACID_MORTAR);
  p.toolCooldown = ACID_MORTAR_COOLDOWN_LOCAL;
  E.playerActionCount++;
}

void ProjectileSystem::applyClusterLauncherInput(Player& p, int previousInput) {
  E.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  if (!primary || wasPrimary || p.toolCooldown > 0) return;
  spawnClusterBomb(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_CLUSTER_LAUNCHER);
  p.toolCooldown = CLUSTER_LAUNCHER_COOLDOWN_LOCAL;
  E.playerActionCount++;
}

void ProjectileSystem::applyMinigunInput(Player& p) {
  E.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  if (!(p.input & PI_PRIMARY) || p.toolCooldown > 0) return;
  spawnMinigunRound(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_MINIGUN);
  p.toolCooldown = MINIGUN_COOLDOWN_LOCAL;
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
  // cells between the player and the visible barrel. The full blast keeps owner
  // immunity; updateProjectiles applies only a small controlled close-range hit.
  round.px = cx; round.py = cy;
  round.vx = dx * BLAST_ROUND_SPEED; round.vy = dy * BLAST_ROUND_SPEED;
  round.life = BLAST_ROUND_LIFE; round.charge = 1.0; round.rotation = std::atan2(dy, dx);
  projectiles.push_back(round);
  E.audio.emit(SE_BLAST_GUN, round.px, round.py, 0.9, GUNPOWDER, 0);
}

void ProjectileSystem::spawnDynamiteAt(int owner, double sx, double sy, double targetX, double targetY) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  Projectile dynamite; dynamite.id = nextId++; dynamite.owner = owner; dynamite.kind = PK_DYNAMITE;
  // Start inside the thrower's actor space. The next actor step sweeps the
  // complete throw path, so a wall touching the actor cannot be bypassed by a
  // pre-offset visual muzzle position.
  dynamite.px = sx;
  dynamite.py = sy;
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

void ProjectileSystem::spawnDynamite(const Creature& thrower, double targetX, double targetY) {
  const CreatureSpecies& s = E.creatures.species(thrower);
  double localX = thrower.wx - E.fg.worldOffsetX;
  double localY = thrower.wy - E.fg.worldOffsetY;
  spawnDynamiteAt(-thrower.id, localX + s.w * .5, localY + s.h * .35, targetX, targetY);
}

void ProjectileSystem::spawnDynamite(Player& thrower) {
  spawnDynamiteAt(thrower.id, thrower.px + thrower.w * .5, thrower.py + thrower.h * .42,
                  thrower.aimX, thrower.aimY);
}

void ProjectileSystem::spawnAcidShellAt(int owner, double sx, double sy, double targetX, double targetY) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  double dx = targetX - sx, dy = targetY - sy;
  double flight = std::max(34.0, std::min(58.0, std::fabs(dx) * .45 + 30.0));
  Projectile shell; shell.id = nextId++; shell.owner = owner; shell.kind = PK_ACID_SHELL;
  shell.px = sx; shell.py = sy;
  shell.vx = dx / flight;
  shell.vy = (dy - .5 * ACID_SHELL_GRAVITY_LOCAL * flight * flight) / flight;
  shell.life = ACID_SHELL_LIFE_LOCAL;
  // Charge doubles as the renderer's scale hint; acid shells are deliberately
  // chunkier than ordinary rounds and have a matching collision envelope.
  shell.charge = 1.65;
  shell.rotation = std::atan2(shell.vy, shell.vx);
  projectiles.push_back(shell);
  E.audio.emit(SE_ACID_MORTAR, sx, sy, 0.9, ACID, 0);
}

void ProjectileSystem::spawnAcidShell(const Creature& shooter, double targetX, double targetY) {
  const CreatureSpecies& s = E.creatures.species(shooter);
  double localX = shooter.wx - E.fg.worldOffsetX;
  double localY = shooter.wy - E.fg.worldOffsetY;
  spawnAcidShellAt(-shooter.id, localX + s.w * .5, localY + s.h * .34, targetX, targetY);
}

void ProjectileSystem::spawnAcidShell(Player& shooter) {
  spawnAcidShellAt(shooter.id, shooter.px + shooter.w * .5, shooter.py + shooter.h * .42,
                   shooter.aimX, shooter.aimY);
}

void ProjectileSystem::spawnClusterBombAt(int owner, double sx, double sy, double targetX, double targetY) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  double dx = targetX - sx, dy = targetY - sy, d = std::hypot(dx, dy);
  if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
  Projectile carrier; carrier.id = nextId++; carrier.owner = owner; carrier.kind = PK_CLUSTER_BOMB;
  carrier.px = sx; carrier.py = sy;
  carrier.vx = dx / d * 2.35;
  carrier.vy = dy / d * 2.35 - .18;
  carrier.life = CLUSTER_CARRIER_FUSE_LOCAL + 90;
  carrier.fuse = CLUSTER_CARRIER_FUSE_LOCAL;
  carrier.charge = 0.0;
  carrier.rotation = std::atan2(carrier.vy, carrier.vx);
  projectiles.push_back(carrier);
  E.audio.emit(SE_CLUSTER_LAUNCH, sx, sy, 0.9, GUNPOWDER, 0);
}

void ProjectileSystem::spawnClusterBomb(const Creature& shooter, double targetX, double targetY) {
  const CreatureSpecies& s = E.creatures.species(shooter);
  double localX = shooter.wx - E.fg.worldOffsetX;
  double localY = shooter.wy - E.fg.worldOffsetY;
  spawnClusterBombAt(-shooter.id, localX + s.w * .5, localY + s.h * .52, targetX, targetY);
}

void ProjectileSystem::spawnClusterBomb(Player& shooter) {
  spawnClusterBombAt(shooter.id, shooter.px + shooter.w * .5, shooter.py + shooter.h * .42,
                     shooter.aimX, shooter.aimY);
}

void ProjectileSystem::spawnMinigunRoundAt(int owner, double guardX, double guardY,
                                           double muzzleX, double muzzleY,
                                           double dirX, double dirY) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  double d = std::hypot(dirX, dirY);
  if (d < 1e-6) { dirX = 1; dirY = 0; d = 1; }
  dirX /= d; dirY /= d;
  // A long authored barrel may cross nearby cover. Preserve the visible muzzle
  // origin when clear. When it crosses an obstruction, launch from the final
  // clear guard sample directly into the first blocked sample so spread cannot
  // steer a fallback shot around a single terrain cell or actor.
  auto blockedAt = [&](double px, double py) {
    int x = (int)std::floor(px), y = (int)std::floor(py);
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return true;
    uint8_t material = E.fg.grid[E.I(x, y)];
    if (!E.isEmptyMaterial(material) && !E.isGasMaterial(material)) return true;
    double wx = E.fg.worldOffsetX + px, wy = E.fg.worldOffsetY + py;
    for (const Creature& creature : E.creatures.creatures) {
      if (!creature.alive || (owner < 0 && creature.id == -owner)) continue;
      const CreatureSpecies& s = E.creatures.species(creature);
      double nx = std::max(creature.wx, std::min(wx, creature.wx + s.w));
      double ny = std::max(creature.wy, std::min(wy, creature.wy + s.h));
      double dx = wx - nx, dy = wy - ny;
      if (dx * dx + dy * dy <= .48 * .48) return true;
    }
    for (const Player& player : E.psys.players) {
      if (!player.active || !player.alive || player.id == owner) continue;
      double nx = std::max(player.px, std::min(px, player.px + player.w));
      double ny = std::max(player.py, std::min(py, player.py + player.h));
      double dx = px - nx, dy = py - ny;
      if (dx * dx + dy * dy <= .48 * .48) return true;
    }
    return false;
  };
  bool guarded = false;
  double clearX = guardX, clearY = guardY;
  double blockedX = muzzleX, blockedY = muzzleY;
  double guardDx = muzzleX - guardX, guardDy = muzzleY - guardY;
  double guardDistance = std::hypot(guardDx, guardDy);
  int guardSteps = imax(1, (int)std::ceil(guardDistance / PROJECTILE_SWEEP_STEP));
  for (int step = 1; step <= guardSteps; step++) {
    double t = step / (double)guardSteps;
    double sampleX = guardX + guardDx * t, sampleY = guardY + guardDy * t;
    if (blockedAt(sampleX, sampleY)) {
      guarded = true;
      blockedX = sampleX;
      blockedY = sampleY;
      break;
    }
    clearX = sampleX;
    clearY = sampleY;
  }
  // A tiny deterministic cone keeps sustained fire lively while preserving
  // replay/network determinism. Each shot still travels much faster than the
  // blast gun and uses swept collision below.
  uint32_t seed = (uint32_t)nextId * 2654435761u ^ (uint32_t)(owner * 2246822519u);
  double spread = ((seed >> 8) & 0xffffu) / 65535.0 * .10 - .05;
  double angle = guarded
    ? std::atan2(blockedY - clearY, blockedX - clearX)
    : std::atan2(dirY, dirX) + spread;
  Projectile round;
  round.id = nextId++; round.owner = owner; round.kind = PK_MINIGUN_ROUND;
  round.px = guarded ? clearX : muzzleX;
  round.py = guarded ? clearY : muzzleY;
  round.vx = guarded ? blockedX - clearX : std::cos(angle) * MINIGUN_ROUND_SPEED_LOCAL;
  round.vy = guarded ? blockedY - clearY : std::sin(angle) * MINIGUN_ROUND_SPEED_LOCAL;
  round.life = MINIGUN_ROUND_LIFE_LOCAL;
  round.charge = 1.0;
  round.rotation = angle;
  projectiles.push_back(round);
  E.audio.emit(SE_MINIGUN, muzzleX, muzzleY, 0.48, GUNPOWDER, 0);
}

void ProjectileSystem::spawnMinigunRound(const Creature& shooter,
                                         double targetX, double targetY) {
  const CreatureSpecies& s = E.creatures.species(shooter);
  double localX = shooter.wx - E.fg.worldOffsetX;
  double localY = shooter.wy - E.fg.worldOffsetY;
  // Match the authored overlay in GLPresenter: gun anchor + hand extension +
  // muzzle bloom. Keep velocity parallel to the rendered barrel rather than
  // bending it back toward the cursor from an offset muzzle.
  double gunX = localX + s.w * .56;
  double gunY = localY + s.h * .48;
  double dx = targetX - gunX, dy = targetY - gunY;
  double d = std::hypot(dx, dy);
  if (d < 1e-6) { dx = shooter.facing; dy = 0; d = 1; }
  dx /= d; dy /= d;
  double muzzleX = gunX + dx * 4.73;
  double muzzleY = gunY + dy * 4.73;
  spawnMinigunRoundAt(-shooter.id, gunX, gunY, muzzleX, muzzleY, dx, dy);
}

void ProjectileSystem::spawnMinigunRound(Player& shooter) {
  double shoulderX = shooter.px + shooter.w * .5;
  double shoulderY = shooter.py + shooter.h * .42;
  double dx = shooter.aimX - shoulderX, dy = shooter.aimY - shoulderY;
  double d = std::hypot(dx, dy);
  if (d < 1e-6) { dx = shooter.facing; dy = 0; d = 1; }
  dx /= d; dy /= d;
  double nx = -dy, ny = dx;
  // hand = shoulder + 1.55 forward; muzzle art = hand + 3.94 forward
  // and -.68 normal.
  double muzzleX = shoulderX + dx * 5.49 - nx * .68;
  double muzzleY = shoulderY + dy * 5.49 - ny * .68;
  spawnMinigunRoundAt(shooter.id, shoulderX, shoulderY,
                      muzzleX, muzzleY, dx, dy);
}

void ProjectileSystem::spawnBoreBeam(int owner, double ox, double oy, double dx, double dy) {
  double d = std::hypot(dx, dy);
  if (d < 1e-6) return;
  // This is a render-only latch. At the actor cap, preserve every live gameplay
  // projectile and skip the cosmetic flash instead of evicting the oldest one.
  if ((int)projectiles.size() >= PROJECTILE_MAX) return;
  Projectile beam;
  beam.id = nextId++; beam.owner = owner; beam.kind = PK_BORE_BEAM;
  beam.px = ox; beam.py = oy; beam.vx = dx / d; beam.vy = dy / d;
  beam.life = 7; beam.fuse = 7; beam.charge = 1.0;
  beam.rotation = std::atan2(beam.vy, beam.vx);
  projectiles.push_back(beam);
}

void ProjectileSystem::updateProjectiles() {
  auto hitsCreature = [&](double px, double py, double radius, int owner) {
    double wx = E.fg.worldOffsetX + px, wy = E.fg.worldOffsetY + py;
    double r2 = radius * radius;
    for (const Creature& c : E.creatures.creatures) {
      if (!c.alive || (owner < 0 && c.id == -owner)) continue;
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
  auto materialStopsPoint = [&](double px, double py) {
    int x = (int)std::floor(px), y = (int)std::floor(py);
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return true;
    uint8_t material = E.fg.grid[E.I(x, y)];
    return !E.isEmptyMaterial(material) && !E.isGasMaterial(material);
  };
  auto blocksClusterCarrier = [&](double px, double py) {
    // The carrier is rendered roughly 2.5x1.8 cells. Sample a compact rounded
    // envelope so that the larger silhouette splits before sinking into terrain
    // or liquid.
    static constexpr double OFFSETS[9][2] = {
      {0, 0}, {-.95, 0}, {.95, 0}, {0, -.72}, {0, .72},
      {-.67, -.51}, {.67, -.51}, {-.67, .51}, {.67, .51},
    };
    for (const auto& offset : OFFSETS)
      if (materialStopsPoint(px + offset[0], py + offset[1])) return true;
    return false;
  };
  auto damageSplash = [&](double px, double py, int radius, int damage, int owner, bool launch) {
    double r2 = (double)radius * radius;
    for (Player& player : E.psys.players) {
      if (!player.active || !player.alive || (owner > 0 && player.id == owner)) continue;
      double nx = std::max(player.px, std::min(px, player.px + player.w));
      double ny = std::max(player.py, std::min(py, player.py + player.h));
      double dx = px - nx, dy = py - ny;
      if (dx * dx + dy * dy > r2) continue;
      E.psys.damagePlayer(player, damage, 16, px, py);
      if (launch) {
        double dir = player.px + player.w * .5 >= px ? 1.0 : -1.0;
        player.vx += dir * .72;
        player.vy = std::min(player.vy, -1.05);
      }
    }
    double wx = E.fg.worldOffsetX + px, wy = E.fg.worldOffsetY + py;
    for (Creature& c : E.creatures.creatures) {
      if (!c.alive || c.hurtCooldown > 0 || (owner < 0 && c.id == -owner)) continue;
      const CreatureSpecies& s = E.creatures.species(c);
      double nx = std::max(c.wx, std::min(wx, c.wx + s.w));
      double ny = std::max(c.wy, std::min(wy, c.wy + s.h));
      double dx = wx - nx, dy = wy - ny;
      if (dx * dx + dy * dy > r2) continue;
      c.health -= damage;
      c.hurtCooldown = 12;
      if (launch) {
        double dir = c.wx + s.w * .5 >= wx ? 1.0 : -1.0;
        c.vx += dir * .72;
        c.vy = std::min(c.vy, -1.05);
      }
      E.audio.emit(SE_CREATURE, c.wx - E.fg.worldOffsetX + s.w * .5,
                   c.wy - E.fg.worldOffsetY + s.h * .5, 0.75, c.species, 0);
    }
  };
  auto burstAcid = [&](const Projectile& shell) {
    int x = imax(1, imin(E.cols - 2, (int)std::lround(shell.px)));
    int y = imax(1, imin(E.rows - 2, (int)std::lround(shell.py)));
    damageSplash(x + .5, y + .5, ACID_SPLASH_RADIUS_LOCAL,
                 ACID_SPLASH_DAMAGE_LOCAL, shell.owner, false);
    Layer* restore = E.L;
    E.useLayer(&E.fg);
    E.paintDisc(x, y, ACID_SPLASH_RADIUS_LOCAL, ACID, false);
    E.useLayer(restore);
    E.audio.emit(SE_ACID_DISSOLVE, x, y, 1.0, ACID, 0);
  };

  std::vector<Projectile> pendingCluster;
  pendingCluster.reserve(CLUSTER_BOMBLET_COUNT_LOCAL);
  auto splitCluster = [&](const Projectile& carrier) {
    // Sixteen deterministic pseudo-random directions read as genuinely scattered
    // mini-dynamite while remaining identical on authority, replay, and clients.
    // A coprime stride permutes the 20-40 tick window, guaranteeing that every
    // child has a distinct short fuse without tying fuse order to its direction.
    int fusePhase = (int)(((uint32_t)carrier.id * 2654435761u) %
                          CLUSTER_BOMBLET_FUSE_SPAN_LOCAL);
    for (int child = 0; child < CLUSTER_BOMBLET_COUNT_LOCAL; child++) {
      uint32_t seed = (uint32_t)carrier.id * 2654435761u ^
                      (uint32_t)(child + 1) * 2246822519u;
      seed ^= seed >> 16; seed *= 0x7feb352du;
      seed ^= seed >> 15; seed *= 0x846ca68bu; seed ^= seed >> 16;
      double angle = (seed / 4294967296.0) * 6.283185307179586;
      double speed = 1.55 + ((seed >> 9) & 0x3ffu) / 1023.0 * .85;
      Projectile bomblet;
      bomblet.id = nextId++;
      bomblet.owner = carrier.owner;
      bomblet.kind = PK_CLUSTER_BOMB;
      bomblet.px = carrier.px;
      bomblet.py = carrier.py;
      bomblet.vx = std::cos(angle) * speed;
      bomblet.vy = std::sin(angle) * speed - .42;
      bomblet.fuse = CLUSTER_BOMBLET_FUSE_MIN_LOCAL +
        (child * CLUSTER_BOMBLET_FUSE_STRIDE_LOCAL + fusePhase) %
          CLUSTER_BOMBLET_FUSE_SPAN_LOCAL;
      bomblet.life = bomblet.fuse + 45;
      bomblet.charge = 1.0;
      bomblet.rotation = angle;
      pendingCluster.push_back(bomblet);
    }
    E.audio.emit(SE_FUSE, carrier.px, carrier.py, 0.72, TNT, 0);
  };
  auto detonateOwnerAware = [&](const Projectile& projectile, int x, int y,
                                int radius, double power, uint8_t material) {
    Creature* immuneCreature = nullptr;
    int savedHurtCooldown = 0;
    if (projectile.owner < 0) {
      for (Creature& creature : E.creatures.creatures) {
        if (creature.id != -projectile.owner) continue;
        immuneCreature = &creature;
        savedHurtCooldown = creature.hurtCooldown;
        // The common blast path already respects hurt cooldown, giving enemy
        // projectiles the same explicit owner immunity players receive by id.
        creature.hurtCooldown = imax(1, creature.hurtCooldown);
        break;
      }
    }
    uint32_t seed = (uint32_t)projectile.id * 2654435761u ^
                    (uint32_t)projectile.kind * 2246822519u;
    E.detonate(x, y, radius, power, projectile.owner > 0 ? projectile.owner : 0,
               material, seed);
    if (immuneCreature) immuneCreature->hurtCooldown = savedHurtCooldown;
  };
  auto damageBlastOwner = [&](const Projectile& round) {
    if (round.owner <= 0) return;
    Player* owner = E.psys.findPlayer(round.owner);
    if (!owner || !owner->active || !owner->alive) return;
    double nearestX = std::max(owner->px, std::min(round.px, owner->px + owner->w));
    double nearestY = std::max(owner->py, std::min(round.py, owner->py + owner->h));
    double dx = nearestX - round.px, dy = nearestY - round.py;
    double distance = std::hypot(dx, dy);
    if (distance >= BLAST_ROUND_RADIUS) return;
    double falloff = 1.0 - distance / BLAST_ROUND_RADIUS;
    int damage = imax(1, (int)std::lround(8.0 * falloff));
    double centerDx = owner->px + owner->w * .5 - round.px;
    double centerDy = owner->py + owner->h * .5 - round.py;
    double centerDistance = std::hypot(centerDx, centerDy);
    if (centerDistance < 1e-6) {
      centerDx = round.vx > 0 ? -1.0 : 1.0;
      centerDy = -.25;
      centerDistance = std::hypot(centerDx, centerDy);
    }
    double impulse = .22 + .38 * falloff;
    owner->vx += centerDx / centerDistance * impulse;
    owner->vy += centerDy / centerDistance * impulse - impulse * .12;
    E.psys.damagePlayer(*owner, damage, 10, round.px, round.py);
  };

  size_t write = 0;
  for (size_t i = 0; i < projectiles.size(); i++) {
    Projectile p = projectiles[i];
    if (p.kind == PK_BORE_BEAM) {
      if (--p.life <= 0) continue;
      p.fuse = imax(0, p.fuse - 1);
      projectiles[write++] = p;
      continue;
    }
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
        E.detonate(x, y, DYNAMITE_PROJECTILE_BLAST_RADIUS_LOCAL,
                   DYNAMITE_PROJECTILE_BLAST_POWER_LOCAL, 0, TNT, seed);
        continue;
      }
      if (outside || --p.life <= 0) continue;
      projectiles[write++] = p;
      continue;
    }

    if (p.kind == PK_ACID_SHELL) {
      bool hit = false, outside = false;
      double distance = std::hypot(p.vx, p.vy);
      int steps = imax(1, (int)std::ceil(distance / PROJECTILE_SWEEP_STEP));
      double sx = p.vx / steps, sy = p.vy / steps;
      for (int step = 0; step < steps && !hit; step++) {
        double nx = p.px + sx, ny = p.py + sy;
        if (nx < 1 || nx >= E.cols - 1 || ny < 1 || ny >= E.rows - 1) {
          outside = true;
          break;
        }
        if (materialStopsPoint(nx, ny) || hitsCreature(nx, ny, 1.35, p.owner) ||
            hitsPlayer(nx, ny, 1.35, p.owner)) {
          hit = true;
          break;
        }
        p.px = nx; p.py = ny;
      }
      if (hit) {
        burstAcid(p);
        continue;
      }
      if (outside || --p.life <= 0) continue;
      p.vy += ACID_SHELL_GRAVITY_LOCAL;
      p.rotation = std::atan2(p.vy, p.vx);
      projectiles[write++] = p;
      continue;
    }

    if (p.kind == PK_CLUSTER_BOMB && p.charge < .5) {
      bool outside = p.px < 1 || p.px >= E.cols - 1 || p.py < 1 || p.py >= E.rows - 1;
      bool impact = false;
      if (!outside) {
        double distance = std::hypot(p.vx, p.vy);
        int steps = imax(1, (int)std::ceil(distance / PROJECTILE_SWEEP_STEP));
        double sx = p.vx / steps, sy = p.vy / steps;
        for (int step = 0; step < steps; step++) {
          double nx = p.px + sx, ny = p.py + sy;
          if (nx < 1 || nx >= E.cols - 1 || ny < 1 || ny >= E.rows - 1) {
            outside = true;
            break;
          }
          if (blocksClusterCarrier(nx, ny) ||
              hitsCreature(nx, ny, 1.35, p.owner) ||
              hitsPlayer(nx, ny, 1.35, p.owner)) {
            impact = true;
            break;
          }
          p.px = nx; p.py = ny;
        }
        if (!impact && !outside) {
          p.vy = std::min(DYNAMITE_MAX_FALL, p.vy + CLUSTER_GRAVITY_LOCAL * .62);
          p.rotation += p.vx * .18;
        }
      }
      if (!outside && (impact || --p.fuse <= 0)) {
        splitCluster(p);
        continue;
      }
      if (outside || --p.life <= 0) continue;
      projectiles[write++] = p;
      continue;
    }

    if (p.kind == PK_CLUSTER_BOMB) {
      bool outside = p.px < 1 || p.px >= E.cols - 1 || p.py < 1 || p.py >= E.rows - 1;
      if (!outside) {
        double distance = std::hypot(p.vx, p.vy);
        int steps = imax(1, (int)std::ceil(distance / PROJECTILE_SWEEP_STEP));
        double sx = p.vx / steps, sy = p.vy / steps;
        bool blockX = false, blockY = false;
        for (int step = 0; step < steps; step++) {
          if (!blockX) {
            double nx = p.px + sx;
            if (blocksPoint(nx, p.py)) {
              p.vx = -p.vx * CLUSTER_BOUNCE_LOCAL;
              blockX = true;
            } else p.px = nx;
          }
          if (!blockY) {
            double ny = p.py + sy;
            if (blocksPoint(p.px, ny)) {
              p.vy = -p.vy * CLUSTER_BOUNCE_LOCAL;
              p.vx *= CLUSTER_FRICTION_LOCAL;
              blockY = true;
            } else p.py = ny;
          }
        }
        p.vy = std::min(DYNAMITE_MAX_FALL, p.vy + CLUSTER_GRAVITY_LOCAL);
        p.rotation += p.vx * .28;
      }
      if (--p.fuse <= 0 && !outside) {
        int x = imax(1, imin(E.cols - 2, (int)std::lround(p.px)));
        int y = imax(1, imin(E.rows - 2, (int)std::lround(p.py)));
        detonateOwnerAware(p, x, y, CLUSTER_BLAST_RADIUS_LOCAL,
                           CLUSTER_BLAST_POWER_LOCAL, GUNPOWDER);
        continue;
      }
      if (outside || --p.life <= 0) continue;
      projectiles[write++] = p;
      continue;
    }

    if (p.kind == PK_MINIGUN_ROUND) {
      bool hit = false, outside = false;
      double distance = std::hypot(p.vx, p.vy);
      int steps = imax(1, (int)std::ceil(distance / PROJECTILE_SWEEP_STEP));
      double sx = p.vx / steps, sy = p.vy / steps;
      for (int step = 0; step < steps && !hit; step++) {
        double nx = p.px + sx, ny = p.py + sy;
        if (nx < 1 || nx >= E.cols - 1 || ny < 1 || ny >= E.rows - 1) {
          outside = true;
          break;
        }
        if (materialStopsPoint(nx, ny) || hitsCreature(nx, ny, .48, p.owner) ||
            hitsPlayer(nx, ny, .48, p.owner)) {
          hit = true;
          p.px = nx; p.py = ny;
          break;
        }
        p.px = nx; p.py = ny;
      }
      if (hit) {
        int x = imax(1, imin(E.cols - 2, (int)std::floor(p.px)));
        int y = imax(1, imin(E.rows - 2, (int)std::floor(p.py)));
        detonateOwnerAware(p, x, y, MINIGUN_BLAST_RADIUS_LOCAL,
                           MINIGUN_BLAST_POWER_LOCAL, GUNPOWDER);
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
            hitsCreature(p.px, p.py, 0.8, p.owner) ||
            hitsPlayer(p.px, p.py, 0.8, p.owner)) hit = true;
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
        damageBlastOwner(p);
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
  for (const Projectile& child : pendingCluster) {
    if ((int)projectiles.size() >= PROJECTILE_MAX) break;
    projectiles.push_back(child);
  }
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
