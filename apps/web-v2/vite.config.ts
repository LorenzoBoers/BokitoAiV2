/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_BOKITO_API_URL || 'http://127.0.0.1:8090'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5180,
      host: '127.0.0.1',
      open: false,
      proxy: {
        '/api': { target: apiUrl, changeOrigin: true, ws: true },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('i18next')) return 'i18n-vendor'
              if (
                /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id) ||
                id.includes('@radix-ui/') ||
                id.includes('@tanstack/')
              ) {
                return 'react-vendor'
              }
            }
            if (/[\\/]src[\\/]locales[\\/]/.test(id)) return 'locales'
            return undefined
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
  }
})
