import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import vercel from './vercel.json' with { type: 'json' };

// The same security headers ship to Vercel and to `vite preview`, so E2E tests
// exercise the production CSP rather than a looser dev configuration.
const previewHeaders: Record<string, string> = {};
for (const h of vercel.headers[0]!.headers) previewHeaders[h.key] = h.value;

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'pdfjs/**/*'],
      manifest: {
        name: 'Folio',
        short_name: 'Folio',
        description: 'Private, offline-first PDF reading and study workspace.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F5F3EE',
        theme_color: '#416C57',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2,bcmap,pfb,ttf,wasm,json,icc}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Never cache anything that is not an application asset.
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    // PDF.js's modern build calls APIs that only the newest browsers have (Promise.try,
    // Map#getOrInsertComputed, Math.sumPrecise), so it fails on iPadOS 17/18 WebKit.
    // The legacy build ships the same engine with polyfills.
    alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
  },
  build: {
    target: ['es2022', 'safari16'],
    chunkSizeWarningLimit: 1600,
  },
  worker: { format: 'es' },
  preview: { headers: previewHeaders },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/unit/setup.ts'],
    testTimeout: 30000,
  },
});
