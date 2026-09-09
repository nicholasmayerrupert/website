"""Original Aster score: authored melodies, harmony, orchestration, and MIDI masters.

python3 scripts/compose-sand-score.py [--render] [--only hearth,canopy,...]
Rendering requires FluidSynth, ffmpeg, and GeneralUser-GS.sf2 in
.sand-artifacts/score-tools/ (see src/sand/audio/score/README.md).
No composition or rendering tools are needed by the game or its normal builds.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src/sand/audio/score'
WORK = ROOT / '.sand-artifacts/score'
FONT = ROOT / '.sand-artifacts/score-tools/GeneralUser-GS.sf2'
PPQ = 960


def pitch(name):
    if isinstance(name, int):
        return name
    return 12 * (int(name[-1]) + 1) + dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)[name[0]] + (1 if '#' in name else -1 if 'b' in name else 0)


def line(text):
    return [(None if n == '_' else pitch(n), float(d)) for n, d in (token.split(':') for token in text.split())]


# The Aster theme: the fourth-shaped D-A-D opens into E-F, reaches A,
# then answers through G-E-D. Eight-bar antecedent/consequent, in 6/8.
A = list(map(line, [
    'D5:1 A4:.5 D5:.5 E5:.5 F5:.5',
    'A5:1 G5:.5 E5:1 D5:.5',
    'F5:.75 E5:.25 D5:.5 A4:.5 C5:.5 D5:.5',
    'E5:1.5 A4:1 _:0.5',
    'D5:.75 E5:.25 F5:.5 A5:1 C6:.5',
    'B5:1 A5:.5 G5:.5 E5:.5 D5:.5',
    'F5:1 E5:.5 C#5:.5 E5:.5 A4:.5',
    'D5:2.5 _:0.5',
]))
# A contrasting, longer-breathed relative-major melody, retaining the fourth.
B = list(map(line, [
    'A5:1 C6:.5 G5:1 A5:.5',
    'B5:.75 A5:.25 G5:.5 E5:1 _:0.5',
    'F5:.5 G5:.5 A5:1 E5:.5 F5:.5',
    'G5:1.5 C5:1 _:0.5',
    'F5:1 A5:.5 D6:1 C6:.5',
    'B5:1 G5:.5 E5:.5 D5:.5 E5:.5',
    'F5:.5 E5:.5 C#5:1 E5:.5 C#5:.5',
    'D5:2.5 _:0.5',
]))
# Development sequences the head of the theme through G minor and E half-diminished.
C = list(map(line, [
    'G5:1 D5:.5 G5:.5 A5:.5 Bb5:.5',
    'A5:1 F5:.5 E5:.5 D5:.5 C5:.5',
    'E5:1 Bb4:.5 E5:.5 F5:.5 G5:.5',
    'E5:.5 D5:.5 C#5:1 A4:1',
    'Bb4:.5 D5:.5 F5:.5 A5:.5 G5:.5 F5:.5',
    'E5:1 G5:.5 Bb5:.5 A5:.5 G5:.5',
    'F5:.5 E5:.5 D5:.5 C#5:.5 E5:.5 A4:.5',
    'D5:1.5 E5:.5 F5:.5 A5:.5',
]))
# Independent inner voice: slower contrary motion leaves space for the tune.
COUNTER = list(map(line, [
    '_:.5 A3:1 C4:.5 D4:1', 'D4:1.5 C4:.5 A3:1',
    'A3:1 G3:.5 F3:1 A3:.5', 'G3:1 E3:.5 C#4:1 _:0.5',
    '_:.5 F3:1 A3:.5 C4:1', 'D4:1 B3:.5 A3:.5 G3:1',
    'A3:1 G3:.5 E3:.5 C#4:1', 'F3:1 E3:.5 D3:1 _:0.5',
]))

# Each voicing explicitly specifies bass and four inner chord tones.
CHORDS = {
    'dm': ('D2', 'A3 D4 F4 A4'), 'dmC': ('C2', 'A3 D4 F4 A4'),
    'bb': ('Bb1', 'A3 D4 F4 Bb4'), 'fA': ('A1', 'A3 C4 F4 G4'),
    'g': ('G2', 'B3 D4 G4 A4'), 'gm': ('G2', 'Bb3 D4 F4 A4'),
    'a': ('A1', 'G3 C#4 E4 A4'), 'aS': ('A1', 'G3 D4 E4 A4'),
    'f': ('F2', 'A3 C4 E4 G4'), 'cE': ('E2', 'G3 C4 E4 G4'),
    'c': ('C2', 'G3 C4 E4 D5'), 'em': ('E2', 'G3 Bb3 D4 G4'),
    'eb': ('Eb2', 'G3 Bb3 D4 F4'), 'dM': ('D2', 'A3 D4 F#4 A4'),
}
HARMONY = {
    'A': ['dm', 'bb', 'fA', 'aS', 'f', 'g', 'a', 'dm'],
    'B': ['f', 'g', 'fA', 'c', 'bb', 'g', 'a', 'dm'],
    'C': ['gm', 'dmC', 'em', 'a', 'bb', 'em', 'a', 'dm'],
}

# Program numbers are zero-based General MIDI. Panning follows a chamber ensemble.
PARTS = {
    'piano': (0, 0, 58, 100, 35), 'harp': (1, 46, 83, 83, 53),
    'flute': (2, 73, 45, 88, 52), 'cello': (3, 42, 80, 83, 48),
    'strings': (4, 48, 47, 78, 59), 'horn': (5, 60, 75, 78, 54),
    'celesta': (6, 8, 91, 76, 67), 'pizz': (7, 45, 39, 74, 37),
    'bass': (8, 43, 62, 92, 30), 'drums': (9, 48, 64, 85, 35),
    'oboe': (10, 68, 55, 81, 53), 'viola': (11, 41, 36, 73, 48),
    'timpani': (12, 47, 68, 88, 48), 'choir': (13, 52, 64, 64, 72),
}

TRACKS = [
    dict(id='hearth', title='A Light Left in the Window', mode='explore', bpm=72, meter=3,
         style='hearth', form=['intro', 'A', 'Av', 'B', 'C', 'Ar', 'coda'], lead='piano', key='D minor / Dorian'),
    dict(id='canopy', title='Where the Leaves Remember', mode='explore', bpm=96, meter=3,
         style='canopy', form=['intro', 'A', 'B', 'Av', 'C', 'Br', 'Ar', 'coda'], lead='flute', key='D Dorian / F Lydian'),
    dict(id='hollows', title='The Earth Keeps Its Stars', mode='explore', bpm=68, meter=4,
         style='hollows', form=['intro', 'A', 'C', 'B', 'Ar', 'coda'], lead='oboe', key='D minor / G minor'),
    dict(id='afterglow', title='All the Roads Lead Home', mode='explore', bpm=78, meter=3,
         style='afterglow', form=['intro', 'B', 'A', 'C', 'Br', 'Ar', 'coda'], lead='cello', key='F major / D minor / D major'),
    dict(id='embers', title='Carry the Flame', mode='combat', bpm=138, meter=4,
         style='embers', form=['intro', 'A', 'Av', 'B', 'C', 'Ar', 'Br', 'coda'], lead='horn', key='D minor / Dorian'),
    dict(id='bell', title='Against the Hollow Bell', mode='combat', bpm=144, meter=3.5,
         style='bell', form=['intro', 'C', 'A', 'B', 'Cv', 'Ar', 'Br', 'coda'], lead='strings', key='D minor / Eb major / D major'),
]


def vlq(number):
    result = [number & 127]
    while number > 127:
        number >>= 7
        result.insert(0, (number & 127) | 128)
    return bytes(result)


class Score:
    def __init__(self, spec):
        self.spec = spec
        self.parts = {name: [] for name in PARTS}
        self.markers = []
        self.note_count = 0

    def event(self, part, beat, message, order=1):
        self.parts[part].append((max(0, round(beat * PPQ)), order, message))

    def note(self, part, beat, duration, key, velocity=60, human=True):
        if key is None:
            return
        key = pitch(key)
        # Fixed performance phrasing: reproducible timing, never random composition.
        if human:
            beat += .010 * math.sin(beat * 3.17 + key * .41)
            velocity += round(2 * math.sin(beat * 1.8 + key))
        channel = PARTS[part][0]
        self.event(part, beat, bytes([0x90 | channel, key, min(120, max(1, int(velocity)))]))
        self.event(part, beat + duration, bytes([0x80 | channel, key, 0]), 0)
        self.note_count += 1

    def phrase(self, part, start, notes, scale=1, octave=0, velocity=75, ornament=False):
        cursor = 0
        for i, (key, duration) in enumerate(notes):
            length = duration * scale
            if key is not None:
                # The longest notes crest; weak passing notes stay lighter.
                expression = 4 if duration >= 1 else -5
                if ornament and i == 0 and duration >= 1:
                    self.note(part, start + cursor, .16 * scale, key + octave + 2, velocity - 12)
                    self.note(part, start + cursor + .16 * scale, length * .94 - .16 * scale, key + octave, velocity + expression)
                else:
                    self.note(part, start + cursor, length * .94, key + octave, velocity + expression)
            cursor += length

    def save(self, path, beats):
        tempo = round(60_000_000 / self.spec['bpm'])
        meter = self.spec['meter']
        numerator, denominator = (7, 3) if meter == 3.5 else ((6, 3) if meter == 3 else (4, 2))
        conductor = [(0, 0, b'\xff\x51\x03' + tempo.to_bytes(3, 'big')),
                     (0, 1, bytes([0xff, 0x58, 4, numerator, denominator, 24, 8]))]
        for beat, title in self.markers:
            raw = title.encode()
            conductor.append((round(beat * PPQ), 2, b'\xff\x06' + vlq(len(raw)) + raw))
        tracks = [conductor]
        for name, events in self.parts.items():
            ch, program, pan, volume, reverb = PARTS[name]
            initial = [bytes([0xc0 | ch, program]), bytes([0xb0 | ch, 7, volume]),
                       bytes([0xb0 | ch, 10, pan]), bytes([0xb0 | ch, 91, reverb]),
                       bytes([0xb0 | ch, 93, 8])]
            title = name.encode()
            tracks.append([(0, -2, b'\xff\x03' + vlq(len(title)) + title)]
                          + [(0, -1, message) for message in initial] + events)
        result = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), PPQ)
        for events in tracks:
            data, previous = b'', 0
            for at, _, message in sorted(events, key=lambda e: (e[0], e[1])):
                data += vlq(at - previous) + message
                previous = at
            end = max(previous, round(beats * PPQ))
            data += vlq(end - previous) + b'\xff\x2f\x00'
            result += b'MTrk' + struct.pack('>I', len(data)) + data
        path.write_bytes(result)


def arrange(spec):
    score = Score(spec)
    meter = spec['meter']
    combat = spec['mode'] == 'combat'
    style = spec['style']
    bar = 0
    for section_index, section in enumerate(spec['form']):
        intro, coda = section == 'intro', section == 'coda'
        reprise = section.endswith('r')
        variation = section.endswith('v')
        motif = section[0] if not (intro or coda) else 'A'
        bars = 4 if intro or coda else 8
        score.markers.append((bar * meter, section))
        for local in range(bars):
            index = local if not coda else local + 4
            chord_name = HARMONY[motif][index]
            if intro:
                chord_name = ['dm', 'bb', 'g' if style == 'canopy' else 'gm', 'aS'][local]
            if style == 'bell' and motif == 'C' and local in [1, 5]:
                chord_name = 'eb'
            if coda and local == 3 and style in ['afterglow', 'bell']:
                chord_name = 'dM'
            bass_name, chord_text = CHORDS[chord_name]
            bass, chord = pitch(bass_name), list(map(pitch, chord_text.split()))
            start = bar * meter
            scale = meter / 3
            intensity = .67 if intro else .72 if coda else 1.06 if reprise else .93 if motif == 'B' else 1
            intensity *= .88 + .13 * math.sin(math.pi * (local + 1) / (bars + 1))
            if style == 'hollows':
                intensity *= .83

            # Bass roots, inversions, and passing fifths articulate the harmonic rhythm.
            score.note('bass' if combat else 'cello', start, meter * .88, bass + (0 if combat else 12), 54 * intensity)
            if combat:
                for beat in [0, 1.5, 2.5] if meter == 3.5 else [0, 1.5, 2, 3.5]:
                    score.note('pizz', start + beat, .32, bass + 12, 57 * intensity)
            elif style == 'canopy':
                score.note('pizz', start + 1.5, .55, bass + 19, 43 * intensity)

            # Open piano/harp voicings avoid crowding the register carrying the melody.
            arp = 'harp' if style in ['canopy', 'hollows', 'bell'] else 'piano'
            pattern = [0, 2, 1, 3, 2, 1]
            if motif == 'B':
                pattern = [0, 1, 3, 2, 1, 2]
            elif motif == 'C':
                pattern = [2, 0, 1, 3, 1, 0]
            if combat:
                pattern = [0, 2, 1, 3, 2, 0, 1] if meter == 3.5 else [0, 2, 1, 3, 2, 1, 3, 2]
            if style == 'hollows':
                pattern = [0, 2, 3, 1]
            for step, tone in enumerate(pattern):
                at = step * meter / len(pattern)
                score.note(arp, start + at, .8 if style == 'hollows' else .52,
                           chord[tone], (40 + (7 if step in [0, 3] else 0)) * intensity)
            if style in ['afterglow', 'hearth'] and not intro:
                score.note('harp', start + meter * .5, .8, chord[-1] + 12, 33 * intensity)

            # Sustained inner voices enter by phrase, with orchestral breathing.
            if not intro or local >= 2:
                pad = 'choir' if style == 'hollows' else 'strings'
                if spec['lead'] == 'strings':
                    pad = 'choir'
                for j, key in enumerate(chord[:3]):
                    score.note(pad, start + j * .018, meter * .92, key - (12 if combat else 0), (38 if combat else 32) * intensity)

            if not intro:
                melody = {'A': A, 'B': B, 'C': C}[motif][index]
                if chord_name == 'eb':
                    melody = [(key - 1 if key == pitch('E5') else key, length) for key, length in melody]
                lead = spec['lead']
                if variation:
                    lead = 'flute' if style in ['hearth', 'embers'] else 'celesta' if style == 'canopy' else 'horn'
                if motif == 'B' and style == 'bell':
                    lead = 'horn'
                if coda:
                    lead = 'piano' if not combat else 'horn'
                octave = -12 if lead in ['cello', 'horn', 'oboe'] else 0
                # 7/8 uses a 2+2+3 pulse underneath an unbroken, singable theme.
                score.phrase(lead, start, melody, scale, octave,
                             (80 if combat else 76) * intensity,
                             ornament=variation and local in [0, 4])
                if reprise:
                    score.phrase('celesta', start, melody, scale, 12, 40 * intensity)
                if (section_index >= 2 and not coda and motif == 'A'):
                    score.phrase('viola', start, COUNTER[local], scale, 0, 49 * intensity)
                elif motif in ['B', 'C'] and local % 2 == 1:
                    # Woodwind answers occupy the resting ends of melodic sentences.
                    reply = [(chord[1] + 12, .5), (chord[2] + 12, .5), (chord[0] + 12, .5)]
                    score.phrase('flute' if lead != 'flute' else 'oboe', start + meter / 2,
                                 reply, scale, 0, 49 * intensity)
                if combat and reprise:
                    score.phrase('strings' if lead != 'strings' else 'horn', start, melody,
                                 scale, -12, 51 * intensity)
            else:
                # The introduction previews the head of the tune in augmentation.
                if local in [0, 2]:
                    score.phrase('piano' if style != 'hollows' else 'celesta', start,
                                 [(pitch('D5'), 1), (pitch('A4'), .5), (pitch('D5'), 1.5)], scale, 0, 59)

            if style in ['canopy', 'afterglow'] and local in [3, 7]:
                for j, key in enumerate(chord):
                    score.note('celesta', start + meter - 1 + j * .20, .6, key + 12, 37)
            if style == 'hollows' and local in [0, 4]:
                score.note('celesta', start + .12, meter * 1.5, chord[-1] + 12, 47)

            if combat:
                # Orchestral bass drum, low toms, timpani and brushed cymbal accents.
                pulses = [0, 1, 2] if meter == 3.5 else [0, 1.5, 2, 3.5]
                for j, beat in enumerate(pulses):
                    score.note('drums', start + beat, .22, 36 if j % 2 == 0 else 41, (68 if j == 0 else 46) * intensity, False)
                for step in range(int(meter * 2)):
                    score.note('drums', start + step * .5, .1, 42, (30 if step % 2 else 39) * intensity, False)
                score.note('timpani', start, .85, max(36, bass + 12), 56 * intensity)
                if local in [0, 4] and not coda:
                    score.note('drums', start, 1.5, 49, 44 * intensity, False)
                if local == 7 and not coda:
                    for j in range(6):
                        score.note('drums', start + meter - 1 + j / 6, .12, [45, 45, 43, 43, 41, 41][j], 39 + j * 5, False)
                if motif == 'C':
                    for beat in [0, 1, 2]:
                        score.note('strings', start + beat, .22, chord[0], 48 * intensity)
            bar += 1
    beats = bar * meter
    score.save(OUT / f"{spec['id']}.mid", beats)
    return dict(**spec, bars=bar, seconds=round(beats * 60 / spec['bpm'] + 4, 3), notes=score.note_count,
                sections=[dict(beat=beat, name=name) for beat, name in score.markers])


def render(spec):
    name = spec['id']
    wav = WORK / f'{name}.wav'
    subprocess.run(['fluidsynth', '-ni', '-r', '44100', '-g', '.65', '-R', '1', '-C', '1',
                    '-o', 'synth.reverb.room-size=0.72', '-o', 'synth.reverb.damp=0.45',
                    '-o', 'synth.reverb.width=85', '-o', 'synth.reverb.level=0.26',
                    '-o', 'synth.chorus.level=0.10', '-F', str(wav), '-T', 'wav',
                    str(FONT), str(OUT / f'{name}.mid')], check=True, stdout=subprocess.DEVNULL)
    # Two-pass integrated mastering retains phrase dynamics and orchestral attack.
    duration = spec['seconds']
    base = f'highpass=f=35,lowpass=f=14500,atrim=0:{duration},afade=t=in:d=0.035,afade=t=out:st={duration - 3}:d=3'
    target = -21 if spec['mode'] == 'combat' else -23
    analysis = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(wav), '-af',
        base + f',loudnorm=I={target}:TP=-3:LRA=12:print_format=json', '-f', 'null', '-'],
        capture_output=True, text=True, check=True)
    levels, _ = json.JSONDecoder().raw_decode(analysis.stderr[analysis.stderr.rfind('{'):])
    norm = (f'loudnorm=I={target}:TP=-3:LRA=12:linear=true:measured_I={levels["input_i"]}'
            f':measured_TP={levels["input_tp"]}:measured_LRA={levels["input_lra"]}'
            f':measured_thresh={levels["input_thresh"]}:offset={levels["target_offset"]}')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-af', base + ',' + norm,
                    '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '144k',
                    '-metadata', f'title={spec["title"]}', '-metadata', 'album=Aster — A Light Left in the Window',
                    str(OUT / f'{name}.mp3')], check=True)
    spec['mastering'] = dict(targetLUFS=target, truePeakCeiling=-3, source=levels)
    spec['bytes'] = (OUT / f'{name}.mp3').stat().st_size
    print(f'{name}: {duration:.1f}s, {spec["notes"]} notes, {spec["bytes"]:,} bytes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    selected = args.only.split(',') if args.only else [spec['id'] for spec in TRACKS]
    manifest = []
    for spec in TRACKS:
        composed = arrange(spec)
        if args.render and spec['id'] in selected:
            render(composed)
        manifest.append(composed)
    if args.render and not args.only:
        (OUT / 'manifest.json').write_text(json.dumps(dict(
            title='Aster — A Light Left in the Window',
            soundfontSHA256=hashlib.sha256(FONT.read_bytes()).hexdigest(), tracks=manifest), indent=2) + '\n')
    print('MIDI masters written to', OUT)
