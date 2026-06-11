// src/GameOfLife3D.jsx
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const GRID_WIDTH = 16;
const GRID_DEPTH = 16;
const GRID_HEIGHT = 30;
const DEFAULT_STEPS_PER_SECOND = 15;
const DEFAULT_SEED =
  "0111001100100110001100100011011101111100000001001100010110101000100001110100010001000001101101000100000000000100011110000101011110001001000101100011000110110110111100100000101111011001000000100001001100000000000100101011010011110000100011101100100101010011";

const makeEmptyLayer = () =>
  Array.from({ length: GRID_DEPTH }, () => Array(GRID_WIDTH).fill(false));

const makeEmptyCells = () =>
  Array.from({ length: GRID_HEIGHT }, makeEmptyLayer);

const binaryToLayer = (binarySeed) =>
  binarySeed
    .slice(0, GRID_WIDTH * GRID_DEPTH)
    .match(new RegExp(`.{1,${GRID_WIDTH}}`, "g"))
    .map((row) => row.split("").map((bit) => bit === "1"));

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const textToLayer = (seedText) => {
  let hash = 2166136261;
  const value = seedText.trim() || "game-of-life";
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const random = mulberry32(hash);
  return Array.from({ length: GRID_DEPTH }, () =>
    Array.from({ length: GRID_WIDTH }, () => random() > 0.62)
  );
};

const seedToLayer = (seedText) => {
  const binary = seedText.replace(/[^01]/g, "");
  if (binary.length >= GRID_WIDTH * GRID_DEPTH) return binaryToLayer(binary);
  return textToLayer(seedText);
};

export default function GameOfLife3D({ className }) {
  const containerRef = useRef(null);
  const speedRef = useRef(DEFAULT_STEPS_PER_SECOND);
  const seedRequestRef = useRef(null);
  const [speed, setSpeed] = useState(DEFAULT_STEPS_PER_SECOND);
  const [seedInput, setSeedInput] = useState(DEFAULT_SEED);
  const [controlsOpen, setControlsOpen] = useState(false);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const applySeed = (seedText = seedInput) => {
    seedRequestRef.current = seedToLayer(seedText);
  };

  const resetDefaultSeed = () => {
    setSeedInput(DEFAULT_SEED);
    seedRequestRef.current = seedToLayer(DEFAULT_SEED);
  };

  const randomizeSeed = () => {
    const randomSeed = `random-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setSeedInput(randomSeed);
    seedRequestRef.current = seedToLayer(randomSeed);
  };

  useEffect(() => {
    // Grid sizes
    const width = GRID_WIDTH;
    const depth = GRID_DEPTH;   // z per layer
    const height = GRID_HEIGHT;  // number of layers (y)
    const cubeSize = 0.93;

    const ROTATION_SPEED_RAD_PER_SEC = 0.25;       // yaw speed
    const YAW_DIRECTION = 1;                        // flip to -1 if you want the other way

    const container = containerRef.current;
    const { clientWidth, clientHeight } = container;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setSize(clientWidth, clientHeight);
    container.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();

    // Pivot hierarchy: pivot (yaw spin) -> content (static orientation)
    const pivot = new THREE.Group();
    scene.add(pivot);

    const content = new THREE.Group();
    // Base orientation: 90° CCW around Z, with your existing yaw
    content.rotation.y = (3 * Math.PI) / 6;
    content.rotation.x = 0;
    content.rotation.z = Math.PI / 2;
    pivot.add(content);

    // Lights (kept on the scene so lighting doesn't spin with the model)
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const directionalLight = new THREE.DirectionalLight(0xcccccc, 1.2);
    directionalLight.position.set(1.5, 1, 0);
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 1.6); // a bit brighter from below
    directionalLight2.position.set(-3.5, -10, -3.5);
    scene.add(directionalLight2);

    // Camera — bottom-up / underslung
    const camera = new THREE.PerspectiveCamera(35, clientWidth / clientHeight, 0.5, 20000);
    // Place camera below the stack (negative Y) and slightly forward on Z
    camera.position.set(0, -height * 2.2, depth * 0.8);
    // Use +Z as "up" so the pivot's Z-rotation reads as yaw from this angle
    camera.up.set(0, 0, 1);
    // Look slightly above center
    camera.lookAt(new THREE.Vector3(0, height * 0.1, 0));

    // Cells (3D boolean grid) with ring buffer
    let cells = makeEmptyCells();
    cells[height - 1] = seedToLayer(DEFAULT_SEED);

    // Instanced mesh (one draw call)
    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const instanceCap = width * depth * height;
    const instanced = new THREE.InstancedMesh(geometry, material, instanceCap);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instanced.count = 0;
    content.add(instanced); // add to content so yaw spins via parent pivot

    // Precompute transforms (positions relative to 'content')
    const precomputed = [];
    const tmpPos = new THREE.Vector3();
    const unitQuat = new THREE.Quaternion();
    const unitScale = new THREE.Vector3(1, 1, 1);

    const idxFor = (x, y, z) => y * (width * depth) + z * width + x;

    for (let y = 0; y < height; y++) {
      for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
          const idx = idxFor(x, y, z);
          // Map layer index to world Y (top-down motion)
          tmpPos.set(x - width / 2, y - height / 2, z - depth / 2);
          precomputed[idx] = new THREE.Matrix4().compose(
            tmpPos.clone(),
            unitQuat,
            unitScale
          );
        }
      }
    }

    // Life helpers
    const countLiveNeighbors = (layer, x, z) => {
      let count = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          const nx = (x + dx + width) % width;
          const nz = (z + dz + depth) % depth;
          if (layer[nz][nx]) count++;
        }
      }
      return count;
    };

    const nextGeneration = (current) => {
      const next = Array.from({ length: depth }, () => Array(width).fill(false));
      for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
          const alive = current[z][x];
          const n = countLiveNeighbors(current, x, z);
          next[z][x] = alive ? n === 2 || n === 3 : n === 3;
        }
      }
      return next;
    };

    // Render alive cells
    const updateInstances = () => {
      let aliveCount = 0;
      for (let y = 0; y < height; y++) {
        const layer = cells[y];
        for (let z = 0; z < depth; z++) {
          const row = layer[z];
          for (let x = 0; x < width; x++) {
            if (row[x]) {
              const srcIdx = idxFor(x, y, z);
              instanced.setMatrixAt(aliveCount++, precomputed[srcIdx]);
            }
          }
        }
      }
      instanced.count = aliveCount;
      instanced.instanceMatrix.needsUpdate = true;
    };

    updateInstances();

    const replaceSeed = (topLayer) => {
      cells = makeEmptyCells();
      cells[height - 1] = topLayer;
      updateInstances();
      lastStepTime = performance.now();
    };

    let raf = 0;
    let lastStepTime = performance.now();
    let lastRenderTime = lastStepTime;
    let spin = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);

      const now = performance.now();
      const dt = now - lastRenderTime;
      const pendingSeed = seedRequestRef.current;

      if (pendingSeed) {
        seedRequestRef.current = null;
        replaceSeed(pendingSeed);
      }

      // Simulation step limiter
      const stepsPerSecond = speedRef.current;
      if (stepsPerSecond > 0 && now - lastStepTime >= 1000 / stepsPerSecond) {
        cells.shift();
        const newTop = nextGeneration(cells[cells.length - 1]);
        cells.push(newTop);
        updateInstances();
        lastStepTime = now;
      }

      // True yaw: rotate the pivot around Z
      spin += YAW_DIRECTION * ROTATION_SPEED_RAD_PER_SEC * (dt / 1000);
      pivot.rotation.z = spin;

      renderer.render(scene, camera);
      lastRenderTime = now;
    };

    animate();

    // Resize to container
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // Cleanup
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
    >
      {!controlsOpen && (
        <button
          type="button"
          onClick={() => setControlsOpen(true)}
          className="pointer-events-auto absolute bottom-2 right-2 z-20 rounded-md border border-white/15 bg-black/45 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-white shadow-lg backdrop-blur-md transition hover:bg-black/65 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:[writing-mode:vertical-rl]"
          aria-label="Open Game of Life controls"
        >
          Life
        </button>
      )}

      {controlsOpen && (
        <form
          className="pointer-events-auto absolute bottom-2 right-2 z-20 w-[min(9.75rem,calc(100vw-1rem))] rounded-lg border border-white/15 bg-black/55 p-2 text-white shadow-lg backdrop-blur-md sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:w-44"
          onSubmit={(event) => {
            event.preventDefault();
            applySeed();
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
              Seed
            </label>
            <button
              type="button"
              onClick={() => setControlsOpen(false)}
              className="grid h-5 w-5 place-items-center rounded bg-white/10 text-xs leading-none text-white transition hover:bg-white/20"
              aria-label="Close Game of Life controls"
            >
              x
            </button>
          </div>
          <textarea
            value={seedInput}
            onChange={(event) => setSeedInput(event.target.value)}
            className="mt-1 h-12 w-full resize-none rounded-md border border-white/15 bg-black/50 p-1.5 font-mono text-[9px] leading-tight text-white outline-none focus:border-white/45 sm:h-16 sm:text-[10px]"
            spellCheck="false"
            aria-label="Game of Life seed"
          />
          <div className="mt-1.5 grid grid-cols-3 gap-1">
            <button
              type="submit"
              className="rounded-md bg-white/80 px-1.5 py-1 text-[9px] font-semibold text-black transition hover:bg-white sm:text-[10px]"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={randomizeSeed}
              className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20 sm:text-[10px]"
            >
              Rand
            </button>
            <button
              type="button"
              onClick={resetDefaultSeed}
              className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20 sm:text-[10px]"
            >
              Reset
            </button>
          </div>

          <label className="mt-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-white/70">
            <span>Speed</span>
            <span>{speed === 0 ? "Frozen" : `${speed}/s`}</span>
          </label>
          <input
            type="range"
            min="0"
            max="30"
            step="1"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="mt-1 w-full accent-white"
            aria-label="Game of Life simulation speed"
          />
          <button
            type="button"
            onClick={() => setSpeed((current) => (current === 0 ? DEFAULT_STEPS_PER_SECOND : 0))}
            className="mt-1.5 w-full rounded-md bg-white/10 px-2 py-1 text-[9px] font-semibold text-white transition hover:bg-white/20 sm:text-[10px]"
          >
            {speed === 0 ? "Resume" : "Freeze"}
          </button>
        </form>
      )}
    </div>
  );
}
