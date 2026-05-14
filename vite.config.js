
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/accionCity/', // <--- AÑADE ESTA LÍNEA AQUÍ
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: [
      'ysioakxlt4.localto.net',
      'localhost',
      '127.0.0.1'
    ],
    hmr: {
      clientPort: 443,
    },
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true
      },
      '/webhook': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    },
    cors: true
  }
});
