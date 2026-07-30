// Unity translation unit for the C++/WASM sand engine. Engine owns shared state
// and thin subsystem shims; composed subsystem classes hold gameplay policy.

#include "engine/common.hpp"

struct Engine {
#include "engine/members.inc"
#include "engine/audio.inc"
#include "engine/core.inc"
#include "engine/step.inc"
#include "engine/components.inc"
#include "engine/reactions.inc"
#include "engine/growth.inc"
#include "engine/tools.inc"
#include "engine/worldgen.inc"
#include "engine/rigid.inc"
#include "engine/explosives.inc"
#include "engine/render.inc"
#include "engine/camera.inc"
#include "engine/gl.inc"
#include "engine/player.inc"
#include "engine/items.inc"
#include "engine/creatures.inc"
#include "engine/missions.inc"
#include "engine/inventory.inc"
#include "engine/crafting.inc"
#include "engine/projectiles.inc"
#include "engine/netsync.inc"
};

// Out-of-line definitions of the Engine static constants.
const int Engine::DIRS_LF[2] = {-1, 1};
const int Engine::DIRS_RF[2] = {1, -1};

// Subsystem method bodies require the complete Engine definition.
#include "engine/netsync_impl.inc"
#include "engine/terrain_impl.inc"
#include "engine/renderer_impl.inc"
#include "engine/glpresenter_impl.inc"
#include "engine/items_impl.inc"
#include "engine/inventory_impl.inc"
#include "engine/crafting_impl.inc"
#include "engine/projectiles_impl.inc"
#include "engine/player_impl.inc"
#include "engine/creatures_impl.inc"
#include "engine/missions_impl.inc"
#include "engine/tools_impl.inc"
#include "engine/reactions_impl.inc"
#include "engine/explosives_impl.inc"
#include "engine/growth_impl.inc"
#include "engine/components_impl.inc"
#include "engine/rigid_impl.inc"
#include "engine/audio_impl.inc"

#include "engine/abi.inc"
