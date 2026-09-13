import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// A separate build keeps the portfolio's shared chunks and preload graph intact.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'esnext',
    rollupOptions: {
      input: { voxelDemo: fileURLToPath(new URL('./3d/index.html', import.meta.url)) },
    },
  },
});
