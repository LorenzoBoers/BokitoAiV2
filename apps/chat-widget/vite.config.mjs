import { defineConfig } from 'vite';

// Static multi-page preview: widget files stay as plain assets; API calls still go to Xano (HTTPS).
export default defineConfig({
  appType: 'mpa',
  server: {
    port: 8787,
    strictPort: true,
    host: '127.0.0.1',
  },
});
