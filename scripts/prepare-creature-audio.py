"""Build the species voice bank from CC0 performances and recorded foley.

python3 scripts/prepare-creature-audio.py [--download]
Requires ffmpeg; normal builds use the committed MP3 files.
"""
import array
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.sand-artifacts/creature-audio-sources'
FOLEY = ROOT / '.sand-artifacts/audio-sources'
OUT = ROOT / 'src/sand/audio/assets/creatures'
RATE = 32000
SOURCES = {
    'creatures': 'https://opengameart.org/sites/default/files/80-CC0-creature-SFX_0.zip',
    'human': 'https://opengameart.org/sites/default/files/RPG%20Male%20Adventurer.zip',
    'roar': 'https://opengameart.org/sites/default/files/monster_roar.wav',
    'bird': 'https://opengameart.org/sites/default/files/birdchirping071414.wav',
    'bat': 'https://opengameart.org/sites/default/files/bat.zip',
    'frog': 'https://opengameart.org/sites/default/files/mutant_frog.zip',
}
FOLEY_SOURCES = {
    'impact-sounds': 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
    'rpg-audio': 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
    'water': 'https://opengameart.org/sites/default/files/water-splash-slime-sfx.zip',
}
if '--download' in sys.argv:
    for base, sources in [(CACHE, SOURCES), (FOLEY, FOLEY_SOURCES)]:
        for name, url in sources.items():
            directory = base / name
            directory.mkdir(parents=True, exist_ok=True)
            data = urllib.request.urlopen(url, timeout=45).read()
            if url.endswith('.zip'):
                archive = zipfile.ZipFile(io.BytesIO(data))
                if any(not (directory / f.filename).resolve().is_relative_to(directory.resolve()) for f in archive.infolist()):
                    raise ValueError('Archive path leaves source directory')
                archive.extractall(directory)
            else:
                (directory / url.rsplit('/', 1)[1]).write_bytes(data)


def pcm(path, start=0, seconds=2.5, rate=1, effects=''):
    filters = f'asetrate={RATE * rate},aresample={RATE},highpass=f=85,lowpass=f=9500'
    if effects:
        filters += ',' + effects
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(start), '-i', str(path),
        '-t', str(seconds), '-ac', '1', '-ar', str(RATE), '-af', f'aresample={RATE},' + filters,
        '-f', 'f32le', 'pipe:1'])
    data = array.array('f', raw)
    if sys.byteorder != 'little':
        data.byteswap()
    return data


keys = sorted(set(re.findall(r'\bcv[A-Za-z0-9]+', (ROOT / 'src/sand/audio/creatureVoices.js').read_text())))
OUT.mkdir(parents=True, exist_ok=True)
report = []
for key in keys:
    name = key[2:]
    start, seconds, rate, effects = 0, 2.4, 1, ''
    extra = []
    if name.startswith('Human'):
        source = name[5:].replace('Big', 'attackbig').lower() + '.wav'
        path = CACHE / 'human/RPG Male Adventurer' / source
    elif name.startswith('Bird'):
        path = CACHE / 'bird/birdchirping071414.wav'
        start = (int(name[-1]) - 1) * .85
        seconds = 1.2
    elif name.startswith('Bat'):
        path = CACHE / f'bat/flac/bat_0{name[-1]}.flac'
    elif name.startswith('Frog'):
        path = CACHE / f'frog/mutant_frog-{name[-1]}.ogg'
    elif name.startswith('Water'):
        path = FOLEY / f'water/bubble_0{name[-1]}.ogg'
        seconds = .75
    elif name.startswith('Creak'):
        path = FOLEY / f'rpg-audio/Audio/creak{name[-1]}.ogg'
    elif name.startswith('Bone'):
        index = 2 if name == 'BoneFall' else int(name[-1]) - 1
        path = FOLEY / f'impact-sounds/Audio/impactWood_light_00{index}.ogg'
        # Dry, irregular clacks make a skeleton's loose joints and collapsing bones.
        extra = [(path, .09, .57, 1.18), (path, .18, .38, .84)]
        if name == 'BoneFall':
            extra += [(path, .31, .45, .70), (path, .47, .3, 1.12), (path, .65, .18, .9)]
    elif name.startswith('Spirit'):
        path = CACHE / f'creatures/alien_0{name[-1]}.ogg'
        rate = .86
        effects = 'highpass=f=420,aecho=0.8:0.7:83|167:0.28|0.17,lowpass=f=4800'
    elif name.startswith('Dinosaur'):
        path = CACHE / 'roar/monster_roar.wav'
        start = 0 if name == 'Dinosaur1' else .65 if name == 'Dinosaur2' else 1.25
        seconds = 2.1 if name != 'DinosaurDeath' else 2.7
        rate = .87 if name != 'DinosaurDeath' else .72
        extra = [(CACHE / 'creatures/roar_03.ogg', .05, .34, .70)]
    else:
        match = re.fullmatch(r'([A-Za-z]+)(\d+)', name)
        source = f'{match[1].lower()}_{int(match[2]):02}.ogg' if match else name.lower() + '.ogg'
        if source.startswith('bark_'):
            source = source.replace('bark_', 'barking_')
        path = CACHE / 'creatures' / source
    samples = pcm(path, start, seconds, rate, effects)
    inputs = [(path, start, seconds, rate, 0, 1)]
    for extra_path, delay, level, extra_rate in extra:
        layer = pcm(extra_path, seconds=seconds, rate=extra_rate)
        offset = int(delay * RATE)
        if len(samples) < len(layer) + offset:
            samples.extend([0] * (len(layer) + offset - len(samples)))
        for i, value in enumerate(layer):
            samples[i + offset] += value * level
        inputs.append((extra_path, 0, seconds, extra_rate, delay, level))
    first = next((i for i, value in enumerate(samples) if abs(value) > .002), 0)
    last = next((i for i in range(len(samples)-1, -1, -1) if abs(samples[i]) > .001), len(samples)-1)
    samples = samples[max(0, first - 128):min(len(samples), last + 1600)]
    for i in range(len(samples)):
        samples[i] *= min(1, i / 128, (len(samples)-1-i) / 1600)
    peak = max(map(abs, samples), default=0)
    rms = math.sqrt(sum(value*value for value in samples) / max(1, len(samples)))
    if rms < .00005:
        raise ValueError(f'{key} is empty or inaudible')
    gain = min(.63 / peak, 10 ** (-21 / 20) / rms)
    samples = array.array('f', (value * gain for value in samples))
    encoded = array.array('f', samples)
    if sys.byteorder != 'little':
        encoded.byteswap()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1',
        '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '80k', '-map_metadata', '-1', str(OUT / f'{key}.mp3')],
        input=encoded.tobytes(), check=True)
    report.append(dict(key=key, duration=len(samples)/RATE, peakDb=round(20*math.log10(peak*gain),2),
        rmsDb=round(20*math.log10(rms*gain),2), effects=effects,
        inputs=[dict(file=str(p.relative_to(ROOT / '.sand-artifacts')), start=s, seconds=n, rate=r, delay=d, gain=g,
                     sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p,s,n,r,d,g in inputs]))

(OUT / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
urls = '\n'.join(f"  {key}: new URL('./assets/creatures/{key}.mp3', import.meta.url).href," for key in keys)
(OUT.parent.parent / 'creatureBank.generated.js').write_text('// Generated by scripts/prepare-creature-audio.py.\n'
    'export const CREATURE_BANK_URLS = Object.freeze({\n' + urls + '\n});\n')
print(f'Prepared {len(report)} creature recordings, {sum((OUT / (r["key"] + ".mp3")).stat().st_size for r in report):,} bytes.')
