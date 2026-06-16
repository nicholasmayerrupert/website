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

  // Mount the runtime once. `onLayoutChange` may fire (from the ResizeObserver)
  // before React paints, so the setter must tolerate being called early.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const game = createSandGame(container, {
      initialTool,
      onLayoutChange: ({ uiAtBottom: b }) => setUiAtBottom(b),
    });
    gameRef.current = game;
    return () => {
      game.destroy();
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
      </div>
    </>
  );
}
