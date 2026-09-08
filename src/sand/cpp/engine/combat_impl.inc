bool CombatSystem::hasCharm(const Player& p, int id) const {
  return p.equipment[7].definitionId == id || p.equipment[8].definitionId == id;
}
int CombatSystem::defense(const Player& p) const {
  int amount = hasCharm(p, 223) ? 4 : 0;
  for (const auto& item : p.equipment) if (item.count) {
    const auto* gear = E.content.gear(item.definitionId);
    if (gear) amount += gear->defense;
  }
  return imin(45, amount);
}
bool CombatSystem::canGuard(const Player& p) const {
  return p.equipment[6].count && p.stamina > 0
    && !(p.actionState == AS_GUARD_BREAK && p.actionTicks > 0);
}
void CombatSystem::tick(Player& p) {
  if (!p.alive) return;
  if (p.dodgeCooldown > 0) p.dodgeCooldown--;
  if (p.actionTicks > 0) {
    p.actionTicks--;
    const auto* gear = E.content.gear(p.actionDefinition);
    if (gear && p.actionTicks == p.actionDuration * 2 / 3) strike(p, *gear);
  }
  if (E.actorTick % 3 == 0 && p.actionTicks == 0 &&
      (!p.shieldActive || E.actorTick - p.lastShieldDamageTick >= 60))
    p.stamina = imin(100, p.stamina + (p.shieldActive ? 1 : 3));
  if (E.actorTick % (hasCharm(p, 221) ? 8 : 15) == 0) p.mana = imin(100, p.mana + 1);
  if (hasCharm(p, 220) && E.actorTick - p.lastDamageTick > 300 && E.actorTick % 120 == 0)
    p.health = imin(100, p.health + 1);
}
void CombatSystem::apply(Player& p, int previousInput) {
  const auto& held = p.inv[p.selectedSlot];
  const auto* gear = E.content.gear(held.definitionId);
  if (!gear || held.count <= 0 || p.actionTicks || p.shieldActive) return;
  bool primary = (p.input & PI_PRIMARY) != 0;
  if (gear->family == 4) {
    if (primary) { p.bowChargeTicks = imin(BOW_CHARGE_MAX, p.bowChargeTicks + 1); return; }
    if ((previousInput & PI_PRIMARY) && p.bowChargeTicks && p.stamina >= gear->stamina) {
      bool arrow = false;
      for (auto& s : p.inv) if (s.itemKind == IK_ARROW && s.count) { if (!--s.count) s = InvSlot(); arrow = true; break; }
      if (arrow) {
        E.projectiles.spawnArrow(p, .25 + .75 * p.bowChargeTicks / BOW_CHARGE_MAX);
        p.stamina -= gear->stamina; p.actionState = AS_BOW; p.actionTicks = p.actionDuration = gear->cooldown;
        p.actionDefinition = 0; E.playerActionCount++;
      }
      p.bowChargeTicks = 0;
    }
    return;
  }
  if (!primary || p.stamina < gear->stamina || p.mana < gear->mana) return;
  if (gear->family > 5 && gear->family != 9 && gear->family != 10) return;
  if (gear->family == 10 && (previousInput & PI_PRIMARY)) return;
  p.stamina -= gear->stamina; p.mana -= gear->mana;
  p.actionDefinition = gear->id;
  p.actionTicks = p.actionDuration = gear->cooldown;
  p.actionState = gear->family == 1 ? AS_SWORD : gear->family == 2 ? AS_AXE : gear->family == 3 ? AS_SPEAR : gear->family == 10 ? AS_DRINK : AS_CAST;
  p.weaponKick = 1;
  E.playerActionCount++;
}
void CombatSystem::strike(Player& p, const ContentGear& gear) {
  if (gear.family == 10) {
    auto& held = p.inv[p.selectedSlot];
    if (held.definitionId != gear.id || held.count <= 0) return;
    if (gear.id == 320) p.health = imin(100, p.health + gear.power);
    else p.mana = imin(100, p.mana + gear.power);
    if (!--held.count) held = InvSlot();
    return;
  }
  double cx = p.px + p.w * .5, cy = p.py + p.h * .42;
  double dx = p.aimX - cx, dy = p.aimY - cy, distance = std::hypot(dx, dy);
  if (distance < .01) { dx = p.facing; dy = 0; distance = 1; }
  dx /= distance; dy /= distance;
  if (gear.family <= 3) E.audio.emit(SE_SWING, cx, cy, 1, (uint8_t)gear.family);
  if ((gear.family == 5 || gear.family == 9) && gear.spell != 6) {
    E.projectiles.spawnRune(p.id, cx, cy, cx + dx * distance, cy + dy * distance,
      gear.id, gear.power + (hasCharm(p, 225) ? 5 : 0));
    return;
  }
  double reach = gear.family <= 3 ? gear.reach : std::min((double)gear.reach, distance);
  double tx = cx, ty = cy;
  for (double at = 1; at <= reach; at += .5) {
    tx = cx + dx * at; ty = cy + dy * at;
    if (E.psys.playerCellSolid((int)tx, (int)ty)) break;
  }
  impact(p, gear, cx, cy, tx, ty, dx, dy);
}
void CombatSystem::impact(Player& p, const ContentGear& gear, double cx, double cy, double tx, double ty, double dx, double dy) {
  int damage = gear.power + (hasCharm(p, 225) ? 5 : 0);
  int spell = gear.spell;
  for (auto& creature : E.creatures.creatures) {
    if (spell == 6 || !creature.alive || E.creatures.isProtectedNpc(creature) || creature.hurtCooldown > 0) continue;
    const auto& species = E.creatures.species(creature);
    double x = creature.wx - E.fg.worldOffsetX + species.w * .5;
    double y = creature.wy - E.fg.worldOffsetY + species.h * .5;
    double vx = x - cx, vy = y - cy, length = std::hypot(vx, vy);
    bool hit = gear.family <= 3
      ? length <= (gear.family == 1 ? gear.reach : std::hypot(tx - cx, ty - cy)) + species.w * .5 &&
        (vx * dx + vy * dy) / std::max(1.0, length) > (gear.family == 3 ? .87 : gear.family == 1 ? -.15 : .20)
      : std::hypot(x - tx, y - ty) < 9 + species.w * .5;
    if (!hit) continue;
    if (gear.family <= 3 && length > .01) {
      bool blocked = false;
      for (double at = .5; at < length-species.w*.4; at+=.5)
        if (E.psys.playerCellSolid((int)(cx+vx*at/length),(int)(cy+vy*at/length))) { blocked=true; break; }
      if (blocked) continue;
    }
    if (gear.family <= 3) E.audio.emit(SE_MELEE_HIT, x, y, .85, (uint8_t)gear.family);
    creature.health -= damage; creature.hurtCooldown = 15;
    if (spell == 1) creature.burnTicks = 120;
    if (spell == 2) creature.slowTicks = 150;
    if (spell == 5) creature.rootTicks = 90;
    creature.vx += dx * (spell == 3 ? 3.5 : gear.family == 2 ? 1.5 : .6);
    creature.vy -= spell == 3 ? 1.6 : .35;
    if (spell == 2 || spell == 5) { creature.attackCooldown = imax(60, creature.attackCooldown); creature.vx *= .15; }
    E.audio.emit(SE_CREATURE, x, y, .8, creature.species);
    if (creature.health <= 0) E.creatures.killCreature(creature);
  }
  if (gear.family == 2 || spell == 4) {
    E.explosives.detonate((int)tx, (int)ty, spell == 4 ? 9 : 3, spell == 4 ? 17.0 : 4.0,
      p.id, STONE, UINT32_MAX, SE_HEAVY_IMPACT, 0.0);
  } else if (spell == 1) {
    E.explosives.detonate((int)tx, (int)ty, 8, 24.0, p.id, FIRE, UINT32_MAX, SE_SPELL_IMPACT, 0.0);
    E.tools.paintDisc((int)tx, (int)ty, 2, FIRE, false);
  } else if (spell == 2) {
    Engine::ActiveLayerScope scope(E, &E.fg);
    std::vector<int> removed;
    CellMutationBatch frozen(E, removed);
    for (int y = imax(1,(int)ty-5); y <= imin(E.rows-2,(int)ty+5); y++)
      for (int x = imax(1,(int)tx-5); x <= imin(E.cols-2,(int)tx+5); x++)
        if ((x-tx)*(x-tx)+(y-ty)*(y-ty)<=25 && E.fg.grid[E.I(x,y)]==WATER) frozen.replaceWithStatic(E.I(x,y), ICE);
    frozen.commitGeneral();
  } else if (spell == 3) {
    E.explosives.detonate((int)tx, (int)ty, 5, 2.0, p.id, EMPTY, UINT32_MAX, SE_JUMP, 0.0);
  } else if (spell == 5) {
    p.health = imin(100, p.health + 5);
    int x0, y0;
    if (E.tools.getSeedOrigin((int)tx, (int)ty, x0, y0)) E.tools.placeSeedAtTyped(x0, y0, 0);
  } else if (spell == 6) p.health = imin(100, p.health + 32);
  if ((gear.family == 1 || gear.family == 3) && E.psys.playerCellSolid((int)tx, (int)ty))
    E.audio.emit(SE_MELEE_HIT, tx, ty, .9, STONE);
  if (spell && spell != 1 && spell != 4)
    E.audio.emit(SE_SPELL_IMPACT, tx, ty, .8, spell == 2 ? ICE : spell == 5 ? ACID : EMPTY);
}

// Terrain destruction shares the component-aware blast transaction. Actor hits
// belong to the attack's contact shape, independently of terrain blast energy.
void CombatSystem::enemyTerrainImpact(double x, double y, int radius, uint8_t material, double ringRadius) {
  Engine::ActiveLayerScope foreground(E, &E.fg);
  ExplosivesSystem::BlastBatch front, back;
  front.emitGas = material == FIRE;
  back.emitGas = back.emitParticles = false;
  back.debrisStepCap = 0;
  int waves = ringRadius > 0 ? 16 : 1;
  for (int i = 0; i < waves; i++) {
    double angle = i * 6.283185307179586 / waves;
    int cx = (int)std::floor(x + std::cos(angle) * ringRadius);
    int cy = (int)std::floor(y + std::sin(angle) * ringRadius);
    if (cx < 1 || cy < 1 || cx >= E.cols - 1 || cy >= E.rows - 1) continue;
    uint32_t seed = (uint32_t)E.actorTick * 2654435761u ^ (uint32_t)i * 2246822519u;
    E.explosives.carveBlast(cx, cy, radius, 24, front, nullptr, material, seed);
    if (E.bgEnabled) {
      Engine::ActiveLayerScope background(E, &E.bg);
      E.explosives.carveBlast(cx, cy, radius, 24, back, nullptr, material, seed);
    }
  }
  E.explosives.finishBlastBatches(front, &back);
  for (int i = 0; i < 24; i++) {
    double angle = i * 2.399963 + E.actorTick * .17;
    double speed = 1.0 + (i % 5) * .38;
    uint8_t fleck = i % 3 == 0 ? ICE : ringRadius > 0 ? CRYSTAL
      : material == STONE ? (i % 2 ? FIRE : GOLD_ORE) : material;
    E.itemsys.spawnParticle(fleck,
      x + std::cos(angle) * ringRadius, y + std::sin(angle) * ringRadius,
      std::cos(angle) * speed, std::sin(angle) * speed - .6, 22 + i % 12);
  }
  if (ringRadius == 0 || ringRadius <= 8)
    E.audio.emit(ringRadius > 0 ? SE_SHOCKWAVE : material == STONE ? SE_HEAVY_IMPACT : SE_SPELL_IMPACT,
      x, y, radius >= 8 || ringRadius > 0 ? 1.2 : .7, material);
}

// Fantasy enemies commit to a telegraphed point before resolving their strike.
void CombatSystem::enemyAttack(Creature& c) {
  if (const auto* profile = enemyAttackProfile(c.species, c.attackPattern)) {
    creatureAttack(c, *profile);
    return;
  }
  const auto& species = E.creatures.species(c);
  bool boss = c.species >= CS_THORNBOUND_HART && c.species <= CS_HOLLOW_BELLKEEPER;
  bool heavy = boss || c.species == CS_ROOT_KNIGHT || c.species == CS_QUARRY_FOREMAN || c.species == CS_REACTOR_WARDEN;
  bool enraged = c.health * 2 < species.maxHealth;
  int damage = heavy ? (enraged ? 28 : 22) : imax(10, imin(18, species.damage));
  int windup = heavy ? (enraged ? 42 : 60) : 26;
  bool ring = (c.species == CS_HOLLOW_BELLKEEPER && c.attackPattern == 0) || (heavy && c.attackPattern == 2 && c.species != CS_MIRE_MATRON);
  int duration = ring ? 50 : 18;
  bool contact = (c.species == CS_THORNBOUND_HART && c.attackPattern == 0) || c.species == CS_BRIAR_WOLF || c.species == CS_FOX || c.species == CS_BONE_GUARD;
  bool slam = c.species == CS_ROOT_KNIGHT || c.species == CS_QUARRY_FOREMAN;
  double x = c.wx + species.w * .5, y = c.wy + species.h * .5;
  double localX = x - E.fg.worldOffsetX, localY = y - E.fg.worldOffsetY;
  if (c.attackState == CAS_FIRING) {
    int tick = c.attackTicks++;
    c.attackProgress = 1 - c.attackTicks / (double)duration;
    bool toll = ring;
    bool archer = c.species == CS_MINIGUNNER;
    if (tick == 0 && archer && (int)E.projectiles.projectiles.size() < PROJECTILE_MAX) {
      double dx=c.attackAimX-x,dy=c.attackAimY-y,d=std::max(1.0,std::hypot(dx,dy));
      Projectile arrow; arrow.id=E.projectiles.nextId++; arrow.owner=-c.id; arrow.kind=PK_ARROW;
      arrow.px=localX; arrow.py=localY; arrow.vx=dx/d*3.5; arrow.vy=dy/d*3.5-.2;
      arrow.fuse=damage; arrow.charge=.7; E.projectiles.projectiles.push_back(arrow);
      E.audio.emit(SE_BOW,localX,localY,.7,EMPTY);
    }
    if (contact) {
      c.vx = c.facing * (heavy ? 2.1 : 1.35);
      if (tick % 4 == 0) enemyTerrainImpact(localX + c.facing * (species.w * .5 + 2),
        localY + species.h * .35, heavy ? 8 : 5, STONE);
    }
    if (ring && tick % 6 == 0) enemyTerrainImpact(localX, localY, 5, ICE, 8 + tick * 1.4);
    if (tick == 0 && !ring && !contact && !archer) {
      int spread = heavy && c.attackPattern == 1 ? 1 : 0;
      if (c.species == CS_MIRE_MATRON) spread = c.attackPattern == 1 ? 2 : 1;
      for (int side = -spread; side <= spread; side++) {
        double tx = c.attackAimX - E.fg.worldOffsetX + side * 20;
        double ty = c.attackAimY - E.fg.worldOffsetY;
        if (slam && c.attackPattern != 1) { enemyTerrainImpact(tx, ty, 13, STONE); continue; }
        if ((int)E.projectiles.projectiles.size() >= PROJECTILE_MAX) break;
        int variedRune = c.species == CS_HOLLOW_BELLKEEPER ? 307
          : c.attackPattern == 1 && c.species == CS_FEN_WISP ? 306
          : c.attackPattern == 1 && (slam || c.species == CS_CINDER_CASTELLAN) ? 308 : 0;
        if (variedRune) {
          if (side == 0) E.projectiles.spawnRune(-c.id, localX, localY, tx, ty, variedRune, damage);
          continue;
        }
        double dx = tx - localX, dy = ty - localY, d = std::max(1.0, std::hypot(dx, dy));
        Projectile bolt; bolt.id = E.projectiles.nextId++; bolt.owner = -c.id; bolt.kind = PK_RUNE;
        bolt.fuse = c.species == CS_MIRE_MATRON ? 301 : c.species == CS_FEN_WISP ? 304
          : c.species == CS_HOLLOW_BELLKEEPER ? 302 : 300;
        bolt.px = localX; bolt.py = localY; bolt.vx = dx / d * 2.4; bolt.vy = dy / d * 2.4;
        bolt.life = 70; bolt.charge = damage;
        E.projectiles.projectiles.push_back(bolt);
        if (side == 0) E.audio.emit(SE_RUNE, localX, localY, 1, (uint8_t)(bolt.fuse - 299));
      }
    }
    for (auto& p : E.psys.players) {
      if (!p.active || !p.alive) continue;
      double px = p.px + E.fg.worldOffsetX + p.w*.5, py = p.py + E.fg.worldOffsetY + p.h*.5;
      bool hit = false;
      if (toll) {
        double radius = 8 + tick * 1.4;
        hit = std::fabs(std::hypot(px-x, py-y) - radius) < 3 && (tick % 3 == 0);
      } else if (contact) hit = std::hypot(px-x, py-y) < species.w*.5 + 5;
      else if (tick == 0 && slam && c.attackPattern != 1) {
        int spread = heavy && c.attackPattern == 1 ? 1 : 0;
        if (c.species == CS_MIRE_MATRON) spread = c.attackPattern == 1 ? 2 : 1;
        for (int side = -spread; side <= spread; side++)
          hit |= std::hypot(px-c.attackAimX-side*20, py-c.attackAimY) < (heavy ? 13 : 7);
      }
      if (hit) E.psys.damagePlayer(p, damage, 30, localX, localY);
    }
    if (c.attackTicks >= duration) {
      c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0;
      c.attackPattern = (c.attackPattern + 1) % 3; c.attackCooldown = heavy ? 72 : 58;
    }
    return;
  }
  if (c.attackState == CAS_CHARGING) {
    c.attackTicks++; c.attackProgress = c.attackTicks / (double)windup;
    if (c.attackTicks >= windup) {
      c.attackState = CAS_FIRING; c.attackTicks = 0; c.attackProgress = 1;
      if (c.species == CS_THORNBOUND_HART || c.species == CS_BRIAR_WOLF) c.vy = -1.3;
      if (!ring && (contact || slam)) E.audio.emit(SE_SWING, localX, localY, heavy ? 1.2 : .8, heavy ? 2 : 1);
    }
    return;
  }
  if (c.attackCooldown > 0) return;
  double tx, ty;
  if (!E.creatures.targetPoint(c, tx, ty, nullptr, nullptr)) return;
  double range = heavy ? 80 : (c.species == CS_FOX || c.species == CS_BRIAR_WOLF || c.species == CS_BONE_GUARD ? 22 : 52);
  if (std::hypot(tx-x, ty-y) > range) return;
  c.attackAimX = tx; c.attackAimY = ty; c.facing = tx >= x ? 1 : -1;
  c.attackState = CAS_CHARGING; c.attackTicks = 0; c.attackProgress = 0;
}

void CombatSystem::creatureAttack(Creature& c, const EnemyAttack& base) {
  const auto& species = E.creatures.species(c);
  const EnemyAttack& attack = base;
  double x = c.wx + species.w * .5, y = c.wy + species.h * .5;
  double lx = x - E.fg.worldOffsetX, ly = y - E.fg.worldOffsetY;
  auto clearLine = [&](double tx, double ty) {
    double dx = tx - x, dy = ty - y, length = std::hypot(dx, dy);
    for (double at = 1; at < length; at += 1)
      if (E.psys.playerCellSolid((int)(lx + dx * at / length), (int)(ly + dy * at / length))) return false;
    return true;
  };
  if (c.attackState == CAS_IDLE) {
    double tx, ty;
    if (c.attackCooldown > 0 || !E.creatures.targetPoint(c, tx, ty, nullptr, nullptr)
        || std::hypot(tx - x, ty - y) > attack.reach || !clearLine(tx, ty)) return;
    c.attackAimX = tx; c.attackAimY = ty; c.facing = tx >= x ? 1 : -1;
    c.attackState = CAS_CHARGING; c.attackTicks = 0; c.attackProgress = 0;
    return;
  }
  if (c.attackState == CAS_RECOVERING) {
    c.vx *= .7;
    c.attackProgress = ++c.attackTicks / 20.0;
    if (c.attackTicks >= 20) { c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0; }
    return;
  }
  if (c.attackState == CAS_CHARGING) {
    c.vx *= .7;
    c.attackProgress = ++c.attackTicks / (double)attack.windup;
    if (c.attackTicks >= attack.windup) {
      c.attackState = CAS_FIRING; c.attackTicks = 0; c.attackProgress = 1;
      if (attack.move == EM_LUNGE && species.locomotion != CL_FLYING) c.vy = -.65;
      if (attack.move <= EM_SLAM) E.audio.emit(SE_SWING, lx, ly, .85, attack.move == EM_SLAM ? 2 : 1);
    }
    return;
  }
  int tick = c.attackTicks++;
  c.attackProgress = 1 - c.attackTicks / (double)attack.duration;
  double dx = c.attackAimX - x, dy = c.attackAimY - y, length = std::max(1.0, std::hypot(dx, dy));
  if (attack.move == EM_LUNGE) {
    c.vx = c.facing * 1.35;
    if (species.locomotion == CL_FLYING || species.locomotion == CL_AQUATIC) c.vy = dy / length * 1.35;
  }
  if (tick == 0 && attack.move == EM_RUNE) {
    E.projectiles.spawnRune(-c.id, lx + dx / length * (species.w * .5 + 1),
      ly + dy / length * (species.w * .5 + 1), c.attackAimX - E.fg.worldOffsetX,
      c.attackAimY - E.fg.worldOffsetY, attack.rune, attack.damage);
  }
  if (tick == 0 && attack.move == EM_ARROW && (int)E.projectiles.projectiles.size() < PROJECTILE_MAX) {
    Projectile arrow; arrow.id = E.projectiles.nextId++; arrow.owner = -c.id; arrow.kind = PK_ARROW;
    arrow.px = lx + dx / length * (species.w * .5 + 1); arrow.py = ly;
    arrow.vx = dx / length * 3.5; arrow.vy = dy / length * 3.5 - .2;
    arrow.fuse = attack.damage; arrow.charge = 1;
    E.projectiles.projectiles.push_back(arrow); E.audio.emit(SE_BOW, lx, ly, .8, EMPTY);
  }
  if (tick == attack.duration / 3 && attack.move == EM_SLAM)
    enemyTerrainImpact(c.attackAimX - E.fg.worldOffsetX, c.attackAimY - E.fg.worldOffsetY, 10, STONE);
  if (attack.move <= EM_SLAM && (attack.move == EM_LUNGE || tick == attack.duration / 3)) {
    auto hits = [&](double tx, double ty) {
      if (attack.move == EM_SLAM) return std::hypot(tx - c.attackAimX, ty - c.attackAimY) < 11;
      double reach = attack.move == EM_LUNGE ? species.w * .5 + 5 : attack.reach;
      return std::hypot(tx - x, ty - y) < reach && (tx - x) * c.facing > -2 && clearLine(tx, ty);
    };
    if (species.hostile) for (auto& p : E.psys.players) {
      if (p.active && p.alive && hits(p.px + E.fg.worldOffsetX + p.w * .5, p.py + E.fg.worldOffsetY + p.h * .5))
        E.psys.damagePlayer(p, attack.damage, 30, lx, ly);
    }
    else for (auto& other : E.creatures.creatures) {
      const auto& target = E.creatures.species(other);
      if (!other.alive || !target.hostile || other.hurtCooldown || !hits(other.wx + target.w * .5, other.wy + target.h * .5)) continue;
      other.health -= attack.damage; other.hurtCooldown = 20; other.vx += c.facing * .7;
      E.audio.emit(SE_MELEE_HIT, other.wx - E.fg.worldOffsetX, other.wy - E.fg.worldOffsetY, .8, STONE);
      if (other.health <= 0) E.creatures.killCreature(other);
    }
  }
  if (c.attackTicks >= attack.duration) {
    c.attackState = CAS_RECOVERING; c.attackTicks = 0; c.attackProgress = 0;
    c.attackPattern = (c.attackPattern + 1) % 3; c.attackCooldown = attack.recovery;
    c.vx *= .3; c.vy *= .6;
  }
}
