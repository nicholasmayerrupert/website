// Falling-sand simulation engine, ported from src/sand/*.js to C++/WebAssembly.
// Behavioral parity (not bit-identical) with the JS engine.
//
// The implementation is split per-subsystem into engine/*.inc files (mirroring
// the JS module layout) and assembled here into one Engine class. Each .inc
// holds that subsystem's methods; they all share the Engine members declared in
// engine/members.inc, exactly like the JS createX(S) factories share `S`.
//
//   common.hpp     enums, material tables, tunables, noise, Comp/Body/Contact
//   members.inc    Engine data members, ctor, hot inline helpers (rand/I/marks)
//   core.inc       grid CA settle passes + side sinks   (engine.js)
//   step.inc       the step() pipeline                  (engine.js)
//   components.inc grid-aligned stone/plant/ice          (components.js)
//   reactions.inc  fire/acid/lava/ice                    (reactions.js)
//   growth.inc     plant growth                          (growth.js)
//   tools.inc      brushes/drafts/seeds                  (tools.js)
//   worldgen.inc   streaming infinite world              (worldgen + worldWindow)
//   rigid.inc      free rigid bodies                     (rigid2d.js + rigidBodies.js)
//   abi.inc        extern "C" exports consumed by wasmBridge/engineFactory.js
//
// Material ids MUST stay in lockstep with src/sand/materials.schema.json.

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
#include "engine/inventory.inc"
#include "engine/netsync.inc"
};

// Out-of-line definitions of the Engine static constants.
const int Engine::DIRS_LF[2] = {-1, 1};
const int Engine::DIRS_RF[2] = {1, -1};

// Out-of-line method bodies for the extracted subsystem classes (need Engine).
#include "engine/netsync_impl.inc"
#include "engine/terrain_impl.inc"
#include "engine/renderer_impl.inc"
#include "engine/glpresenter_impl.inc"
#include "engine/items_impl.inc"
#include "engine/inventory_impl.inc"
#include "engine/player_impl.inc"
#include "engine/creatures_impl.inc"
#include "engine/tools_impl.inc"
#include "engine/reactions_impl.inc"
#include "engine/explosives_impl.inc"
#include "engine/growth_impl.inc"
#include "engine/components_impl.inc"
#include "engine/rigid_impl.inc"
#include "engine/audio_impl.inc"

#include "engine/abi.inc"
