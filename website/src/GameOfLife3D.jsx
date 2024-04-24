import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
const GameOfLife3D = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const width = 16;
    const height = 28; // Now represents the depth of the grid
    const depth = 16; // Now represents the height of the grid
    const cubeSize = 0.95 //0.97;

    const scene = new THREE.Scene();
    scene.rotation.y = 3*Math.PI / 2; // Rotate the scene 90 degrees around the Y-axis
    scene.rotation.x = Math.PI / 4;
    scene.scale.set(3.25, 3.25, 3.25); // Scale every object in the scene by a factor of 2

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // soft white light
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xeeeeff, 2);
    directionalLight.position.set(1.5, 1, 0); // coming from the top
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xeeedff, 2.5);
    directionalLight.position.set(-3.5, -10, -3.5); // coming from the top
    scene.add(directionalLight2);



    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true,antialias:true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    canvasRef.current.appendChild(renderer.domElement);

    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const aliveMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff });
    const deadMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0 });

    // Initialize the 3D grid with false (dead cells)

    
    let cells = Array.from({ length: height }, () =>
    Array.from({ length: depth }, () => Array(width).fill(false))
  );

  // Methuselah pattern input as a single string (provided pattern)
  //const patternString = "1110011010110111111111110000101001001001010111010010011000100100001000001010001110000110001110100001100100101001001111010010110011011001100000111011110100001110100011110011100001111111111001111100010111010111011011111100010101000001111010011101010110000010";
  //pretty good const patternString = "0010010010110110110001110000101101010001010111010010011000111101001110011110001110001101111110100001000100101001001111010010110011011001100110111011110100001110100011110011100001111111111001111100010111010111011011111100010101000001111010011111010110000010";
  const patternString = "0010010010111110110001110000101101010001010111010010011000111101001110011110001110001101111110100001000100101001001111010010110011011001100110111011110100001110100011110011100001111111111001111100010111010111011011111100010101000001111010011111010110000010";
  // Convert the string into a 2D array for the top layer
  cells[height - 1] = patternString.match(/.{1,16}/g).map(row =>
    row.split('').map(bit => bit === '1')
  );

    const cubes = cells.flat(2).map((cell, idx) => {
      const y = Math.floor(idx / (width * depth));
      const z = Math.floor((idx % (width * depth)) / width);
      const x = idx % width;
      const material = cell ? aliveMaterial : deadMaterial;
      const cube = new THREE.Mesh(geometry, material);
      cube.position.set(x - width / 2, z - depth / 2, y - height / 2);
      scene.add(cube);
      return cube;
    });

    const controls = new OrbitControls(camera, renderer.domElement);

    controls.dampingFactor = 0.05;
    controls.enabled = false;

    camera.position.set(width / 2, height * 3, 0);
    camera.lookAt(new THREE.Vector3(width / 2, 0, depth / 2)); // Look at the center of the grid

    let frameCount = 0;
    const frameSkip = 5;

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      if ( frameCount % frameSkip === 0){
      // Move each slice down one level in y, update the top slice according to Game of Life rules
      for (let y = 0; y < height - 1; y++) {
        cells[y] = cells[y + 1];
      }
      cells[height - 1] = getNextGeneration(cells[height - 1], width, depth);
      scene.rotation.z += 0.02;
      // Update cube materials
      cells.flat(2).forEach((cell, idx) => {
        cubes[idx].material = cell ? aliveMaterial : deadMaterial;
      });
    }
      renderer.render(scene, camera);
      frameCount++;
    };

    const getNextGeneration = (currentLayer, width, depth) => {
      return currentLayer.map((row, z) =>
        row.map((cell, x) => {
          const liveNeighbors = countLiveNeighbors(currentLayer, x, z, width, depth);
          if (cell) {
            return liveNeighbors === 2 || liveNeighbors === 3;
          } else {
            return liveNeighbors === 3;
          }
        })
      );
    };

    const countLiveNeighbors = (layer, x, z, width, depth) => {
      let count = 0;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          if (i === 0 && j === 0) continue;
          const dx = (x + i + width) % width;
          const dz = (z + j + depth) % depth;
          if (layer[dz][dx]) count++;
        }
      }
      return count;
    };

    animate();

    return () => {
      renderer.dispose();
    };
  }, []);

  return <div ref={canvasRef} />;
};

export default GameOfLife3D;
