import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Große, selten wechselnde Abhängigkeiten in eigene Chunks auslagern,
        // damit sie separat gecacht werden und den App-Chunk klein halten.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/storage'],
          react: ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  },
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': '/src'
    }
  },
})

