import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

// The packaged CSP stays locked to connect-src 'self'; only the dev server's
// HMR websocket needs a localhost allowance, injected here at serve time.
function devHmrCsp(): Plugin {
  return {
    name: 'dev-hmr-csp',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:*")
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), devHmrCsp()]
  }
})
