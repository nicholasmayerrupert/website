  // Plant + mycelium growth (GrowthSystem, growth.hpp) — composed here; method
  // bodies in growth_impl.inc.
  GrowthSystem growth{*this};
  void growPlantComponents() { growth.growPlantComponents(); }
  void growMyceliumComponents() { growth.growMyceliumComponents(); }
  void refreshDormantMyceliumComponents() { growth.refreshDormantMyceliumComponents(); }
