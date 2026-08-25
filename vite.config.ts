import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A relative base works both locally and on project GitHub Pages URLs.
export default defineConfig({
  base: './',
  plugins: [react()],
})
