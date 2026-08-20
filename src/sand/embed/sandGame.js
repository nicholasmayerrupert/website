// Framework-free <sand-game> Web Component. The standalone build embeds WASM;
// see embed/README.md for attributes, layout, and events.

import { initSandWasm } from '../wasmBridge/engineFactory.js';
import { createSandGame } from '../game/createSandGame';
import { DEFAULT_TOOL } from '../game/runtimeConfig';
import { createToolPalette } from './toolPalette';
import { createInventoryHud } from './inventoryHud';
import { createSurvivalStatus } from './survivalStatus';
import { createFootprintMenu } from './footprintMenu';
import { createConnectPanel } from './connectPanel';
import { createMissionHud, presentMissionSnapshot } from './missionHud';
import { createTalkHud } from './talkHud';
import { MISSION_PHASE } from '../wasmBridge/abi.generated.js';

const HOST_CSS = `
:host { position: absolute; inset: 0; display: block; pointer-events: none;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; }
/* Keep text-entry controls (search, multiplayer IP, etc.) selectable/editable. */
input, textarea { user-select: text; -webkit-user-select: text; -webkit-touch-callout: default; }
.sg-sim { position: absolute; inset: 0; overflow: hidden; }
/* When mobile drawing is armed, make the simulation the gesture target and
   tell the browser that drags belong to the canvas, not page scrolling. */
.sg-sim.draw-on { pointer-events: auto; touch-action: none; overscroll-behavior: none; }
.sg-stick { position: absolute; right: 10px; bottom: calc(26px + env(safe-area-inset-bottom, 0px)); z-index: 68;
  width: 104px; height: 104px; border-radius: 50%; pointer-events: auto; touch-action: none;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  background: rgba(17,24,39,.3); box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,.14); }
.sg-stick .sg-knob { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px;
  border-radius: 50%; background: rgba(255,255,255,.24); border: 1px solid rgba(255,255,255,.5);
  box-shadow: 0 4px 10px rgba(0,0,0,.35); transition: transform .08s ease-out; will-change: transform; }
.sg-stick.active .sg-knob { transition: none; background: rgba(255,255,255,.82); }
.sg-stick.sg-hidden, .sg-zoom.sg-hidden, .sg-start.sg-hidden { display: none; }
.sg-desktop-controls { position: absolute; right: 14px; bottom: 14px; z-index: 72; display: flex; align-items: stretch;
  gap: 8px; pointer-events: none; font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", "Roboto Mono", "Courier New", monospace;
  font-weight: 700; text-rendering: geometricPrecision; -webkit-font-smoothing: none; font-smooth: never; }
.sg-control-hints { display: flex; align-items: center; gap: 10px; height: 36px; box-sizing: border-box; padding: 0 10px;
  border: 1px solid rgba(255,255,255,.2); background: rgba(17,24,39,.5); color: #dbe4ef;
  backdrop-filter: blur(5px); box-shadow: 3px 3px 0 rgba(0,0,0,.38); }
.sg-control-hint { display: flex; align-items: center; gap: 5px; white-space: nowrap;
  font-size: 8px; line-height: 1; letter-spacing: .08em; }
.sg-control-key { display: inline-grid; place-items: center; min-width: 25px; height: 18px; box-sizing: border-box; padding: 0 4px;
  border: 1px solid rgba(255,255,255,.42); background: rgba(255,255,255,.12); color: #fff;
  box-shadow: 2px 2px 0 rgba(0,0,0,.48); font-family: inherit; font-size: 8px; font-weight: 800; line-height: 1; letter-spacing: .04em; }
.sg-sound { display:flex; align-items:center; gap:7px; height:40px; padding:0 11px;
  border:2px solid #080a0c; border-radius:0; background:#252b31; color:#fff;
  pointer-events:auto; cursor:pointer; touch-action:manipulation; font-family:inherit;
  font-size:9px; font-weight:800; line-height:1; letter-spacing:.1em;
  box-shadow:inset 0 0 0 1px #59636c,4px 4px 0 rgba(0,0,0,.48); }
.sg-sound:hover { background:#30373e; border-color:#080a0c; color:#f0d465; }
.sg-sound-icon { position: relative; width: 17px; height: 14px; flex: none; }
.sg-sound-icon::before { content: ''; position: absolute; left: 0; top: 4px; width: 5px; height: 6px;
  background: currentColor; box-shadow: 4px -3px 0 -1px currentColor, 4px 3px 0 -1px currentColor; }
.sg-sound-icon::after { content: ''; position: absolute; left: 9px; top: 6px; width: 2px; height: 2px; background: currentColor;
  box-shadow: 3px -2px 0 currentColor, 3px 0 0 currentColor, 3px 2px 0 currentColor,
    6px -4px 0 currentColor, 6px -2px 0 currentColor, 6px 0 0 currentColor,
    6px 2px 0 currentColor, 6px 4px 0 currentColor; }
.sg-sound.muted { color: rgba(255,255,255,.55); }
.sg-sound.muted .sg-sound-icon::after { left: 9px; top: 3px; box-shadow: 6px 0 0 currentColor,
  2px 2px 0 currentColor, 4px 2px 0 currentColor, 2px 4px 0 currentColor,
  4px 4px 0 currentColor, 0 6px 0 currentColor, 6px 6px 0 currentColor; }
.sg-start { position: absolute; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom, 0px)); z-index: 72;
  width: min(72vw, 320px); height: 56px; transform: translateX(-50%); pointer-events: auto; touch-action: manipulation;
  border: 1px solid rgba(255,255,255,.32); border-radius: 16px; background: rgba(17,24,39,.62); color: #fff;
  font: 700 15px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .12em; cursor: pointer;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  backdrop-filter: blur(6px); box-shadow: 0 12px 24px -8px rgba(0,0,0,.55); }
.sg-start:active { background: rgba(255,255,255,.86); color: #111827; }
.sg-zoom { position: absolute; left: 12px; bottom: calc(36px + env(safe-area-inset-bottom, 0px)); z-index: 71;
  display: grid; grid-template: "zoom-in layer" 40px "zoom-out draw" 40px / 40px 40px; gap: 6px;
  pointer-events: auto; touch-action: manipulation;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.sg-zoom button { width: 40px; height: 40px; border: 1px solid rgba(255,255,255,.22); border-radius: 10px;
  background: rgba(17,24,39,.5); color: #fff; font-size: 22px; line-height: 1; font-weight: 600; cursor: pointer;
  backdrop-filter: blur(4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,.3);
  -webkit-tap-highlight-color: transparent; }
.sg-zoom button:active { background: rgba(255,255,255,.82); color: #000; }
.sg-zoom-in { grid-area: zoom-in; }
.sg-zoom-out { grid-area: zoom-out; }
.sg-zoom .sg-layer, .sg-zoom .sg-draw { padding: 3px 2px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3px; font-size: 8px; line-height: 1; letter-spacing: .04em; }
.sg-layer { grid-area: layer; }
.sg-draw { grid-area: draw; }
.sg-layer-icon { position: relative; width: 20px; height: 16px; }
.sg-layer-icon::before, .sg-layer-icon::after { content: ''; position: absolute; width: 13px; height: 10px;
  border: 1px solid rgba(255,255,255,.72); border-radius: 3px; transition: background .15s, transform .15s; }
.sg-layer-icon::before { left: 1px; top: 1px; background: rgba(255,255,255,.75); }
.sg-layer-icon::after { right: 1px; bottom: 1px; background: rgba(17,24,39,.82); }
.sg-layer.bg .sg-layer-icon::before { background: rgba(17,24,39,.82); }
.sg-layer.bg .sg-layer-icon::after { background: rgba(255,255,255,.75); }
.sg-layer.bg { background: rgba(75,85,99,.78); border-color: rgba(255,255,255,.42); }
.sg-draw-icon { font-size: 15px; line-height: 13px; }
.sg-draw.on { background: rgba(255,255,255,.82); border-color: rgba(255,255,255,.72); color: #111827; }
.sg-perf { position: absolute; top: 64px; right: 12px; z-index: 72; pointer-events: none;
  min-width: 150px; padding: 8px 10px; border-radius: 8px; font-size: 11px; line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #e5e7eb;
  background: rgba(17,24,39,.55); border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); backdrop-filter: blur(4px); }
.sg-perf .sg-perf-title { display: block; font-size: 9px; letter-spacing: .08em; text-transform: uppercase;
  color: #9ca3af; margin-bottom: 4px; }
.sg-perf .sg-perf-row { display: flex; justify-content: space-between; gap: 12px; white-space: nowrap; }
.sg-perf .sg-perf-row span:last-child { color: #fff; font-variant-numeric: tabular-nums; }
.sg-init-failure { position: absolute; inset: 0; z-index: 90; display: grid; place-items: center;
  padding: 24px; background: rgba(10,12,16,.9); color: #fff; text-align: center;
  pointer-events: auto; font: 600 15px/1.45 ui-sans-serif, system-ui, sans-serif; }
.sg-init-failure button { margin-top: 14px; border: 0; border-radius: 999px; padding: 9px 18px;
  background: #fff; color: #111827; cursor: pointer; font: 700 14px/1 ui-sans-serif, system-ui, sans-serif; }
`;

// Mobile-only analog thumbstick. Its radial position is forwarded as a continuous
// normalized vector: angle is unrestricted and speed ramps from zero just outside
// the center deadzone to full speed at the rim.
function createMobileJoystick(root, game) {
  const DEADZONE = 0.14;

  const wrap = document.createElement('div');
  wrap.className = 'sg-stick';
  wrap.setAttribute('aria-label', 'Movement joystick');
  const knob = document.createElement('div');
  knob.className = 'sg-knob';
  wrap.appendChild(knob);

  let pointerId = null;
  let maxTravel = 29; // recomputed from real geometry on each press

  const apply = (dx, dy) => {
    // Clamp the knob inside the ring, then map its position to the axes.
    const dist = Math.hypot(dx, dy);
    const scale = dist > maxTravel ? maxTravel / dist : 1;
    const kx = dx * scale;
    const ky = dy * scale;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    const radial = Math.min(1, dist / maxTravel);
    const strength = radial <= DEADZONE ? 0 : (radial - DEADZONE) / (1 - DEADZONE);
    if (dist > 0 && strength > 0) game.inputStick((dx / dist) * strength, (dy / dist) * strength);
    else game.inputStick(0, 0);
  };

  const fromCenter = (e) => {
    const r = wrap.getBoundingClientRect();
    return [e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)];
  };

  const onDown = (e) => {
    pointerId = e.pointerId;
    wrap.classList.add('active');
    wrap.setPointerCapture?.(e.pointerId);
    maxTravel = wrap.getBoundingClientRect().width / 2 - knob.offsetWidth / 2;
    apply(...fromCenter(e));
    e.preventDefault();
    e.stopPropagation();
  };
  const onMove = (e) => {
    if (e.pointerId !== pointerId) return;
    apply(...fromCenter(e));
    e.preventDefault();
    e.stopPropagation();
  };
  const onUp = (e) => {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    pointerId = null;
    wrap.classList.remove('active');
    knob.style.transform = 'translate(0px, 0px)';
    game.inputStick(0, 0);
    try { wrap.releasePointerCapture?.(e.pointerId); } catch { /* capture already gone */ }
    e.preventDefault();
    e.stopPropagation();
  };

  wrap.addEventListener('pointerdown', onDown);
  wrap.addEventListener('pointermove', onMove);
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    wrap.addEventListener(ev, onUp);
  }

  root.appendChild(wrap);
  return {
    setHidden(hidden) {
      wrap.classList.toggle('sg-hidden', !!hidden);
      wrap.setAttribute('aria-hidden', String(!!hidden));
      if (hidden) {
        pointerId = null;
        wrap.classList.remove('active');
        knob.style.transform = 'translate(0px, 0px)';
        game.inputStick(0, 0);
      }
    },
    destroy() {
      game.inputStick(0, 0);
      wrap.remove();
    },
  };
}

// Mobile-only canvas controls: zoom, tap layer, and draw/scroll mode.
// Desktop uses +/- and normal left/right clicks instead.
function createZoomButtons(root, game, onToggleDrawMode) {
  const wrap = document.createElement('div');
  wrap.className = 'sg-zoom';
  wrap.setAttribute('aria-label', 'View, placement, and interaction controls');
  const mk = (label, className, aria, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = className;
    b.setAttribute('aria-label', aria);
    // Act on pointerdown and swallow it so the press never reaches the sim canvas
    // (which would otherwise start placing/mining under the button).
    b.addEventListener('pointerdown', (e) => { fn(); e.preventDefault(); e.stopPropagation(); });
    for (const ev of ['pointerup', 'pointermove', 'click']) b.addEventListener(ev, (e) => e.stopPropagation());
    wrap.appendChild(b);
    return b;
  };
  mk('+', 'sg-zoom-in', 'Zoom in', () => game.zoomIn());
  mk('−', 'sg-zoom-out', 'Zoom out', () => game.zoomOut());

  const layer = document.createElement('button');
  layer.type = 'button';
  layer.className = 'sg-layer';
  layer.setAttribute('aria-label', 'Tap layer: foreground');
  layer.setAttribute('aria-pressed', 'false');
  const layerIcon = document.createElement('span');
  layerIcon.className = 'sg-layer-icon';
  const layerText = document.createElement('span');
  layerText.textContent = 'FG';
  layer.append(layerIcon, layerText);
  let background = false;
  layer.addEventListener('pointerdown', (e) => {
    background = !background;
    game.setTouchLayer(background);
    layer.classList.toggle('bg', background);
    layerText.textContent = background ? 'BG' : 'FG';
    layer.setAttribute('aria-label', `Tap layer: ${background ? 'background' : 'foreground'}`);
    layer.setAttribute('aria-pressed', String(background));
    e.preventDefault();
    e.stopPropagation();
  });
  for (const ev of ['pointerup', 'pointermove', 'click']) layer.addEventListener(ev, (e) => e.stopPropagation());
  wrap.appendChild(layer);

  const draw = document.createElement('button');
  draw.type = 'button';
  draw.className = 'sg-draw';
  const drawIcon = document.createElement('span');
  drawIcon.className = 'sg-draw-icon';
  const drawText = document.createElement('span');
  draw.append(drawIcon, drawText);
  let drawOn = false;
  const renderDraw = () => {
    draw.classList.toggle('on', drawOn);
    drawIcon.textContent = drawOn ? '↕' : '✎';
    drawText.textContent = drawOn ? 'SCROLL' : 'DRAW';
    draw.setAttribute('aria-label', drawOn ? 'Switch to page scrolling' : 'Start drawing');
    draw.setAttribute('aria-pressed', String(drawOn));
  };
  draw.addEventListener('click', (e) => {
    drawOn = !drawOn;
    renderDraw();
    onToggleDrawMode?.(drawOn);
    e.preventDefault();
    e.stopPropagation();
  });
  for (const ev of ['pointerdown', 'pointerup', 'pointermove']) draw.addEventListener(ev, (e) => e.stopPropagation());
  renderDraw();
  wrap.appendChild(draw);
  root.appendChild(wrap);
  return {
    setDrawMode(on) { drawOn = !!on; renderDraw(); },
    setHidden(hidden) {
      wrap.classList.toggle('sg-hidden', !!hidden);
      wrap.setAttribute('aria-hidden', String(!!hidden));
    },
    destroy() { wrap.remove(); },
  };
}

// Mobile creative mode stays visually quiet until the visitor explicitly arms
// drawing. This is the only interactive control in that resting state.
function createMobileStartButton(root, onStart) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sg-start';
  button.textContent = 'START';
  button.setAttribute('aria-label', 'Start drawing in the sand simulation');
  button.addEventListener('click', (e) => {
    onStart?.();
    e.preventDefault();
    e.stopPropagation();
  });
  for (const ev of ['pointerdown', 'pointerup', 'pointermove']) {
    button.addEventListener(ev, (e) => e.stopPropagation());
  }
  root.appendChild(button);
  return {
    setHidden(hidden) {
      button.classList.toggle('sg-hidden', !!hidden);
      button.setAttribute('aria-hidden', String(!!hidden));
    },
    destroy() { button.remove(); },
  };
}

function createDesktopSoundButton(root, game, showCreativeHints) {
  const controls = document.createElement('div');
  controls.className = 'sg-desktop-controls';
  if (showCreativeHints) {
    const hints = document.createElement('div');
    hints.className = 'sg-control-hints';
    hints.setAttribute('aria-label', 'Creative controls');
    for (const [key, action] of [['WASD', 'MOVE'], ['LMB', 'PLACE FOREGROUND'], ['RMB', 'PLACE BACKGROUND']]) {
      const hint = document.createElement('span');
      hint.className = 'sg-control-hint';
      const keycap = document.createElement('kbd');
      keycap.className = 'sg-control-key';
      keycap.textContent = key;
      const label = document.createElement('span');
      label.textContent = action;
      hint.append(keycap, label);
      hints.appendChild(hint);
    }
    controls.appendChild(hints);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sg-sound';
  const icon = document.createElement('span');
  icon.className = 'sg-sound-icon';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = 'SOUND';
  button.append(icon, label);
  const render = () => {
    const muted = game.getAudioState().muted;
    button.classList.toggle('muted', muted);
    button.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
    button.setAttribute('aria-pressed', String(muted));
  };
  button.addEventListener('click', (event) => {
    game.unlockAudio();
    game.toggleAudioMuted();
    render();
    event.preventDefault();
    event.stopPropagation();
  });
  for (const event of ['pointerdown', 'pointerup', 'pointermove'])
    button.addEventListener(event, (e) => e.stopPropagation());
  render();
  controls.appendChild(button);
  root.appendChild(controls);
  return { destroy() { controls.remove(); } };
}

// Live performance overlay (the /fps route). A tiny top-right panel that polls
// game.perfStats() and derives fps (its own rAF cadence) + tickrate (sim-step
// delta) over a rolling ~500ms window. Read-only, pointer-events: none.
function createPerfHud(root, game) {
  const wrap = document.createElement('div');
  wrap.className = 'sg-perf';
  const title = document.createElement('span');
  title.className = 'sg-perf-title';
  title.textContent = 'Performance';
  wrap.appendChild(title);

  const rows = {};
  const addRow = (key, label) => {
    const row = document.createElement('div');
    row.className = 'sg-perf-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = '–';
    row.append(l, v);
    wrap.appendChild(row);
    rows[key] = v;
  };
  addRow('fps', 'fps');
  addRow('actorTps', 'actor/s');
  addRow('worldTps', 'world/s');
  addRow('authority', 'authority');
  addRow('actor', 'actor ms');
  addRow('step', 'step ms');
  addRow('render', 'render ms');
  addRow('light', 'light ms');
  addRow('fill', 'fill ms');
  addRow('upload', 'upload ms');
  addRow('mirrorApply', 'mirror apply');
  addRow('packet', 'packet KB');
  addRow('grounding', 'grounding ms');
  addRow('xlayerG', 'x-layer ground');
  addRow('compIdx', 'comp index ms');
  addRow('assembly', 'assembly ms');
  addRow('carry', 'carry ms');
  addRow('body', 'body ms');
  addRow('sand', 'sand ms');
  addRow('liquid', 'liquid ms');
  addRow('gas', 'gas ms');
  addRow('react', 'react ms');
  addRow('tail', 'tail ms');
  addRow('frame', 'frame p95');
  addRow('peakFrame', 'peak raf/step');
  addRow('peakRender', 'peak render/l/f/u');
  addRow('timing', 'actor debt');
  addRow('dirty', 'dirty chunks');
  addRow('dirtyRows', 'dirty rows');
  addRow('dirtyCells', 'dirty cells');
  addRow('comps', 'components');
  addRow('compCells', 'comp cells');
  addRow('xBonds', 'cross bonds');
  addRow('creatures', 'creatures');
  addRow('shifts', 'world shifts');
  addRow('heap', 'heap mirror/authority MB');
  addRow('grid', 'grid');
  addRow('tick', 'tick');
  root.appendChild(wrap);

  let raf = 0;
  let frames = 0;
  let winStart = performance.now();
  let lastActorTick = null;
  let lastWorldTick = null;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    frames++;
    const now = performance.now();
    const dt = now - winStart;
    if (dt < 500) return;
    const s = game.perfStats ? game.perfStats() : null;
    const fps = (frames * 1000) / dt;
    let actorTps = 0;
    let worldTps = 0;
    if (s) {
      if (lastActorTick !== null) actorTps = ((s.actorTick - lastActorTick) * 1000) / dt;
      if (lastWorldTick !== null) worldTps = ((s.worldTick - lastWorldTick) * 1000) / dt;
      lastActorTick = s.actorTick;
      lastWorldTick = s.worldTick;
    }
    frames = 0;
    winStart = now;
    if (!s) return;
    const f2 = (v) => (v || 0).toFixed(2);
    rows.fps.textContent = fps.toFixed(0);
    rows.actorTps.textContent = actorTps.toFixed(0);
    rows.worldTps.textContent = worldTps.toFixed(0);
    rows.authority.textContent = `${s.workerStatus} / ${s.workerStage}`;
    rows.actor.textContent = f2(s.actorMs);
    rows.step.textContent = f2(s.stepMs);
    rows.render.textContent = f2(s.renderMs);
    rows.light.textContent = f2(s.lightMs);
    rows.fill.textContent = f2(s.fillMs);
    rows.upload.textContent = f2(s.uploadMs);
    rows.mirrorApply.textContent = f2(s.mirrorApplyMs);
    rows.packet.textContent = ((s.mirrorPacketBytes || 0) / 1024).toFixed(1);
    rows.grounding.textContent = f2(s.groundingMs);
    rows.xlayerG.textContent = f2(s.crossLayerGroundingMs);
    rows.compIdx.textContent = f2(s.componentIndexMs);
    rows.assembly.textContent = f2(s.assemblyUnionMs);
    rows.carry.textContent = f2(s.carryMs);
    rows.body.textContent = f2(s.bodyMs);
    rows.sand.textContent = f2(s.sandMs);
    rows.liquid.textContent = f2(s.liquidMs);
    rows.gas.textContent = f2(s.gasMs);
    rows.react.textContent = f2(s.reactMs);
    rows.tail.textContent = f2(s.tailMs);
    rows.frame.textContent = f2(s.p95FrameMs);
    rows.peakFrame.textContent = `${f2(s.peakRafMs)} / ${f2(s.peakStepMs)}`;
    rows.peakRender.textContent = `${f2(s.peakRenderMs)} / ${f2(s.peakLightMs)} / ${f2(s.peakFillMs)} / ${f2(s.peakUploadMs)}`;
    rows.timing.textContent = `${f2(s.actorDebtMs)} / ${f2(s.actorDroppedMs)}`;
    rows.dirty.textContent = String(s.dirtyChunks || 0);
    rows.dirtyRows.textContent = String(s.dirtyRows || 0);
    rows.dirtyCells.textContent = String(s.dirtyCells || 0);
    rows.comps.textContent = String(s.componentCount || 0);
    rows.compCells.textContent = String(s.componentCellCount || 0);
    rows.xBonds.textContent = String(s.crossBondCount || 0);
    rows.creatures.textContent = String(s.creatureCount || 0);
    rows.shifts.textContent = String(s.worldShifts);
    rows.heap.textContent = `${s.heapMB.toFixed(1)} / ${s.authorityHeapMB.toFixed(1)}`;
    rows.grid.textContent = `${s.cols}×${s.rows}`;
    rows.tick.textContent = `${s.actorTick}/${s.worldTick}`;
  };
  raf = requestAnimationFrame(tick);

  return { destroy() { cancelAnimationFrame(raf); wrap.remove(); } };
}

function setPageScrollLocked(lock) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const body = document.body;
  if (!html || !body) return;
  if (lock) {
    if (!body.dataset.sandPrevOverflow) body.dataset.sandPrevOverflow = body.style.overflow || ' ';
    if (!html.dataset.sandPrevOverflow) html.dataset.sandPrevOverflow = html.style.overflow || ' ';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
  } else {
    if (body.dataset.sandPrevOverflow !== undefined) {
      body.style.overflow = body.dataset.sandPrevOverflow === ' ' ? '' : body.dataset.sandPrevOverflow;
      delete body.dataset.sandPrevOverflow;
    }
    if (html.dataset.sandPrevOverflow !== undefined) {
      html.style.overflow = html.dataset.sandPrevOverflow === ' ' ? '' : html.dataset.sandPrevOverflow;
      delete html.dataset.sandPrevOverflow;
    }
  }
}

class SandGameElement extends HTMLElement {
  static get observedAttributes() { return ['initial-tool']; }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;
    let root = this.shadowRoot;
    let sim = root?.querySelector('.sg-sim');
    if (!root) {
      root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.dataset.sandHostStyle = '';
      style.textContent = HOST_CSS;
      root.appendChild(style);
    }
    if (!sim) {
      sim = document.createElement('div');
      sim.className = 'sg-sim';
      root.appendChild(sim);
    }

    const initialTool = this.getAttribute('initial-tool') || DEFAULT_TOOL;
    // 'survival' (default): armed player character + follow camera.
    // 'creative': free camera, draw anywhere, no character.
    const mode = this.getAttribute('mode') === 'creative' ? 'creative' : 'survival';
    const planet = this.getAttribute('planet') || 'earth';
    const mission = this.getAttribute('mission') || null;
    const seedAttribute = this.getAttribute('world-seed');
    const seedValue = seedAttribute === null ? NaN : Number(seedAttribute);
    const worldSeed = Number.isFinite(seedValue) ? seedValue >>> 0 : undefined;
    let loadout = [];
    try {
      const parsed = JSON.parse(this.getAttribute('loadout') || '[]');
      if (Array.isArray(parsed)) loadout = parsed;
    } catch {
      loadout = [];
    }
    const debugHitboxes = this.hasAttribute('debug-hitboxes');
    const autoStart = this.hasAttribute('auto-start');
    this._lastMissionTerminal = 0;
    this._ready = false;
    let cancelled = false;

    const start = () => {
      this._initFailure?.remove();
      this._initFailure = null;
      return initSandWasm()
      .then(() => {
        if (cancelled || !this.isConnected) return;
        const game = createSandGame(sim, {
          initialTool,
          mode,
          planet,
          mission,
          worldSeed,
          loadout,
          debugHitboxes,
          onLayoutChange: ({ uiAtBottom }) => this._palette?.setLayout(uiAtBottom),
          // Survival inventory HUD wiring (the engine owns the inventory state).
          onInventory: (inv) => {
            this._hud?.update(inv);
            this._sizeMenu?.update(this._game?.getSurvivalFootprints?.() || [], inv.selectedFootprint);
          },
          onPlayerState: (player) => this._status?.update(player),
          onMission: (rawSnapshot) => {
            const detail = presentMissionSnapshot(rawSnapshot);
            this._missionHud?.update(detail);
            this.dispatchEvent(new CustomEvent('sand:missionupdate', {
              detail, bubbles: true, composed: true,
            }));
            if (detail.phase !== MISSION_PHASE.COMPLETE &&
                detail.phase !== MISSION_PHASE.FAILED) return;
            if (this._lastMissionTerminal === detail.phase) return;
            this._lastMissionTerminal = detail.phase;
            const terminalDetail = {
              ...detail,
              inventory: this._game?.getInventory() || null,
            };
            this.dispatchEvent(new CustomEvent(
              detail.phase === MISSION_PHASE.COMPLETE
                ? 'sand:missioncomplete'
                : 'sand:missionfailed',
              { detail: terminalDetail, bubbles: true, composed: true },
            ));
          },
          onToggleInventory: () => {
            this._sizeMenu?.setOpen(false);
            this._hud?.toggleOpen();
          },
          onToggleFootprintMenu: () => {
            this._hud?.setOpen(false);
            this._sizeMenu?.toggleOpen();
          },
          onEquipCreativeMaterial: (kind, value) => {
            if (!this._palette) return false;
            return this._palette.selectCreative(kind, value);
          },
          onInteraction: (detail) => {
            this.dispatchEvent(new CustomEvent('sand:interaction', {
              detail, bubbles: true, composed: true,
            }));
          },
        });
        this._game = game;
        const coarse = typeof window !== 'undefined' && window.matchMedia &&
          window.matchMedia('(pointer: coarse)').matches;
        let syncMobileCreativeUi = () => {};
        if (mode === 'survival') {
          // Survival uses the authoritative hotbar + openable inventory/crafting
          // grid. Combat weapons share the same slot/cursor model as mined blocks
          // and tools.
          this._hud = createInventoryHud(root, {
            selectSlot: (i) => game.selectSlot(i),
            cursorPick: (slot, half) => game.cursorPick(slot, half),
            throwFromCursor: (whole) => game.throwFromCursor(whole),
            getCursor: () => game.getCursor(),
            recipes: game.getCraftingRecipes(),
            craft: (recipe, max) => game.craft(recipe, max),
          });
          this._status = createSurvivalStatus(root, { respawn: () => game.respawn() });
          this._talkHud = createTalkHud(root, game, (detail) => {
            this.dispatchEvent(new CustomEvent('sand:talkaction', {
              detail, bubbles: true, composed: true,
            }));
          });
          this._sizeMenu = createFootprintMenu(root, {
            selectFootprint: (id) => game.setSelectedFootprint(id),
          });
          if (mission) this._missionHud = createMissionHud(root, game);
          this._hud.update(game.getInventory());
          this._sizeMenu.update(game.getSurvivalFootprints(), game.getInventory().selectedFootprint);
          // Multiplayer connect panel (collapsed): join an authoritative server
          // by IP:port. Survival-only; single-player UI is unchanged at rest.
          if (!mission) {
            this._mp = createConnectPanel(root, {
              join: (url, room) => game.netJoin(url, room),
              disconnect: () => game.netDisconnect(),
              getStatus: () => game.netStatus(),
              focusSurface: () => sim.focus({ preventScroll: true }),
            });
          }
        } else {
          // Creative uses the searchable "spawn anything" palette: every material +
          // a seed per species + eraser + cube, routed through setCreativeMaterial.
          let drawModeOn = !coarse || autoStart;
          syncMobileCreativeUi = () => {
            if (!coarse) return;
            const controlsHidden = !drawModeOn;
            this._start?.setHidden(drawModeOn);
            this._palette?.setHidden(!drawModeOn);
            this._stick?.setHidden(controlsHidden);
            this._zoom?.setHidden(controlsHidden);
          };
          const applyDrawMode = (on) => {
            drawModeOn = !!on;
            game.setDrawMode(drawModeOn);
            game.setAudioEnabled(drawModeOn);
            // START/DRAW is a trusted mobile click. Unlock after enabling so
            // mobile WebKit does not consume the gesture on a silent graph.
            if (drawModeOn) game.unlockAudio();
            this._palette?.setDrawMode(drawModeOn);
            this._zoom?.setDrawMode(drawModeOn);
            if (coarse) {
              sim.classList.toggle('draw-on', drawModeOn);
              setPageScrollLocked(drawModeOn);
            }
            syncMobileCreativeUi();
            this.dispatchEvent(new CustomEvent('sand:drawmodechange', {
              detail: { on: drawModeOn }, bubbles: true, composed: true,
            }));
          };
          this._palette = createToolPalette(root, {
            showDrawToggle: false,
            requireDrawMode: coarse,
            onSelectCreative: ({ kind, value }) => game.setCreativeMaterial(kind, value),
            onSetTime: (phase) => {
              if (phase === null) game.clearDayPhase();
              else game.setDayPhase(phase);
            },
            getTimeState: () => game.getDayNight(),
          });
          // Touch has no +/- keys, so give mobile an on-screen zoom control beside
          // the palette (desktop zooms via the keyboard).
          if (coarse) {
            this._zoom = createZoomButtons(root, game, applyDrawMode);
            if (!autoStart) this._start = createMobileStartButton(root, () => applyDrawMode(true));
          }
        }
        // Fine pointers are draw-enabled. Coarse pointers stay scrollable unless
        // the host already received an explicit start action.
        const drawDefault = !coarse || (mode === 'creative' && autoStart);
        game.setDrawMode(drawDefault);
        game.setAudioEnabled(!coarse || mode === 'survival' || drawDefault);
        sim.classList.toggle('draw-on', coarse && drawDefault);
        this._palette?.setDrawMode(drawDefault);
        this._zoom?.setDrawMode(drawDefault);
        if (coarse) this._stick = createMobileJoystick(root, game);
        else this._sound = createDesktopSoundButton(root, game, mode === 'creative');
        syncMobileCreativeUi();
        // Perf overlay (opt-in via the `perf-hud` attribute — the /fps route sets it).
        if (this.hasAttribute('perf-hud')) this._perfHud = createPerfHud(root, game);

        // Stop authority, presentation, and audio work when the embedded game is
        // outside the viewport. Resume from the current tick with a reset fixed
        // clock, so time away never turns into catch-up simulation debt.
        let onScreen = true;
        const syncViewportActivity = () => game.setViewportActive(onScreen && !document.hidden);
        if (typeof IntersectionObserver !== 'undefined') {
          this._visibilityObserver = new IntersectionObserver(([entry]) => {
            onScreen = !!entry?.isIntersecting;
            syncViewportActivity();
          }, { rootMargin: '150px 0px' });
          this._visibilityObserver.observe(this);
        }
        this._onDocumentVisibility = syncViewportActivity;
        document.addEventListener('visibilitychange', this._onDocumentVisibility);
        syncViewportActivity();
        if (coarse && mode === 'creative' && autoStart) {
          setPageScrollLocked(true);
          this.dispatchEvent(new CustomEvent('sand:drawmodechange', {
            detail: { on: true }, bubbles: true, composed: true,
          }));
        }
        this._ready = true;
        this.dispatchEvent(new CustomEvent('sand:ready', {
          bubbles: true, composed: true,
        }));
      })
      .catch((e) => {
        if (cancelled || !this.isConnected) return;
        this._ready = false;
        console.error('sand-game: engine failed to initialize', e);
        this.dispatchEvent(new CustomEvent('sand:error', {
          detail: { message: e instanceof Error ? e.message : String(e) },
          bubbles: true,
          composed: true,
        }));
        const failure = document.createElement('div');
        failure.className = 'sg-init-failure';
        failure.setAttribute('role', 'alert');
        const panel = document.createElement('div');
        const message = document.createElement('div');
        message.textContent = 'The sand simulation could not start.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => start());
        panel.append(message, retry);
        failure.appendChild(panel);
        root.appendChild(failure);
        this._initFailure = failure;
      });
    };
    start();

    this._cancel = () => { cancelled = true; };
  }

  disconnectedCallback() {
    this._ready = false;
    this._cancel?.();
    // Release analog input while its engine is still alive.
    this._stick?.destroy();
    this._game?.destroy();
    this._palette?.destroy();
    this._hud?.destroy();
    this._status?.destroy();
    this._sizeMenu?.destroy();
    this._missionHud?.destroy();
    this._talkHud?.destroy();
    this._mp?.destroy();
    this._zoom?.destroy();
    this._start?.destroy();
    this._perfHud?.destroy();
    this._sound?.destroy();
    this._initFailure?.remove();
    this._visibilityObserver?.disconnect();
    if (this._onDocumentVisibility) document.removeEventListener('visibilitychange', this._onDocumentVisibility);
    setPageScrollLocked(false);
    this._game = this._palette = this._hud = this._status = this._sizeMenu = this._missionHud = this._mp = this._stick = this._zoom = this._start = this._perfHud = this._sound = this._initFailure = null;
    this._visibilityObserver = this._onDocumentVisibility = null;
    this._cancel = null;
    this._lastMissionTerminal = 0;
    this._mounted = false;
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'initial-tool' && value && this._game) {
      this._game.setTool(value);
      this._palette?.setTool?.(value);
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sand-game')) {
  customElements.define('sand-game', SandGameElement);
}

export { SandGameElement };
