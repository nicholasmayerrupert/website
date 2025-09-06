import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',      // project page under /website
  build: { outDir: 'dist' } // put build in ./docs
})