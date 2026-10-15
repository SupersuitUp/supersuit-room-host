import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: { alias: [
    { find: 'server-only', replacement: path.resolve(__dirname, './src/test/server-only.ts') },
    { find: '@', replacement: path.resolve(__dirname, './src') },
  ] },
})
