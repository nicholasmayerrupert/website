# Aster: The Hollow Bell

The medieval fantasy adventure at `/game` keeps the existing cell palette,
lighting, procedural landscape, destructible structures, and two fully simulated
layers. The browser presents the game; the C++ authority owns its rules.

## Chapter and progression

The eight main quests form one continuous route:

1. **Sparks for the mill.** Speak to Osei, mine 24 iron, and exchange it for timber.
2. **A bridge worth crossing.** Place a connected, supported timber crossing with
   enough headroom. Background guide planks do not satisfy this objective.
3. **The heart beneath the thorns.** Rowan sends the player into Watchwood.
   Defeating the Thornbound Hart grants Gale Step, a single airborne dash.
4. **The drowned archive.** Mira asks the player to drain the reading hall into
   the cavern below. Its actual water coverage determines completion. The lost
   verse and Briar rune are recovered here.
5. **The memory in the mire.** Senna introduces the Mire Matron. Its defeat grants
   Windmantle: hold jump while descending to glide.
6. **An oath of cinders.** Brann’s Cinder Court houses the Castellan. Defeating it
   restores access to the bell’s clapper.
7. **The road above the wind.** Reach Windward Belfry with the earned traversal
   abilities, excavation, and construction.
8. **Let the Hollow Bell ring.** Speak to Elowen and defeat the Bellkeeper in the
   open crown of the belfry. The main story resolves, while side quests remain
   playable. Vale and Elowen acknowledge the restored bell.

Twelve side quests cover material deliveries, excavation, homecoming, and three
miniboss encounters: the Root Knight, the Stonebound, and the Ashen Sentinel.
Eight named residents give quests in contextual conversations. `world.js` owns
quest dependencies, residents, dialogue, structures, and chest loot.

The design target is a 3–5 hour first chapter. Automated progression checks prove
that its objective chain works; they do not establish ordinary-play completion
time or final difficulty balance. Those require an uninterrupted playthrough.

## Presentation and onboarding

Map (M), Journal (J), and Inventory (I) are the three full panels. They share one
focus and pause owner. The player enters the world directly. Nearby residents
show a talk prompt (T); nearby chests show an open prompt (E). Small in-world
control hints replace onboarding menus.

The map records terrain revealed from the player’s position, independently of
camera zoom. It supports panning, zooming, recentering, discovered landmarks and
tracked destinations. The Journal contains available/completed quests, tracking,
encounter notes, sound settings, controls, and save status. Chests, Osei’s
workbench, Brann’s forge, and Iven’s copper barter share Inventory.

Player art has 29 named clips with per-frame timing. Creatures have eight clips
(idle, move, windup, attack, recover, hurt, death, special). NPC clothing varies by
resident identity. Equipment colors, headwear, shoulder plates, gloves, shields,
and held weapons render on the character. Windmantle and Gale Step have visible
wind effects. Combat has committed ground warnings, boss health bars, rune
trails/impacts, and distinct melee, guard, rune, and bell sounds. The score uses
quiet plucked arpeggios and a sparse melody.

## Combat, equipment, and loot

`equipment.js` defines stable identities for 15 weapons, 36 armor pieces in six
sets, three shields, six charms, six runes, two cordials, and four story relics.
Nine equipment slots cover head, torso, hands, legs, boots, cloak, offhand, and two
charms. Weapons/runes stay in the quickbar. Spare equipment can be dropped and recovered; story relics remain protected.
Equipment changes, material payments,
crafting, and container transfers are authoritative and atomic.

Melee attacks spend stamina, commit through a windup, respect intervening walls,
and have recovery. Axes and Stonebreak alter terrain. Bows charge and consume
arrows. Guarding protects the aimed direction, spends stamina, and can break.
Dodging has a short immunity window; airborne dashing and gliding must be earned.

Ember ignites and burns; Rime slows enemies and converts water to component-backed
ice; Gale displaces creatures and loose terrain; Stonebreak opens stone; Briar
restrains enemies, offers a small heal, and can plant at a suitable ground cell;
Lumen restores health. Spell bolts stop on intervening creatures and terrain.
Bosses commit their targets before attacking, cycle patterns, and shorten their
windup below half health.

Thirty authored coffers cover the six original structures. Procedural village
buildings outside the authored chapter contain deterministic additional coffers.
Loot remains in a chest if the pack cannot accept it. Creature loot supplies
cordials and armor. Crafting uses nearby workshops; Iven exchanges runes and
cordials for copper. Later forge items require earned progression.

## Destruction and persistence

Foreground and background structures remain destructible. Osei’s “Mend the lodge” conversation action
restores only the lodge. Essential NPCs recover near their homes when buried or
lost below their region, including dormant actors. Death keeps equipment,
weapons, and relics. One quarter of pooled materials moves to a recoverable coffer
at the player’s Hearthwood spawn.

Versioned binary checkpoints store both grids and their persistent cell channels,
components, rigid bodies and joint links, streamed stores, players, equipment,
materials, creatures and dormant actors, projectiles, quests, weather, discovery,
and containers. Checksums and format/world-generation versions are checked before
loading. Browser storage uses compressed IndexedDB records with a previous-save
fallback. Saves follow item/quest transactions, run periodically, and flush when
the page is hidden or the runtime closes. A failed load disables overwriting that save. Resumed-world replay
capsules include a compressed authoritative origin checkpoint.

## Verification and remaining acceptance work

Focused suites:

- `frontier`: the eight main quests, all three minibosses, post-ending side
  quests, real bridge/drain/passage conditions, actor streaming, scoped repair.
- `adventure`: equipment transactions, NPC proximity/handoffs, chest transfers,
  complete damaged-world checkpoint round-trip and resumed-world replay origin.
- `adventure-combat`: melee timing and occlusion, guard/armor, dodge, earned
  traversal, component-backed freezing, workshop proximity, death recovery, all
  four boss warning/attack/recovery cycles, wet-bank swimming, and protected relics.
- `adventure-e2e`: ordinary panel/equipment/chest input, reload, responsive layout,
  corrupt-latest checkpoint recovery and repair.
- `adventure-opening-e2e`: the first quest through ordinary walking, jumping,
  swimming, tool-size selection, mining, collection, and NPC delivery; no grants.
- `campaign-e2e`: walking to residents, contextual quest acceptance, workshop and
  trader presentation through the shared inventory.
- `game-content`, `anim`, `game-studio-e2e`: content/clip contracts and authoring.

Before calling the chapter fully polished, finish an uninterrupted ordinary-input
playthrough, measure completion time, and tune encounter pacing, enemy variety,
resource quantities, and readability from those results. Automated tests and
scene screenshots do not replace that acceptance gate.

### Recorded implementation checks

The production and standalone embed builds, generated-source contracts, and sand
lint pass. The engine benchmark retains checksum `0xe1e87436`; horizontal and
vertical pan instability are both zero. The focused chapter, combat, content,
inventory, replay, worker, authoring, and adventure browser checks pass.

Two wider sandbox suites have known failures also reproduced against the clean
`a6303295eb37` revision: the natural-encounter cadence assertion in `creatures`,
and four inventory focus assertions in `players-e2e`. Their comparisons are
recorded under `.sand-artifacts/tests/`; they are not claimed as passing.
