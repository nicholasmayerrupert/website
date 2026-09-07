import { useEffect, useRef, useState } from 'react';
import { CREATURE } from '../wasmBridge/abi.generated.js';
import { BESTIARY } from '../content/bestiary.js';
import creatureArt from '../content/creatureArt.js';

function CreatureCard({ name, art }) {
  const canvas = useRef(null);
  const [clipName, setClipName] = useState('idle');
  useEffect(() => {
    const ctx = canvas.current.getContext('2d');
    const draw = () => {
      const clip = art.clips?.[clipName] || { frames: art.frames, ticks: 9 };
      const duration = clip.frames.reduce((sum, _, i) => sum + (clip.durations?.[i] || clip.ticks), 0);
      let phase = Math.floor(performance.now() * .06) % duration, frame = 0;
      while (frame < clip.frames.length-1 && phase >= (clip.durations?.[frame] || clip.ticks)) { phase -= clip.durations?.[frame] || clip.ticks; frame++; }
      ctx.clearRect(0, 0, art.width, art.height);
      clip.frames[frame].forEach((row, y) => [...row].forEach((symbol, x) => {
        if (symbol === '.' || symbol === '0') return;
        ctx.fillStyle = art.palette[symbol]; ctx.fillRect(x, y, 1, 1);
      }));
    };
    draw(); const timer = setInterval(draw, 100);
    return () => clearInterval(timer);
  }, [art, clipName]);
  return <figure><div><canvas ref={canvas} width={art.width} height={art.height} aria-label={`${name} animation`} style={{ width: art.width * 3, height: art.height * 3 }} /></div><figcaption>{name}</figcaption><select aria-label={`${name} clip`} value={clipName} onChange={e => setClipName(e.target.value)}>{Object.keys(art.clips || { idle: null }).map(clip => <option key={clip}>{clip}</option>)}</select></figure>;
}

export function CreatureGallery() {
  return <section className="studio-creatures" aria-label="Creature artwork">{Object.entries(creatureArt).map(([key, art]) =>
    <CreatureCard key={key} art={art} name={BESTIARY[CREATURE[key]]?.name || key.toLowerCase().replaceAll('_', ' ')} />)}</section>;
}
