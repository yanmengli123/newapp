import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api':      'http://localhost:8001',
      '/health':   'http://localhost:8001',
      '/chromosomes': 'http://localhost:8001',
      '/annotations': 'http://localhost:8001',
      '/kegg-images': 'http://localhost:8001',
      '/tools':    'http://localhost:8001',
      '/genome':   'http://localhost:8001',
      '/search':   'http://localhost:8001',
      '/datasets': 'http://localhost:8001',
      '/genes':    'http://localhost:8001',
      '/overview': 'http://localhost:8001',
      '/bwdata':  'http://localhost:8001',
    },
  },
})
