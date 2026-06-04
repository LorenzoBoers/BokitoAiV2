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

        let relativePath = requestPath.slice('/chat-widget/'.length)
        if (relativePath.startsWith('internal/')) {
          relativePath = relativePath.slice('internal/'.length)
        } else if (relativePath.startsWith('external/')) {
          relativePath = relativePath.slice('external/'.length)
        }

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
  const xanoBaseUrl = env.VITE_XANO_BASE_URL || 'https://xrex-nmji-j9ur.f2.xano.io'
  const authCanonical = env.VITE_API_GROUP_AUTH || 'auth'
  const bokitoApiUrl = env.VITE_BOKITO_API_URL || 'http://127.0.0.1:8000'
  const useBokitoApi = env.VITE_API_MODE === 'bokito'

  const proxy: Record<string, object> = useBokitoApi
    ? {
        '/api:livechat': {
          target: bokitoApiUrl,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api:livechat/, '/api/livechat'),
        },
        '/api': {
          target: bokitoApiUrl,
          changeOrigin: true,
        },
      }
    : {
        '/api/auth': {
          target: xanoBaseUrl,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/auth/, `/api:${authCanonical}`),
        },
        '/api': {
          target: xanoBaseUrl,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/([^/]+)/, '/api:$1'),
        },
      }

  return {
    plugins: [react(), chatWidgetDevPlugin()],
    server: {
      port: 5174,
      host: '127.0.0.1',
      open: false,
      proxy,
    },
  }
})
