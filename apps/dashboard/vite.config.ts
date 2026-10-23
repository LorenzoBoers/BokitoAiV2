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
  // Set only on the VPS checkout behind https://dev.app.bokito.ai.
  // Laptop dev leaves this empty and keeps HMR on 127.0.0.1.
  const publicDevHost = (process.env.VITE_DEV_PUBLIC_HOST || env.VITE_DEV_PUBLIC_HOST || '').trim()

  const proxy: Record<string, object> = {
    '/api': {
      target: bokitoApiUrl,
      changeOrigin: true,
      ws: true,
    },
  }

  return {
    plugins: [react(), chatWidgetDevPlugin()],
    define: {
      __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    },
    resolve: {
      extensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
      alias: {
        'react-native': 'react-native-web',
        '@bokito/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
        '@bokito/ui-tokens': path.resolve(__dirname, '../../packages/ui-tokens/src/index.ts'),
        '@bokito/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('@sentry')) return 'sentry'
              if (id.includes('i18next')) return 'i18n-vendor'
              // Keep React + Radix primitives in one chunk so Provider/Root
              // context never splits across lazy route bundles.
              if (
                /node_modules[\\/](react|react-dom|react-native-web|react-router|react-router-dom|scheduler)[\\/]/.test(id) ||
                id.includes('@radix-ui/')
              ) {
                return 'react-vendor'
              }
              return undefined
            }
            // One chunk per language, loaded on demand by src/i18n.
            const locale = /[\\/]src[\\/]locales[\\/]([a-z]{2})[\\/]/.exec(id)
            if (locale) return `locales-${locale[1]}`
            return undefined
          },
        },
      },
    },
    server: {
      port: 5174,
      host: '127.0.0.1',
      open: false,
      // Test files must not full-reload the operator's open Communication tab
      // when agents sync them to remote-dev (Vite defaults to page reload).
      watch: {
        ignored: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
      },
      ...(publicDevHost
        ? {
            allowedHosts: [publicDevHost],
            hmr: { protocol: 'wss' as const, host: publicDevHost, clientPort: 443 },
          }
        : {}),
      proxy,
      fs: {
        // The dev server is reachable on a public host (dev.app), so treat
        // /@fs as hostile input: allow four directories, and refuse secrets
        // and local databases even if `allow` is ever widened.
        strict: true,
        allow: [
          path.resolve(__dirname),
          path.resolve(__dirname, '../api/app/data'),
          path.resolve(__dirname, '../../packages'),
          // npm hoists the self-hosted fonts to the repo root.
          path.resolve(__dirname, '../../node_modules/@fontsource-variable'),
        ],
        deny: [
          '**/.env',
          '**/.env.*',
          '**/*.pem',
          '**/*.key',
          '**/*.crt',
          '**/*.p12',
          '**/*.db',
          '**/*.sqlite',
          '**/*.sqlite3',
          '**/.git/**',
          '**/node_modules/.vite/**',
        ],
      },
    },
  }
})
