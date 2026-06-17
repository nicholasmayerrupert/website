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
//   abi.inc        extern "C" exports consumed by engineWasm.js
//
// Material ids MUST stay in lockstep with src/sand/materials.js.

#include "engine/common.hpp"

struct Engine {
#include "engine/members.inc"
#include "engine/core.inc"
#include "engine/step.inc"
#include "engine/components.inc"
#include "engine/reactions.inc"
#include "engine/growth.inc"
#include "engine/tools.inc"
#include "engine/worldgen.inc"
#include "engine/rigid.inc"
#include "engine/render.inc"
#include "engine/camera.inc"
#include "engine/gl.inc"
#include "engine/player.inc"
#include "engine/netsync.inc"
};

// Out-of-line definitions of the Engine static constants.
const double Engine::RIGID_LAVA_ERODE_P = 0.12; // = ACID_DISSOLVE_P
const double Engine::RIGID_FIRE_ERODE_P = 0.11; // = FIRE_SPREAD_P
const double Engine::SURFACE_FREQ = 0.010;
const double Engine::CAVE_FREQ = 0.05;
const double Engine::CAVE_THRESH = 0.66;
const double Engine::TREE_PROB = 0.05;
const int Engine::SURFACE_OCT = 5;
const int Engine::GEN_SKIN = 1;
const int Engine::DIRS_LF[2] = {-1, 1};
const int Engine::DIRS_RF[2] = {1, -1};

#include "engine/abi.inc"
