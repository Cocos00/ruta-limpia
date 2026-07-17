import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Ruta Limpia · Pueblo Nuevo Jasso',
        short_name: 'Ruta Limpia',
        description: 'Seguimiento y avisos del servicio de recolección de residuos.',
        theme_color: '#0d6137',
        background_color: '#f5f7f1',
        display: 'standalone',
        start_url: '/',
        lang: 'es-MX',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
