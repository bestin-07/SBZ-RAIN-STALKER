import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Build id stamped at build time — changes every deploy so there's an explicit
  // JS version (logged on boot, used to force-refresh via the service worker).
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID || new Date().toISOString()),
  },
  server: { port: 5173 },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
