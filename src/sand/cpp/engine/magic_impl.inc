void MagicSystem::tickMana(Player& p) {
  p.mana = std::clamp(p.mana, 0, PLAYER_MANA_MAX);
  if (!p.alive) { cancelCharge(p); p.pendingCast = SpellCast(); return; }
  if (p.mana == PLAYER_MANA_MAX) { p.manaRecoveryTicks = 0; return; }
  int interval = E.combat.hasCharm(p, 221) ? 8 : 15;
  if (++p.manaRecoveryTicks >= interval) {
    p.manaRecoveryTicks = 0; restoreMana(p, 1);
  }
}
bool MagicSystem::spendMana(Player& p, int cost) {
  if (cost < 0 || !p.alive || p.mana < cost) return false;
  p.mana -= cost; return true;
}
void MagicSystem::restoreMana(Player& p, int amount) {
  p.mana = std::clamp(p.mana + std::clamp(amount, 0, PLAYER_MANA_MAX), 0, PLAYER_MANA_MAX);
}
void MagicSystem::resetMana(Player& p) {
  p.mana = PLAYER_MANA_MAX; p.manaRecoveryTicks = 0;
  cancelCharge(p); p.pendingCast = SpellCast();
}
void MagicSystem::cancelCharge(Player& p) { p.wandChargeTicks = 0; }
void MagicSystem::apply(Player& p, int previousInput) {
  auto& item = p.inv[p.selectedSlot];
  initializeWand(item);
  SpellCast cast = compileCast(item);
  if (!cast.count || p.actionTicks > 0 || p.shieldActive) { cancelCharge(p); return; }
  bool primary = (p.input & PI_PRIMARY) != 0;
  if (cast.charged) {
    if (primary) {
      int next = imin(WAND_CHARGE_TICKS + 1, p.wandChargeTicks + 1);
      if (compileCast(item, next).manaCost <= p.mana) p.wandChargeTicks = next;
      return;
    }
    if (!(previousInput & PI_PRIMARY) || p.wandChargeTicks == 0) return;
    cast = compileCast(item, p.wandChargeTicks); cancelCharge(p);
  } else if (!primary) return;
  if (!spendMana(p, cast.manaCost)) return;
  cast.bonusDamage = E.combat.hasCharm(p, 225) ? 5 : 0;
  p.pendingCast = cast;
  p.actionDefinition = item.definitionId;
  p.actionTicks = p.actionDuration = imax(3, cast.cooldown);
  p.actionState = AS_CAST; p.weaponKick = 1;
  item.wand.cursor = cast.nextSlot;
  E.playerActionCount++;
}
void MagicSystem::fire(Player& p) {
  if (!p.pendingCast.count) return;
  SpellCast cast = p.pendingCast; p.pendingCast = SpellCast();
  double x = p.px + p.w * .5, y = p.py + p.h * .42;
  double tx = p.aimX, ty = p.aimY;
  if (std::hypot(tx-x, ty-y) < .01) { tx = x + p.facing; ty = y; }
  emit({cast, p.id, 0, x, y, tx, ty});
}
void MagicSystem::emit(const Pending& spell) {
  const auto& cast = spell.cast;
  for (int node = spell.node; node < cast.count; node++) {
    const auto* gear = E.content.gear(cast.spells[node]);
    if (!gear) return;
    auto* player = E.psys.findPlayer(spell.owner);
    if (gear->spell == SP_LUMEN) {
      if (player && player->alive) player->health = imin(100, player->health + 32 * cast.power * cast.shots / 100);
      E.audio.emit(SE_SPELL_IMPACT, spell.x, spell.y, .8, EMPTY);
    } else {
      int damage = (gear->power + cast.bonusDamage) * cast.power / 100;
      E.projectiles.spawnRune(spell.owner, spell.x, spell.y, spell.targetX, spell.targetY,
        gear->id, damage, &cast, node);
    }
    if (cast.connections[node] != SC_TOGETHER) break;
  }
}
void MagicSystem::trigger(Projectile& p) {
  if (p.spellNode < 0 || p.spellNode + 1 >= p.cast.count) return;
  int& connection = p.cast.connections[p.spellNode];
  if (connection != SC_IMPACT && connection != SC_TIMER) return;
  if (pending.size() < PROJECTILE_MAX) {
    double dx = p.vx, dy = p.vy, length = std::hypot(dx,dy);
    if (length < .01) { dx = 1; dy = 0; length = 1; }
    pending.push_back({p.cast, p.owner, p.spellNode + 1, p.px, p.py,
      p.px + dx / length * 64, p.py + dy / length * 64});
  }
  connection = SC_SEQUENCE; p.spellTimer = 0;
}
void MagicSystem::flush() {
  for (const auto& spell : pending) emit(spell);
  pending.clear();
}
