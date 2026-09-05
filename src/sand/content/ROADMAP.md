# Game rebuild

The user authorizes redesigning the /game experience and replacing its content
and presentation. Each stage must ship a playable example and remove the old
implementation it supersedes.

- [x] Named development scenes, capture CLI, live inspector
- [x] Validated runtime content packages and named world anchors
- [x] External pixel art and animation authoring
- [ ] Redesigned opening, movement and camera presentation
- [x] Blueprint map authoring and simulation preview
- [ ] Persistent entities and shared interaction vocabulary
- [ ] Quest conditions, branching dialogue and consequences
- [ ] Items, abilities, recipes and progression
- [ ] Enemy behavior and encounter authoring
- [ ] Boss phases and encounter preview
- [ ] Unified effects, sound and interface presentation
- [ ] Durable world saves and complete adventure playthrough

Verification: real engine/worker for scenarios; ordinary controls for gameplay
acceptance; focused suites and relevant benchmark comparisons. Record incomplete
work explicitly. Preserve pre-existing physics edits in this shared workspace.

## Working milestone: authoring foundation

Hearthwood Lodge replaces the station opening with timber, moss roofing, a
furnished cellar, greenhouse, and woodland palette. The three destinations use
editable blueprints; reach, passage, and drainage quests share named anchors with
the map. Player artwork and all twenty creature sprite sets are external data.
The workbench edits player frames/timing and physical map rectangles, validates
saves, reloads the real worker, and captures named scenes. Its pause mode continues
applying authority snapshots so single-stepping is visible.

Removed: embedded player/creature pixel tables, bespoke landmark stamping code,
duplicated quest coordinates/reward branches, and fixed quest-count UI logic.
Retained: the existing physics and actor behavior systems. The movement model,
combat progression, encounter design, audio palette, branching dialogue, and
persistent save system still need their own passes. The new opening is a visual
starting point, not the finished adventure.

Verification on 2026-09-04: seven focused suites pass (`game-content`, `frontier`,
`anim`, `replay-capsule`, `worldgen-version`, `game-studio-e2e`, `campaign-e2e`).
Playwright exercises walking, talking, tracking, responsive journal layouts,
repair, mouse/keyboard respawn, editor brushes/undo, frame addition/removal,
authority stepping, and scene reset. A separate real save/reload changed the
content fingerprint and restored the original artwork without recompiling WASM.
Engine benchmark checksum remains `0xb1117be5`; existing performance gates pass.
Pan benchmark reports zero horizontal/vertical instability and 17.8 ms frame p95.

Next: named persistent entities and shared interactions, followed by authored
quest transitions and encounters. Every stage should add a playable example,
ordinary-input acceptance checks, and an isolated development scene. Art and
map changes now use the content pipeline rather than C++ edits.
