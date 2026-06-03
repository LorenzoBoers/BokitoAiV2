import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Bokito Messenger',
        short_name: 'Bokito',
        description: 'Bokito AI OS messenger',
        theme_color: '#111827',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    port: 5175,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.VITE_BOKITO_API_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
