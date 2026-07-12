import { defineConfig } from 'vite';

// Single-page Vite app. `base: './'` makes the production build path-relative, so
// the contents of `dist/` can be dropped onto any static host (Netlify, GitHub
// Pages, itch.io, a plain folder) and just work — no server config required.
export default defineConfig({
  base: './',
  // Honor the PORT env var so preview harnesses with auto-assigned ports work.
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  // The lpc_repo checkout has its own HTML/TS entries that break vite's
  // dependency scan (and skip pre-bundling → slow first load). Only scan
  // the game's real entry point.
  optimizeDeps: {
    entries: ['index.html'],
  },
  test: {
    include: ['test/**/*.test.js'],
  },
});
