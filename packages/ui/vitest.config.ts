import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __DEV__: 'true',
  },
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
    alias: {
      'react-native': 'react-native-web',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
  },
})
