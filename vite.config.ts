import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// LyricsGlow dev server. Port 5177 to avoid colliding with PhilsHome (5174),
// Glance (5175), Cue (5176), and the default Vite (5173) when running side by side.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '0.0.0.0',
    port: 5177,
  },
})
