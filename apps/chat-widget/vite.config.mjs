import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  publicDir: 'public',
  server: {
    port: 8787,
    open: '/chat-standalone.html',
  },
  plugins: [
    {
      name: 'serve-built-widget-in-dev',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/bokito-chat.js' || req.url === '/bokito-chat.js.map') {
            const file = req.url === '/bokito-chat.js.map' ? 'bokito-chat.js.map' : 'bokito-chat.js'
            const path = resolve(__dirname, 'dist', file)
            import('node:fs').then((fs) => {
              if (!fs.existsSync(path)) {
                next()
                return
              }
              res.setHeader('Content-Type', 'application/javascript')
              fs.createReadStream(path).pipe(res)
            }).catch(next)
            return
          }
          next()
        })
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/widget-main.ts'),
      name: 'BokitoChatWidget',
      formats: ['iife'],
      fileName: () => 'bokito-chat.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
