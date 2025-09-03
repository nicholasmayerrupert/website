import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/website/',      // project page under /website
  //build: { outDir: 'docs' } // put build in ./docs
})