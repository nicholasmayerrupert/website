// src/GameOfLife3D.jsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export default function GameOfLife3D({ className }) {
  const containerRef = useRef(null);

  useEffect(() => {
    // Grid sizes
    const width = 16;
    const depth = 16;   // z per layer
    const height = 30;  // number of layers (y)
    const cubeSize = 0.93;

    // ---- SPEED CONTROLS ----
    const MAX_STEPS_PER_SECOND = 15;               // simulation speed cap
    const STEP_INTERVAL_MS = 1000 / MAX_STEPS_PER_SECOND;
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
    let cells = Array.from({ length: height }, () =>
      Array.from({ length: depth }, () => Array(width).fill(false))
    );

    // Seed pattern on the top layer
    const patternString =
      "0111001100100110001100100011011101111100000001001100010110101000100001110100010001000001101101000100000000000100011110000101011110001001000101100011000110110110111100100000101111011001000000100001001100000000000100101011010011110000100011101100100101010011";
    const topLayer = patternString.match(/.{1,16}/g).map((row) =>
      row.split("").map((bit) => bit === "1")
    );
    cells[height - 1] = topLayer;

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

    let raf = 0;
    let lastStepTime = performance.now();
    let lastRenderTime = lastStepTime;
    let spin = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);

      const now = performance.now();
      const dt = now - lastRenderTime;

      // Simulation step limiter
      if (now - lastStepTime >= STEP_INTERVAL_MS) {
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
    />
  );
}
