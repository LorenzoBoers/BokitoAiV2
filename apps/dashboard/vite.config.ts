import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const chatWidgetRoot = path.resolve(__dirname, '../chat-widget')
const chatWidgetServeRoot = path.join(chatWidgetRoot, 'dist')
const chatWidgetMimeTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
}

function chatWidgetDevPlugin() {
  return {
    name: 'chat-widget-dev-server',
    configureServer(server: { middlewares: { use: (handler: (req: { url?: string }, res: { setHeader: (name: string, value: string) => void; end: (body: string | Buffer) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const requestPath = req.url ? req.url.split('?')[0] : ''
        if (!requestPath.startsWith('/chat-widget/')) {
          next()
          return
        }

        const relativePath = requestPath.slice('/chat-widget/'.length)
        const absolutePath = path.resolve(chatWidgetServeRoot, relativePath)
        if (!absolutePath.startsWith(chatWidgetServeRoot)) {
          next()
          return
        }

        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
          next()
          return
        }

        const extension = path.extname(absolutePath)
        const mimeType = chatWidgetMimeTypes[extension] || 'application/octet-stream'
        res.setHeader('Content-Type', mimeType)
        res.end(fs.readFileSync(absolutePath))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const bokitoApiUrl = env.VITE_BOKITO_API_URL || 'http://127.0.0.1:8000'

  const proxy: Record<string, object> = {
    '/api': {
      target: bokitoApiUrl,
      changeOrigin: true,
      ws: true,
    },
  }

  return {
    plugins: [react(), chatWidgetDevPlugin()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('@sentry')) return 'sentry'
              if (id.includes('i18next')) return 'i18n-vendor'
              if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
                return 'react-vendor'
              }
              return undefined
            }
            if (/[\\/]src[\\/]locales[\\/]/.test(id)) return 'locales'
            return undefined
          },
        },
      },
    },
    server: {
      port: 5174,
      host: '127.0.0.1',
      open: false,
      proxy,
      fs: {
        allow: [path.resolve(__dirname), path.resolve(__dirname, '../api/app/data')],
      },
    },
  }
})
