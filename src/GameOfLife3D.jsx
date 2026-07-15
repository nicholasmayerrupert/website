// src/GameOfLife3D.jsx
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createLifeSearchClient } from "./life/createLifeSearchClient.js";

const GRID_HEIGHT = 30;
const DEFAULT_STEPS_PER_SECOND = 15;
const AUTO_ROTATION_RESUME_MS = 6000;
const DRAG_ROTATION_SCALE = 0.008;
const PITCH_RESET_DURATION_MS = 2800;
const MAX_MANUAL_PITCH = Math.PI * 0.42;
const EDITOR_CANVAS_SIZE = 256;
const DEFAULT_SEED =
  "0111001100100110001100100011011101111100000001001100010110101000100001110100010001000001101101000100000000000100011110000101011110001001000101100011000110110110111100100000101111011001000000100001001100000000000100101011010011110000100011101100100101010011";

// A layer is a flat Uint8Array of size*size cells (1 = alive), indexed by
// z * size + x — the same row-major layout the instance idxFor uses. Flat typed
// arrays are far more cache-friendly to scan than nested boolean arrays, which
// matters because updateInstances sweeps the whole volume every simulation step.
const makeEmptyLayer = (size) => new Uint8Array(size * size);

const makeEmptyCells = (size) =>
  Array.from({ length: GRID_HEIGHT }, () => makeEmptyLayer(size));

const cloneLayer = (layer) => layer.slice();

const binaryToLayer = (binarySeed, size) => {
  const layer = new Uint8Array(size * size);
  const n = Math.min(binarySeed.length, size * size);
  for (let i = 0; i < n; i++) if (binarySeed[i] === "1") layer[i] = 1;
  return layer;
};

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const textToLayer = (seedText, size) => {
  let hash = 2166136261;
  const value = seedText.trim() || "game-of-life";
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const random = mulberry32(hash);
  const layer = new Uint8Array(size * size);
  for (let i = 0; i < layer.length; i++) if (random() > 0.62) layer[i] = 1;
  return layer;
};

const seedToLayer = (seedText, size) => {
  const binary = seedText.replace(/[^01]/g, "");
  if (binary.length >= size * size) return binaryToLayer(binary, size);
  return textToLayer(seedText, size);
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (t) => t * t * (3 - 2 * t);

export default function GameOfLife3D({
  className,
  onControlsOpenChange,
  defaultControlsOpen,
}) {
  const canvasHostRef = useRef(null);
  const editorCanvasRef = useRef(null);
  const speedRef = useRef(DEFAULT_STEPS_PER_SECOND);
  const pausedRef = useRef(false);
  const seedRequestRef = useRef(null);
  const manualRotateRef = useRef(false);
  const resumeStepResetRef = useRef(false);
  const editorPointerActiveRef = useRef(false);
  const seedInputRef = useRef(DEFAULT_SEED);
  const simulationApiRef = useRef({
    clearTopLayer: () => {},
    getTopLayer: () => new Uint8Array(0),
    renderEditor: () => {},
    replaceHistory: () => {},
    setTopCell: () => {},
  });
  const searchClientRef = useRef(null);

  const [speed, setSpeed] = useState(DEFAULT_STEPS_PER_SECOND);
  const [seedInput, setSeedInput] = useState(DEFAULT_SEED);
  const [controlsOpen, setControlsOpen] = useState(() => {
    if (typeof defaultControlsOpen === "boolean") return defaultControlsOpen;
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const [paused, setPaused] = useState(false);
  const [drawMode, setDrawMode] = useState("draw");
  const [gridSize, setGridSize] = useState(16);
  const [activeTab, setActiveTab] = useState("simulate");
  const [searchMode, setSearchMode] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [soupSettings, setSoupSettings] = useState({
    density: 37.5,
    horizon: 5000,
    seed: "soup-1",
    batchSize: 32,
    leaderboardSize: 10,
  });
  const [soupProgress, setSoupProgress] = useState({ searched: 0, elapsedMs: 0, results: [] });
  const handleSearchMessage = (message) => {
    if (message.type === "started") {
      setSearchMode(message.mode);
      setSearchError("");
    } else if (message.type === "soup-progress") {
      setSoupProgress(message);
    } else if (message.type === "stopped") {
      setSearchMode(null);
    } else if (message.type === "error") {
      setSearchMode(null);
      setSearchError(message.message || "Search failed");
    }
  };

  const ensureSearchClient = () => {
    if (searchClientRef.current) return searchClientRef.current;
    try {
      const client = createLifeSearchClient(handleSearchMessage);
      searchClientRef.current = client;
      return client;
    } catch (error) {
      setSearchMode(null);
      setSearchError(error?.message || "Unable to start the Life search worker");
      return null;
    }
  };

  useEffect(() => () => {
    searchClientRef.current?.destroy();
    searchClientRef.current = null;
  }, []);

  useEffect(() => {
    searchClientRef.current?.stop();
    setSearchMode(null);
    setSearchError("");
    setSoupProgress({ searched: 0, elapsedMs: 0, results: [] });
  }, [gridSize]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    seedInputRef.current = seedInput;
  }, [seedInput]);

  // Drag-to-rotate is enabled only while the controls are open on desktop; on
  // mobile it stays off so vertical scrolling isn't captured.
  useEffect(() => {
    const desktop =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(min-width: 768px)").matches
        : false;
    manualRotateRef.current = controlsOpen && desktop;
  }, [controlsOpen]);

  useEffect(() => {
    if (controlsOpen) simulationApiRef.current.renderEditor();
    onControlsOpenChange?.(controlsOpen);
  }, [controlsOpen, onControlsOpenChange]);

  useEffect(() => {
    if (activeTab === "simulate") simulationApiRef.current.renderEditor();
  }, [activeTab]);

  const applySeed = (seedText = seedInput) => {
    seedRequestRef.current = seedToLayer(seedText, gridSize);
  };

  const resetDefaultSeed = () => {
    setSeedInput(DEFAULT_SEED);
    seedRequestRef.current = seedToLayer(DEFAULT_SEED, gridSize);
  };

  const randomizeSeed = () => {
    const randomSeed = `random-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setSeedInput(randomSeed);
    seedRequestRef.current = seedToLayer(randomSeed, gridSize);
  };

  const togglePaused = () => {
    setPaused((current) => {
      const next = !current;
      if (current && !next) resumeStepResetRef.current = true;
      return next;
    });
  };

  const clearTopLayer = () => {
    simulationApiRef.current.clearTopLayer();
  };

  const stopSearch = () => searchClientRef.current?.stop();

  const resetSoupSearch = () => {
    stopSearch();
    setSoupProgress({ searched: 0, elapsedMs: 0, results: [] });
    setSearchError("");
  };

  const startSoupSearch = () => {
    setSearchError("");
    setSoupProgress({ searched: 0, elapsedMs: 0, results: [] });
    ensureSearchClient()?.startSoup({ size: gridSize, ...soupSettings });
  };

  const loadSoupResult = (cells) => {
    const layer = new Uint8Array(cells);
    const binary = Array.from(layer, (cell) => cell ? "1" : "0").join("");
    setSeedInput(binary);
    seedRequestRef.current = layer;
    setActiveTab("simulate");
  };

  const updateSoupSetting = (key, value) => {
    setSoupSettings((current) => ({ ...current, [key]: value }));
  };

  const paintFromPointer = (event) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(
      Math.floor(((event.clientX - rect.left) / rect.width) * gridSize),
      0,
      gridSize - 1
    );
    const z = clamp(
      Math.floor(((event.clientY - rect.top) / rect.height) * gridSize),
      0,
      gridSize - 1
    );
    const erase =
      drawMode === "erase" ||
      event.button === 2 ||
      event.buttons === 2 ||
      event.altKey ||
      event.shiftKey;
    simulationApiRef.current.setTopCell(x, z, !erase);
  };

  const onEditorPointerDown = (event) => {
    editorPointerActiveRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paintFromPointer(event);
    event.preventDefault();
  };

  const onEditorPointerMove = (event) => {
    if (!editorPointerActiveRef.current) return;
    paintFromPointer(event);
    event.preventDefault();
  };

  const onEditorPointerEnd = (event) => {
    editorPointerActiveRef.current = false;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch (_) {
      // Pointer capture may already be released by the browser.
    }
  };

  useEffect(() => {
    const width = gridSize;
    const depth = gridSize;
    const height = GRID_HEIGHT;
    const cubeSize = 0.93;

    const ROTATION_SPEED_RAD_PER_SEC = 0.14;
    const YAW_DIRECTION = 1;

    const container = canvasHostRef.current;
    if (!container) return undefined;
    const { clientWidth, clientHeight } = container;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setSize(clientWidth, clientHeight, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = "grab";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const pivot = new THREE.Group();
    scene.add(pivot);

    const content = new THREE.Group();
    content.rotation.y = (3 * Math.PI) / 6;
    content.rotation.x = 0;
    content.rotation.z = Math.PI / 2;
    pivot.add(content);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const directionalLight = new THREE.DirectionalLight(0xcccccc, 1.2);
    directionalLight.position.set(1.5, 1, 0);
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 1.6);
    directionalLight2.position.set(-3.5, -10, -3.5);
    scene.add(directionalLight2);

    const camera = new THREE.PerspectiveCamera(
      35,
      clientWidth / Math.max(1, clientHeight),
      0.5,
      20000
    );
    camera.position.set(0, -height * 2.2, depth * 0.8);
    camera.up.set(0, 0, 1);
    camera.lookAt(new THREE.Vector3(0, height * 0.1, 0));

    let cells = makeEmptyCells(gridSize);
    cells[height - 1] = seedToLayer(seedInputRef.current, gridSize);

    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const instanceCap = width * depth * height;
    const instanced = new THREE.InstancedMesh(geometry, material, instanceCap);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instanced.count = 0;
    content.add(instanced);

    const precomputed = [];
    const tmpPos = new THREE.Vector3();
    const unitQuat = new THREE.Quaternion();
    const unitScale = new THREE.Vector3(1, 1, 1);

    const idxFor = (x, y, z) => y * (width * depth) + z * width + x;

    for (let y = 0; y < height; y++) {
      for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
          const idx = idxFor(x, y, z);
          tmpPos.set(x - width / 2, y - height / 2, z - depth / 2);
          precomputed[idx] = new THREE.Matrix4().compose(tmpPos, unitQuat, unitScale);
        }
      }
    }

    const countLiveNeighbors = (layer, x, z) => {
      let count = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          const nx = (x + dx + width) % width;
          const nz = (z + dz + depth) % depth;
          if (layer[nz * width + nx]) count++;
        }
      }
      return count;
    };

    // `out` (the recycled bottom layer) avoids a fresh allocation per step.
    const nextGeneration = (current, out) => {
      const next = out && out !== current ? out : new Uint8Array(width * depth);
      for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
          const alive = current[z * width + x];
          const n = countLiveNeighbors(current, x, z);
          next[z * width + x] = (alive ? n === 2 || n === 3 : n === 3) ? 1 : 0;
        }
      }
      return next;
    };

    const renderEditor = () => {
      const canvas = editorCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cellSize = EDITOR_CANVAS_SIZE / width;
      const topLayer = cells[cells.length - 1];

      ctx.clearRect(0, 0, EDITOR_CANVAS_SIZE, EDITOR_CANVAS_SIZE);

      ctx.fillStyle = "#f8fafc";
      for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
          if (topLayer[z * width + x]) {
            ctx.fillRect(
              x * cellSize + 1,
              z * cellSize + 1,
              Math.max(1, cellSize - 2),
              Math.max(1, cellSize - 2)
            );
          }
        }
      }

      ctx.strokeStyle = width > 32 ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.13)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= width; i++) {
        const p = Math.round(i * cellSize) + 0.5;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, EDITOR_CANVAS_SIZE);
        ctx.stroke();
      }
      for (let i = 0; i <= depth; i++) {
        const p = Math.round(i * cellSize) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(EDITOR_CANVAS_SIZE, p);
        ctx.stroke();
      }
    };

    const updateInstances = () => {
      // Write straight into the instanced mesh's backing Float32Array (16 floats
      // per matrix) rather than via setMatrixAt(...).toArray, and scan flat typed
      // layers — both cut per-step CPU so the 15/sec update doesn't spike frames.
      const arr = instanced.instanceMatrix.array;
      let aliveCount = 0;
      for (let y = 0; y < height; y++) {
        const layer = cells[y];
        for (let z = 0; z < depth; z++) {
          const base = z * width;
          for (let x = 0; x < width; x++) {
            if (layer[base + x]) {
              arr.set(precomputed[idxFor(x, y, z)].elements, aliveCount * 16);
              aliveCount++;
            }
          }
        }
      }
      instanced.count = aliveCount;
      instanced.instanceMatrix.needsUpdate = true;
    };

    const replaceSeed = (topLayer) => {
      cells = makeEmptyCells(gridSize);
      cells[height - 1] = cloneLayer(topLayer);
      updateInstances();
      renderEditor();
      lastStepTime = performance.now();
    };

    const setTopCell = (x, z, alive) => {
      const topLayer = cells[cells.length - 1];
      const v = alive ? 1 : 0;
      if (topLayer[z * width + x] === v) return;
      topLayer[z * width + x] = v;
      updateInstances();
      renderEditor();
      lastStepTime = performance.now();
    };

    const clearTopLayerOnly = () => {
      cells[cells.length - 1] = makeEmptyLayer(gridSize);
      updateInstances();
      renderEditor();
      lastStepTime = performance.now();
    };

    const replaceHistory = (layers) => {
      const history = layers
        .slice(-height)
        .map((layer) => cloneLayer(layer));
      cells = [
        ...Array.from({ length: height - history.length }, () => makeEmptyLayer(gridSize)),
        ...history,
      ];
      updateInstances();
      renderEditor();
      lastStepTime = performance.now();
    };

    simulationApiRef.current = {
      clearTopLayer: clearTopLayerOnly,
      getTopLayer: () => cloneLayer(cells[cells.length - 1]),
      renderEditor,
      replaceHistory,
      setTopCell,
    };

    updateInstances();
    renderEditor();

    let raf = 0;
    let running = false;
    let lastStepTime = performance.now();
    let lastRenderTime = lastStepTime;
    let yaw = 0;
    let pitch = 0;
    let isDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let autoRotationResumeAt = 0;
    let pitchReset = null;

    const pauseAutoRotation = () => {
      autoRotationResumeAt = performance.now() + AUTO_ROTATION_RESUME_MS;
      pitchReset = null;
    };

    const onPointerDown = (event) => {
      if (!manualRotateRef.current) return;
      isDragging = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      pauseAutoRotation();
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };

    const onPointerMove = (event) => {
      if (!isDragging) return;
      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      yaw += dx * DRAG_ROTATION_SCALE;
      pitch = clamp(pitch + dy * DRAG_ROTATION_SCALE, -MAX_MANUAL_PITCH, MAX_MANUAL_PITCH);
      pivot.rotation.z = yaw;
      pivot.rotation.x = pitch;
      pauseAutoRotation();
      event.preventDefault();
    };

    const stopDragging = (event) => {
      if (!isDragging) return;
      isDragging = false;
      pauseAutoRotation();
      renderer.domElement.style.cursor = "grab";
      try {
        renderer.domElement.releasePointerCapture?.(event.pointerId);
      } catch (_) {
        // Pointer capture may already be released by the browser.
      }
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", stopDragging);
    renderer.domElement.addEventListener("pointercancel", stopDragging);
    renderer.domElement.addEventListener("lostpointercapture", stopDragging);

    const animate = () => {
      if (!running) return;
      raf = requestAnimationFrame(animate);

      const now = performance.now();
      const dt = now - lastRenderTime;
      const pendingSeed = seedRequestRef.current;

      if (pendingSeed) {
        seedRequestRef.current = null;
        replaceSeed(pendingSeed);
      }

      if (resumeStepResetRef.current) {
        resumeStepResetRef.current = false;
        lastStepTime = now;
      }

      const stepsPerSecond = speedRef.current;
      if (
        !pausedRef.current &&
        stepsPerSecond > 0 &&
        now - lastStepTime >= 1000 / stepsPerSecond
      ) {
        const recycled = cells.shift();
        const newTop = nextGeneration(cells[cells.length - 1], recycled);
        cells.push(newTop);
        updateInstances();
        renderEditor();
        lastStepTime = now;
      }

      renderer.domElement.style.touchAction = manualRotateRef.current ? "none" : "pan-y";

      if (!isDragging && now >= autoRotationResumeAt) {
        if (Math.abs(pitch) > 0.001) {
          if (!pitchReset) {
            pitchReset = { startTime: now, startPitch: pitch };
          }
          const resetProgress = clamp(
            (now - pitchReset.startTime) / PITCH_RESET_DURATION_MS,
            0,
            1
          );
          pitch = pitchReset.startPitch * (1 - smoothstep(resetProgress));
        } else {
          pitch = 0;
          pitchReset = null;
          yaw += YAW_DIRECTION * ROTATION_SPEED_RAD_PER_SEC * (dt / 1000);
        }
      }
      pivot.rotation.z = yaw;
      pivot.rotation.x = pitch;

      renderer.render(scene, camera);
      lastRenderTime = now;
    };

    // Run the render loop ONLY while the canvas is on-screen and the tab is
    // visible. Once mounted, About stays mounted (its LazySection never unmounts),
    // so without this gate the WebGL loop would render at ~60fps forever even when
    // scrolled far away. Restarting resets the step/render clocks so the sim and
    // rotation don't fast-forward to "catch up" after being idle.
    // DEV-only observability for the headless gate test (stripped from prod builds).
    const markRunning = (v) => {
      if (import.meta.env?.DEV && typeof window !== "undefined") window.__gol3dRunning = v;
    };
    const start = () => {
      if (running) return;
      running = true;
      markRunning(true);
      lastStepTime = lastRenderTime = performance.now();
      raf = requestAnimationFrame(animate);
    };
    const stop = () => {
      running = false;
      markRunning(false);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    let onScreen = true;
    const evaluateRun = () => {
      if (onScreen && !document.hidden) start();
      else stop();
    };
    const visibilityObserver = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      evaluateRun();
    });
    visibilityObserver.observe(container);
    document.addEventListener("visibilitychange", evaluateRun);
    start(); // paint immediately; the observer corrects within a frame if off-screen

    const onResize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      simulationApiRef.current = {
        clearTopLayer: () => {},
        getTopLayer: () => new Uint8Array(0),
        renderEditor: () => {},
        replaceHistory: () => {},
        setTopCell: () => {},
      };
      cancelAnimationFrame(raf);
      ro.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", evaluateRun);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", stopDragging);
      renderer.domElement.removeEventListener("pointercancel", stopDragging);
      renderer.domElement.removeEventListener("lostpointercapture", stopDragging);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [gridSize]);

  const interactiveClassName = (className || "")
    .replace(/\bpointer-events-none\b/g, "")
    .trim();
  return (
    <div
      className={`${interactiveClassName} relative h-full w-full overflow-hidden pointer-events-auto ${
        controlsOpen ? "md:grid md:grid-cols-[minmax(0,1fr)_18rem]" : ""
      }`}
    >
      <div ref={canvasHostRef} className="relative h-full min-h-0 w-full" />

      {!controlsOpen && (
        <button
          type="button"
          onClick={() => setControlsOpen(true)}
          className="pointer-events-auto absolute bottom-3 right-3 z-20 rounded-md border border-white/15 bg-gray-900/55 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-white shadow-lg backdrop-blur-md transition hover:bg-gray-900/75 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:[writing-mode:vertical-rl]"
          aria-label="Open Game of Life controls"
        >
          Life
        </button>
      )}

      {controlsOpen && (
        <form
          className="pointer-events-auto absolute inset-x-3 bottom-3 top-3 z-20 flex min-h-0 flex-col overflow-y-auto rounded-lg border border-white/15 bg-gray-900/75 p-3 text-white shadow-2xl backdrop-blur-md md:static md:h-full md:rounded-none md:border-y-0 md:border-r-0 md:border-l md:bg-gray-900/55"
          onSubmit={(event) => {
            event.preventDefault();
            if (activeTab === "simulate") applySeed();
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
              Life lab
            </label>
            <button
              type="button"
              onClick={() => setControlsOpen(false)}
              className="grid h-6 w-6 place-items-center rounded bg-white/10 text-xs leading-none text-white transition hover:bg-white/20"
              aria-label="Close Game of Life controls"
            >
              x
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1" role="tablist" aria-label="Game of Life tools">
            {[["simulate", "Simulate"], ["soup", "Soup"]].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`rounded-md px-1 py-1.5 text-[9px] font-semibold transition ${activeTab === id ? "bg-white/80 text-black" : "bg-white/10 text-white hover:bg-white/20"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="mt-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-white/70">
            <span>Board</span>
            <span>{gridSize}x{gridSize}</span>
          </label>
          <input
            type="range"
            min="8"
            max="64"
            step="1"
            value={gridSize}
            onChange={(event) => {
              seedRequestRef.current = null;
              setGridSize(Number(event.target.value));
            }}
            className="mt-1 w-full accent-white"
            aria-label="Game of Life board size"
          />

          {searchError && (
            <p className="mt-2 rounded bg-red-400/15 p-1.5 text-[9px] leading-tight text-red-100" role="alert">
              {searchError}
            </p>
          )}

          {activeTab === "simulate" && (
            <>
              <label className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-white/70">Seed</label>
              <textarea
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                className="mt-1 h-14 w-full resize-none rounded-md border border-white/15 bg-gray-950/45 p-1.5 font-mono text-[9px] leading-tight text-white outline-none focus:border-white/45 sm:h-16 sm:text-[10px]"
                spellCheck="false"
                aria-label="Game of Life seed"
              />
              <div className="mt-1.5 grid grid-cols-3 gap-1">
                <button type="submit" className="rounded-md bg-white/80 px-1.5 py-1 text-[9px] font-semibold text-black transition hover:bg-white">Apply</button>
                <button type="button" onClick={randomizeSeed} className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20">Rand</button>
                <button type="button" onClick={resetDefaultSeed} className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20">Reset</button>
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-white/70">
                <span>Top layer</span><span>{paused ? "Paused" : "Live"}</span>
              </div>
              <canvas
                ref={editorCanvasRef}
                width={EDITOR_CANVAS_SIZE}
                height={EDITOR_CANVAS_SIZE}
                className="mt-1 aspect-square w-full max-h-[30svh] max-w-[30svh] self-center touch-none rounded-md border border-white/15 bg-transparent [image-rendering:pixelated] md:max-h-none md:max-w-none md:self-auto"
                aria-label="Editable top layer of the Game of Life simulation"
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={onEditorPointerDown}
                onPointerMove={onEditorPointerMove}
                onPointerUp={onEditorPointerEnd}
                onPointerCancel={onEditorPointerEnd}
                onLostPointerCapture={onEditorPointerEnd}
              />
              <div className="mt-2 grid grid-cols-3 gap-1">
                {["draw", "erase"].map((mode) => (
                  <button key={mode} type="button" onClick={() => setDrawMode(mode)} className={`rounded-md px-1.5 py-1 text-[9px] font-semibold capitalize transition ${drawMode === mode ? "bg-white/80 text-black" : "bg-white/10 text-white hover:bg-white/20"}`} aria-pressed={drawMode === mode}>{mode}</button>
                ))}
                <button type="button" onClick={clearTopLayer} className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20">Clear</button>
              </div>
              <label className="mt-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-white/70">
                <span>Speed</span><span>{speed}/s</span>
              </label>
              <input type="range" min="1" max="30" step="1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="mt-1 w-full accent-white" aria-label="Game of Life simulation speed" />
              <div className="mt-auto pt-3">
                <button type="button" onClick={togglePaused} className={`w-full rounded-md px-2 py-1.5 text-[9px] font-semibold transition ${paused ? "bg-white/80 text-black" : "bg-white/10 text-white hover:bg-white/20"}`} aria-pressed={paused}>{paused ? "Resume" : "Pause"}</button>
              </div>
            </>
          )}

          {activeTab === "soup" && (
            <div className="mt-3 flex min-h-0 flex-1 flex-col text-[10px]">
              <p className="m-0 text-[9px] leading-snug text-white/55">Ranks distinct, non-empty generations before extinction or an exact repeat.</p>
              <label className="mt-3 flex justify-between font-semibold uppercase tracking-wide text-white/70"><span>Density</span><span>{soupSettings.density}%</span></label>
              <input type="range" min="1" max="99" step="0.5" value={soupSettings.density} onChange={(event) => updateSoupSetting("density", Number(event.target.value))} className="mt-1 w-full accent-white" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-white/65">Generation horizon<input type="number" min="1" max="100000" value={soupSettings.horizon} onChange={(event) => updateSoupSetting("horizon", Number(event.target.value))} className="mt-1 w-full rounded border border-white/15 bg-gray-950/45 p-1 text-white" /></label>
                <label className="text-white/65">Batch size<input type="number" min="1" max="10000" value={soupSettings.batchSize} onChange={(event) => updateSoupSetting("batchSize", Number(event.target.value))} className="mt-1 w-full rounded border border-white/15 bg-gray-950/45 p-1 text-white" /></label>
                <label className="text-white/65">RNG seed<input type="text" value={soupSettings.seed} onChange={(event) => updateSoupSetting("seed", event.target.value)} className="mt-1 w-full rounded border border-white/15 bg-gray-950/45 p-1 text-white" /></label>
                <label className="text-white/65">Leaderboard<input type="number" min="1" max="100" value={soupSettings.leaderboardSize} onChange={(event) => updateSoupSetting("leaderboardSize", Number(event.target.value))} className="mt-1 w-full rounded border border-white/15 bg-gray-950/45 p-1 text-white" /></label>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1">
                <button type="button" onClick={startSoupSearch} className="rounded-md bg-white/80 px-2 py-1.5 font-semibold text-black">{searchMode === "soup" ? "Restart" : "Start"}</button>
                <button type="button" onClick={stopSearch} disabled={!searchMode} className="rounded-md bg-white/10 px-2 py-1.5 font-semibold text-white disabled:opacity-35">Stop</button>
                <button type="button" onClick={resetSoupSearch} className="rounded-md bg-white/10 px-2 py-1.5 font-semibold text-white">Reset</button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-black/20 p-2 text-white/65">
                <span>Soups</span><strong className="text-right text-white">{Math.round(soupProgress.searched || 0).toLocaleString()}</strong>
                <span>Rate</span><strong className="text-right text-white">{soupProgress.elapsedMs ? Math.round(soupProgress.searched * 1000 / soupProgress.elapsedMs).toLocaleString() : 0}/s</strong>
              </div>
              <div className="mt-2 space-y-1 overflow-y-auto">
                {(soupProgress.results || []).map((result, index) => (
                  <button key={`${result.lifetime}-${index}`} type="button" onClick={() => loadSoupResult(result.cells)} className="flex w-full items-center justify-between rounded bg-white/5 px-2 py-1.5 text-left transition hover:bg-white/15">
                    <span>#{index + 1}</span><strong>{result.reason === 3 ? "≥" : ""}{result.lifetime.toLocaleString()} gen</strong><span className="text-white/45">{result.reason === 1 ? "empty" : result.reason === 2 ? "repeat" : "open"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

        </form>
      )}
    </div>
  );
}
