import { useEffect, useRef, useState } from 'react';
import { GAME_CONTENT, GAME_WORLD, PLAYER_ART } from '../content/catalog.js';
import { ANIMATION_STATES } from '../content/compile.js';
import { MAT } from '../materials.js';
import { MATERIAL_BY_ID } from '../materials.generated.js';

async function save(name, data) {
  const response = await fetch('/__game-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
}

export function PixelEditor() {
  const [art, setArt] = useState(() => structuredClone(PLAYER_ART));
  const [clip, setClip] = useState('idle');
  const [frame, setFrame] = useState(0);
  const [color, setColor] = useState('T');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const canvas = useRef(null), painting = useRef(false);
  useEffect(() => {
    const context = canvas.current.getContext('2d');
    const size = 10;
    context.fillStyle = '#1b302a'; context.fillRect(0, 0, art.width * size, art.height * size);
    art.clips[clip].frames[frame].forEach((row, y) => [...row].forEach((s, x) => {
      context.fillStyle = s === '.' ? (x + y) % 2 ? '#263d32' : '#1f352e' : art.palette[s];
      context.fillRect(x * size, y * size, size - 1, size - 1);
    }));
  }, [art, clip, frame]);
  const paint = event => {
    const box = canvas.current.getBoundingClientRect();
    const x = Math.floor((event.clientX - box.left) / box.width * art.width);
    const y = Math.floor((event.clientY - box.top) / box.height * art.height);
    if (x < 0 || y < 0 || x >= art.width || y >= art.height) return;
    setArt(old => {
      const next = structuredClone(old);
      const row = next.clips[clip].frames[frame][y].split(''); row[x] = color;
      next.clips[clip].frames[frame][y] = row.join(''); return next;
    });
    setDirty(true);
  };
  return <section className="studio-editor">
    <h2>Pixel frame editor</h2><p>Paint source pixels. Saving reloads the live character.</p>
    <div className="editor-row"><select aria-label="Animation clip" value={clip} onChange={e => { setClip(e.target.value); setFrame(0); }}>{ANIMATION_STATES.map(s => <option key={s}>{s}</option>)}</select><select aria-label="Animation frame" value={frame} onChange={e => setFrame(Number(e.target.value))}>{art.clips[clip].frames.map((_, i) => <option key={i} value={i}>Frame {i + 1}</option>)}</select></div>
    <div className="studio-actions"><button disabled={art.clips[clip].frames.length >= 16} onClick={() => {
      const next = structuredClone(art); next.clips[clip].frames.splice(frame + 1, 0, [...next.clips[clip].frames[frame]]);
      setArt(next); setFrame(frame + 1); setDirty(true);
    }}>Duplicate frame</button><button disabled={art.clips[clip].frames.length <= 1} onClick={() => {
      const next = structuredClone(art); next.clips[clip].frames.splice(frame, 1);
      setArt(next); setFrame(Math.min(frame, next.clips[clip].frames.length - 1)); setDirty(true);
    }}>Delete frame</button></div>
    <canvas ref={canvas} width={art.width * 10} height={art.height * 10} aria-label="Editable player pixels" onPointerDown={e => { painting.current = true; e.currentTarget.setPointerCapture(e.pointerId); paint(e); }} onPointerMove={e => { if (painting.current) paint(e); }} onPointerUp={() => { painting.current = false; }} onPointerCancel={() => { painting.current = false; }} />
    <div className="editor-palette">{Object.entries(art.palette).map(([key, value]) => <button key={key} aria-label={`Pixel color ${key}`} aria-pressed={key === color} style={{ background: value }} onClick={() => setColor(key)}>{key === '.' ? '×' : ''}</button>)}</div>
    <label>Ticks per frame<input type="number" min="1" max="120" value={art.clips[clip].ticks} onChange={e => { const next = structuredClone(art); next.clips[clip].ticks = Number(e.target.value); setArt(next); setDirty(true); }} /></label>
    <div className="studio-actions"><button disabled={!dirty} onClick={async () => { try { await save('player', art); } catch (e) { setError(e.message); } }}>Save artwork</button><button disabled={!dirty} onClick={() => { setArt(structuredClone(PLAYER_ART)); setFrame(0); setDirty(false); setError(''); }}>Discard edits</button></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function BlueprintEditor({ scene }) {
  const site = GAME_WORLD.sites.find(s => s.id === scene) || GAME_WORLD.sites[0];
  const [layer, setLayer] = useState('fg');
  const [material, setMaterial] = useState('PINE_WOOD');
  const [pending, setPending] = useState([]);
  const [error, setError] = useState('');
  const canvas = useRef(null), start = useRef(null);
  const [selection, setSelection] = useState(null);
  const bounds = site.editorBounds || [-170, -120, 170, 110];
  const [x0, y0, x1, y1] = bounds;
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  useEffect(() => {
    const ctx = canvas.current.getContext('2d');
    ctx.fillStyle = '#0f2425'; ctx.fillRect(0, 0, width, height);
    const colors = new Map();
    const draw = (r, selected) => {
      const id = r[6];
      if (!colors.has(id)) {
        const c = MATERIAL_BY_ID[id]?.color >>> 0;
        colors.set(id, id === 0 ? '#0f2425' : `rgb(${c & 255} ${(c >>> 8) & 255} ${(c >>> 16) & 255})`);
      }
      ctx.globalAlpha = selected ? 1 : .65;
      ctx.fillStyle = colors.get(id);
      ctx.fillRect(r[2] - site.origin[0] - x0, r[3] - site.origin[1] - y0, r[4] - r[2] + 1, r[5] - r[3] + 1);
    };
    for (const r of GAME_CONTENT.rectangles) {
      if (r[1] !== (site.surfaceAt ?? -2147483648) || (r[0] !== 2 && r[0] !== (layer === 'fg' ? 0 : 1))) continue;
      draw(r, true);
    }
    for (const op of pending) if (op.layer === layer) draw([0, 0, op.rect[0] + site.origin[0], op.rect[1] + site.origin[1], op.rect[2] + site.origin[0], op.rect[3] + site.origin[1], MAT[op.material]], true);
    if (selection) { ctx.globalAlpha = .5; ctx.fillStyle = '#fff3a8'; ctx.fillRect(selection[0] - x0, selection[1] - y0, selection[2] - selection[0] + 1, selection[3] - selection[1] + 1); }
    ctx.globalAlpha = 1;
  }, [site, layer, pending, selection, width, height, x0, y0]);
  const at = e => {
    const box = canvas.current.getBoundingClientRect();
    return [Math.max(x0, Math.min(x1, Math.floor((e.clientX - box.left) / box.width * width) + x0)), Math.max(y0, Math.min(y1, Math.floor((e.clientY - box.top) / box.height * height) + y0))];
  };
  const area = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  return <section className="studio-editor"><h2>Blueprint brush</h2><p>Drag a rectangle to add physical cells. Choose Empty to cut an opening.</p>
    <div className="editor-row"><select aria-label="Blueprint layer" value={layer} onChange={e => setLayer(e.target.value)}><option value="fg">Foreground</option><option value="bg">Background</option></select><select aria-label="Brush material" value={material} onChange={e => setMaterial(e.target.value)}>{Object.keys(MAT).map(m => <option key={m} value={m}>{m.toLowerCase().replaceAll('_', ' ')}</option>)}</select></div>
    <canvas ref={canvas} width={width} height={height} className="studio-blueprint" aria-label="Editable scene blueprint" onPointerDown={e => { start.current = at(e); e.currentTarget.setPointerCapture(e.pointerId); setSelection(area(start.current, start.current)); }} onPointerMove={e => { if (start.current) setSelection(area(start.current, at(e))); }} onPointerUp={e => { if (start.current) { const rect = area(start.current, at(e)); setPending(p => [...p, { layer, material, rect }]); } start.current = null; setSelection(null); }} onPointerCancel={() => { start.current = null; setSelection(null); }} />
    <small>{site.name} · {pending.length} pending stamps</small>
    <div className="studio-actions"><button disabled={!pending.length} onClick={async () => {
      const world = structuredClone(GAME_WORLD); world.sites.find(s => s.id === site.id).operations.push(...pending);
      try { await save('world', world); } catch (e) { setError(e.message); }
    }}>Save blueprint</button><button disabled={!pending.length} onClick={() => setPending(p => p.slice(0, -1))}>Undo stamp</button></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
