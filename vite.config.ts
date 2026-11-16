import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: './',
  // Vite's TSX transform works in dev without an inline React Refresh preamble.
  plugins: command === 'build' ? [react()] : [],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/artifacts/**', '**/.tools/**', '**/release/**', '**/dist-electron/**'] },
  },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' },
}));
