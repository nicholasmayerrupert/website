// src/ProjectArt.jsx
// Hand-crafted SVG artwork for the project cards (replaces the stock Lottie files).
// Each scene is drawn in a 400x300 viewBox (matches the 4:3 card) and fills the
// card edge-to-edge. Animation is pure CSS (see ProjectArt.css) and is disabled
// under prefers-reduced-motion.

import React from 'react';
import './ProjectArt.css';

/* Four-point sparkle used across scenes. */
function Sparkle({ x, y, s, fill, className, style, opacity = 1 }) {
  const d = `M ${x} ${y - s} Q ${x} ${y} ${x + s} ${y} Q ${x} ${y} ${x} ${y + s} Q ${x} ${y} ${x - s} ${y} Q ${x} ${y} ${x} ${y - s} Z`;
  return <path d={d} fill={fill} className={className} style={style} opacity={opacity} />;
}

/* =====================================================================
   1. LLM CHESS COACH — a knight wired with circuitry, orbited by rings
   ===================================================================== */
export function ChessArt() {
  // Perspective checkerboard floor: a rotated/flattened grid of squares.
  const floor = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      if ((i + j) % 2 === 0) {
        floor.push(<rect key={`f${i}-${j}`} x={-78 + i * 26} y={-78 + j * 26} width="26" height="26" fill="#b366ff" />);
      }
    }
  }

  const traceNodes = [
    [205, 92], [205, 120], [205, 146], [205, 178], [205, 212],
    [190, 162], [184, 192], [220, 170], [226, 198],
  ];

  return (
    <svg className="project-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="chess-bg" cx="50%" cy="42%" r="75%">
          <stop offset="0%" stopColor="#2a0a4a" />
          <stop offset="55%" stopColor="#140428" />
          <stop offset="100%" stopColor="#060010" />
        </radialGradient>
        <linearGradient id="chess-piece" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3c0d73" />
          <stop offset="55%" stopColor="#220747" />
          <stop offset="100%" stopColor="#12022a" />
        </linearGradient>
        <linearGradient id="chess-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a1d85" />
          <stop offset="100%" stopColor="#1c0638" />
        </linearGradient>
      </defs>

      <rect width="400" height="300" fill="url(#chess-bg)" />

      {/* perspective board floor */}
      <g opacity="0.12" transform="translate(200 312) scale(1.7 0.72) rotate(45)">{floor}</g>

      {/* orbital rings */}
      <g className="pa-spin-slow">
        <circle cx="205" cy="150" r="98" fill="none" stroke="rgba(179,102,255,0.3)" strokeWidth="1" strokeDasharray="4 11" />
      </g>
      <g className="pa-spin-rev">
        <path d="M 205 52 A 98 98 0 0 1 303 150" fill="none" stroke="rgba(255,209,102,0.35)" strokeWidth="1.4" />
        <path d="M 205 248 A 98 98 0 0 1 107 150" fill="none" stroke="rgba(255,209,102,0.35)" strokeWidth="1.4" />
      </g>
      <circle cx="205" cy="150" r="112" fill="none" stroke="rgba(179,102,255,0.12)" strokeWidth="1" />

      {/* neural constellations in the corners */}
      <g stroke="rgba(179,102,255,0.3)" strokeWidth="0.8" fill="none">
        <path d="M 40 60 L 70 40 L 95 75 L 60 95 Z M 70 40 L 60 95" />
        <path d="M 330 200 L 355 178 L 372 212 L 342 226 Z" />
      </g>
      <g fill="#d9b8ff">
        {[[40, 60], [70, 40], [95, 75], [60, 95], [330, 200], [355, 178], [372, 212], [342, 226]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2" opacity={0.55 + (i % 3) * 0.12} />
        ))}
      </g>

      {/* planned-move arrow on the board */}
      <path d="M 96 236 C 76 196 96 160 138 148" fill="none" stroke="#ffd166" strokeWidth="1.6" strokeDasharray="5 7" opacity="0.55" className="pa-dash" />
      <polygon points="150,146 136,141 138,153" fill="#ffd166" opacity="0.7" />

      {/* pedestal */}
      <path d="M 160 226 L 252 226 L 260 240 L 152 240 Z" fill="url(#chess-base)" stroke="#6d28d9" strokeWidth="1" opacity="0.95" />
      <rect x="142" y="240" width="128" height="15" rx="7" fill="#160433" stroke="#6d28d9" strokeWidth="1" />
      <line x1="152" y1="241.5" x2="260" y2="241.5" stroke="rgba(217,184,255,0.35)" strokeWidth="1" />

      {/* the pawn — soft rim via stroke; no SVG blur filter (expensive under CSS anim). */}
      <g>
        <circle
          cx="205"
          cy="92"
          r="25"
          fill="url(#chess-piece)"
          stroke="#c084fc"
          strokeWidth="2"
        />
        <path
          d="M 178 124
             C 178 116 184 111 192 111
             L 218 111
             C 226 111 232 116 232 124
             C 232 132 226 137 218 137
             L 192 137
             C 184 137 178 132 178 124
             Z"
          fill="url(#chess-base)"
          stroke="#c084fc"
          strokeWidth="2"
        />
        <path
          d="M 187 135
             C 181 158 168 185 164 218
             L 246 218
             C 242 185 229 158 223 135
             Z"
          fill="url(#chess-piece)"
          stroke="#c084fc"
          strokeWidth="2"
        />
        <path
          d="M 171 218
             C 171 207 180 200 192 200
             L 218 200
             C 230 200 239 207 239 218
             Z"
          fill="url(#chess-base)"
          stroke="#c084fc"
          strokeWidth="2"
        />
      </g>

      {/* circuitry running through the piece */}
      <g fill="none" stroke="#d9b8ff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.58">
        <path d="M 205 92 L 205 212" />
        <path d="M 205 146 L 190 162" />
        <path d="M 205 178 L 184 192" />
        <path d="M 205 156 L 220 170" />
        <path d="M 205 184 L 226 198" />
      </g>
      <g fill="#ffd166">
        {traceNodes.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.2" className={i % 3 === 0 ? 'pa-pulse' : undefined} style={i % 3 === 0 ? { animationDelay: `${(i % 5) * 0.5}s` } : undefined} opacity={i % 3 === 0 ? 1 : 0.75} />
        ))}
      </g>

      {/* a thought forming */}
      <circle cx="235" cy="58" r="2" fill="#d9b8ff" opacity="0.7" />
      <circle cx="252" cy="46" r="3" fill="#d9b8ff" opacity="0.85" />
      <circle cx="270" cy="36" r="4" fill="#d9b8ff" className="pa-twinkle" />
      <Sparkle x={290} y={24} s={9} fill="#ffd166" className="pa-twinkle" style={{ animationDelay: '1.5s' }} />

      <Sparkle x={70} y={198} s={6} fill="#d9b8ff" opacity={0.7} />
      <Sparkle x={332} y={70} s={8} fill="#d9b8ff" className="pa-twinkle" style={{ animationDelay: '2s' }} />
      <Sparkle x={110} y={66} s={5} fill="#ffd166" opacity={0.8} />
    </svg>
  );
}

/* =====================================================================
   2. GRABBY — OCR + snipping: marquee, scan beam, recognized glyphs
   ===================================================================== */
const GRAB_ROWS = [
  { y: 132, widths: [8, 6, 9, 5, 8, 7, 6, 9, 8, 5, 7], hot: [2, 6] },
  { y: 154, widths: [6, 9, 7, 8, 5, 9, 6, 7, 8, 9, 5], hot: [0, 4, 9] },
  { y: 176, widths: [9, 5, 7, 6, 8, 6, 9, 5, 7, 8, 6], hot: [3, 7] },
];

function glyphRow({ y, widths, hot }, rowIdx) {
  const rects = [];
  let x = 132;
  widths.forEach((w, i) => {
    const isHot = hot.includes(i);
    rects.push(
      <rect
        key={`${rowIdx}-${i}`}
        x={x}
        y={y}
        width={w}
        height="10"
        rx="1.5"
        fill={isHot ? '#3ce0ff' : '#7d92c4'}
        opacity={isHot ? 0.95 : 0.4}
        className={isHot ? 'pa-pulse' : undefined}
        style={isHot ? { animationDelay: `${(rowIdx * 3 + i) * 0.3}s` } : undefined}
      />
    );
    x += w + 5;
  });
  return rects;
}

/* =====================================================================
   2b. PIXEL SAND SIMULATION - streamed terrain, two layers, falling cells
   ===================================================================== */
const SAND_GRID = {
  x: 104,
  y: 74,
  size: 13,
  gap: 1,
  cols: 15,
  rows: 10,
};

const SAND_CELLS = [
  [0, 7, '#6f3db7', 0.44], [1, 7, '#6f3db7', 0.54], [2, 7, '#6f3db7', 0.58], [3, 7, '#8b5cf6', 0.7],
  [4, 6, '#8b5cf6', 0.78], [5, 6, '#8b5cf6', 0.82], [6, 6, '#6f3db7', 0.66], [7, 7, '#6f3db7', 0.58],
  [8, 7, '#6f3db7', 0.52], [9, 7, '#6f3db7', 0.5], [10, 6, '#8b5cf6', 0.74], [11, 6, '#8b5cf6', 0.72],
  [12, 7, '#6f3db7', 0.52], [13, 7, '#6f3db7', 0.48], [14, 7, '#6f3db7', 0.42],
  [0, 8, '#2b1749', 0.72], [1, 8, '#2b1749', 0.8], [2, 8, '#38205d', 0.88], [3, 8, '#3e2468', 0.94],
  [4, 8, '#4b2b7a', 0.96], [5, 8, '#4b2b7a', 0.96], [6, 8, '#3e2468', 0.9], [7, 8, '#2b1749', 0.76],
  [10, 8, '#38205d', 0.86], [11, 8, '#3e2468', 0.88], [12, 8, '#2b1749', 0.78], [13, 8, '#2b1749', 0.74], [14, 8, '#24133e', 0.68],
  [0, 9, '#160a28', 0.92], [1, 9, '#160a28', 0.94], [2, 9, '#21123a', 0.96], [3, 9, '#21123a', 0.98],
  [4, 9, '#24133e', 0.98], [5, 9, '#24133e', 0.98], [6, 9, '#21123a', 0.96], [7, 9, '#160a28', 0.92],
  [8, 9, '#160a28', 0.88], [9, 9, '#21123a', 0.94], [10, 9, '#21123a', 0.96], [11, 9, '#24133e', 0.96],
  [12, 9, '#21123a', 0.92], [13, 9, '#160a28', 0.9], [14, 9, '#160a28', 0.86],
  [5, 2, '#ffd166', 1], [5, 3, '#ffd166', 0.96], [5, 4, '#f59e0b', 0.9],
  [4, 5, '#f59e0b', 0.95], [5, 5, '#fbbf24', 1], [6, 5, '#ffd166', 0.92],
  [4, 6, '#f59e0b', 0.92], [5, 6, '#fbbf24', 0.98], [6, 6, '#f59e0b', 0.86],
  [9, 3, '#3ce0ff', 0.86], [10, 3, '#3ce0ff', 0.74], [9, 4, '#38bdf8', 0.9],
  [10, 4, '#38bdf8', 0.82], [11, 4, '#38bdf8', 0.64], [9, 5, '#3ce0ff', 0.74], [10, 5, '#38bdf8', 0.78],
  [12, 5, '#ff7b2f', 0.9], [12, 6, '#ff9d3f', 0.95], [13, 6, '#ffe08a', 0.86],
  [2, 5, '#5eead4', 0.72], [2, 6, '#34d399', 0.64], [3, 6, '#5eead4', 0.7],
];

const BG_SAND_CELLS = [
  [1, 5, '#35205b', 0.36], [2, 5, '#35205b', 0.34], [3, 5, '#35205b', 0.32], [4, 5, '#4a2a75', 0.32],
  [5, 5, '#4a2a75', 0.3], [6, 5, '#35205b', 0.3], [7, 6, '#35205b', 0.32], [8, 6, '#35205b', 0.34],
  [9, 6, '#4a2a75', 0.32], [10, 6, '#4a2a75', 0.3], [11, 6, '#35205b', 0.28], [12, 6, '#35205b', 0.28],
];

const FALLING_GRAINS = [
  { x: 5, y: 0, fill: '#ffd166', delay: 0 },
  { x: 10, y: 1, fill: '#3ce0ff', delay: 0.9 },
];

const sandCellX = (c) => SAND_GRID.x + c * (SAND_GRID.size + SAND_GRID.gap);
const sandCellY = (r) => SAND_GRID.y + r * (SAND_GRID.size + SAND_GRID.gap);

function SandCell({ c, r, fill, opacity = 1, className, style }) {
  return (
    <rect
      x={sandCellX(c)}
      y={sandCellY(r)}
      width={SAND_GRID.size}
      height={SAND_GRID.size}
      rx="1.5"
      fill={fill}
      opacity={opacity}
      className={className}
      style={style}
    />
  );
}

export function SandSimArt() {
  const gridWidth = SAND_GRID.cols * (SAND_GRID.size + SAND_GRID.gap) - SAND_GRID.gap;
  const gridHeight = SAND_GRID.rows * (SAND_GRID.size + SAND_GRID.gap) - SAND_GRID.gap;
  const gridLines = [];

  for (let i = 1; i < SAND_GRID.cols; i++) {
    const x = SAND_GRID.x + i * (SAND_GRID.size + SAND_GRID.gap) - SAND_GRID.gap / 2;
    gridLines.push(<line key={`v${i}`} x1={x} y1={SAND_GRID.y} x2={x} y2={SAND_GRID.y + gridHeight} />);
  }
  for (let i = 1; i < SAND_GRID.rows; i++) {
    const y = SAND_GRID.y + i * (SAND_GRID.size + SAND_GRID.gap) - SAND_GRID.gap / 2;
    gridLines.push(<line key={`h${i}`} x1={SAND_GRID.x} y1={y} x2={SAND_GRID.x + gridWidth} y2={y} />);
  }

  return (
    <svg className="project-art project-art--sand" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="sand-bg" cx="50%" cy="45%" r="80%">
          <stop offset="0%" stopColor="#121044" />
          <stop offset="58%" stopColor="#0d0623" />
          <stop offset="100%" stopColor="#060010" />
        </radialGradient>
        <linearGradient id="sand-horizon" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,209,102,0.08)" />
          <stop offset="42%" stopColor="rgba(60,224,255,0.18)" />
          <stop offset="100%" stopColor="rgba(157,107,255,0.08)" />
        </linearGradient>
        <linearGradient id="sand-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(60,224,255,0)" />
          <stop offset="50%" stopColor="rgba(60,224,255,0.48)" />
          <stop offset="100%" stopColor="rgba(60,224,255,0)" />
        </linearGradient>
        <pattern id="sand-dots" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="#6b5fa8" />
        </pattern>
        <clipPath id="sand-clip">
          <rect x={SAND_GRID.x} y={SAND_GRID.y} width={gridWidth} height={gridHeight} rx="6" />
        </clipPath>
      </defs>

      <rect width="400" height="300" fill="url(#sand-bg)" />
      <rect width="400" height="300" fill="url(#sand-dots)" opacity="0.18" />

      <g fill="none" stroke="#6d5aa8" strokeWidth="0.8" opacity="0.24">
        <path d="M 18 214 C 70 188 116 208 164 182 C 220 152 276 180 354 150" />
        <path d="M 42 236 C 94 214 132 228 180 206 C 248 174 302 202 382 174" />
        <path d="M 72 58 L 96 38 L 122 68 L 96 96 Z M 96 38 L 96 96" />
        <path d="M 318 210 L 346 190 L 370 220 L 336 238 Z" />
      </g>
      <g fill="#d9b8ff">
        {[[72, 58], [96, 38], [122, 68], [96, 96], [318, 210], [346, 190], [370, 220], [336, 238]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.8" />
        ))}
      </g>

      <g>
        <rect x="83" y="56" width="236" height="172" rx="13" fill="#08051a" stroke="#463a72" strokeWidth="1.2" opacity="0.96" />
        <rect x="95" y="66" width="214" height="151" rx="9" fill="#0b0820" stroke="rgba(60,224,255,0.22)" strokeWidth="1" />
      </g>

      <g clipPath="url(#sand-clip)">
        <rect x={SAND_GRID.x} y={SAND_GRID.y} width={gridWidth} height={gridHeight} fill="#060010" />
        <rect x={SAND_GRID.x} y="136" width={gridWidth} height="1.5" fill="url(#sand-horizon)" />
        <g className="pa-pan-drift" opacity="0.62">
          {BG_SAND_CELLS.map(([c, r, fill, opacity], i) => (
            <SandCell key={`bg${i}`} c={c} r={r} fill={fill} opacity={opacity} />
          ))}
        </g>
        <g stroke="#1f173a" strokeWidth="0.45" opacity="0.72">{gridLines}</g>
        {SAND_CELLS.map(([c, r, fill, opacity]) => (
          <SandCell
            key={`fg${c}-${r}-${fill}`}
            c={c}
            r={r}
            fill={fill}
            opacity={opacity}
          />
        ))}
        {FALLING_GRAINS.map(({ x, y, fill, delay }, i) => (
          <SandCell
            key={`fall${i}`}
            c={x}
            r={y}
            fill={fill}
            opacity={0.96}
            className="pa-sand-fall"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
        <rect x={SAND_GRID.x} y="70" width={gridWidth} height="18" fill="url(#sand-beam)" className="pa-scan" opacity="0.7" />
      </g>

      <rect
        x={SAND_GRID.x - 2}
        y={SAND_GRID.y - 2}
        width={gridWidth + 4}
        height={gridHeight + 4}
        rx="8"
        fill="rgba(60,224,255,0.04)"
        stroke="#3ce0ff"
        strokeWidth="1.4"
        strokeDasharray="6 7"
        className="pa-ants"
      />
      <g stroke="#3ce0ff" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.9">
        <path d="M 102 92 L 102 72 L 122 72" />
        <path d="M 292 72 L 312 72 L 312 92" />
        <path d="M 312 192 L 312 212 L 292 212" />
        <path d="M 122 212 L 102 212 L 102 192" />
      </g>

      <path d="M 266 46 C 244 56 228 74 220 100" fill="none" stroke="#ffd166" strokeWidth="1.3" strokeDasharray="5 7" opacity="0.58" className="pa-dash" />
      <polygon points="260,42 274,40 268,53" fill="#ffd166" opacity="0.78" />
      <g className="pa-float">
        <circle cx="222" cy="94" r="12" fill="none" stroke="#ffd166" strokeWidth="1.3" opacity="0.7" />
        <line x1="222" y1="78" x2="222" y2="86" stroke="#ffd166" strokeWidth="1.3" />
        <line x1="222" y1="102" x2="222" y2="110" stroke="#ffd166" strokeWidth="1.3" />
        <line x1="206" y1="94" x2="214" y2="94" stroke="#ffd166" strokeWidth="1.3" />
        <line x1="230" y1="94" x2="238" y2="94" stroke="#ffd166" strokeWidth="1.3" />
      </g>

      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 72 144 C 54 156 54 184 72 196" stroke="#7ef2d0" strokeWidth="1.5" opacity="0.55" />
        <path d="M 72 196 L 64 193 M 72 196 L 70 187" stroke="#7ef2d0" strokeWidth="1.5" opacity="0.55" />
        <path d="M 328 144 C 346 156 346 184 328 196" stroke="#9d6bff" strokeWidth="1.5" opacity="0.5" />
        <path d="M 328 196 L 336 193 M 328 196 L 330 187" stroke="#9d6bff" strokeWidth="1.5" opacity="0.5" />
      </g>

      <Sparkle x={52} y={64} s={6} fill="#3ce0ff" className="pa-twinkle" style={{ animationDelay: '0.4s' }} />
      <Sparkle x={346} y={78} s={8} fill="#7ef2d0" opacity={0.75} />
      <Sparkle x={62} y={238} s={7} fill="#d9b8ff" opacity={0.7} />
      <Sparkle x={350} y={250} s={5} fill="#ffd166" className="pa-twinkle" style={{ animationDelay: '2.6s' }} />
    </svg>
  );
}

/* =====================================================================
   3. FOREST FIRE MODELLING - burning ridge line + data overlay
   ===================================================================== */
function Conifer({ x, y, h, fill, opacity = 1 }) {
  const w = h * 0.62;
  return (
    <g fill={fill} opacity={opacity}>
      <rect x={x - h * 0.05} y={y - h * 0.18} width={h * 0.1} height={h * 0.2} />
      <polygon points={`${x - w / 2},${y - h * 0.12} ${x + w / 2},${y - h * 0.12} ${x},${y - h * 0.55}`} />
      <polygon points={`${x - w * 0.4},${y - h * 0.4} ${x + w * 0.4},${y - h * 0.4} ${x},${y - h * 0.78}`} />
      <polygon points={`${x - w * 0.28},${y - h * 0.66} ${x + w * 0.28},${y - h * 0.66} ${x},${y - h}`} />
    </g>
  );
}

const EMBERS = [
  { x: 272, y: 212, r: 2.2, delay: 0, dur: 3.6 },
  { x: 305, y: 216, r: 2, delay: 1.2, dur: 3.4 },
  { x: 288, y: 200, r: 1.6, delay: 2.2, dur: 4 },
  { x: 196, y: 232, r: 1.6, delay: 0.8, dur: 3.8 },
];

const FIRE_STARS = [
  [30, 30], [74, 18], [128, 42], [182, 22], [232, 38],
  [310, 30], [368, 22], [54, 64],
];

export function WildfireArt() {
  return (
    <svg className="project-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="fire-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#060010" />
          <stop offset="62%" stopColor="#1c0b2e" />
          <stop offset="100%" stopColor="#33113a" />
        </linearGradient>
        <radialGradient id="fire-heat" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255,123,47,0.5)" />
          <stop offset="60%" stopColor="rgba(255,123,47,0.14)" />
          <stop offset="100%" stopColor="rgba(255,123,47,0)" />
        </radialGradient>
        <linearGradient id="fire-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,179,71,0.35)" />
          <stop offset="100%" stopColor="rgba(255,179,71,0)" />
        </linearGradient>
      </defs>

      <rect width="400" height="300" fill="url(#fire-sky)" />

      {/* stars — mostly static; one twinkles for life */}
      <g fill="#d9b8ff">
        {FIRE_STARS.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i % 3 === 0 ? 1.4 : 0.9}
            opacity={0.45 + (i % 4) * 0.12}
            className={i === 0 || i === 4 ? 'pa-twinkle' : undefined}
            style={i === 0 || i === 4 ? { animationDelay: `${i * 0.45}s` } : undefined}
          />
        ))}
      </g>

      {/* smoky moon */}
      <circle cx="342" cy="56" r="17" fill="#e8c79a" opacity="0.8" />
      <circle cx="350" cy="50" r="15" fill="#13062a" opacity="0.92" />

      {/* heat shimmer behind the main flame */}
      <ellipse cx="290" cy="218" rx="86" ry="64" fill="url(#fire-heat)" />

      {/* ridges, back to front */}
      <path d="M 0 190 C 60 168 120 186 180 170 C 240 156 320 178 400 162 L 400 300 L 0 300 Z" fill="#1a0b30" />
      <Conifer x={48} y={184} h={24} fill="#241040" />
      <Conifer x={86} y={178} h={28} fill="#241040" />
      <Conifer x={210} y={166} h={26} fill="#241040" />
      <Conifer x={344} y={170} h={24} fill="#241040" />

      <path d="M 0 222 C 70 206 150 220 220 206 C 290 194 340 212 400 200 L 400 300 L 0 300 Z" fill="#100722" />
      <Conifer x={32} y={216} h={34} fill="#1a0b30" />
      <Conifer x={120} y={218} h={38} fill="#1a0b30" />
      <Conifer x={252} y={202} h={34} fill="#1a0b30" />
      <Conifer x={372} y={204} h={32} fill="#1a0b30" />

      {/* smoke from the burn, behind the front ridge */}
      <g fill="none" stroke="#b9a8d8" strokeWidth="7" strokeLinecap="round" opacity="0.1">
        <path className="pa-sway" d="M 292 182 C 282 162 302 150 292 130 C 284 114 300 102 294 86" />
        <path className="pa-sway" style={{ animationDelay: '2s' }} d="M 268 196 C 260 180 274 170 266 152 C 260 138 272 128 268 114" />
      </g>

      <path d="M 0 258 C 80 244 170 256 260 246 C 320 240 360 250 400 244 L 400 300 L 0 300 Z" fill="#080313" />
      <Conifer x={62} y={252} h={46} fill="#0e051f" />
      <Conifer x={148} y={256} h={42} fill="#0e051f" />
      {/* this one is burning */}
      <Conifer x={204} y={252} h={44} fill="#1f0a14" />
      <Conifer x={340} y={250} h={48} fill="#0e051f" />

      {/* small flame on the burning tree */}
      <g className="pa-flicker">
        <path d="M 204 232 C 196 226 194 216 199 209 C 202 205 202 200 200 196 C 207 201 210 208 209 213 C 212 210 213 205 212 201 C 217 209 216 222 209 229 C 207 231 206 232 204 232 Z" fill="#ff9d3f" />
        <path d="M 204 229 C 199 225 198 219 201 214 C 203 211 203 208 202 205 C 207 209 209 215 207 219 C 210 222 208 227 204 229 Z" fill="#ffe08a" />
      </g>

      {/* the main fire — CSS scale only (no SVG blur) */}
      <g className="pa-flicker" style={{ animationDuration: '1.1s' }}>
        <path
          d="M 290 244
             C 262 232 256 206 266 188
             C 272 177 270 168 264 158
             C 276 164 282 172 284 180
             C 288 164 284 150 278 136
             C 296 148 302 164 302 176
             C 306 168 308 158 305 148
             C 318 162 322 182 316 200
             C 322 194 325 186 325 178
             C 332 198 328 226 312 238
             C 305 243 298 245 290 244 Z"
          fill="#ff7b2f"
        />
        <path
          d="M 290 241
             C 272 232 268 212 276 198
             C 280 191 280 184 277 177
             C 287 184 292 194 292 202
             C 296 195 297 187 294 180
             C 304 190 308 206 303 219
             C 307 215 309 209 309 203
             C 313 218 308 233 297 239
             C 295 240 292 241 290 241 Z"
          fill="#ffb347"
        />
        <path
          d="M 290 238
             C 278 230 276 216 283 205
             C 286 200 288 194 287 188
             C 295 196 299 207 297 216
             C 300 212 301 207 300 202
             C 306 212 304 227 295 235
             C 293 237 292 238 290 238 Z"
          fill="#ffe08a"
        />
      </g>

      {/* rising embers */}
      <g fill="#ffcf6e">
        {EMBERS.map((e, i) => (
          <circle
            key={i}
            cx={e.x}
            cy={e.y}
            r={e.r}
            className="pa-ember"
            style={{ animationDelay: `${e.delay}s`, animationDuration: `${e.dur}s` }}
          />
        ))}
      </g>

      {/* heat contour isolines around the burn */}
      <g fill="none" stroke="#ff9d4d" strokeDasharray="3 5">
        <ellipse cx="290" cy="240" rx="42" ry="13" opacity="0.3" strokeWidth="1" />
        <ellipse cx="290" cy="242" rx="64" ry="20" opacity="0.2" strokeWidth="1" />
        <ellipse cx="290" cy="244" rx="88" ry="27" opacity="0.12" strokeWidth="1" />
      </g>

      {/* spread-model chart overlay */}
      <g>
        <line x1="38" y1="40" x2="38" y2="118" stroke="#8a7fb8" strokeWidth="1" opacity="0.6" />
        <line x1="38" y1="118" x2="152" y2="118" stroke="#8a7fb8" strokeWidth="1" opacity="0.6" />
        {[56, 76, 96].map((y) => (
          <line key={y} x1="35" y1={y} x2="41" y2={y} stroke="#8a7fb8" strokeWidth="1" opacity="0.5" />
        ))}
        {[64, 92, 120].map((x) => (
          <line key={x} x1={x} y1="115" x2={x} y2="121" stroke="#8a7fb8" strokeWidth="1" opacity="0.5" />
        ))}
        <polygon points="38,108 56,100 72,104 88,88 104,90 120,74 136,78 150,62 150,118 38,118" fill="url(#fire-area)" />
        <polyline points="38,108 56,100 72,104 88,88 104,90 120,74 136,78 150,62" fill="none" stroke="#ffb347" strokeWidth="1.6" />
        <line x1="38" y1="106" x2="150" y2="64" stroke="#ff7b2f" strokeWidth="1" strokeDasharray="4 4" opacity="0.55" />
        {[[56, 100], [88, 88], [120, 74], [150, 62]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.4" fill="#ffe08a" className={i === 3 ? 'pa-pulse' : undefined} opacity={i === 3 ? 1 : 0.85} />
        ))}
      </g>
    </svg>
  );
}

/* =====================================================================
   4. 3D GAME OF LIFE — isometric glider generations stacked in time
   ===================================================================== */
const ISO = { cx: 200, cyBase: 150, dx: 20, dy: 10, hz: 44, ch: 16, n: 5 };

const isoPt = (c, r, layer) => ({
  x: ISO.cx + (c - r) * ISO.dx,
  y: ISO.cyBase + (c + r) * ISO.dy - layer * ISO.hz,
});
const pts = (list) => list.map((p) => `${p.x},${p.y}`).join(' ');

function IsoCube({ c, r, layer, top, left, right, className, style, opacity = 1 }) {
  const p00 = isoPt(c, r, layer);
  const p10 = isoPt(c + 1, r, layer);
  const p11 = isoPt(c + 1, r + 1, layer);
  const p01 = isoPt(c, r + 1, layer);
  const d = ISO.ch;
  return (
    <g className={className} style={style} opacity={opacity}>
      <polygon points={pts([p01, p11, { x: p11.x, y: p11.y + d }, { x: p01.x, y: p01.y + d }])} fill={left} />
      <polygon points={pts([p10, p11, { x: p11.x, y: p11.y + d }, { x: p10.x, y: p10.y + d }])} fill={right} />
      <polygon points={pts([p00, p10, p11, p01])} fill={top} stroke="rgba(255,255,255,0.15)" strokeWidth="0.6" />
    </g>
  );
}

function IsoPlate({ layer, stroke, opacity }) {
  const n = ISO.n;
  const outline = pts([isoPt(0, 0, layer), isoPt(n, 0, layer), isoPt(n, n, layer), isoPt(0, n, layer)]);
  const lines = [];
  for (let i = 1; i < n; i++) {
    const a = isoPt(i, 0, layer);
    const b = isoPt(i, n, layer);
    const c = isoPt(0, i, layer);
    const d = isoPt(n, i, layer);
    lines.push(<line key={`c${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
    lines.push(<line key={`r${i}`} x1={c.x} y1={c.y} x2={d.x} y2={d.y} />);
  }
  return (
    <g stroke={stroke} strokeWidth="0.8" opacity={opacity} fill="none">
      <polygon points={outline} fill="rgba(157,107,255,0.04)" />
      {lines}
    </g>
  );
}

// Three consecutive generations of a glider, oldest at the bottom.
const LIFE_LAYERS = [
  {
    layer: 0,
    cells: [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]],
    colors: { top: '#4c3375', left: '#2c1d49', right: '#231539' },
    opacity: 0.7,
  },
  {
    layer: 1,
    cells: [[1, 2], [3, 2], [2, 3], [3, 3], [2, 4]],
    colors: { top: '#7c5cd6', left: '#4a3489', right: '#3b2a6e' },
    opacity: 0.88,
  },
  {
    layer: 2,
    cells: [[3, 2], [1, 3], [3, 3], [2, 4], [3, 4]],
    colors: { top: '#5eead4', left: '#1f8f87', right: '#176e68' },
    opacity: 1,
  },
];

const LIFE_TICKS = [
  { label: 't-2', layer: 0 },
  { label: 't-1', layer: 1 },
  { label: 't', layer: 2 },
];

export function LifeArt() {
  const scanPlate = pts([isoPt(0, 0, 0), isoPt(5, 0, 0), isoPt(5, 5, 0), isoPt(0, 5, 0)]);

  return (
    <svg className="project-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="life-bg" cx="50%" cy="42%" r="78%">
          <stop offset="0%" stopColor="#160a33" />
          <stop offset="60%" stopColor="#0c0521" />
          <stop offset="100%" stopColor="#060010" />
        </radialGradient>
      </defs>

      <rect width="400" height="300" fill="url(#life-bg)" />

      {/* background plus-marks (static) */}
      <g stroke="#4b3f7a" strokeWidth="1" opacity="0.5">
        {[[44, 52], [356, 64], [34, 244], [368, 236], [330, 150], [60, 150]].map(([x, y], i) => (
          <g key={i}>
            <line x1={x - 4} y1={y} x2={x + 4} y2={y} />
            <line x1={x} y1={y - 4} x2={x} y2={y + 4} />
          </g>
        ))}
      </g>

      {/* time axis */}
      <line x1="72" y1="252" x2="72" y2="70" stroke="#8a7fb8" strokeWidth="1.2" opacity="0.7" />
      <polygon points="72,60 67,72 77,72" fill="#8a7fb8" opacity="0.8" />
      {LIFE_TICKS.map(({ label, layer }) => {
        const y = ISO.cyBase + ISO.n * ISO.dy - layer * ISO.hz;
        const corner = isoPt(0, ISO.n, layer);
        return (
          <g key={label}>
            <line x1="66" y1={y} x2="78" y2={y} stroke="#8a7fb8" strokeWidth="1.2" opacity="0.7" />
            <line x1="78" y1={y} x2={corner.x} y2={corner.y} stroke="#8a7fb8" strokeWidth="0.8" strokeDasharray="3 4" opacity="0.4" />
            <text x="60" y={y + 3} textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10" fill="#8a7fb8">
              {label}
            </text>
          </g>
        );
      })}

      {/* generations, bottom (oldest) to top (current) — static cubes; motion is the scan. */}
      {LIFE_LAYERS.map(({ layer, cells, colors, opacity }) => {
        const ordered = [...cells].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
        return (
          <g key={layer}>
            <IsoPlate layer={layer} stroke="#6d5aa8" opacity={0.2 + layer * 0.12} />
            {ordered.map(([c, r]) => (
              <IsoCube
                key={`${c}-${r}`}
                c={c}
                r={r}
                layer={layer}
                {...colors}
                opacity={opacity}
              />
            ))}
          </g>
        );
      })}

      {/* scan plane sweeping up through the generations */}
      <polygon
        points={scanPlate}
        fill="rgba(94,234,212,0.08)"
        stroke="rgba(94,234,212,0.3)"
        strokeWidth="1"
        className="pa-rise"
      />

      <Sparkle x={320} y={84} s={7} fill="#5eead4" className="pa-twinkle" style={{ animationDelay: '1.4s' }} />
      <Sparkle x={96} y={92} s={5} fill="#9d6bff" opacity={0.75} />
      <Sparkle x={336} y={216} s={6} fill="#9d6bff" opacity={0.7} />
    </svg>
  );
}
