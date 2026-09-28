import { defineConfig } from 'vite';

export default defineConfig({
  base: '/accionCity/', // <--- AÑADE ESTA LÍNEA AQUÍ
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['ysioakxlt4.localto.net'],

     /* hmr: {
      host: 'ysioakxlt4.localto.net',
      protocol: 'wss',
      clientPort: 443,
      path: '/'
    }, */

    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      },
      '/webhook': { 
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  }, // <-- Cierre correcto de server
  cors: true,
  build: {
    chunkSizeWarningLimit: 1000 // Aumenta el limite de advertencia a 1000 kBs
  }
}); // <-- El cierre correcto de defineConfig debe ir aquí, al final.
