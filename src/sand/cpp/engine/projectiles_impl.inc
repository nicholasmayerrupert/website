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
// Initial corrosive disc; falling-sand reactions roughen it into a pool.
static constexpr int ACID_SPLASH_RADIUS_LOCAL = 9;
static constexpr int ACID_SPLASH_DAMAGE_LOCAL = 16;
static constexpr int CLUSTER_LAUNCHER_COOLDOWN_LOCAL = 90;
static constexpr int CLUSTER_CARRIER_FUSE_LOCAL = 120;
static constexpr int CLUSTER_BOMBLET_COUNT_LOCAL = 16;
static constexpr int CLUSTER_BOMBLET_FUSE_MIN_LOCAL = 6;
static constexpr int CLUSTER_BOMBLET_FUSE_SPAN_LOCAL = 17;
static constexpr int CLUSTER_BOMBLET_FUSE_STRIDE_LOCAL = 7;
static constexpr double CLUSTER_GRAVITY_LOCAL = 0.075;
static constexpr double CLUSTER_BOUNCE_LOCAL = 0.54;
static constexpr double CLUSTER_FRICTION_LOCAL = 0.58;
static constexpr int CLUSTER_BLAST_RADIUS_LOCAL = 18;
static constexpr double CLUSTER_BLAST_POWER_LOCAL = 13.0;
static constexpr double CLUSTER_ACTOR_DAMAGE_SCALE_LOCAL = 0.5;
static constexpr int MINIGUN_COOLDOWN_LOCAL = 2;
static constexpr int MINIGUN_ROUND_LIFE_LOCAL = 40;
static constexpr double MINIGUN_ROUND_SPEED_LOCAL = 15.5;
static constexpr int MINIGUN_BLAST_RADIUS_LOCAL = 2;
static constexpr double RESCUE_BEAM_RANGE_LOCAL = 112.0;
// Radius, not a weak visual-only puff, is what keeps these explosions tiny.
// Thirteen power lets a direct hit chip durability-13 terrain while the
// steep two-cell falloff prevents each high-rate round from opening a crater.
static constexpr double MINIGUN_BLAST_POWER_LOCAL = 13.0;

void ProjectileSystem::applyBowInput(Player& p, int previousInput) {
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p);
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
    p.weaponKick = 1;
  }
  p.bowChargeTicks = 0;
}

void ProjectileSystem::applyBlastGunInput(Player& p) {
  E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  if (!(p.input & PI_PRIMARY) || p.toolCooldown > 0) return;
  spawnBlastRound(p);
  p.weaponKick = 1;
  p.toolCooldown = BLAST_GUN_COOLDOWN;
  E.playerActionCount++;
}

void ProjectileSystem::applyDynamiteSatchelInput(Player& p, int previousInput) {
  E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  if (!primary || wasPrimary || p.toolCooldown > 0) return;
  spawnDynamite(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_DYNAMITE_SATCHEL);
  p.weaponKick = 1;
  p.toolCooldown = DYNAMITE_SATCHEL_COOLDOWN;
  E.playerActionCount++;
}

void ProjectileSystem::applyBoreCannonInput(Player& p, int previousInput) {
  E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p);
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  if (!primary || p.toolCooldown > 0) { p.bowChargeTicks = 0; return; }
  if (!wasPrimary) E.audio.emit(SE_BORE_CHARGE, p.px + p.w * .5, p.py + p.h * .42, 0.82, STONE, 0);
  if (++p.bowChargeTicks < BORE_CANNON_CHARGE_TICKS) return;
  E.creatures.fireBore(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_BORE_CANNON);
  p.bowChargeTicks = 0;
  p.weaponKick = 1;
  p.toolCooldown = BORE_CANNON_COOLDOWN;
  E.playerActionCount++;
}

void ProjectileSystem::applyAcidMortarInput(Player& p, int previousInput) {
  E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  if (!primary || wasPrimary || p.toolCooldown > 0) return;
  spawnAcidShell(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_ACID_MORTAR);
  p.weaponKick = 1;
  p.toolCooldown = ACID_MORTAR_COOLDOWN_LOCAL;
  E.playerActionCount++;
}

void ProjectileSystem::applyClusterLauncherInput(Player& p, int previousInput) {
  E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  bool primary = (p.input & PI_PRIMARY) != 0;
  bool wasPrimary = (previousInput & PI_PRIMARY) != 0;
  if (!primary || wasPrimary || p.toolCooldown > 0) return;
  spawnClusterBomb(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_CLUSTER_LAUNCHER);
  p.weaponKick = 1;
  p.toolCooldown = CLUSTER_LAUNCHER_COOLDOWN_LOCAL;
  E.playerActionCount++;
}

void ProjectileSystem::applyMinigunInput(Player& p) {
  E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  if (!(p.input & PI_PRIMARY) || p.toolCooldown > 0) return;
  spawnMinigunRound(p);
  E.inv.consumeSelectedWeaponAmmo(p, IK_MINIGUN);
  p.weaponKick = 1;
  p.toolCooldown = MINIGUN_COOLDOWN_LOCAL;
  E.playerActionCount++;
}

void ProjectileSystem::applyRescueBeamInput(Player& p) {
  E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p); p.bowChargeTicks = 0;
  if (!(p.input & PI_PRIMARY) || p.toolCooldown > 0) return;
  fireRescueBeam(p);
  p.toolCooldown = 1;
  E.playerActionCount++;
}

void ProjectileSystem::spawnArrow(Player& p, double charge) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  double sx = p.px + p.w * .5, sy = p.py + p.h * .42;
  double dx = p.aimX - sx, dy = p.aimY - sy, d = std::hypot(dx, dy);
  if (!std::isfinite(d) || d < 1e-6) { dx = p.facing; dy = 0; d = 1; }
  double speed = 2.5 + 4.5 * charge;
  Projectile arrow; arrow.id = nextId++; arrow.owner = p.id; arrow.kind = PK_ARROW;
  arrow.px = sx; arrow.py = sy; arrow.vx = dx / d * speed; arrow.vy = dy / d * speed;
  arrow.charge = charge;
  const auto* gear = E.content.gear(p.inv[p.selectedSlot].definitionId);
  if (gear && gear->family == 4) arrow.fuse = gear->power + (E.combat.hasCharm(p, 225) ? 5 : 0);
  arrow.rotation = std::atan2(arrow.vy, arrow.vx);
  projectiles.push_back(arrow);
  E.audio.emit(SE_BOW, sx, sy, 0.55 + charge * .45, EMPTY);
}

void ProjectileSystem::spawnBlastRound(Player& p) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) projectiles.erase(projectiles.begin());
  double cx = p.px + p.w * .5, cy = p.py + p.h * .42;
  double dx = p.aimX - cx, dy = p.aimY - cy, d = std::hypot(dx, dy);
  if (!std::isfinite(d) || d < 1e-6) { dx = p.facing; dy = 0; d = 1; }
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
  double gravity = E.scaledGravity(DYNAMITE_GRAVITY);
  dynamite.vy = std::max(-2.35, std::min(0.25, (dy - .5 * gravity * flight * flight) / flight));
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
  double gravity = E.scaledGravity(ACID_SHELL_GRAVITY_LOCAL);
  shell.vy = (dy - .5 * gravity * flight * flight) / flight;
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
  if (!std::isfinite(d) || d < 1e-6) { dx = 1; dy = 0; d = 1; }
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
  if (!std::isfinite(d) || d < 1e-6) { dirX = 1; dirY = 0; d = 1; }
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
  // replay/authority determinism. Each shot still travels much faster than the
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
  if (guarded) {
    double span = std::hypot(blockedX - clearX, blockedY - clearY);
    if (!std::isfinite(span) || span < 1e-6) {
      round.vx = std::cos(angle) * MINIGUN_ROUND_SPEED_LOCAL;
      round.vy = std::sin(angle) * MINIGUN_ROUND_SPEED_LOCAL;
    } else {
      double scale = MINIGUN_ROUND_SPEED_LOCAL / span;
      round.vx = (blockedX - clearX) * scale;
      round.vy = (blockedY - clearY) * scale;
    }
  } else {
    round.vx = std::cos(angle) * MINIGUN_ROUND_SPEED_LOCAL;
    round.vy = std::sin(angle) * MINIGUN_ROUND_SPEED_LOCAL;
  }
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
  if (!std::isfinite(d) || d < 1e-6) { dx = shooter.facing; dy = 0; d = 1; }
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
  if (!std::isfinite(d) || d < 1e-6) { dx = shooter.facing; dy = 0; d = 1; }
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
  if (!std::isfinite(d) || d < 1e-6) return;
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

void ProjectileSystem::fireRescueBeam(Player& player) {
  double ox = player.px + player.w * .5;
  double oy = player.py + player.h * .42;
  double dx = player.aimX - ox, dy = player.aimY - oy;
  double d = std::hypot(dx, dy);
  if (!std::isfinite(d) || d < 1e-6) { dx = player.facing; dy = 0; d = 1; }
  dx /= d; dy /= d;
  double distance = RESCUE_BEAM_RANGE_LOCAL;
  for (double t = .5; t <= RESCUE_BEAM_RANGE_LOCAL; t += .5) {
    double px = ox + dx * t, py = oy + dy * t;
    double wx = E.fg.worldOffsetX + px, wy = E.fg.worldOffsetY + py;
    bool linked = false;
    for (Creature& creature : E.creatures.creatures) {
      if (!creature.alive || creature.species != CS_SURVEYOR) continue;
      const CreatureSpecies& species = E.creatures.species(creature);
      double nx = std::max(creature.wx, std::min(wx, creature.wx + species.w));
      double ny = std::max(creature.wy, std::min(wy, creature.wy + species.h));
      double ex = wx - nx, ey = wy - ny;
      if (ex * ex + ey * ey > 1.15 * 1.15) continue;
      linked = creature.shelterCharge > 0 || E.missions.rescueCreature(creature);
      if (linked) break;
    }
    if (linked) {
      distance = t;
      break;
    }
    int x = (int)std::floor(px), y = (int)std::floor(py);
    if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows - 1) {
      distance = t;
      break;
    }
    uint8_t material = E.fg.grid[E.I(x, y)];
    if (!E.isEmptyMaterial(material) && !E.isGasMaterial(material)) {
      distance = t;
      break;
    }
  }
  Projectile beam;
  beam.owner = player.id;
  beam.kind = PK_RESCUE_BEAM;
  beam.px = ox;
  beam.py = oy;
  beam.vx = dx;
  beam.vy = dy;
  beam.life = 3;
  beam.fuse = 3;
  beam.charge = distance;
  beam.rotation = std::atan2(dy, dx);
  for (Projectile& existing : projectiles) {
    if (existing.kind != PK_RESCUE_BEAM || existing.owner != player.id) continue;
    beam.id = existing.id;
    existing = beam;
    return;
  }
  if ((int)projectiles.size() >= PROJECTILE_MAX) return;
  beam.id = nextId++;
  projectiles.push_back(beam);
}

void ProjectileSystem::spawnFireBreath(int owner, double x, double y, double targetX, double targetY, int damage, int phase) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) return;
  double angle = std::atan2(targetY - y, targetX - x) + std::sin(phase * 1.7) * .065;
  Projectile shot;
  shot.id = nextId++; shot.owner = owner; shot.kind = PK_FIRE_BREATH; shot.fuse = 300;
  shot.px = x; shot.py = y; shot.vx = std::cos(angle) * 1.55; shot.vy = std::sin(angle) * 1.55;
  shot.charge = damage; shot.life = 58;
  projectiles.push_back(shot);
  if (phase % 12 == 0) E.audio.emit(SE_RUNE, x, y, .9, 1);
}

void ProjectileSystem::spawnFrost(int owner, double x, double y, double targetX, double targetY, bool shard, int damage, int phase) {
  if ((int)projectiles.size() >= PROJECTILE_MAX) return;
  double angle = std::atan2(targetY - y, targetX - x);
  if (!shard) angle += std::sin(phase * 1.7) * .075;
  double speed = shard ? 3.1 : 1.75;
  Projectile shot;
  shot.id = nextId++; shot.owner = owner; shot.fuse = 309;
  shot.kind = shard ? PK_ICE_SHARD : PK_FROST_BREATH;
  shot.px = x; shot.py = y;
  shot.vx = std::cos(angle) * speed; shot.vy = std::sin(angle) * speed;
  shot.charge = damage; shot.life = shard ? 48 : 52;
  projectiles.push_back(shot);
  if (shard || phase % 12 == 0) E.audio.emit(SE_RUNE, x, y, shard ? 1.2 : .65, 10);
}

void ProjectileSystem::freezeSurface(double cx, double cy, int radius) {
  Engine::ActiveLayerScope foreground(E, &E.fg);
  std::vector<int> cells, removed;
  for (int y = imax(2, (int)cy - radius); y <= imin(E.rows - 3, (int)cy + radius); y++)
    for (int x = imax(2, (int)cx - radius); x <= imin(E.cols - 3, (int)cx + radius); x++) {
      if ((x-cx)*(x-cx)+(y-cy)*(y-cy) > radius*radius) continue;
      int k = E.I(x,y), mat = E.fg.grid[k];
      bool coat = mat == WATER || mat == SNOW;
      if (mat == EMPTY || mat == FIRE || mat == STEAM) {
        // Only a two-cell skin adjoining the substrate can grow into air.
        for (int distance = 1; distance <= 2; distance++) for (int offset : {-distance, distance, -distance*E.cols, distance*E.cols}) {
          int neighbor = E.fg.grid[k + offset];
          if (neighbor != ICE && E.isBlockingForActor(neighbor)) coat = true;
        }
      }
      if (!coat) continue;
      bool occupied = false;
      for (const auto& player : E.psys.players) if (player.active && player.alive
          && x + 1 > player.px && x < player.px + player.w && y + 1 > player.py && y < player.py + player.h) occupied = true;
      for (const auto& creature : E.creatures.creatures) if (creature.alive) {
        const auto& species = E.creatures.species(creature);
        double px = creature.wx - E.fg.worldOffsetX, py = creature.wy - E.fg.worldOffsetY;
        if (x + 1 > px && x < px + species.w && y + 1 > py && y < py + species.h) occupied = true;
      }
      if (!occupied) cells.push_back(k);
    }
  if (cells.empty()) return;
  CellMutationBatch frozen(E, removed);
  for (int k : cells) frozen.replaceWithStatic(k, ICE);
  frozen.commitGeneral();
}

void ProjectileSystem::spawnRune(int owner, double x, double y, double targetX, double targetY, int gearId, int damage,
                                 const SpellCast* cast, int node) {
  const auto* gear = E.content.gear(gearId);
  if (!gear) return;
  double dx = targetX - x, dy = targetY - y, distance = std::hypot(dx, dy);
  if (distance < .01) { dx = 1; dy = 0; distance = 1; }
  double angle = std::atan2(dy, dx);
  int count = gear->spell == SP_PRISM ? (owner < 0 ? 3 : 5) : 1;
  if (cast) count *= cast->shots;
  double speed = gear->spell == SP_WINTERBREATH ? .85 : gear->spell == SP_CINDERMAW ? 1.5 : gear->spell == SP_PRISM ? 3.6 : owner < 0 ? 2.4 : 2.8;
  for (int i = 0; i < count && (int)projectiles.size() < PROJECTILE_MAX; i++) {
    double a = angle + (i - (count - 1) * .5) * .16;
    Projectile bolt; bolt.id = nextId++; bolt.owner = owner; bolt.kind = PK_RUNE;
    bolt.fuse = gearId; bolt.px = x; bolt.py = y;
    bolt.vx = std::cos(a) * speed; bolt.vy = std::sin(a) * speed;
    if (gear->spell == SP_CINDERMAW) bolt.vy -= .35;
    bolt.charge = damage; bolt.rotation = gear->spell == SP_PRISM ? 2 : 0;
    double reach = gear->spell == SP_HOLLOW_STAR ? std::min((double)gear->reach, distance) : gear->reach;
    bolt.life = imax(1, (int)std::ceil(reach / speed));
    if (gear->spell == SP_FAULTLINE) {
      bolt.kind = PK_RUNE_FIELD; bolt.life = 36; bolt.charge = 1; bolt.rotation = damage;
      bolt.vx = std::cos(a) * 1.35; bolt.vy = std::sin(a) * 1.35;
      bolt.px += std::cos(a) * 6; bolt.py += std::sin(a) * 6;
    }
    if (cast) {
      bolt.cast = *cast; bolt.spellNode = node; bolt.spellBounces = cast->bounces;
      bolt.spellTimer = cast->connections[node] == SC_TIMER ? 24 : 0;
      bolt.life = bolt.life * cast->lifetime / 100;
    }
    projectiles.push_back(bolt);
  }
  E.audio.emit(SE_RUNE, x, y, .8, (uint8_t)gear->spell);
}

void ProjectileSystem::updateProjectiles() {
  auto friendlyOwner = [&](int owner) {
    if (owner >= 0) return false;
    for (const auto& c : E.creatures.creatures)
      if (c.id == -owner) return c.species == CS_VILLAGE_GUARD || c.species == CS_VILLAGE_HUNTER;
    return false;
  };
  auto hitsCreature = [&](double px, double py, double radius, int owner) {
    double wx = E.fg.worldOffsetX + px, wy = E.fg.worldOffsetY + py;
    double r2 = radius * radius;
    for (const Creature& c : E.creatures.creatures) {
      if (!c.alive || (owner < 0 && c.id == -owner) || E.creatures.isProtectedNpc(c)
          || (friendlyOwner(owner) && !E.creatures.species(c).hostile)) continue;
      const CreatureSpecies& s = E.creatures.species(c);
      double nx = std::max(c.wx, std::min(wx, c.wx + s.w));
      double ny = std::max(c.wy, std::min(wy, c.wy + s.h));
      double dx = wx - nx, dy = wy - ny;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  };
  auto hitsPlayer = [&](double px, double py, double radius, int owner) {
    if (friendlyOwner(owner)) return false;
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
    return E.isBlockingForActor(E.fg.grid[E.I(x, y)]);
  };
  auto sweepBouncingPoint = [&](Projectile& projectile, double bounce,
                                double friction) {
    double distance = std::hypot(projectile.vx, projectile.vy);
    int steps = imax(1, (int)std::ceil(distance / PROJECTILE_SWEEP_STEP));
    double stepX = projectile.vx / steps, stepY = projectile.vy / steps;
    bool blockX = false, blockY = false;
    for (int step = 0; step < steps; step++) {
      if (!blockX) {
        double nextX = projectile.px + stepX;
        if (blocksPoint(nextX, projectile.py)) {
          projectile.vx = -projectile.vx * bounce;
          blockX = true;
        } else projectile.px = nextX;
      }
      if (!blockY) {
        double nextY = projectile.py + stepY;
        if (blocksPoint(projectile.px, nextY)) {
          projectile.vy = -projectile.vy * bounce;
          projectile.vx *= friction;
          blockY = true;
        } else projectile.py = nextY;
      }
    }
  };
  auto materialStopsPoint = [&](double px, double py) {
    int x = (int)std::floor(px), y = (int)std::floor(py);
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return true;
    uint8_t material = E.fg.grid[E.I(x, y)];
    return !E.isEmptyMaterial(material) && !E.isGasMaterial(material);
  };
  auto blocksClusterCarrier = [&](double px, double py) {
    // The carrier is rendered roughly 2.5x1.8 cells. Sample a compact rounded
    // envelope so that the larger silhouette bounces before sinking into
    // terrain or liquid.
    static constexpr double OFFSETS[9][2] = {
      {0, 0}, {-.95, 0}, {.95, 0}, {0, -.72}, {0, .72},
      {-.67, -.51}, {.67, -.51}, {-.67, .51}, {.67, .51},
    };
    for (const auto& offset : OFFSETS)
      if (materialStopsPoint(px + offset[0], py + offset[1])) return true;
    return false;
  };
  auto damageSplash = [&](double px, double py, int radius, int damage, int owner, bool launch, const ContentGear* effectGear = nullptr) {
    double r2 = (double)radius * radius;
    for (Player& player : E.psys.players) {
      if (!player.active || !player.alive || friendlyOwner(owner) || (owner > 0 && player.id == owner)) continue;
      double nx = std::max(player.px, std::min(px, player.px + player.w));
      double ny = std::max(player.py, std::min(py, player.py + player.h));
      double dx = px - nx, dy = py - ny;
      if (dx * dx + dy * dy > r2) continue;
      int dealt = E.psys.damagePlayer(player, damage, 16, px, py);
      if (dealt && effectGear) for (const auto& effect : effectGear->statusEffects)
        E.status.apply(player, effect.effect, effect.durationTicks, 1, owner > 0 ? SA_PLAYER : owner < 0 ? SA_CREATURE : SA_NONE, std::abs(owner));
      if (launch) {
        double dir = player.px + player.w * .5 >= px ? 1.0 : -1.0;
        player.vx += dir * .72;
        player.vy = std::min(player.vy, -1.05);
      }
    }
    double wx = E.fg.worldOffsetX + px, wy = E.fg.worldOffsetY + py;
    for (Creature& c : E.creatures.creatures) {
      if (!c.alive || c.hurtCooldown > 0 ||
          E.creatures.isProtectedNpc(c) ||
          (owner < 0 && c.id == -owner)) continue;
      const CreatureSpecies& s = E.creatures.species(c);
      double nx = std::max(c.wx, std::min(wx, c.wx + s.w));
      double ny = std::max(c.wy, std::min(wy, c.wy + s.h));
      double dx = wx - nx, dy = wy - ny;
      if (dx * dx + dy * dy > r2) continue;
      c.health -= damage;
      if (effectGear) for (const auto& effect : effectGear->statusEffects)
        E.status.apply(c, effect.effect, effect.durationTicks, 1, owner > 0 ? SA_PLAYER : owner < 0 ? SA_CREATURE : SA_NONE, std::abs(owner));
      c.hurtCooldown = 12;
      if (c.health > 0) E.creatures.emitVoice(c, SE_CREATURE, .7);
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
    {
      Engine::ActiveLayerScope layerScope(E, &E.fg);
      E.tools.paintDisc(x, y, ACID_SPLASH_RADIUS_LOCAL, ACID, false);
    }
    E.audio.emit(SE_ACID_DISSOLVE, x, y, 1.0, ACID, 0);
  };
  auto fractureRune = [&](const Projectile& p, int radius, uint8_t material, int damage) {
    Engine::ActiveLayerScope foreground(E, &E.fg);
    ExplosivesSystem::BlastBatch front, back;
    front.emitGas = back.emitGas = false;
    uint32_t seed = (uint32_t)p.id * 2654435761u ^ (uint32_t)p.life * 2246822519u;
    E.explosives.carveBlastAcrossLayers((int)p.px, (int)p.py, radius,
      material == STONE ? 30 : 24, front, &back, nullptr, material, p.owner, seed, SE_SPELL_IMPACT, 0.0);
    E.explosives.finishBlastBatches(front, &back);
    damageSplash(p.px, p.py, radius + 1, damage, p.owner, material == STONE);
    for (auto& c : E.creatures.creatures) if (c.alive && c.health <= 0) E.creatures.killCreature(c);
  };

  std::vector<Projectile> pendingCluster;
  pendingCluster.reserve(CLUSTER_BOMBLET_COUNT_LOCAL);
  auto splitCluster = [&](const Projectile& carrier) {
    // Sixteen deterministic pseudo-random directions read as genuinely scattered
    // mini-dynamite while remaining identical on authority, replay, and clients.
    // A coprime stride permutes the 6-22 tick window, guaranteeing all sixteen
    // children distinct detonation ticks without tying fuse order to direction.
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
                                int radius, double power, uint8_t material,
                                double actorDamageScale = 1.0,
                                bool bypassActorCooldown = false) {
    uint32_t seed = (uint32_t)projectile.id * 2654435761u ^
                    (uint32_t)projectile.kind * 2246822519u;
    E.explosives.detonate(x, y, radius, power, projectile.owner > 0 ? projectile.owner : 0,
               material, seed, SE_WEAPON_EXPLOSION, actorDamageScale,
               bypassActorCooldown, projectile.owner < 0 ? -projectile.owner : 0);
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
    if (p.kind == PK_BORE_BEAM || p.kind == PK_RESCUE_BEAM || p.kind == PK_EXTRACTION_BEAM) {
      if (--p.life <= 0) continue;
      p.fuse = imax(0, p.fuse - 1);
      projectiles[write++] = p;
      continue;
    }
    if (p.kind == PK_DYNAMITE) {
      bool outside = p.px < 1 || p.px >= E.cols - 1 || p.py < 1 || p.py >= E.rows - 1;
      if (!outside) {
        sweepBouncingPoint(p, DYNAMITE_BOUNCE, DYNAMITE_FRICTION);
        int cx = (int)std::floor(p.px), cy = (int)std::floor(p.py);
        if (cx >= 0 && cx < E.cols && cy >= 0 && cy < E.rows && E.isLiquidMaterial(E.fg.grid[E.I(cx, cy)])) {
          p.vx *= 0.91; p.vy *= 0.88;
        }
        p.vy = std::min(DYNAMITE_MAX_FALL, p.vy + E.scaledGravity(DYNAMITE_GRAVITY));
        p.rotation += p.vx * .22;
      }
      if (--p.fuse <= 0 && !outside) {
        int x = imax(1, imin(E.cols - 2, (int)std::lround(p.px)));
        int y = imax(1, imin(E.rows - 2, (int)std::lround(p.py)));
        uint32_t seed = (uint32_t)p.id * 2654435761u ^ (uint32_t)p.kind * 2246822519u;
        E.explosives.detonate(x, y, DYNAMITE_PROJECTILE_BLAST_RADIUS_LOCAL,
                   DYNAMITE_PROJECTILE_BLAST_POWER_LOCAL, 0, TNT, seed,
                   SE_WEAPON_EXPLOSION);
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
      p.vy += E.scaledGravity(ACID_SHELL_GRAVITY_LOCAL);
      p.rotation = std::atan2(p.vy, p.vx);
      projectiles[write++] = p;
      continue;
    }

    if (p.kind == PK_CLUSTER_BOMB && p.charge < .5) {
      bool outside = p.px < 1 || p.px >= E.cols - 1 || p.py < 1 || p.py >= E.rows - 1;
      bool actorImpact = false;
      if (!outside) {
        double distance = std::hypot(p.vx, p.vy);
        int steps = imax(1, (int)std::ceil(distance / PROJECTILE_SWEEP_STEP));
        double sx = p.vx / steps, sy = p.vy / steps;
        bool blockX = false, blockY = false;
        for (int step = 0; step < steps; step++) {
          double nx = p.px + (blockX ? 0 : sx);
          double ny = p.py + (blockY ? 0 : sy);
          if (nx < 1 || nx >= E.cols - 1 || ny < 1 || ny >= E.rows - 1) {
            outside = true;
            break;
          }
          // Actor contact has priority when the carrier simultaneously brushes
          // nearby terrain (for example, hitting a grounded target).
          if (hitsCreature(nx, ny, 1.35, p.owner) ||
              hitsPlayer(nx, ny, 1.35, p.owner)) {
            p.px = nx; p.py = ny;
            actorImpact = true;
            break;
          }
          bool hitX = !blockX && blocksClusterCarrier(nx, p.py);
          bool hitY = !blockY && blocksClusterCarrier(p.px, ny);
          // Resolve a diagonal corner that neither axis probe reaches alone.
          if (!hitX && !hitY && blocksClusterCarrier(nx, ny)) {
            hitX = !blockX;
            hitY = !blockY;
          }
          if (hitX) {
            p.vx = -p.vx * CLUSTER_BOUNCE_LOCAL;
            blockX = true;
          } else p.px = nx;
          if (hitY) {
            p.vy = -p.vy * CLUSTER_BOUNCE_LOCAL;
            p.vx *= CLUSTER_FRICTION_LOCAL;
            blockY = true;
          } else p.py = ny;
        }
        if (!actorImpact && !outside) {
          p.vy = std::min(DYNAMITE_MAX_FALL, p.vy + E.scaledGravity(CLUSTER_GRAVITY_LOCAL) * .62);
          p.rotation += p.vx * .18;
        }
      }
      if (!outside && (actorImpact || --p.fuse <= 0)) {
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
        sweepBouncingPoint(p, CLUSTER_BOUNCE_LOCAL, CLUSTER_FRICTION_LOCAL);
        p.vy = std::min(DYNAMITE_MAX_FALL, p.vy + E.scaledGravity(CLUSTER_GRAVITY_LOCAL));
        p.rotation += p.vx * .28;
      }
      if (--p.fuse <= 0 && !outside) {
        int x = imax(1, imin(E.cols - 2, (int)std::lround(p.px)));
        int y = imax(1, imin(E.rows - 2, (int)std::lround(p.py)));
        detonateOwnerAware(p, x, y, CLUSTER_BLAST_RADIUS_LOCAL,
                           CLUSTER_BLAST_POWER_LOCAL, GUNPOWDER,
                           CLUSTER_ACTOR_DAMAGE_SCALE_LOCAL, true);
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

    if (p.kind == PK_RUNE_FIELD) {
      if (p.px < 1 || p.py < 1 || p.px >= E.cols - 1 || p.py >= E.rows - 1) continue;
      const auto* gear = E.content.gear(p.fuse);
      if (!gear) continue;
      if (p.spellTimer > 0 && --p.spellTimer == 0) E.magic.trigger(p);
      if (gear->spell == SP_HOLLOW_STAR) {
        // Bounded actor-clock attraction; static terrain is cut only at collapse.
        if (p.life % 3 == 0) {
          auto pull = [&](double x, double y, double& vx, double& vy, double strength) {
            double dx = p.px - x, dy = p.py - y, distance = std::hypot(dx, dy);
            if (distance < 1 || distance > 26) return false;
            double force = strength * (1 - distance / 30);
            vx = std::clamp(vx * .85 + dx / distance * force, -2.5, 2.5);
            vy = std::clamp(vy * .85 + dy / distance * force, -2.5, 2.5);
            return true;
          };
          for (auto& c : E.creatures.creatures) {
            if (!c.alive || E.creatures.isProtectedNpc(c) || (p.owner < 0 && c.id == -p.owner)) continue;
            const auto& s = E.creatures.species(c);
            if (pull(c.wx - E.fg.worldOffsetX + s.w * .5, c.wy - E.fg.worldOffsetY + s.h * .5, c.vx, c.vy, 1.0))
              E.status.apply(c, STATUS_CHILLED, 6, 1, p.owner > 0 ? SA_PLAYER : p.owner < 0 ? SA_CREATURE : SA_NONE, std::abs(p.owner));
          }
          for (auto& hero : E.psys.players) if (hero.active && hero.alive && hero.id != p.owner)
            pull(hero.px + hero.w * .5, hero.py + hero.h * .5, hero.vx, hero.vy, .65);
          for (auto& item : E.itemsys.items) pull(item.px, item.py, item.vx, item.vy, 1.2);
          for (Layer* layer : {&E.fg, &E.bg}) for (Body* body : layer->bodies)
            if (body->jointRole != 2 && body->material != NEUTRONIUM && body->occ.size() <= 256 &&
                pull(body->px, body->py, body->vx, body->vy, .65)) E.rigid.wakeBody(body);
        }
      } else if (gear->spell == SP_FAULTLINE) {
        if (p.life % 6 == 0) fractureRune(p, 9, STONE, (int)p.rotation);
        p.px += p.vx; p.py += p.vy;
      }
      if (--p.life <= 0) {
        E.magic.trigger(p);
        if (gear->spell == SP_HOLLOW_STAR) fractureRune(p, 12, NEUTRONIUM, (int)p.rotation);
        p.kind = PK_RUNE_BURST; p.life = 18; p.charge = 1;
        p.rotation = gear->spell == SP_HOLLOW_STAR ? 16 : 8; p.vx = p.vy = 0;
      } else p.charge = p.life / ((gear->spell == SP_HOLLOW_STAR ? 72.0 : 36.0) * p.cast.lifetime / 100);
      projectiles[write++] = p; continue;
    }
    if (p.kind == PK_RUNE_BURST) {
      if (--p.life > 0) { p.charge = p.life / 18.0; projectiles[write++] = p; }
      continue;
    }
    if (p.kind == PK_RUNE || p.kind == PK_FROST_BREATH || p.kind == PK_ICE_SHARD || p.kind == PK_FIRE_BREATH) {
      const auto* rune = E.content.gear(p.fuse);
      bool hit = false, outside = false;
      bool flame = p.kind == PK_FIRE_BREATH;
      bool breath = p.kind == PK_FROST_BREATH, shard = p.kind == PK_ICE_SHARD;
      bool frost = rune && rune->spell == SP_WINTERBREATH, molten = rune && rune->spell == SP_CINDERMAW;
      if (p.spellTimer > 0 && --p.spellTimer == 0) E.magic.trigger(p);
      if (p.cast.homing > 0) {
        double nearest = 36 * 36, tx = 0, ty = 0;
        for (const auto& c : E.creatures.creatures) {
          if (!c.alive || E.creatures.isProtectedNpc(c) || (p.owner < 0 && c.id == -p.owner)) continue;
          const auto& species = E.creatures.species(c);
          double x = c.wx - E.fg.worldOffsetX + species.w * .5, y = c.wy - E.fg.worldOffsetY + species.h * .5;
          double d = (x-p.px)*(x-p.px) + (y-p.py)*(y-p.py);
          if (d < nearest) { nearest = d; tx = x; ty = y; }
        }
        if (nearest < 36 * 36 && nearest > .01) {
          double speed = std::hypot(p.vx,p.vy), turn = std::min(.3, .07 * p.cast.homing);
          double vx = p.vx * (1-turn) + (tx-p.px)/std::sqrt(nearest)*speed*turn;
          double vy = p.vy * (1-turn) + (ty-p.py)/std::sqrt(nearest)*speed*turn;
          double length = std::hypot(vx,vy);
          if (length > .01) { p.vx = vx/length*speed; p.vy = vy/length*speed; }
        }
      }
      double hitRadius = flame ? 2.8 : frost ? 3.2 : molten ? 1.8 : 1;
      if (molten) p.vy += E.scaledGravity(.018);
      int steps = imax(1, (int)std::ceil(std::hypot(p.vx,p.vy) / .25));
      for (int j = 0; j < steps; j++) {
        double oldX = p.px, oldY = p.py;
        p.px += p.vx / steps; p.py += p.vy / steps;
        if (p.px < 1 || p.py < 1 || p.px >= E.cols-1 || p.py >= E.rows-1) { outside = true; break; }
        int mat = E.fg.grid[E.I((int)p.px,(int)p.py)];
        if (shard) {
          double speed = std::hypot(p.vx, p.vy);
          double tipX = p.px + p.vx / speed * 5, tipY = p.py + p.vy / speed * 5;
          if (tipX < 1 || tipY < 1 || tipX >= E.cols-1 || tipY >= E.rows-1) { outside = true; break; }
          if (blocksPoint(tipX, tipY)) { p.px = tipX; p.py = tipY; hit = true; break; }
        }
        auto blocksRune = [&](double x, double y) {
          return blocksPoint(x, y) || ((frost || molten || flame) &&
            (blocksPoint(x + hitRadius, y) || blocksPoint(x - hitRadius, y) ||
             blocksPoint(x, y + hitRadius) || blocksPoint(x, y - hitRadius)));
        };
        bool terrainHit = blocksRune(p.px, p.py);
        if (rune && terrainHit && ((rune->spell == SP_PRISM && p.rotation > 0) || p.spellBounces > 0)) {
          bool blockX = blocksRune(p.px, oldY), blockY = blocksRune(oldX, p.py);
          if (rune->spell == SP_PRISM) fractureRune(p, 3, CRYSTAL, (int)p.charge);
          if (blockX || !blockY) p.vx = -p.vx;
          if (blockY || !blockX) p.vy = -p.vy;
          p.px = oldX; p.py = oldY;
          if (p.spellBounces > 0) p.spellBounces--; else p.rotation--;
          break;
        }
        if (terrainHit || (rune && (rune->spell == SP_RIME || frost) && mat == WATER) ||
            (p.owner < 0 && (materialStopsPoint(p.px,p.py) || hitsPlayer(p.px,p.py,hitRadius,p.owner))) ||
            hitsCreature(p.px,p.py,hitRadius,p.owner)) { hit = true; break; }
      }
      if (outside) continue;
      if (hit || --p.life <= 0) {
        if (!rune || rune->spell != SP_HOLLOW_STAR || p.cast.connections[p.spellNode] == SC_TIMER) E.magic.trigger(p);
        auto* owner = E.psys.findPlayer(p.owner); const auto* gear = E.content.gear(p.fuse);
        if (flame) {
          damageSplash(p.px, p.py, 5, (int)p.charge, p.owner, false);
          Engine::ActiveLayerScope foreground(E, &E.fg);
          // Fire occupies open air beside the impact; the substrate stays intact.
          for (int fy = -4; fy <= 4; fy++) for (int fx = -4; fx <= 4; fx++) {
            int gx = (int)p.px + fx, gy = (int)p.py + fy;
            if (fx*fx+fy*fy > 16 || gx < 1 || gy < 1 || gx >= E.cols-1 || gy >= E.rows-1) continue;
            int k = E.I(gx,gy);
            if (E.fg.grid[k] == EMPTY && (gx*13+gy*7+p.id)%3 == 0) E.tools.paintDisc(gx,gy,0,FIRE,false);
          }
          for (auto& c : E.creatures.creatures) if (c.alive && c.health <= 0) E.creatures.killCreature(c);
          continue;
        } else if (gear && (gear->spell == SP_WINTERBREATH || gear->spell == SP_CINDERMAW)) {
          int radius = shard ? 11 : breath ? 5 : frost ? 7 : 5;
          if (shard) E.combat.enemyTerrainImpact(p.px, p.py, 7, ICE);
          damageSplash(p.px, p.py, radius, (int)p.charge, p.owner, false, gear);
          Engine::ActiveLayerScope foreground(E, &E.fg);
          if (frost) {
            freezeSurface(p.px, p.py, radius);
            for (auto& c : E.creatures.creatures) {
              if (!c.alive || E.creatures.isProtectedNpc(c) || (p.owner < 0 && c.id == -p.owner)) continue;
              const auto& def = E.creatures.species(c);
              if (std::hypot(c.wx - E.fg.worldOffsetX + def.w*.5 - p.px,
                  c.wy - E.fg.worldOffsetY + def.h*.5 - p.py) < radius + def.w*.5) {
                c.attackCooldown = imax(c.attackCooldown, 45);
              }
            }
          } else {
            E.combat.enemyTerrainImpact(p.px, p.py, 4, FIRE);
            E.tools.paintDisc((int)p.px, (int)p.py, 2, LAVA, false);
          }
          for (auto& c : E.creatures.creatures) if (c.alive && c.health <= 0) E.creatures.killCreature(c);
          if (!breath || p.id % 4 == 0) E.audio.emit(SE_SPELL_IMPACT, p.px, p.py, shard ? 1.2 : breath ? .45 : 1, frost ? ICE : LAVA);
        } else if (gear && gear->spell == SP_HOLLOW_STAR) {
          if (hit) E.magic.trigger(p);
          p.kind = PK_RUNE_FIELD; p.life = 72 * p.cast.lifetime / 100; p.rotation = p.charge; p.charge = 1; p.vx = p.vy = 0;
          E.audio.emit(SE_RUNE, p.px, p.py, 1.1, 8);
          projectiles[write++] = p; continue;
        } else if (gear && gear->spell == SP_PRISM) {
          fractureRune(p, 3, CRYSTAL, (int)p.charge);
        } else if (p.owner < 0 && p.px >= 1 && p.py >= 1 && p.px < E.cols-1 && p.py < E.rows-1) {
          int radius = p.charge > 18 ? 12 : 8;
          uint8_t material = p.fuse == 301 ? WATER : p.fuse == 304 ? ACID : p.fuse == 302 ? ICE : FIRE;
          E.combat.enemyTerrainImpact(p.px, p.py, radius, material);
          damageSplash(p.px, p.py, radius, (int)p.charge, p.owner, true, gear);
          if (material == WATER || material == ACID || material == FIRE) {
            Engine::ActiveLayerScope foreground(E, &E.fg);
            E.tools.paintDisc((int)p.px, (int)p.py, material == WATER ? 4 : 2, material, false);
          }
        } else if (owner && gear) {
          double length = std::max(.01, std::hypot(p.vx,p.vy));
          E.combat.impact(*owner,*gear,owner->px+owner->w*.5,owner->py+owner->h*.42,p.px,p.py,p.vx/length,p.vy/length,(int)p.charge);
        }
        p.rotation = shard ? 14 : breath ? 4 : frost ? 7 : molten ? 5 : gear && gear->spell == SP_PRISM ? 4 : p.owner < 0 && p.charge > 18 ? 12 : 8;
        p.kind = PK_RUNE_BURST; p.life = 18; p.charge = 1; p.vx = p.vy = 0;
      }
      projectiles[write++] = p; continue;
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
        if (E.isBlockingForActor(material)) { hit = true; break; }
        int damage = p.fuse > 0 ? (int)std::lround(p.fuse * (.4 + .6*p.charge)) : 8 + (int)std::lround(22 * p.charge);
        if (p.owner < 0 && !friendlyOwner(p.owner)) {
          for (auto& hero : E.psys.players) if (hero.active && hero.alive && p.px >= hero.px && p.px <= hero.px+hero.w && p.py >= hero.py && p.py <= hero.py+hero.h) {
            E.psys.damagePlayer(hero,damage,25,p.px-p.vx,p.py-p.vy); hit=true;
          }
        } else if (E.creatures.damageAtPoint(x, y, 1, damage)) hit = true;
      }
    }
    if (hit) {
      if (p.kind == PK_BLAST_ROUND && p.px >= 1 && p.px < E.cols - 1 && p.py >= 1 && p.py < E.rows - 1) {
        int x = (int)std::floor(p.px), y = (int)std::floor(p.py);
        uint32_t seed = (uint32_t)p.id * 2654435761u ^ (uint32_t)p.kind * 2246822519u;
        damageBlastOwner(p);
        E.explosives.detonate(x, y, BLAST_ROUND_RADIUS, BLAST_ROUND_POWER, p.owner,
                   GUNPOWDER, seed, SE_WEAPON_EXPLOSION);
      } else if (p.kind == PK_ARROW) {
        if (p.owner < 0 && !friendlyOwner(p.owner) && E.planetId == PL_FRONTIER && p.px >= 1 && p.py >= 1 && p.px < E.cols-1 && p.py < E.rows-1)
          E.combat.enemyTerrainImpact(p.px, p.py, 6, STONE);
        E.itemsys.spawnParticle(STONE, p.px, p.py, -p.vx * .08, -0.15, 12);
        E.audio.emit(SE_ARROW_HIT, p.px, p.py, 0.45 + p.charge * .55, STONE);
      }
      continue;
    }
    if (p.kind == PK_ARROW) {
      p.vy += E.scaledGravity(ARROW_GRAVITY);
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
  E.magic.flush();
}

int ProjectileSystem::buildSnapshot() {
  snapshot.assign(projectiles.size() * PRS_STRIDE, 0.0f);
  for (size_t i = 0; i < projectiles.size(); i++) {
    const Projectile& p = projectiles[i]; float* o = snapshot.data() + i * PRS_STRIDE;
    writeProjectileSnapshot(o, p);
  }
  return (int)projectiles.size();
}
