"""Prepare the CC0 game sound bank with ffmpeg and Python's standard library.

Usage: python3 scripts/prepare-game-audio.py [--download]
Sources and intermediates live in .sand-artifacts/audio-sources.
"""

import array
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.sand-artifacts/audio-sources'
OUT = ROOT / 'src/sand/audio/assets'
RATE = 32000
SOURCES = {
    'impact-sounds': 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
    'rpg-audio': 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
    'battle': 'https://opengameart.org/sites/default/files/battle_sound_effects_0.zip',
    'water': 'https://opengameart.org/sites/default/files/water-splash-slime-sfx.zip',
    'fire.wav': 'https://opengameart.org/sites/default/files/fire.wav',
    'wind.wav': 'https://opengameart.org/sites/default/files/short%20wind%20sound.wav',
    'snarl.ogg': 'https://opengameart.org/sites/default/files/monster-snarls-2_0.ogg',
    'huge-explosion.mp3': 'https://cdn.freesound.org/previews/591/591998_5487341-hq.mp3',
}

if '--download' in sys.argv:
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        data = urllib.request.urlopen(url, timeout=60).read()
        if url.endswith('.zip'):
            archive = zipfile.ZipFile(io.BytesIO(data))
            for member in archive.infolist():
                target = (CACHE / name / member.filename).resolve()
                if not target.is_relative_to((CACHE / name).resolve()):
                    raise ValueError('Archive path leaves source directory')
            archive.extractall(CACHE / name)
        else:
            (CACHE / name).write_bytes(data)

jobs = []


def add(key, source, *, start=0, seconds=2, loop=0, music=False):
    jobs.append(dict(key=key, source=source, start=start, seconds=seconds,
                     loop=loop, music=music))


for family, original in {
    'stone': 'impactMining', 'wood': 'impactWood_medium',
    'metal': 'impactMetal_medium', 'glass': 'impactGlass_medium',
    'hit': 'impactPunch_heavy', 'step': 'footstep_concrete',
    'soil': 'footstep_grass',
}.items():
    for i in range(3):
        add(f'{family}{i + 1}', f'impact-sounds/Audio/{original}_{i:03}.ogg')
for i in range(3):
    add(f'swish{i + 1}', f'battle/battle_sound_effects/swish_{i + 2}.wav')
    add(f'cloth{i + 1}', f'rpg-audio/Audio/cloth{i + 1}.ogg')
    add(f'splash{i + 1}', f'water/splash_{i + 1:02}.ogg')
add('bow', 'battle/battle_sound_effects/Bow.wav')
add('pickup1', 'rpg-audio/Audio/handleSmallLeather.ogg')
add('pickup2', 'rpg-audio/Audio/handleSmallLeather2.ogg')
add('craft', 'rpg-audio/Audio/metalLatch.ogg')
add('bell', 'impact-sounds/Audio/impactBell_heavy_000.ogg', seconds=5)
add('creature1', 'snarl.ogg', start=0, seconds=1.1)
add('creature2', 'snarl.ogg', start=3, seconds=1.1)
add('fireLoop', 'fire.wav', start=3, seconds=12, loop=.5)
add('windLoop', 'wind.wav', seconds=4.2, loop=.35)
add('bubbleLoop', 'water/loop_bubbles_1.ogg', seconds=8, loop=.2)
add('explosionBurst', 'huge-explosion.mp3', seconds=3.5)

report = []
OUT.mkdir(parents=True, exist_ok=True)
for job in jobs:
    source = CACHE / job['source']
    channels = 2 if job['music'] else 1
    filters = 'highpass=f=45,lowpass=f=11500' if job['music'] else 'highpass=f=75,lowpass=f=10000'
    if job['key'] == 'explosionBurst':
        filters = 'highpass=f=30,lowpass=f=14000'
    raw = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-ss', str(job['start']), '-i', str(source),
        '-t', str(job['seconds']), '-ac', str(channels), '-ar', str(RATE),
        '-af', filters, '-f', 'f32le', 'pipe:1',
    ])
    samples = array.array('f', raw)
    if sys.byteorder != 'little':
        samples.byteswap()
    # Trim only leading silence from foley; preserve the performer's attack.
    if not job['loop'] and not job['music']:
        first = next((i for i, x in enumerate(samples) if abs(x) > .002), 0)
        samples = samples[max(0, first - int(.004 * RATE)):]
    if job['loop']:
        overlap = min(int(job['loop'] * RATE), len(samples) // 4)
        seam = array.array('f', (
            samples[-overlap + i] * (1 - i / overlap) + samples[i] * i / overlap
            for i in range(overlap)
        ))
        samples = samples[overlap:-overlap] + seam
    else:
        fade_in, fade_out = (.04, .25) if job['music'] else (.002, .035)
        if job['key'] == 'explosionBurst':
            fade_in = .00025
            fade_out = .4
        frames = len(samples) // channels
        for i in range(frames):
            fade = min(1, i / (RATE * fade_in), (frames - 1 - i) / (RATE * fade_out))
            for channel in range(channels):
                samples[i * channels + channel] *= fade
    rms = math.sqrt(sum(x * x for x in samples) / len(samples))
    peak = max(map(abs, samples))
    # Match perceived body while preserving transient crest and 3 dB headroom.
    target_db = -23 if job['music'] else -20
    gain = min(10 ** (target_db / 20) / max(rms, 1e-9), .708 / max(peak, 1e-9))
    samples = array.array('f', (x * gain for x in samples))
    filename = job['key'] + '.mp3'
    if sys.byteorder != 'little':
        samples.byteswap()
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE),
        '-ac', str(channels), '-i', 'pipe:0', '-c:a', 'libmp3lame',
        '-b:a', '128k' if job['music'] else '80k', '-map_metadata', '-1',
        str(OUT / filename),
    ], input=samples.tobytes(), check=True)
    report.append({**job, 'file': filename, 'duration': len(samples) / RATE / channels,
                   'peakDb': round(20 * math.log10(peak * gain), 2),
                   'rmsDb': round(20 * math.log10(rms * gain), 2),
                   'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest()})

(OUT / 'mix-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
urls = '\n'.join(f"  {j['key']}: new URL('./assets/{j['key']}.mp3', import.meta.url).href," for j in jobs)
(OUT.parent / 'recordedBank.generated.js').write_text(
    '// Generated by scripts/prepare-game-audio.py.\n'
    'export const RECORDED_BANK_URLS = Object.freeze({\n' + urls + '\n});\n')
print(f'Prepared {len(jobs)} recordings; {sum((OUT / j["file"]).stat().st_size for j in report):,} bytes.')
