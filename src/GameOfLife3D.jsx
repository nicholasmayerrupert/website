import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createLifeSearchClient } from "./life/createLifeSearchClient.js";
import { MAX_LIFE_SEARCH_WORKERS } from "./life/searchLimits.js";
import { usePrefersReducedMotion } from "./hooks/useMediaQuery.js";

const GRID_HEIGHT = 30;
const DEFAULT_STEPS_PER_SECOND = 15;
const AUTO_ROTATION_RESUME_MS = 6000;
const DRAG_ROTATION_SCALE = 0.008;
const PITCH_RESET_DURATION_MS = 2800;
const MAX_MANUAL_PITCH = Math.PI * 0.42;
const EDITOR_CANVAS_SIZE = 256;
const DEFAULT_LIFE_SEARCH_WORKERS = Math.min(8, Math.max(1,
  (typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4) - 1));
const DEFAULT_SEED =
  "0110101100010101111001100001110000000001001001000000110100000001110000010100001010110010001110100001010010011011001110000010101001100110111001111110000000010001101000110010000001001001000100000010101010010010110001010101101101011010000000011111000010010010";

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
  intro,
  labDetails,
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const lifeRootRef = useRef(null);
  const canvasHostRef = useRef(null);
  const editorCanvasRef = useRef(null);
  const toroidalCanvasRef = useRef(null);
  const renderToroidalLayerRef = useRef(() => {});
  const speedRef = useRef(DEFAULT_STEPS_PER_SECOND);
  const previousSpeedRef = useRef(DEFAULT_STEPS_PER_SECOND);
  const drawModeRef = useRef("draw");
  const seedRequestRef = useRef(null);
  const manualRotateRef = useRef(false);
  const reducedMotionRef = useRef(prefersReducedMotion);
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
  const [drawMode, setDrawMode] = useState("draw");
  const [gridSize, setGridSize] = useState(16);
  const [layerView, setLayerView] = useState("toroidal");
  const [activeTab, setActiveTab] = useState("simulate");
  const [searchMode, setSearchMode] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [soupSettings, setSoupSettings] = useState({
    density: 37.5,
    horizon: 0,
    seed: "soup-1",
    batchSize: 32,
    leaderboardSize: 10,
    workers: DEFAULT_LIFE_SEARCH_WORKERS,
  });
  const [soupProgress, setSoupProgress] = useState({ searched: 0, workers: 0, elapsedMs: 0, results: [], loops: [] });
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
    setSoupProgress({ searched: 0, workers: 0, elapsedMs: 0, results: [], loops: [] });
  }, [gridSize]);

  useEffect(() => {
    if (previousSpeedRef.current === 0 && speed > 0) {
      resumeStepResetRef.current = true;
    }
    speedRef.current = speed;
    previousSpeedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  useEffect(() => {
    reducedMotionRef.current = prefersReducedMotion;
  }, [prefersReducedMotion]);

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
  }, [activeTab, layerView]);

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

  const clearTopLayer = () => {
    simulationApiRef.current.clearTopLayer();
  };

  const stopSearch = () => searchClientRef.current?.stop();

  const resetSoupSearch = () => {
    stopSearch();
    setSoupProgress({ searched: 0, workers: 0, elapsedMs: 0, results: [], loops: [] });
    setSearchError("");
  };

  const startSoupSearch = () => {
    setSearchError("");
    setSoupProgress({ searched: 0, workers: 0, elapsedMs: 0, results: [], loops: [] });
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
      const topLayer = cells[cells.length - 1];
      renderToroidalLayerRef.current(topLayer);

      const canvas = editorCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cellSize = EDITOR_CANVAS_SIZE / width;

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

      if (!reducedMotionRef.current && !isDragging && now >= autoRotationResumeAt) {
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

    // Run the shared simulation/render loop while either Life card is on-screen
    // and the tab is visible. On mobile the lab stacks below the 3D canvas, so
    // observing only `container` would freeze the visible torus as soon as the 3D
    // card scrolled away. Restarting resets the step/render clocks so the sim and
    // rotation don't fast-forward to "catch up" after the whole showcase is idle.
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
    visibilityObserver.observe(lifeRootRef.current || container);
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

  useEffect(() => {
    if (!controlsOpen || activeTab !== "simulate" || layerView !== "toroidal") {
      renderToroidalLayerRef.current = () => {};
      return undefined;
    }

    const canvas = toroidalCanvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const majorRadius = 1.65;
    const minorRadius = 0.72;
    const defaultTilt = -Math.PI * 0.26;
    const autoRotationSpeed = 0.00018;
    const cameraDistance = 7;
    let currentLayer = new Uint8Array(gridSize * gridSize);
    let rotation = -0.25;
    let tilt = defaultTilt;
    let tiltCos = Math.cos(tilt);
    let tiltSin = Math.sin(tilt);
    let viewWidth = EDITOR_CANVAS_SIZE;
    let viewHeight = EDITOR_CANVAS_SIZE;
    let hitTiles = [];
    let pointerInteraction = null;
    let autoRotationResumeAt = 0;
    let resumeTransition = null;
    let autoRotationAtFullSpeed = true;

    const setTilt = (value) => {
      tilt = value;
      tiltCos = Math.cos(tilt);
      tiltSin = Math.sin(tilt);
    };

    const pointOnTorus = (u, v) => {
      const ringRadius = majorRadius + minorRadius * Math.cos(v);
      const x = ringRadius * Math.cos(u);
      const y = ringRadius * Math.sin(u);
      const z = minorRadius * Math.sin(v);
      return {
        x,
        y: y * tiltCos - z * tiltSin,
        z: y * tiltSin + z * tiltCos,
      };
    };

    const project = (point, scale) => {
      const perspective = cameraDistance / (cameraDistance - point.z);
      return {
        x: viewWidth * 0.5 + point.x * scale * perspective,
        y: viewHeight * 0.5 - point.y * scale * perspective,
      };
    };

    const drawToroid = () => {
      context.clearRect(0, 0, viewWidth, viewHeight);
      const scale = Math.min(viewWidth, viewHeight) * 0.195;
      const angleStep = (Math.PI * 2) / gridSize;
      const tiles = [];

      for (let z = 0; z < gridSize; z++) {
        const v0 = z * angleStep;
        const v1 = (z + 1) * angleStep;
        for (let x = 0; x < gridSize; x++) {
          const u0 = x * angleStep + rotation;
          const u1 = (x + 1) * angleStep + rotation;
          const corners = [
            pointOnTorus(u0, v0),
            pointOnTorus(u1, v0),
            pointOnTorus(u1, v1),
            pointOnTorus(u0, v1),
          ];
          const centerU = (x + 0.5) * angleStep + rotation;
          const centerV = (z + 0.5) * angleStep;
          const normalY = Math.cos(centerV) * Math.sin(centerU);
          const normalZ = Math.sin(centerV);
          const tiltedNormalZ = normalY * tiltSin + normalZ * tiltCos;
          tiles.push({
            alive: currentLayer[z * gridSize + x],
            brightness: clamp(0.64 + tiltedNormalZ * 0.28, 0.38, 0.92),
            corners,
            depth: corners.reduce((sum, corner) => sum + corner.z, 0) * 0.25,
            x,
            z,
          });
        }
      }

      tiles.sort((a, b) => a.depth - b.depth);
      context.lineJoin = "round";
      context.lineWidth = gridSize > 40 ? 0.35 : 0.65;
      for (const tile of tiles) {
        tile.screenCorners = tile.corners.map((corner) => project(corner, scale));
        const first = tile.screenCorners[0];
        context.beginPath();
        context.moveTo(first.x, first.y);
        for (let i = 1; i < tile.screenCorners.length; i++) {
          const corner = tile.screenCorners[i];
          context.lineTo(corner.x, corner.y);
        }
        context.closePath();
        const level = Math.round((tile.alive ? 255 : 30) * tile.brightness);
        context.fillStyle = `rgb(${level}, ${level}, ${tile.alive ? level : Math.round(level * 1.35)})`;
        context.strokeStyle = tile.alive ? "rgba(255,255,255,0.55)" : "rgba(100,116,139,0.52)";
        context.fill();
        context.stroke();
      }
      hitTiles = tiles;
    };

    const renderLayer = (layer) => {
      if (layer?.length !== gridSize * gridSize) return;
      currentLayer = layer.slice();
    };
    renderToroidalLayerRef.current = renderLayer;
    renderLayer(simulationApiRef.current.getTopLayer());

    const resize = () => {
      viewWidth = Math.max(1, canvas.clientWidth);
      viewHeight = Math.max(1, canvas.clientHeight);
      const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(viewWidth * pixelRatio);
      canvas.height = Math.round(viewHeight * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawToroid();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const pointerPosition = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewWidth,
        y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewHeight,
      };
    };

    const pointInPolygon = (point, polygon) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if (
          (a.y > point.y) !== (b.y > point.y) &&
          point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
        ) {
          inside = !inside;
        }
      }
      return inside;
    };

    const cellAtPoint = (point) => {
      for (let i = hitTiles.length - 1; i >= 0; i--) {
        const tile = hitTiles[i];
        if (pointInPolygon(point, tile.screenCorners)) return tile;
      }
      return null;
    };

    const onToroidPointerDown = (event) => {
      const point = pointerPosition(event);
      pointerInteraction = {
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        dragging: false,
        erase:
          drawModeRef.current === "erase" ||
          event.button === 2 ||
          event.altKey ||
          event.shiftKey,
      };
      autoRotationResumeAt = Infinity;
      resumeTransition = null;
      autoRotationAtFullSpeed = false;
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };

    const onToroidPointerMove = (event) => {
      if (!pointerInteraction || pointerInteraction.pointerId !== event.pointerId) return;
      const point = pointerPosition(event);
      const totalDistance = Math.hypot(
        point.x - pointerInteraction.startX,
        point.y - pointerInteraction.startY
      );
      if (totalDistance > 5) pointerInteraction.dragging = true;
      if (pointerInteraction.dragging) {
        rotation += (point.x - pointerInteraction.lastX) * 0.012;
        setTilt(tilt + (point.y - pointerInteraction.lastY) * 0.008);
        canvas.style.cursor = "grabbing";
        drawToroid();
      }
      pointerInteraction.lastX = point.x;
      pointerInteraction.lastY = point.y;
      event.preventDefault();
    };

    const finishToroidPointer = (event, editCell) => {
      if (!pointerInteraction || pointerInteraction.pointerId !== event.pointerId) return;
      const interaction = pointerInteraction;
      pointerInteraction = null;
      if (editCell && !interaction.dragging) {
        const tile = cellAtPoint(pointerPosition(event));
        if (tile) simulationApiRef.current.setTopCell(tile.x, tile.z, !interaction.erase);
      }
      autoRotationResumeAt = performance.now() + AUTO_ROTATION_RESUME_MS;
      canvas.style.cursor = "grab";
      try {
        canvas.releasePointerCapture?.(event.pointerId);
      } catch (_) {
        // Pointer capture may already be released by the browser.
      }
      event.preventDefault();
    };

    const onToroidPointerUp = (event) => finishToroidPointer(event, true);
    const onToroidPointerCancel = (event) => finishToroidPointer(event, false);
    const onToroidContextMenu = (event) => event.preventDefault();
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", onToroidPointerDown);
    canvas.addEventListener("pointermove", onToroidPointerMove);
    canvas.addEventListener("pointerup", onToroidPointerUp);
    canvas.addEventListener("pointercancel", onToroidPointerCancel);
    canvas.addEventListener("lostpointercapture", onToroidPointerCancel);
    canvas.addEventListener("contextmenu", onToroidContextMenu);

    let raf = 0;
    let lastTime = performance.now();
    let lastDrawTime = lastTime;
    const frameInterval = 1000 / (gridSize > 40 ? 15 : 30);
    const animateToroid = (now) => {
      const dt = Math.min(50, now - lastTime);
      lastTime = now;
      if (!reducedMotionRef.current && !pointerInteraction && now >= autoRotationResumeAt) {
        if (!autoRotationAtFullSpeed) {
          if (!resumeTransition) {
            const fullTurn = Math.PI * 2;
            resumeTransition = {
              startTime: now,
              startTilt: tilt,
              targetTilt:
                defaultTilt + Math.round((tilt - defaultTilt) / fullTurn) * fullTurn,
            };
          }
          const progress = clamp(
            (now - resumeTransition.startTime) / PITCH_RESET_DURATION_MS,
            0,
            1
          );
          const eased = smoothstep(progress);
          setTilt(
            resumeTransition.startTilt +
              (resumeTransition.targetTilt - resumeTransition.startTilt) * eased
          );
          rotation += dt * autoRotationSpeed * eased;
          if (progress === 1) {
            autoRotationAtFullSpeed = true;
            resumeTransition = null;
          }
        } else {
          rotation += dt * autoRotationSpeed;
        }
      }
      if (now - lastDrawTime >= frameInterval) {
        drawToroid();
        lastDrawTime = now;
      }
      raf = requestAnimationFrame(animateToroid);
    };
    raf = requestAnimationFrame(animateToroid);

    return () => {
      renderToroidalLayerRef.current = () => {};
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onToroidPointerDown);
      canvas.removeEventListener("pointermove", onToroidPointerMove);
      canvas.removeEventListener("pointerup", onToroidPointerUp);
      canvas.removeEventListener("pointercancel", onToroidPointerCancel);
      canvas.removeEventListener("lostpointercapture", onToroidPointerCancel);
      canvas.removeEventListener("contextmenu", onToroidContextMenu);
    };
  }, [activeTab, controlsOpen, gridSize, layerView]);

  const interactiveClassName = (className || "")
    .replace(/\bpointer-events-none\b/g, "")
    .trim();
  return (
    <div
      ref={lifeRootRef}
      className={`${interactiveClassName} relative w-full pointer-events-auto ${
        controlsOpen
          ? "grid h-auto grid-cols-1 gap-[18px] overflow-visible min-[801px]:h-full min-[801px]:grid-cols-[minmax(0,1fr)_clamp(18rem,22vw,21rem)]"
          : "h-full overflow-hidden"
      }`}
    >
      <section className="life-showcase__visual flex min-w-0 flex-col overflow-hidden min-[801px]:h-full">
        {intro}
        <div
          ref={canvasHostRef}
          className="relative h-[min(650px,76svh)] min-h-[480px] w-full shrink-0 min-[801px]:h-auto min-[801px]:min-h-0 min-[801px]:flex-1"
        />
      </section>

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
          className="pointer-events-auto relative z-20 flex min-h-0 flex-col rounded-[28px] border border-white/10 bg-[#101014]/90 p-3 text-white shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl min-[801px]:h-auto min-[801px]:self-stretch min-[801px]:overflow-y-auto min-[801px]:rounded-[36px] min-[801px]:bg-[#101014]/72 min-[801px]:shadow-[0_16px_48px_rgba(0,0,0,0.22)]"
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

          <label className="mt-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-white/70">
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
              <label className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-white/70">Seed</label>
              <textarea
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                className="mt-1 h-12 w-full resize-none rounded-md border border-white/15 bg-gray-950/45 p-1.5 font-mono text-[9px] leading-tight text-white outline-none focus:border-white/45 sm:text-[10px]"
                spellCheck="false"
                aria-label="Game of Life seed"
              />
              <div className="mt-1.5 grid grid-cols-3 gap-1">
                <button type="submit" className="rounded-md bg-white/80 px-1.5 py-1 text-[9px] font-semibold text-black transition hover:bg-white">Apply</button>
                <button type="button" onClick={randomizeSeed} className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20">Rand</button>
                <button type="button" onClick={resetDefaultSeed} className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20">Reset</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1" role="tablist" aria-label="Current layer view">
                {[["toroidal", "Toroidal view"], ["2d", "2D view"]].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={layerView === id}
                    onClick={() => setLayerView(id)}
                    className={`rounded-md px-1 py-1.5 text-[9px] font-semibold transition ${layerView === id ? "bg-white/80 text-black" : "bg-white/10 text-white hover:bg-white/20"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-right text-[9px] font-semibold uppercase tracking-wide text-white/45">{speed === 0 ? "Paused" : "Live"}</div>
              {layerView === "2d" ? (
                <>
                  <canvas
                    key="life-layer-2d"
                    ref={editorCanvasRef}
                    width={EDITOR_CANVAS_SIZE}
                    height={EDITOR_CANVAS_SIZE}
                    className="mt-1 aspect-square w-full max-h-[min(72vw,18rem)] max-w-[min(72vw,18rem)] self-center touch-none rounded-md border border-white/15 bg-transparent [image-rendering:pixelated] min-[801px]:h-auto min-[801px]:max-h-64 min-[801px]:w-64 min-[801px]:max-w-full"
                    aria-label="Editable current layer of the Game of Life simulation"
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
                </>
              ) : (
                <>
                  <canvas
                    key="life-layer-toroidal"
                    ref={toroidalCanvasRef}
                    width={EDITOR_CANVAS_SIZE}
                    height={EDITOR_CANVAS_SIZE}
                    className="mt-1 aspect-square w-full max-h-[min(72vw,18rem)] max-w-[min(72vw,18rem)] self-center touch-none rounded-md border border-white/15 bg-gray-950/25 min-[801px]:h-auto min-[801px]:max-h-64 min-[801px]:w-64 min-[801px]:max-w-full"
                    aria-label="Editable toroidal view of the current Game of Life layer"
                  />
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {["draw", "erase"].map((mode) => (
                      <button key={mode} type="button" onClick={() => setDrawMode(mode)} className={`rounded-md px-1.5 py-1 text-[9px] font-semibold capitalize transition ${drawMode === mode ? "bg-white/80 text-black" : "bg-white/10 text-white hover:bg-white/20"}`} aria-pressed={drawMode === mode}>{mode}</button>
                    ))}
                    <button type="button" onClick={clearTopLayer} className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20">Clear</button>
                  </div>
                </>
              )}
              <label className="mt-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-white/70">
                <span>Speed</span><span>{speed === 0 ? "Paused" : `${speed}/s`}</span>
              </label>
              <input type="range" min="0" max="30" step="1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="mt-1 w-full accent-white" aria-label="Game of Life simulation speed" aria-valuetext={speed === 0 ? "Paused" : `${speed} generations per second`} />
              {labDetails}
            </>
          )}

          {activeTab === "soup" && (
            <div className="mt-3 flex min-h-0 flex-1 flex-col text-[10px]">
              <p className="m-0 text-[9px] leading-snug text-white/55">
                Generates random boards in parallel. Length stops at extinction or the first exact repeat; non-trivial repeats are also ranked by period.
              </p>
              <label className="mt-3 flex justify-between font-semibold uppercase tracking-wide text-white/70"><span>Density</span><span>{soupSettings.density}%</span></label>
              <input type="range" min="1" max="99" step="0.5" value={soupSettings.density} onChange={(event) => updateSoupSetting("density", Number(event.target.value))} className="mt-1 w-full accent-white" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-white/65">Max generations (0=∞)<input type="number" min="0" value={soupSettings.horizon} onChange={(event) => updateSoupSetting("horizon", Number(event.target.value))} className="mt-1 w-full rounded border border-white/15 bg-gray-950/45 p-1 text-white" /></label>
                <label className="text-white/65">Workers<input type="number" min="1" max={MAX_LIFE_SEARCH_WORKERS} value={soupSettings.workers} onChange={(event) => updateSoupSetting("workers", Number(event.target.value))} className="mt-1 w-full rounded border border-white/15 bg-gray-950/45 p-1 text-white" /></label>
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
                <span>Workers</span><strong className="text-right text-white">{soupProgress.workers || 0}</strong>
                <span>Soups</span><strong className="text-right text-white">{Math.round(soupProgress.searched || 0).toLocaleString()}</strong>
                <span>Rate</span><strong className="text-right text-white">{soupProgress.elapsedMs ? Math.round(soupProgress.searched * 1000 / soupProgress.elapsedMs).toLocaleString() : 0}/s</strong>
              </div>
              <div className="mt-2 overflow-y-auto">
                <p className="mb-1 mt-0 font-semibold uppercase tracking-wide text-white/55">Length</p>
                <div className="space-y-1">
                {(soupProgress.results || []).map((result, index) => (
                  <button key={`${result.workerIndex}-${result.serial}-${index}`} type="button" onClick={() => loadSoupResult(result.cells)} className="flex w-full items-center justify-between rounded bg-white/5 px-2 py-1.5 text-left transition hover:bg-white/15">
                    <span>#{index + 1}</span><strong>{result.reason === 3 ? "≥" : ""}{result.lifetime.toLocaleString()} gen</strong><span className="text-white/45">{result.reason === 1 ? "empty" : result.reason === 2 ? "repeat" : "open"}</span>
                  </button>
                ))}
                </div>
                <p className="mb-1 mt-3 font-semibold uppercase tracking-wide text-white/55">Repeat period</p>
                <div className="space-y-1">
                  {(soupProgress.loops || []).map((result, index) => (
                    <button key={`${result.workerIndex}-${result.serial}-${index}`} type="button" onClick={() => loadSoupResult(result.cells)} className="flex w-full items-center justify-between rounded bg-white/5 px-2 py-1.5 text-left transition hover:bg-white/15">
                      <span>#{index + 1}</span><strong>{result.period.toLocaleString()} period</strong><span className="text-white/45">{result.lifetime.toLocaleString()} gen</span>
                    </button>
                  ))}
                  {!(soupProgress.loops || []).length && <p className="m-0 rounded bg-white/[0.03] px-2 py-1.5 text-white/35">No period above 2 found yet.</p>}
                </div>
              </div>
            </div>
          )}

        </form>
      )}
    </div>
  );
}
