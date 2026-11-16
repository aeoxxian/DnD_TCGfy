import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';

export default defineConfig(({ command }) => {
  const nonce = command === 'serve' ? randomBytes(16).toString('base64') : undefined;
  return {
  base: './',
  html: nonce ? { cspNonce: nonce } : undefined,
  // Vite's TSX transform works in dev without an inline React Refresh preamble.
  plugins: [
    ...(command === 'build' ? [react()] : []),
    { name: 'local-dev-style-nonce', transformIndexHtml: html => nonce ? html.replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`) : html },
  ],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/artifacts/**', '**/.tools/**', '**/release/**', '**/dist-electron/**'] },
  },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' },
  };
});
