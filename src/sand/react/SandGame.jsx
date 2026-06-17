// React wrapper around the framework-agnostic sand game.
//
// This is the only thing a React page needs to embed the whole simulation:
//
//   <SandGame onDrawModeChange={setFaded} />
//
// It mounts the vanilla runtime (../game/createSandGame.js) into a container
// div, renders the tool palette, and bridges React UI state into the runtime
// via its imperative handle. The runtime owns the canvases, render loop, input,
// and engine; this component owns only UI state.

import React, { useEffect, useRef, useState } from 'react';
import { createSandGame } from '../game/createSandGame';
import { initSandWasm } from '../engineWasm';
import { ToolPalette } from './ToolPalette';

export function SandGame({ initialTool = 'cube', onDrawModeChange }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);

  const [selectedTool, setSelectedTool] = useState(initialTool);
  const [drawModeOn, setDrawModeOn] = useState(false);
  const [uiAtBottom, setUiAtBottom] = useState(false);

  // Default to scroll (draw off) on coarse-pointer devices so touch users can
  // still scroll the page.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (window.matchMedia('(pointer: coarse)').matches) setDrawModeOn(false);
  }, []);

  // Mount the runtime once, after the WASM engine has loaded. `onLayoutChange`
  // may fire (from the ResizeObserver) before React paints, so the setter must
  // tolerate being called early.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let game = null;
    let cancelled = false;
    initSandWasm()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        game = createSandGame(container, {
          initialTool,
          onLayoutChange: ({ uiAtBottom: b }) => setUiAtBottom(b),
        });
        gameRef.current = game;
      })
      .catch((e) => { console.error('sand engine failed to init; staying blank', e); });
    return () => {
      cancelled = true;
      if (game) game.destroy();
      gameRef.current = null;
    };
  }, [initialTool]);

  // Bridge UI state into the runtime.
  useEffect(() => { gameRef.current?.setTool(selectedTool); }, [selectedTool]);
  useEffect(() => {
    gameRef.current?.setDrawMode(drawModeOn);
    onDrawModeChange?.(drawModeOn);
  }, [drawModeOn, onDrawModeChange]);

  return (
    <>
      {/* Simulation layer — sits BEHIND page content so the page stays readable.
          The runtime creates and appends its canvases into this container. */}
      <div ref={containerRef} className="absolute inset-0 z-0 pointer-events-none" />

      {/* UI layer — sits ABOVE page content, scoped to the section bounds. */}
      <div className="absolute inset-0 z-[60] pointer-events-none">
        <ToolPalette
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
          drawModeOn={drawModeOn}
          onToggleDrawMode={() => setDrawModeOn((v) => !v)}
          uiAtBottom={uiAtBottom}
        />
        {import.meta.env?.DEV && <MultiplayerPanel gameRef={gameRef} />}
      </div>
    </>
  );
}

// Minimal multiplayer control (DEV only — needs the local relay,
// `npm run mp:server`). Host a room or join one by code; the host runs the
// authoritative engine, clients send input and render players from snapshots.
function MultiplayerPanel({ gameRef }) {
  const [room, setRoom] = useState('sand');
  const [status, setStatus] = useState({ role: null, connected: false, remotes: 0, status: 'offline' });
  const url = `ws://${window.location.hostname}:5191`;

  useEffect(() => {
    const id = setInterval(() => { const s = gameRef.current?.netStatus?.(); if (s) setStatus(s); }, 500);
    return () => clearInterval(id);
  }, [gameRef]);

  const connected = status.connected;
  const btn = 'px-2 py-1 rounded text-xs font-medium border border-white/20 hover:bg-white/10';
  return (
    <div className="pointer-events-auto absolute top-2 right-2 flex items-center gap-1 rounded bg-black/55 px-2 py-1 text-white/90 backdrop-blur">
      <input
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        placeholder="room"
        className="w-16 rounded bg-white/10 px-1 py-0.5 text-xs outline-none"
        disabled={connected}
      />
      {!connected ? (
        <>
          <button className={btn} onClick={() => gameRef.current?.netHost(url, room)}>Host</button>
          <button className={btn} onClick={() => gameRef.current?.netJoin(url, room)}>Join</button>
        </>
      ) : (
        <button className={btn} onClick={() => gameRef.current?.netDisconnect()}>Leave</button>
      )}
      <span className="text-[10px] tabular-nums text-white/60">
        {connected ? `${status.role} · ${status.remotes} peer${status.remotes === 1 ? '' : 's'}` : status.status}
      </span>
    </div>
  );
}
