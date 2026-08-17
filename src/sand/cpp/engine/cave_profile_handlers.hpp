#pragma once

struct CaveProfileHandlerDef {
  CaveBiomeProfile profile;
  CaveUpperDressingHandler upperDressing;
  CaveDeepDressingHandler deepDressing;
  CaveDeepStructureHandler deepStructure;
  CaveDeepFloorPolicy deepFloor;
};

inline constexpr std::array<CaveProfileHandlerDef, CBP_COUNT>
    CAVE_PROFILE_HANDLERS = {{
#define SAND_CAVE_PROFILE_HANDLER(profile, upper, deep, structure, floor) \
  {profile, upper, deep, structure, floor},
#include "cave_profile_handlers.def"
#undef SAND_CAVE_PROFILE_HANDLER
}};

template <size_t N>
constexpr bool caveProfileHandlersAreExhaustive(
    const std::array<CaveProfileHandlerDef, N>& handlers) {
  if (N != CBP_COUNT) return false;
  for (size_t index = 0; index < N; index++) {
    const CaveProfileHandlerDef& handler = handlers[index];
    if ((size_t)handler.profile != index
        || (unsigned)handler.upperDressing >= CUDH_COUNT
        || (unsigned)handler.deepDressing >= CDDH_COUNT
        || (unsigned)handler.deepStructure >= CDSH_COUNT
        || (unsigned)handler.deepFloor >= CDFP_COUNT)
      return false;
  }
  return true;
}

static_assert(CAVE_PROFILE_HANDLERS.size() == CBP_COUNT
              && caveProfileHandlersAreExhaustive(CAVE_PROFILE_HANDLERS),
              "Cave profile handlers must exhaust CaveBiomeProfile in id order");

constexpr bool caveProfileHandlerInvalidFixturesAreRejected() {
  auto fixture = CAVE_PROFILE_HANDLERS;
  fixture[0].upperDressing = (CaveUpperDressingHandler)CUDH_COUNT;
  if (caveProfileHandlersAreExhaustive(fixture)) return false;
  fixture = CAVE_PROFILE_HANDLERS;
  fixture[0].profile = fixture[1].profile;
  return !caveProfileHandlersAreExhaustive(fixture);
}
static_assert(caveProfileHandlerInvalidFixturesAreRejected(),
              "Invalid cave handler selectors must fail validation");

inline const CaveProfileHandlerDef& caveProfileHandler(
    CaveBiomeProfile profile) {
  if ((unsigned)profile < CAVE_PROFILE_HANDLERS.size())
    return CAVE_PROFILE_HANDLERS[(size_t)profile];
  __builtin_trap();
}
