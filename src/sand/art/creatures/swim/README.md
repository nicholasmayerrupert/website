# Swimming strips

This manifest registers separate swimming sources for creatures whose main
manifest does not contain a unified `atlas.swim` mapping. Unified atlases store
swimming in their fourth row (sixth for the frost giant) and are imported by `import-creature-art.mjs`;
they have no active entry here. Aquatic fish retain their movement art; flyers and stationary creatures
do not need additional swimming poses. Attack, hurt and death clips are shared
with the existing creature art.

The dragon is the only active separate strip. The other PNGs are retained as
source references. Each PNG contains one row: reach, pull, recovery. Equipped knights instead use
an extended kick, a compact knee tuck and the opposite kick. `references/` holds
the native creature appearance used for generation; `prompts/` records the exact
built-in ImageGen prompt and generated source filename for every accepted strip.

From the repository root:

```sh
node scripts/import-creature-swim.mjs
node scripts/import-creature-art.mjs FROST_GIANT
node scripts/import-creature-art.mjs VILLAGE_GUARD
node scripts/run-tests.mjs --only creature-swim,creature-swim-e2e
```

`width`/`height` are the original land canvas dimensions. `size` adjusts the
source-to-native scale. `offsets` are per-pose native-pixel translations for head
registration. The importer finds full connected silhouettes, keys out magenta,
uses the existing palette, and pads the shared canvas if extended limbs need
room. Land art retains its center/bottom anchor. Reimporting is deterministic.

All 25 strips were inspected individually as native pixels and as three poses
through the game renderer in water. The manifest records creature-specific
review notes. Checks cover all three distinct rendered poses for forward motion,
upward motion and treading water in both facings, plus dry/shallow/deep transitions.
The browser suite writes each water strip and a machine-readable result under
its test artifact directory. Visual review remains necessary after regeneration.

Open `/game?creature=VILLAGE_GUARD&swim` to compare the source and game views,
change water depth, and select Forward, Straight upward or Tread water.

## Compact source pixels

The registered dragon strip uses a compact square grid, up to 24 opaque colors
and hard transparency. Its `sourceGrid` flag preserves small detached details
during component extraction. Other active swimming poses live in the unified
creature atlases; the remaining strips and references are compact archives.
