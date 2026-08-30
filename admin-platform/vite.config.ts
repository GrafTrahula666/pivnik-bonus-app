import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/admin': { target: 'http://127.0.0.1:4174', changeOrigin: false },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/tests/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.ts'
  }
})
