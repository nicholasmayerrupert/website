import { useEffect, useRef } from 'react';
import creatureArt from '../content/creatureArt.js';

function CreatureCard({ name, art }) {
  const canvas = useRef(null);
  useEffect(() => {
    const ctx = canvas.current.getContext('2d');
    const draw = () => {
      const frame = Math.floor(performance.now() / 150) % art.frames.length;
      ctx.clearRect(0, 0, art.width, art.height);
      art.frames[frame].forEach((row, y) => [...row].forEach((symbol, x) => {
        if (symbol === '.' || symbol === '0') return;
        ctx.fillStyle = art.palette[symbol]; ctx.fillRect(x, y, 1, 1);
      }));
    };
    draw(); const timer = setInterval(draw, 100);
    return () => clearInterval(timer);
  }, [art]);
  return <figure><div><canvas ref={canvas} width={art.width} height={art.height} aria-label={`${name} animation`} style={{ width: art.width * 3, height: art.height * 3 }} /></div><figcaption>{name}</figcaption></figure>;
}

export function CreatureGallery() {
  return <section className="studio-creatures" aria-label="Creature artwork">{Object.entries(creatureArt).map(([key, art]) =>
    <CreatureCard key={key} art={art} name={key.toLowerCase().replaceAll('_', ' ')} />)}</section>;
}
