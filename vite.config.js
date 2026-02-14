
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Listen on all addresses (0.0.0.0)
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true
      }
    },
    // Allow tunnel URLs (bypass strict host check)
    allowedHosts: true,
    // Enable CORS for external access
    cors: true,
    origin: '*',
    // Fix WebSocket (HMR) connection 
    // hmr: {
    //     clientPort: 443 
    // }
  }
});
