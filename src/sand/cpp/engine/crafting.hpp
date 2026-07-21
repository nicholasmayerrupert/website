#pragma once

struct Engine;

struct CraftIngredient { uint8_t kind = CIK_MATERIAL; int value = 0, count = 0; };
struct CraftRecipe {
  int id = 0;
  InvSlot output;
  std::vector<CraftIngredient> ingredients;
};

class CraftingSystem {
 public:
  explicit CraftingSystem(Engine& e);
  std::vector<CraftRecipe> recipes;
  std::vector<int32_t> recipeSnapshot, ingredientSnapshot;

  bool ingredientMatches(const InvSlot& slot, const CraftIngredient& ingredient) const;
  void ensureRecipes();
  bool craftOnce(Player& p, const CraftRecipe& recipe);
  int craft(int playerId, int recipeId, bool craftMax);
  int buildRecipeSnapshot();
  int buildIngredientSnapshot();

 private:
  Engine& E;
};
