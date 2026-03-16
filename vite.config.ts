import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // Remove GEMINI_API_KEY from frontend bundle.
      // API_KEY might still be needed if other logic expects it, 
      // but ideally frontend should not have any raw keys.
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              // Automatically inject the API key for local dev testing
              const apiKey = env.GEMINI_API_KEY || env.API_KEY;
              if (apiKey) {
                proxyReq.setHeader('x-goog-api-key', apiKey);
              }
            });
          }
        }
      }
    },
  };
});
