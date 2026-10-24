import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative paths so Electron can load the built files from disk.
  base: './',
  server: { port: 5173, strictPort: true },
})
