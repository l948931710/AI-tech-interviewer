import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

import fs from 'fs';
import * as dotenv from 'dotenv';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      {
        name: 'local-api-generate',
        configureServer(server) {
          server.middlewares.use('/api/generate', async (req, res) => {
            if (req.method === 'POST') {
              try {
                let body = '';
                for await (const chunk of req) {
                  body += chunk;
                }
                const { POST } = await server.ssrLoadModule('/api/generate.ts');
                
                try {
                  const localEnv = dotenv.parse(fs.readFileSync('.env.local'));
                  if (localEnv.GEMINI_API_KEY) {
                    process.env.GEMINI_API_KEY = localEnv.GEMINI_API_KEY;
                  }
                } catch (err) {
                  // ignore if file not found
                }
                
                const fetchReq = new Request(`http://${req.headers.host}${req.url}`, {
                  method: 'POST',
                  headers: Object.fromEntries(Object.entries(req.headers)) as any,
                  body
                });
                
                const fetchRes = await POST(fetchReq);
                res.statusCode = fetchRes.status;
                fetchRes.headers.forEach((val, key) => {
                  res.setHeader(key, val);
                });
                const responseText = await fetchRes.text();
                res.end(responseText);
              } catch (e: any) {
                console.error("Local API Generate Proxy Error:", e);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: e.message || "Internal server error" }));
              }
            } else {
              res.statusCode = 405;
              res.end('Method Not Allowed');
            }
          });
        }
      }
    ],
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
      // proxy removed to avoid overriding our custom local API plugin
    },
  };
});
