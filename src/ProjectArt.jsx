// src/ProjectArt.jsx
// Hand-crafted SVG artwork for the project cards (replaces the stock Lottie files).
// Each scene fills its project card edge-to-edge. Animation is pure CSS (see
// ProjectArt.css) and is disabled under prefers-reduced-motion.

import './ProjectArt.css';

/* Four-point sparkle used across scenes. */
function Sparkle({ x, y, s, fill, className, style, opacity = 1 }) {
  const d = `M ${x} ${y - s} Q ${x} ${y} ${x + s} ${y} Q ${x} ${y} ${x} ${y + s} Q ${x} ${y} ${x - s} ${y} Q ${x} ${y} ${x} ${y - s} Z`;
  return <path d={d} fill={fill} className={className} style={style} opacity={opacity} />;
}

/* =====================================================================
   1. LLM CHESS COACH — board analysis, engine lines, coaching feedback
   ===================================================================== */
export function ChessArt() {
  const boardX = 49;
  const boardY = 52;
  const cell = 25;
  const squares = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      squares.push(
        <rect
          key={`${file}-${rank}`}
          x={boardX + file * cell}
          y={boardY + rank * cell}
          width={cell}
          height={cell}
          fill={(file + rank) % 2 === 0 ? '#d8cce2' : '#6a5279'}
        />,
      );
    }
  }

  const pieces = [
    ['♜', 0, 0, 'black'], ['♛', 3, 0, 'black'], ['♜', 5, 0, 'black'], ['♚', 6, 0, 'black'],
    ['♟', 0, 1, 'black'], ['♟', 1, 1, 'black'], ['♟', 2, 1, 'black'], ['♟', 3, 2, 'black'],
    ['♟', 5, 1, 'black'], ['♟', 6, 1, 'black'], ['♟', 7, 1, 'black'],
    ['♞', 2, 2, 'black'], ['♝', 2, 3, 'black'], ['♞', 5, 2, 'black'],
    ['♙', 0, 6, 'white'], ['♙', 1, 6, 'white'], ['♙', 2, 6, 'white'], ['♙', 3, 4, 'white'],
    ['♙', 5, 6, 'white'], ['♙', 6, 6, 'white'], ['♙', 7, 6, 'white'],
    ['♘', 2, 5, 'white'], ['♗', 2, 4, 'white'], ['♘', 5, 5, 'white'],
    ['♖', 0, 7, 'white'], ['♕', 3, 7, 'white'], ['♖', 5, 7, 'white'], ['♔', 6, 7, 'white'],
  ];

  return (
    <svg className="project-art project-art--chess" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="chess-bg" cx="45%" cy="44%" r="78%">
          <stop offset="0%" stopColor="#382151" />
          <stop offset="52%" stopColor="#171025" />
          <stop offset="100%" stopColor="#07080e" />
        </radialGradient>
        <linearGradient id="chess-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#281936" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#11131d" stopOpacity="0.96" />
        </linearGradient>
        <linearGradient id="chess-eval" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5eefe" />
          <stop offset="100%" stopColor="#bca4d5" />
        </linearGradient>
      </defs>

      <rect width="400" height="300" fill="url(#chess-bg)" />
      <circle cx="117" cy="145" r="135" fill="#a65df5" opacity="0.08" />
      <circle cx="351" cy="218" r="118" fill="#3a9bf0" opacity="0.07" />

      <g className="pa-spin-slow" fill="none" strokeLinecap="round">
        <circle cx="150" cy="151" r="133" stroke="#bd87ef" strokeWidth="0.9" strokeDasharray="4 13" opacity="0.32" />
        <path d="M40 79 A138 138 0 0 1 278 61" stroke="#ffd166" strokeWidth="1.2" strokeDasharray="20 34" opacity="0.23" />
      </g>

      <g stroke="#ba82e8" strokeWidth="1" fill="none" opacity="0.38">
        <path d="M255 42 L290 26 L321 44 L356 23 L389 47" />
        <path d="M244 252 L278 268 L311 247 L347 269 L389 242" />
        <path d="M292 26 L301 74 M356 23 L345 89 M311 247 L320 201 M347 269 L353 224" />
      </g>
      <g fill="#dfbcff">
        {[[255, 42], [290, 26], [321, 44], [356, 23], [389, 47], [244, 252], [278, 268], [311, 247], [347, 269], [389, 242]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2.5 : 1.8} opacity={0.48 + (i % 3) * 0.14} className={i % 4 === 0 ? 'pa-pulse' : undefined} />
        ))}
      </g>

      <rect x="22" y="18" width="144" height="25" rx="12.5" fill="#21142f" stroke="#664485" />
      <circle cx="37" cy="30.5" r="3" fill="#7cebb6" className="pa-pulse" />
      <text x="48" y="34" fill="#e5d4f1" fontSize="9" fontWeight="700" letterSpacing="1.1">ENGINE COACH</text>
      <text x="376" y="32" fill="#a589b9" fontSize="7.5" fontWeight="650" textAnchor="end" letterSpacing="0.9">18 PLY SEARCH</text>

      <g transform="rotate(-2 149 152)">
        <rect x={boardX - 8} y={boardY - 8} width="216" height="216" rx="13" fill="#0a0910" stroke="#9b70ba" strokeWidth="1.4" opacity="0.96" />
        <rect x="32" y={boardY} width="7" height="200" rx="3.5" fill="url(#chess-eval)" />
        <path d={`M32 ${boardY}H39V${boardY + 57}H32Z`} fill="#292132" />
        <text x="35.5" y={boardY + 214} fill="#a9f0c1" fontSize="8" fontWeight="700" textAnchor="middle">+0.8</text>

        <rect x={boardX - 1} y={boardY - 1} width="202" height="202" rx="4" fill="#0c0b12" stroke="#d0a6eb" strokeWidth="1.4" />
        <g>{squares}</g>
        <rect x={boardX + 3 * cell} y={boardY + 4 * cell} width={cell} height={cell} fill="#ffd166" opacity="0.56" />
        <rect x={boardX + 2 * cell} y={boardY + 5 * cell} width={cell} height={cell} fill="#7af0c4" opacity="0.52" className="pa-pulse" />

        <g fontFamily="Georgia, 'Times New Roman', serif" fontSize="22" textAnchor="middle">
          {pieces.map(([piece, file, rank, side], i) => (
            <text
              key={i}
              x={boardX + file * cell + cell / 2}
              y={boardY + rank * cell + 20}
              fill={side === 'white' ? '#fffdf7' : '#23202b'}
              stroke={side === 'white' ? '#4b4255' : '#eadff0'}
              strokeWidth={side === 'white' ? 0.45 : 0.65}
              paintOrder="stroke"
            >
              {piece}
            </text>
          ))}
        </g>

        <path d="M111 190 C112 169 121 151 136 142" fill="none" stroke="#7af0c4" strokeWidth="4.5" strokeLinecap="round" opacity="0.96" />
        <polygon points="138,141 128,141 135,150" fill="#7af0c4" />
      </g>

      <rect x="267" y="65" width="111" height="136" rx="16" fill="url(#chess-panel)" stroke="#8561a2" strokeWidth="1.2" />
      <text x="281" y="86" fill="#b397c8" fontSize="7.5" fontWeight="700" letterSpacing="1">BEST LINE</text>
      <text x="281" y="116" fill="#fff9ff" fontSize="22" fontWeight="700">Nxd5</text>
      <text x="364" y="115" fill="#91efb1" fontSize="10" fontWeight="700" textAnchor="end">+0.82</text>
      <path d="M280 128H365" stroke="#503c5f" />
      <text x="281" y="147" fill="#9f86b2" fontSize="7.5" fontWeight="650">ALTERNATIVES</text>
      <rect x="280" y="157" width="39" height="23" rx="11.5" fill="#2e213a" />
      <text x="299.5" y="172" fill="#d9cbe3" fontSize="8.5" fontWeight="650" textAnchor="middle">O-O</text>
      <rect x="324" y="157" width="41" height="23" rx="11.5" fill="#2e213a" />
      <text x="344.5" y="172" fill="#d9cbe3" fontSize="8.5" fontWeight="650" textAnchor="middle">Qc2</text>
      <text x="281" y="191" fill="#7e6c8d" fontSize="7">1.2M positions searched</text>

      <rect x="267" y="213" width="111" height="50" rx="14" fill="#192a25" stroke="#4b8b70" strokeWidth="1.2" />
      <circle cx="281" cy="229" r="3.5" fill="#7aefb1" className="pa-pulse" />
      <text x="291" y="232" fill="#cdf7dc" fontSize="9" fontWeight="700">Strong move</text>
      <text x="281" y="248" fill="#8eaa9d" fontSize="7.5">Wins control of the centre</text>

      <text x="337" y="294" fill="#d8b6ef" fontFamily="Georgia, serif" fontSize="54" textAnchor="middle" opacity="0.08">♞</text>
      <Sparkle x={20} y={72} s={6} fill="#d6a6ff" className="pa-twinkle" style={{ animationDelay: '0.6s' }} />
      <Sparkle x={384} y={91} s={7} fill="#ffd166" className="pa-twinkle" style={{ animationDelay: '2.1s' }} opacity={0.75} />
    </svg>
  );
}

/* =====================================================================
   2. GRABBY — OCR + snipping: marquee, scan beam, recognized glyphs
   ===================================================================== */
/* =====================================================================
   2b. PIXEL SAND SIMULATION - streamed terrain, two layers, falling cells
   ===================================================================== */
const SAND_GRID = {
  x: 48,
  y: 60,
  size: 23,
  gap: 1,
  cols: 36,
  rows: 11,
};

const SAND_TERRAIN_PROFILE = [
  8, 8, 7, 7, 6, 6, 7, 7, 8, 8, 9, 9,
  9, 9, 9, 9, 9, 9, 9, 8, 8, 7, 7, 7,
  8, 8, 7, 7, 6, 6, 6, 7, 7, 8, 8, 8,
];

const terrainColor = (column, row, surface) => {
  if (row >= 10) return column % 3 === 0 ? '#343744' : '#404451';
  if (row >= 9) return column % 2 === 0 ? '#4d4658' : '#554a5c';
  if (column < 10) return row === surface ? '#f0c45b' : '#a96f48';
  if (column >= 27) return row === surface ? '#67ad58' : '#83583f';
  return row === surface ? '#8f6a9e' : '#69516f';
};

const SAND_CELLS = SAND_TERRAIN_PROFILE.flatMap((surface, column) =>
  Array.from({ length: SAND_GRID.rows - surface }, (_, offset) => {
    const row = surface + offset;
    return [column, row, terrainColor(column, row, surface), 1];
  }),
);

const WATER_CELLS = Array.from({ length: 9 }, (_, columnOffset) =>
  Array.from({ length: 3 }, (_, rowOffset) => [
    10 + columnOffset,
    6 + rowOffset,
    rowOffset === 0 ? '#55c8ef' : '#2797d0',
    0.78 + rowOffset * 0.08,
  ]),
).flat();

const FEATURE_CELLS = [
  [4, 3, '#f4cf69', 1], [4, 4, '#edb94d', 1], [4, 5, '#e8a83e', 1],
  [3, 5, '#f4cf69', 1], [5, 5, '#f4cf69', 1],
  [22, 5, '#f04444', 1], [23, 5, '#e23838', 1], [22, 6, '#c62f37', 1], [23, 6, '#b82732', 1],
  [22, 4, '#ffb347', 0.94], [23, 3, '#ffd166', 0.96], [24, 4, '#ff7438', 0.9],
  [29, 3, '#805c3f', 1], [29, 4, '#805c3f', 1], [29, 5, '#805c3f', 1],
  [28, 2, '#66b85b', 0.96], [29, 2, '#72c466', 1], [30, 2, '#66b85b', 0.96],
  [27, 3, '#5fae55', 0.9], [28, 3, '#72c466', 1], [30, 3, '#72c466', 1], [31, 3, '#5fae55', 0.9],
  [32, 4, '#aeb4c2', 1], [33, 4, '#8e95a5', 1], [32, 5, '#9299a8', 1], [33, 5, '#747c8d', 1],
];

const BG_SAND_CELLS = SAND_TERRAIN_PROFILE.flatMap((surface, column) => {
  const backgroundSurface = Math.max(5, surface - 2 - (column % 5 === 0 ? 1 : 0));
  return Array.from({ length: 2 }, (_, offset) => [
    column,
    backgroundSurface + offset,
    offset === 0 ? '#554a7e' : '#393653',
    0.28 + offset * 0.08,
  ]);
});

const FALLING_GRAINS = [
  { x: 3, y: 0, fill: '#f4cf69', delay: 0 },
  { x: 5, y: 1, fill: '#edb94d', delay: 1.2 },
  { x: 14, y: 0, fill: '#55c8ef', delay: 0.6 },
  { x: 16, y: 1, fill: '#2797d0', delay: 1.8 },
  { x: 32, y: 0, fill: '#aeb4c2', delay: 0.35 },
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
      rx="1"
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
    <svg className="project-art project-art--sand" viewBox="0 0 960 350" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="sand-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#11182b" />
          <stop offset="52%" stopColor="#17102d" />
          <stop offset="100%" stopColor="#090711" />
        </linearGradient>
        <linearGradient id="sand-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#18243f" />
          <stop offset="58%" stopColor="#1e2940" />
          <stop offset="100%" stopColor="#3c3145" />
        </linearGradient>
        <linearGradient id="sand-horizon" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(240,196,91,0.06)" />
          <stop offset="46%" stopColor="rgba(85,200,239,0.26)" />
          <stop offset="100%" stopColor="rgba(103,173,88,0.08)" />
        </linearGradient>
        <linearGradient id="sand-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(127,214,255,0)" />
          <stop offset="50%" stopColor="rgba(127,214,255,0.34)" />
          <stop offset="100%" stopColor="rgba(127,214,255,0)" />
        </linearGradient>
        <pattern id="sand-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="#7e78a4" />
        </pattern>
        <clipPath id="sand-clip">
          <rect x={SAND_GRID.x} y={SAND_GRID.y} width={gridWidth} height={gridHeight} rx="5" />
        </clipPath>
      </defs>

      <rect width="960" height="350" fill="url(#sand-bg)" />
      <rect width="960" height="350" fill="url(#sand-dots)" opacity="0.13" />
      <circle cx="788" cy="50" r="142" fill="rgba(111,130,255,0.09)" />
      <circle cx="170" cy="285" r="185" fill="rgba(211,105,255,0.06)" />

      <rect x="22" y="20" width="916" height="310" rx="17" fill="#080a11" stroke="#45485e" strokeWidth="1.3" />
      <rect x="23" y="21" width="914" height="35" rx="16" fill="#141621" />
      <path d="M23 56H937" stroke="#393c4f" strokeWidth="1" />
      <circle cx="43" cy="38" r="4" fill="#ff6b6b" />
      <circle cx="57" cy="38" r="4" fill="#ffd166" />
      <circle cx="71" cy="38" r="4" fill="#62d98b" />
      <text x="91" y="42" fill="#aeb4c2" fontSize="10" fontWeight="650" letterSpacing="1.5">SAND ENGINE</text>
      <text x="913" y="42" fill="#7f86a0" fontSize="9" textAnchor="end" letterSpacing="1.2">FG + BG · LIVE</text>

      <g clipPath="url(#sand-clip)">
        <rect x={SAND_GRID.x} y={SAND_GRID.y} width={gridWidth} height={gridHeight} fill="url(#sand-sky)" />
        <g fill="#dce9ff">
          {[[74, 80], [148, 104], [238, 78], [356, 92], [468, 76], [588, 103], [714, 82], [842, 98]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.8 : 1.2} opacity={0.28 + (i % 3) * 0.13} />
          ))}
        </g>
        <circle cx="805" cy="104" r="24" fill="#d9e6ff" opacity="0.75" />
        <circle cx="795" cy="96" r="24" fill="#202b43" opacity="0.9" />
        <path d="M48 178 L138 112 L222 171 L320 102 L418 176 L522 121 L638 182 L742 116 L911 183 V250 H48Z" fill="#283249" opacity="0.88" />
        <path d="M48 208 L148 156 L252 208 L368 145 L482 210 L602 164 L716 207 L818 154 L911 198 V260 H48Z" fill="#313646" opacity="0.92" />
        <rect x={SAND_GRID.x} y="201" width={gridWidth} height="2" fill="url(#sand-horizon)" />
        <g className="pa-pan-drift">
          {BG_SAND_CELLS.map(([c, r, fill, opacity], i) => (
            <SandCell key={`bg${i}`} c={c} r={r} fill={fill} opacity={opacity} />
          ))}
        </g>
        <g stroke="#182033" strokeWidth="0.5" opacity="0.48">{gridLines}</g>
        {SAND_CELLS.map(([c, r, fill, opacity], i) => (
          <SandCell
            key={`fg${i}`}
            c={c}
            r={r}
            fill={fill}
            opacity={opacity}
          />
        ))}
        {WATER_CELLS.map(([c, r, fill, opacity], i) => (
          <SandCell key={`water${i}`} c={c} r={r} fill={fill} opacity={opacity} />
        ))}
        {FEATURE_CELLS.map(([c, r, fill, opacity], i) => (
          <SandCell key={`feature${i}`} c={c} r={r} fill={fill} opacity={opacity} />
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
        <rect x={SAND_GRID.x} y="64" width={gridWidth} height="20" fill="url(#sand-beam)" className="pa-scan" opacity="0.6" />
      </g>

      <rect
        x={SAND_GRID.x - 2}
        y={SAND_GRID.y - 2}
        width={gridWidth + 4}
        height={gridHeight + 4}
        rx="7"
        fill="rgba(127,214,255,0.025)"
        stroke="#7fd6ff"
        strokeWidth="1.2"
        strokeDasharray="8 9"
        className="pa-ants"
      />
      <g stroke="#a2e4ff" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.86">
        <path d="M 48 80 L 48 60 L 68 60" />
        <path d="M 891 60 L 911 60 L 911 80" />
        <path d="M 911 303 L 911 323 L 891 323" />
        <path d="M 68 323 L 48 323 L 48 303" />
      </g>
      <g className="pa-float" fill="none" stroke="#f4cf69" strokeWidth="1.5" opacity="0.78">
        <circle cx="144" cy="104" r="13" />
        <path d="M144 83V92 M144 116V125 M123 104H132 M156 104H165" />
      </g>
      <Sparkle x={99} y={91} s={7} fill="#7fd6ff" className="pa-twinkle" style={{ animationDelay: '0.4s' }} />
      <Sparkle x={861} y={102} s={8} fill="#8ee29b" className="pa-twinkle" style={{ animationDelay: '2s' }} />
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
