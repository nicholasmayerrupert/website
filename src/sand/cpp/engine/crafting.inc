  CraftingSystem crafting{*this};
  int craftRecipe(int playerId, int recipeId, bool craftMax) { return crafting.craft(playerId, recipeId, craftMax); }
