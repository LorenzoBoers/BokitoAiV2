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
  const xanoBaseUrl = env.VITE_XANO_BASE_URL || 'https://xrex-nmji-j9ur.f2.xano.io'
  const authCanonical = env.VITE_API_GROUP_AUTH || 'auth'

  return {
    plugins: [react(), chatWidgetDevPlugin()],
    server: {
      port: 5174,
      open: false,
      proxy: {
        '/api/auth': {
          target: xanoBaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/auth/, `/api:${authCanonical}`),
        },
        '/api': {
          target: xanoBaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/([^/]+)/, '/api:$1'),
        },
      },
    },
  }
})
