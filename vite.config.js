import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const entryRoutes = new Map([
  ['/game', '/game/'],
  ['/work/falling-sand', '/work/falling-sand/'],
])

const entryRoutePlugin = () => ({
  name: 'entry-routes',
  configureServer(server) {
    server.middlewares.use(rewriteEntryRoute)
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewriteEntryRoute)
  },
})

const rewriteEntryRoute = (req, _res, next) => {
  const url = new URL(req.url || '/', 'http://vite.local')
  const target = entryRoutes.get(url.pathname)
  if (target) req.url = `${target}${url.search}`
  next()
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [entryRoutePlugin(), react()],
  base: '/',
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    target: 'esnext',
    rollupOptions: {
      input: {
        portfolio: fileURLToPath(new URL('./index.html', import.meta.url)),
        game: fileURLToPath(new URL('./game/index.html', import.meta.url)),
        fallingSand: fileURLToPath(new URL('./work/falling-sand/index.html', import.meta.url)),
      },
    },
  }
})
