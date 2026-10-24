import { defineConfig } from 'vite';

export default defineConfig({
  base: '/accionCity/', // <--- AÑADE ESTA LÍNEA AQUÍ
  cacheDir: 'C:/Users/ildem/.vite_cache/accionCity',
  plugins: [
    {
      name: 'watcher-error-guard',
      configureServer(server) {
        // Evita que errores de I/O (EIO, EPERM o archivos temporales/bloqueados en Windows) tumben Vite
        server.watcher.on('error', (err) => {
          console.warn('[Vite Watcher Error Ignorado]:', err?.message || err);
        });
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['ysioakxlt4.localto.net'],
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
    },

    watch: {
      // Ignora antes de hacer stat para que Windows nunca intente leer ni bloquear modelos o temporales
      ignored: [
        (path) => {
          const p = path.toLowerCase();
          return p.includes('models') || 
                 p.endsWith('.glb') || 
                 p.includes('node_modules') || 
                 p.includes('.git') || 
                 p.includes('dist');
        }
      ]
    },

    hmr: {
      overlay: false
    },

    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (err && err.code === 'ECONNRESET') return; // Normal client disconnect on mobile
            console.warn('[proxy]', err.message || err);
          });
        }
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
