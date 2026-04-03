import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api':      'http://localhost:8000',
      '/health':   'http://localhost:8000',
      '/chromosomes': 'http://localhost:8000',
      '/annotations': 'http://localhost:8000',
      '/kegg-images': 'http://localhost:8000',
      '/tools':    'http://localhost:8000',
      '/genome':   'http://localhost:8000',
      '/search':   'http://localhost:8000',
      '/datasets': 'http://localhost:8000',
      '/genes':    'http://localhost:8000',
      '/overview': 'http://localhost:8000',
    },
  },
})
