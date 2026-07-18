import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const gameEntryRoute = () => ({
  name: 'game-entry-route',
  configureServer(server) {
    server.middlewares.use(rewriteGameEntry)
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewriteGameEntry)
  },
})

const rewriteGameEntry = (req, _res, next) => {
  const url = new URL(req.url || '/', 'http://vite.local')
  if (url.pathname === '/game') req.url = `/game/${url.search}`
  next()
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [gameEntryRoute(), react()],
  base: '/',
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    target: 'esnext',
    rollupOptions: {
      input: {
        portfolio: fileURLToPath(new URL('./index.html', import.meta.url)),
        game: fileURLToPath(new URL('./game/index.html', import.meta.url)),
      },
    },
  }
})
