CraftingSystem::CraftingSystem(Engine& e) : E(e) {}

void CraftingSystem::ensureRecipes() {
  if (!recipes.empty()) return;
  auto material = [](uint8_t mat, int count) { InvSlot s; s.itemKind = IK_MATERIAL; s.material = mat; s.count = count; return s; };
  auto mat = [](int value, int count) { return CraftIngredient{CIK_MATERIAL, value, count}; };
  recipes = {
    {6, material(BRICK, 8),   {mat(CLAY, 8)}},
    {7, material(TNT, 4),     {mat(GUNPOWDER, 12), mat(SAND, 8)}},
  };
}

bool CraftingSystem::ingredientMatches(const InvSlot& slot, const CraftIngredient& ingredient) const {
  if (slot.count <= 0 || slot.itemKind != IK_MATERIAL) return false;
  if (ingredient.kind == CIK_MATERIAL) return slot.material == ingredient.value;
  if (ingredient.kind != CIK_MATERIAL_FLAG) return false;
  return (MAT_CRAFT_FLAGS[slot.material] & ingredient.value) != 0;
}

bool CraftingSystem::craftOnce(Player& p, const CraftRecipe& recipe) {
  Player trial = p;
  for (const CraftIngredient& ingredient : recipe.ingredients) {
    int left = ingredient.count;
    // Preserve the visible hotbar when equivalent ingredients are in the backpack.
    for (int pass = 0; pass < 2 && left > 0; pass++) {
      int begin = pass == 0 ? INV_HOTBAR : 0, end = pass == 0 ? INV_SLOTS : INV_HOTBAR;
      for (int i = begin; i < end && left > 0; i++) {
        InvSlot& s = trial.inv[i];
        if (!ingredientMatches(s, ingredient)) continue;
        int take = imin(left, s.count); s.count -= take; left -= take;
        if (s.count <= 0) s = InvSlot();
      }
    }
    for (int pool = 1; pool <= INV_POOL_COUNT && left > 0; pool++) {
      if (!E.inv.hasPool(trial, pool)) continue;
      for (auto& entry : trial.pools[pool - 1].entries) {
        InvSlot s; s.material = entry.material; s.count = entry.count;
        if (!ingredientMatches(s, ingredient)) continue;
        int take = imin(left, entry.count); entry.count -= take; left -= take;
      }
    }
    if (left > 0) return false;
  }
  if (!E.inv.addStack(trial, recipe.output)) return false;
  p = trial;
  E.inv.setSelectedSlot(p, p.selectedSlot);
  return true;
}

int CraftingSystem::craft(int playerId, int recipeId, bool craftMax) {
  ensureRecipes();
  Player* p = E.psys.findPlayer(playerId);
  if (!p || !p->active || !p->alive) return 0;
  const CraftRecipe* recipe = nullptr;
  for (const auto& r : recipes) if (r.id == recipeId) { recipe = &r; break; }
  if (!recipe) return 0;
  int made = 0, limit = craftMax ? INV_STACK_MAX : 1;
  while (made < limit && craftOnce(*p, *recipe)) made++;
  if (made > 0) E.audio.emit(SE_CRAFT, p->px + p->w * .5, p->py + p->h * .5, 0.7, recipe->output.material);
  return made;
}

int CraftingSystem::buildRecipeSnapshot() {
  ensureRecipes();
  recipeSnapshot.assign(recipes.size() * CR_STRIDE, 0);
  int ingredientStart = 0;
  for (size_t i = 0; i < recipes.size(); i++) {
    const CraftRecipe& r = recipes[i]; int32_t* o = recipeSnapshot.data() + i * CR_STRIDE;
    writeCraftingRecipeSnapshot(o, r, {
      .ingredientStart = WriteCraftingRecipeSnapshotIngredientStart{
        ingredientStart},
      .ingredientCount = WriteCraftingRecipeSnapshotIngredientCount{
        (int)r.ingredients.size()},
    });
    ingredientStart += (int)r.ingredients.size();
  }
  return (int)recipes.size();
}
int CraftingSystem::buildIngredientSnapshot() {
  ensureRecipes();
  size_t n = 0; for (const auto& r : recipes) n += r.ingredients.size();
  ingredientSnapshot.assign(n * CI_STRIDE, 0); size_t at = 0;
  for (const auto& r : recipes) for (const auto& ingredient : r.ingredients) {
    int32_t* o = ingredientSnapshot.data() + at++ * CI_STRIDE;
    writeCraftingIngredientSnapshot(o, ingredient);
  }
  return (int)n;
}
