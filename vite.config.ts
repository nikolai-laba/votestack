/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The release version from package.json (bumped and tagged v<version> on
  // each release), shown in the footer (src/version.ts).
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync('package.json', 'utf8')).version,
    ),
  },
  // The prerender step (scripts/prerender.ts) reads which chunks each page
  // needs from the manifest, then deletes it.
  build: { manifest: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Agent worktrees are other checkouts of this repo, not its tests.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
})
