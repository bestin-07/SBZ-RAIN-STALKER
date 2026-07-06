import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Semantic release version — the human-facing version shown in the app and tagged in
// git (see CLAUDE.md → Versioning & rollback). BUILD_ID is the per-deploy stamp used
// only for the service-worker cache-bust; APP_VERSION is what we roll back to.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

export default defineConfig({
  plugins: [react()],
  // Build id stamped at build time — changes every deploy so there's an explicit
  // JS version (logged on boot, used to force-refresh via the service worker).
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID || new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { port: 5173 },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
