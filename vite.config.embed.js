import { defineConfig } from 'vite';

// Bundles the <sand-game> Web Component into ONE self-contained, drop-in ES file
// (dist-embed/sand-game.js). The WASM engine is already embedded (SINGLE_FILE),
// and the entry graph pulls in only the framework-agnostic runtime + the vanilla
// palette — no React, no Tailwind. The multiplayer net layer is DEV-gated and
// tree-shakes out of the production embed.
//
//   npm run build:embed
//   <script type="module" src="sand-game.js"></script>  <sand-game></sand-game>
export default defineConfig({
  define: { 'import.meta.env.DEV': 'false' },
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    copyPublicDir: false, // drop-in is a single file; don't copy public/ assets
    lib: {
      entry: 'src/sand/embed/sandGame.js',
      formats: ['es'],
      fileName: () => 'sand-game.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
