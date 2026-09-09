# Aster — A Light Left in the Window

An original six-piece chamber/orchestral score composed for this game, with
four exploration movements and two combat movements. About 11 minutes 20 seconds
of music. The melodies, harmonies, instrumental parts, and arrangements are
authored in [compose-sand-score.py](../../../../scripts/compose-sand-score.py).
The MIDI files here are the editable multitrack masters; MP3 files are the
game's stereo performances. No existing song or MIDI composition is sampled.

| Piece | Duration | Character |
| --- | --- | --- |
| [A Light Left in the Window](hearth.mp3) | 2:04 | Piano states the theme in 6/8; flute takes a variation, with harp and a viola countermelody. |
| [Where the Leaves Remember](canopy.mp3) | 1:49 | A quicker Dorian woodland dance: flute, plucked strings, harp, and a celesta variation. |
| [The Earth Keeps Its Stars](hollows.mp3) | 2:25 | The tune stretches into slow 4/4, with low oboe, distant celesta, choir, and darker minor harmony. |
| [All the Roads Lead Home](afterglow.mp3) | 1:55 | Cello leads with the contrasting theme; piano and harp answer, ending with a D-major chord. |
| [Carry the Flame](embers.mp3) | 1:41 | Combat in 4/4: horns carry the tune over plucked bass, strings, timpani, and orchestral percussion. |
| [Against the Hollow Bell](bell.mp3) | 1:26 | Heavy combat in 7/8, grouped 2+2+3; strings and horns trade the themes over darker chromatic harmony. |

## Musical construction

The main eight-bar melody is built around **D–A–D, E–F**, reaching a higher A
before answering **G–E–D**. An antecedent ends on the dominant; the consequent
returns to D. The Dorian B-natural gives the G-major chord its lift, while the
A-dominant cadence uses C-sharp to make the return to D clear.

The contrasting eight-bar theme opens **A–C–G–A** over F-major harmony. A third
section develops the first theme through G minor and E half-diminished, with
sequential phrases and a chromatic dominant. The boss arrangement adds E-flat
major color; two endings use a Picardy third. Slow inner lines move independently
of the lead. Woodwinds answer phrase endings, and celesta doubles selected
returns an octave above. These details surround a lead melody that stays
foregrounded in register and dynamics.

Every movement has a four-bar introduction, written eight-bar sections,
developments and varied reprises, and a four-bar coda. Accompaniment patterns,
lead instruments, bass inversions, and rhythmic density vary by movement and
section. Deterministic timing offsets, phrase swells, articulation, and stereo
placement shape the instrumental performance. The music contains no runtime
random-note generation.

## Game playback

`musicDirector.js` streams locally served MP3s through two Web Audio media-element
decks. It starts with the piano theme and rotates through the four exploration
pieces. Nearby hostile creatures, active ranged attackers, and player damage
raise combat music; named bosses select the heavier arrangement. A 14-second
hold bridges gaps between attacks. Exploration returns with the next piece.
Wildlife, friendly NPCs, and firing into empty space do not trigger combat.

Transitions fade over 1.8 seconds into combat and 3.5 seconds back to exploration.
Track endings crossfade into the next composition. Music pauses with the game,
mute, page visibility, or disabled audio, preserving its position. Playback
starts after audio activation. Failed tracks are skipped, and all streams are
released on teardown. The effects bank does not preload or decode the full score.
The standalone embed still includes the compressed tracks in its single bundle.

## Rebuilding and instrumentation

Requires Python 3, FluidSynth, ffmpeg, and the GeneralUser GS 2.0.3 SoundFont.
On macOS, FluidSynth is available through `brew install fluid-synth`.
Obtain the instrument bank from [S. Christian Collins](https://schristiancollins.com/generaluser.php)
or [its official repository](https://github.com/mrbumpy409/GeneralUser-GS), and
place `GeneralUser-GS.sf2` in `.sand-artifacts/score-tools/`.

```sh
python3 scripts/compose-sand-score.py
python3 scripts/compose-sand-score.py --render
python3 scripts/compose-sand-score.py --render --only hearth,embers
```

The first command writes MIDI masters only. Rendering writes 44.1 kHz stereo
MP3s; a complete render also writes `manifest.json` with form, tempo, note counts,
mastering measurements, and the SoundFont hash. Intermediate WAV masters live
in `.sand-artifacts/score/`. Normal application builds need none of these tools.

GeneralUser GS supplies instrument timbres, not compositions. Its license permits
private and commercial music creation and publication of the resulting recordings.
The complete [instrument license](GeneralUser-GS-LICENSE.txt) is retained here.
The original score is separate from the CC0 sound-effects bank.

FluidSynth renders the authored MIDI with reverb and restrained chorus. Two-pass
mastering targets −23 LUFS for exploration and −21 LUFS for combat, with a −3 dBTP
ceiling and preserved phrase dynamics. The game uses a separate music bus and
brief, shallow ducking under attacks so the melody remains audible.
