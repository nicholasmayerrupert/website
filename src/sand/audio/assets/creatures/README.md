# Creature voice recordings

All recordings used by this bank are licensed CC0. Source pages and licenses
were checked 2026-09-09. These are edited recordings and vocal performances;
playback does not generate oscillators or download sounds from external sites.

| Sources | Author | Source page |
| --- | --- | --- |
| Creature vocals, snarls, grunts, howls, and spectral voice layers | rubberduck | [80 CC0 creature SFX](https://opengameart.org/content/80-cc0-creature-sfx) |
| Human effort, hurt, death, and greeting performances | Brandon Song (wolfwoot) | [Male Adventurer RPG](https://opengameart.org/content/voice-clip-pack-male-adventurer-rpg) |
| Dinosaur roar body | trazzz123 | [CC0 Deep Monster Roar](https://opengameart.org/content/cc0-deep-monster-roar) |
| Bird calls | syncopika | [Bird chirping sounds](https://opengameart.org/content/bird-chirping-sounds) |
| Bat screeches | polymorpheva; edited by AntumDeluge | [Bat Screeches](https://opengameart.org/content/bat-screeches), [original recording](https://freesound.org/s/104205/) |
| Toad croaks | AntumDeluge | [Mutant Frog](https://opengameart.org/content/mutant-frog) |
| Skeletal clacks and collapsing bones | Kenney | [Impact Sounds](https://kenney.nl/assets/impact-sounds) |
| Root creaks | Kenney | [RPG Audio](https://kenney.nl/assets/rpg-audio) |
| Fish bubbles | rubberduck | [40 CC0 water / splash / slime SFX](https://opengameart.org/content/40-cc0-water-splash-slime-sfx) |

License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

`audio/creatureVoices.js` assigns every species its own call, attack, hurt,
death, movement texture, pitch, gain, and audible distance. Spectral voices use
short filtered echoes. Skeletal clacks combine irregularly spaced wooden
impacts; the dinosaur combines a deep roar with a quieter second performance.
The manifest records exact sources, source hashes, excerpt times, layers,
processing, duration, peak level, and RMS level for every derived recording.

Rebuild with `python3 scripts/prepare-creature-audio.py --download`; omit
`--download` to reuse `.sand-artifacts/creature-audio-sources/` and the existing
foley cache. The script requires ffmpeg and Python's standard library. It only
writes this bank and `audio/creatureBank.generated.js`.

Files are mono, 32 kHz, 80 kbps MP3. Edits trim silence, remove rumble, soften the
upper band, fade boundaries, and match body loudness to -21 dBFS RMS with at
least 4 dB peak headroom. The mixer adds modest take/pitch variation, distance
filtering and stereo placement. Quiet calls and movement use at most four
simultaneous creature voices; foreground creature sounds can use up to eight.
