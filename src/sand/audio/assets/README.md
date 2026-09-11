# Audio asset sources

These files are edited derivatives of recordings published under Creative
Commons Zero (CC0). Attribution is not required, but the sources are retained
here so the asset history stays auditable.

License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

## Foley and ambience

Source pages and their CC0 license declarations checked 2026-09-08. For the
multi-licensed Battle Sound Effects pack, these derivatives use its CC0 option.

| Bundled files | Work and author | Source |
| --- | --- | --- |
| `stone*`, `wood*`, `metal*`, `glass*`, `hit*`, `step*`, `soil*`, `bell` | Impact Sounds — Kenney | https://kenney.nl/assets/impact-sounds |
| `cloth*`, `pickup*`, `craft` | RPG Audio — Kenney | https://kenney.nl/assets/rpg-audio |
| `swish*`, `bow` | Battle Sound Effects — artisticdude (uploaded by Ogrebane) | https://opengameart.org/content/battle-sound-effects |
| `splash*`, `bubbleLoop` | 40 CC0 water / splash / slime SFX — rubberduck | https://opengameart.org/content/40-cc0-water-splash-slime-sfx |
| `fireLoop` | Fireplace Sound loop — PagDev | https://opengameart.org/content/fireplace-sound-loop |
| `windLoop` | Short wind sound — remaxim | https://opengameart.org/content/short-wind-sound |
| `creature*` | Monster snarls — Darsycho | https://opengameart.org/content/monster-snarls |
| `explosionBurst` | Huge explosion — SamsterBirdies | https://freesound.org/people/SamsterBirdies/sounds/591998/ |

Filenames in this table have the `.mp3` extension. The exact input filenames,
excerpt positions, source SHA-256 hashes, and pre-encoding peak/RMS measurements
are in [mix-manifest.json](mix-manifest.json).

Reproduce the bank with `python3 scripts/prepare-game-audio.py --download`
from the repository root (requires ffmpeg). Omit `--download` to reuse sources
in `.sand-artifacts/audio-sources/`. Normal site and embed builds use the
committed assets and require no downloads or audio tools.

Processing removes sub-bass/DC, rolls off the harsh upper band, trims leading
foley silence, fades boundaries, and matches body loudness to -20 dBFS RMS
while preserving transients below -3 dBFS peak.
Environmental loops have crossfaded seams. Foley is mono at 32 kHz/80 kbps;
the original soundtrack is documented in [../score/README.md](../score/README.md).
The browser applies material-specific
layers, alternating takes, small pitch variations, distance filtering, and
stereo placement. Music has a separate bus with smooth combat ducking. Master
compression and a soft peak guard reserve room for simultaneous impacts.

The explosion uses a 3.5-second excerpt of SamsterBirdies' layered firecracker
recording, sourced from Freesound's high-quality MP3 preview. Processing retains
30 Hz–14 kHz, preserves the leading transient with a 0.25 ms fade, and fades the
last 400 ms. The mixer retains the rolling body, normalizes the peak once, and
varies pitch and weight with blast strength. Distant playback gradually rolls
off high frequencies.

Body-contact and solid-placement thuds combine low-pass brown noise with a
short descending sine body, scaled by material density. Acid dissolution uses
high-pass white noise at 2250 Hz, a 420 ms hold, and a 300 ms release; its
movement voice gain is 0.056. These effects are synthesized in Web Audio.

## Species voices

The separate [creature bank](creatures/README.md) contains the per-species voice
performances, source credits, and reproducible processing recipe.

## Flow and weapon recordings

Source and license checked 2026-07-23 as recorded for these assets.

- `sand-flow.wav`: “SAND POUR.wav” by nicoproson —
  https://freesound.org/people/nicoproson/sounds/627070/
- `water-flow.wav`: “Water Stream.wav” by metaepitome —
  https://freesound.org/people/metaepitome/sounds/181320/
- `blast-gun-report.mp3`: “Reddit Gunshot” by qubodup —
  https://freesound.org/people/qubodup/sounds/826162/
- `minigun-burst.mp3`: “Rifle Burst” by qubodup —
  https://freesound.org/people/qubodup/sounds/482120/
- `weapon-action.mp3`: “Gun Click 8” by qubodup —
  https://freesound.org/people/qubodup/sounds/844173/

Edits: trimmed, filtered, loudness-normalized, resampled, and (for the movement
beds) crossfaded into seamless mono loops. The gun recordings were taken from Freesound's high-quality previews,
trimmed to their useful transients, high-pass filtered, converted to mono, faded,
and encoded as 96 kbps MP3. “Rifle Burst” was extracted by its publisher from a
public-domain US military recording; the other two sources document their CC0
inputs or explicit CC0 redistribution permission on their linked pages.

Weapon reports use the recorded muzzle transient and a quieter delayed
mechanical action. TNT uses a peak-normalized explosion buffer.
Sound files are served locally with the game; no audio
is streamed from the source websites during play.

## Sparks electricity

`electric-crackle.mp3` is a mono, 32 kHz/96 kbps edit of **Long Crackle 04.wav**
by ironcross32: https://freesound.org/people/ironcross32/sounds/582631/ (CC0;
source and license checked 2026-09-11). The high-quality preview is filtered
at 140 Hz and 6.5 kHz, with 1 ms entry and 90 ms exit fades. The mixer scatters
short excerpts at varied rates into a six-second loop, with a quiet noise bed
and irregular electrical snaps. It normalizes the buffer, rolls off above
5.2 kHz, and uses one persistent voice with a short release.

The crackling, layered character was referenced against Skyrim Sparks footage
at 27–33 seconds in https://www.youtube.com/watch?v=M1JydpoIV2U . That recording
is used only as a spectrogram reference; the shipped source is the
CC0 recording above and procedural layers.
