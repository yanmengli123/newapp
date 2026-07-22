import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/go-enrichment' || req.url === '/go-enrichment/') {
            req.url = '/';
          }
          if (req.url === '/comparative' || req.url === '/comparative/') {
            req.url = '/';
          }
          next();
        });
      },
    } satisfies Plugin,
  ],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api':      'http://localhost:8001',
      '/health':   'http://localhost:8001',
      '/chromosomes': 'http://localhost:8001',
      '/annotations': 'http://localhost:8001',
      '/kegg-images': 'http://localhost:8001',
      '/tools':    'http://localhost:8001',
      '/genome-api': 'http://localhost:8001',
      '/genome':   'http://localhost:8001',
      '/search':   'http://localhost:8001',
      '/datasets': 'http://localhost:8001',
      '/genes':    'http://localhost:8001',
      '/overview': 'http://localhost:8001',
      '/bwdata':  'http://localhost:8001',
      '/go-enrichment': 'http://localhost:8001',
      '/comparative': 'http://localhost:8001',
    },
  },
})
