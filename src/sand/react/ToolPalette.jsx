// Presentational tool palette for the sand game. Pure props in / callbacks out —
// it never touches the engine. The runtime lives in ../game/createSandGame.js;
// ../react/SandGame.jsx wires this component's selections into it.

import React, { useRef, useState } from 'react';

const toolButtons = [
  {
    id: 'cube',
    title: 'Cube (click to drop a tumbling rigid body)',
    activeClass: 'bg-stone-600/50 ring-stone-300/35 text-stone-100',
    idleClass: 'text-stone-400/85 bg-stone-400/10',
  },
  {
    id: 'sand',
    title: 'Sand (hold LMB)',
    activeClass: 'bg-yellow-600/50 ring-yellow-300/35 text-yellow-200',
    idleClass: 'text-yellow-400/75 bg-yellow-400/10',
  },
  {
    id: 'water',
    title: 'Water (hold LMB)',
    activeClass: 'bg-blue-600/50 ring-blue-300/35 text-blue-100',
    idleClass: 'text-blue-400/75 bg-blue-400/10',
  },
  {
    id: 'oil',
    title: 'Oil (hold LMB)',
    activeClass: 'bg-amber-900/60 ring-amber-300/35 text-amber-200',
    idleClass: 'text-amber-900/85 bg-amber-900/10',
  },
  {
    id: 'fire',
    title: 'Fire (hold LMB)',
    activeClass: 'bg-orange-600/55 ring-orange-200/35 text-orange-100',
    idleClass: 'text-orange-400/80 bg-orange-400/10',
  },
  {
    id: 'stone',
    title: 'Stone (hold to draft, release to drop)',
    activeClass: 'bg-gray-600/50 ring-white/25 text-gray-100',
    idleClass: 'text-gray-400/85 bg-gray-400/10',
  },
  {
    id: 'seed',
    title: 'Seed (hold to place, release to drop)',
    activeClass: 'bg-green-700/50 ring-green-200/35 text-green-100',
    idleClass: 'text-green-400/80 bg-green-400/10',
  },
  {
    id: 'driftwood',
    title: 'Driftwood (hold to draft, release to drop) — wood-like, does not grow',
    activeClass: 'bg-stone-600/50 ring-stone-300/35 text-stone-100',
    idleClass: 'text-stone-400/80 bg-stone-400/10',
  },
  {
    id: 'acid',
    title: 'Acid (hold LMB)',
    activeClass: 'bg-lime-600/50 ring-lime-300/35 text-lime-100',
    idleClass: 'text-lime-400/80 bg-lime-400/10',
  },
  {
    id: 'lava',
    title: 'Lava (hold LMB)',
    activeClass: 'bg-red-700/55 ring-orange-300/35 text-orange-100',
    idleClass: 'text-red-400/80 bg-red-500/10',
  },
  {
    id: 'ice',
    title: 'Ice (hold to draft, release to drop)',
    activeClass: 'bg-cyan-600/50 ring-cyan-200/35 text-cyan-50',
    idleClass: 'text-cyan-300/80 bg-cyan-400/10',
  },
  {
    id: 'eraser',
    title: 'Eraser (hold LMB, or hold RMB anytime)',
    activeClass: 'bg-rose-600/50 ring-rose-200/35 text-rose-100',
    idleClass: 'text-rose-300/80 bg-rose-400/10',
  },
];

const toolLabel = (id) => id.charAt(0).toUpperCase() + id.slice(1);

const renderToolMark = (id) => {
  switch (id) {
    case 'sand':
      return (
        <div className="relative h-6 w-7" aria-hidden="true">
          <span className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-yellow-200/90" />
          <span className="absolute bottom-1 left-3 h-1.5 w-1.5 rounded-full bg-amber-300/90" />
          <span className="absolute bottom-1 left-5 h-1.5 w-1.5 rounded-full bg-yellow-300/80" />
          <span className="absolute bottom-[7px] left-2 h-1.5 w-1.5 rounded-full bg-yellow-300/90" />
          <span className="absolute bottom-[7px] left-4 h-1.5 w-1.5 rounded-full bg-amber-200/85" />
          <span className="absolute bottom-[13px] left-3 h-1.5 w-1.5 rounded-full bg-yellow-100/90" />
          <span className="absolute bottom-0 left-0 h-[2px] w-7 rounded-full bg-yellow-700/45" />
        </div>
      );
    case 'water':
      return (
        <div
          className="h-6 w-5 rounded-[60%_60%_70%_70%] bg-blue-400/80 shadow-[inset_3px_4px_0_rgba(255,255,255,0.25),0_0_8px_rgba(96,165,250,0.35)] rotate-45"
          aria-hidden="true"
        />
      );
    case 'oil':
      return (
        <div
          className="h-6 w-5 rounded-[60%_60%_70%_70%] bg-amber-950/90 ring-1 ring-amber-700/40 shadow-[inset_3px_4px_0_rgba(245,158,11,0.22),0_0_7px_rgba(120,53,15,0.35)] rotate-45"
          aria-hidden="true"
        />
      );
    case 'fire':
      return (
        <div className="relative h-7 w-5" aria-hidden="true">
          <span className="absolute bottom-0 left-1 h-5 w-4 rounded-[70%_30%_70%_40%] bg-orange-500/90 rotate-45 shadow-[0_0_9px_rgba(251,146,60,0.45)]" />
          <span className="absolute bottom-2 left-[7px] h-4 w-3 rounded-[70%_30%_70%_40%] bg-yellow-300/90 rotate-45" />
          <span className="absolute bottom-4 left-[4px] h-3 w-2.5 rounded-[70%_30%_70%_40%] bg-red-500/75 rotate-45" />
        </div>
      );
    case 'stone':
      return (
        <div className="relative h-6 w-6" aria-hidden="true">
          <span className="absolute bottom-1 left-1 h-4 w-5 rounded-[4px] bg-gray-400/85 shadow-[inset_2px_2px_0_rgba(255,255,255,0.18)] rotate-[-8deg]" />
          <span className="absolute bottom-[5px] left-[9px] h-[3px] w-[3px] rounded-full bg-gray-700/35" />
          <span className="absolute bottom-[11px] left-[5px] h-[2px] w-[6px] rounded-full bg-gray-100/25" />
        </div>
      );
    case 'seed':
      return (
        <div className="relative h-6 w-6" aria-hidden="true">
          <span className="absolute bottom-1 left-2 h-3 w-4 rounded-[55%_45%_55%_45%] bg-amber-900/85 rotate-[-20deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.16)]" />
          <span className="absolute bottom-3 left-3 h-3 w-2 rounded-full bg-green-400/80 rotate-45" />
          <span className="absolute bottom-[15px] left-[9px] h-2 w-1.5 rounded-full bg-lime-300/75 rotate-[-35deg]" />
        </div>
      );
    case 'driftwood':
      return (
        <div className="relative h-6 w-6" aria-hidden="true">
          <span className="absolute bottom-2 left-0 h-2 w-6 rounded-[3px] bg-stone-500/85 rotate-[-10deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.18)]" />
          <span className="absolute bottom-[11px] left-1 h-[2px] w-4 rounded-full bg-stone-300/35 rotate-[-10deg]" />
          <span className="absolute bottom-[7px] left-2 h-[2px] w-3 rounded-full bg-stone-800/35 rotate-[-10deg]" />
        </div>
      );
    case 'acid':
      return (
        <div
          className="h-6 w-5 rounded-[60%_60%_70%_70%] bg-lime-400/85 ring-1 ring-lime-300/40 shadow-[inset_3px_4px_0_rgba(255,255,255,0.28),0_0_8px_rgba(132,204,22,0.45)] rotate-45"
          aria-hidden="true"
        />
      );
    case 'lava':
      return (
        <div className="relative h-7 w-5" aria-hidden="true">
          <span className="absolute bottom-0 left-1 h-5 w-4 rounded-[70%_30%_70%_40%] bg-red-600/90 rotate-45 shadow-[0_0_9px_rgba(239,68,68,0.5)]" />
          <span className="absolute bottom-2 left-[7px] h-4 w-3 rounded-[70%_30%_70%_40%] bg-orange-400/90 rotate-45" />
          <span className="absolute bottom-3 left-[5px] h-2.5 w-2 rounded-[70%_30%_70%_40%] bg-yellow-300/80 rotate-45" />
        </div>
      );
    case 'ice':
      return (
        <div className="relative h-6 w-6" aria-hidden="true">
          <span className="absolute bottom-1 left-1 h-4 w-4 rounded-[4px] bg-cyan-200/85 rotate-[12deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.4),0_0_7px_rgba(103,232,249,0.4)]" />
          <span className="absolute bottom-[7px] left-[6px] h-[2px] w-[7px] rounded-full bg-white/55 rotate-[12deg]" />
          <span className="absolute bottom-[11px] left-[8px] h-[6px] w-[2px] rounded-full bg-white/45 rotate-[12deg]" />
        </div>
      );
    case 'cube':
      return (
        <div className="relative h-6 w-6" aria-hidden="true">
          <span className="absolute bottom-1 left-1 h-4 w-4 rounded-[3px] bg-stone-300/85 rotate-[18deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.28),0_0_6px_rgba(168,162,158,0.35)]" />
          <span className="absolute bottom-[10px] left-[7px] h-[2px] w-[7px] rounded-full bg-white/30 rotate-[18deg]" />
        </div>
      );
    case 'eraser':
      return (
        <div className="relative h-6 w-6" aria-hidden="true">
          <span className="absolute bottom-2 left-1 h-3.5 w-5 rounded-[4px] bg-rose-200/90 rotate-[-28deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.35)]" />
          <span className="absolute bottom-[10px] left-[13px] h-3.5 w-[2px] rounded-full bg-rose-500/45 rotate-[-28deg]" />
          <span className="absolute bottom-1 left-1 h-[2px] w-5 rounded-full bg-white/35" />
        </div>
      );
    default:
      return null;
  }
};

export function ToolPalette({
  selectedTool,
  onSelectTool,
  drawModeOn,
  onToggleDrawMode,
  uiAtBottom,
}) {
  const uiRef = useRef(null);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);

  const selectedToolButton =
    toolButtons.find(({ id }) => id === selectedTool) ?? toolButtons[0];

  return (
    <div
      ref={uiRef}
      className={`absolute ${
        uiAtBottom
          ? 'bottom-3 left-1/2 -translate-x-1/2'
          : 'left-4 top-1/2 -translate-y-1/2'
      } z-[70] bg-gray-900/30 rounded-lg p-2 backdrop-blur-sm shadow-lg pointer-events-auto max-w-[calc(100vw-1.5rem)]`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className={`flex ${uiAtBottom ? 'flex-col items-stretch' : 'flex-col'} gap-2`}>
        <div className={`relative ${drawModeOn ? '' : 'opacity-45'}`}>
          <button
            type="button"
            onClick={() => setToolPickerOpen((v) => !v)}
            className={`w-48 max-w-[calc(100vw-2.5rem)] rounded-md p-2 text-left transition ring-1 ${
              drawModeOn ? 'bg-gray-800/70 hover:bg-gray-800/85 ring-white/15' : 'bg-gray-800/45 ring-white/10'
            }`}
            title={selectedToolButton.title}
            aria-haspopup="listbox"
            aria-expanded={toolPickerOpen}
          >
            <span className="block text-[10px] uppercase tracking-wide text-gray-300">
              Currently selected material
            </span>
            <span className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ring-1 ${selectedToolButton.activeClass}`}>
                {renderToolMark(selectedTool)}
              </span>
              {toolLabel(selectedTool)}
              <span className="ml-auto text-gray-300" aria-hidden="true">v</span>
            </span>
          </button>

          {toolPickerOpen && (
            <div
              className={`absolute z-[80] w-48 max-w-[calc(100vw-2.5rem)] rounded-md bg-gray-950/95 p-1 shadow-xl ring-1 ring-white/15 backdrop-blur-sm ${
                uiAtBottom ? 'bottom-full mb-2 left-0' : 'left-0 top-full mt-2'
              }`}
              role="listbox"
              aria-label="Select material"
            >
              {toolButtons.map(({ id, title, activeClass, idleClass }) => {
                const active = selectedTool === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onSelectTool(id);
                      setToolPickerOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
                      active
                        ? 'bg-white/15 text-white'
                        : 'text-gray-200 hover:bg-white/10'
                    }`}
                    title={title}
                    role="option"
                    aria-selected={active}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ${
                      active ? activeClass : `ring-white/10 ${idleClass}`
                    }`}>
                      {renderToolMark(id)}
                    </span>
                    <span>{toolLabel(id)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onToggleDrawMode()}
          className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${
            drawModeOn
              ? 'bg-white/80 text-black hover:bg-white'
              : 'bg-white/10 text-white hover:bg-white/20'
          }`}
          title={drawModeOn ? 'Disable drawing so the page scrolls normally' : 'Enable drawing in the physics simulation'}
          aria-pressed={drawModeOn}
        >
          Draw {drawModeOn ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  );
}
