import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distBundle = path.resolve(__dirname, 'dist/bokito-chat.js')

/** In dev, serve the last production build of the IIFE at `/bokito-chat.js` when present. */
function serveBuiltWidgetInDev(): Plugin {
  return {
    name: 'serve-built-widget-iife',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? ''
        if (pathname !== '/bokito-chat.js') {
          next()
          return
        }
        if (!fs.existsSync(distBundle)) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(
            'Run `npm run build` in apps/chat-widget first so dist/bokito-chat.js exists, then refresh.',
          )
          return
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.end(fs.readFileSync(distBundle))
      })
    },
  }
}

export default defineConfig({
  appType: 'mpa',
  publicDir: 'public',
  plugins: [serveBuiltWidgetInDev()],
  server: {
    port: 8787,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'BokitoChatEmbed',
      formats: ['iife'],
      fileName: () => 'bokito-chat',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'bokito-chat.js',
      },
    },
  },
})
