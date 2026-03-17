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
        name: 'local-api-routes',
        configureServer(server) {
          // Read .env.local ONCE at server startup, not per-request
          let envLoaded = false;
          function ensureEnv() {
            if (envLoaded) return;
            try {
              const localEnv = dotenv.parse(fs.readFileSync('.env.local'));
              if (localEnv.GEMINI_API_KEY) {
                process.env.GEMINI_API_KEY = localEnv.GEMINI_API_KEY;
              }
            } catch (err) {
              // ignore if file not found
            }
            envLoaded = true;
          }

          // Helper: read full request body
          async function readBody(req: any): Promise<string> {
            let body = '';
            for await (const chunk of req) {
              body += chunk;
            }
            return body;
          }

          // Helper: proxy a POST request to a Vercel-style API handler
          async function proxyToHandler(req: any, res: any, handlerPath: string) {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end('Method Not Allowed');
              return;
            }
            try {
              ensureEnv();
              const body = await readBody(req);
              const mod = await server.ssrLoadModule(handlerPath);
              const handler = mod.POST || mod.default;
              
              if (!handler) {
                throw new Error(`No POST or default export found in ${handlerPath}`);
              }

              const fetchReq = new Request(`http://${req.headers.host}${req.url}`, {
                method: 'POST',
                headers: Object.fromEntries(Object.entries(req.headers)) as any,
                body
              });

              const fetchRes = await handler(fetchReq);
              res.statusCode = fetchRes.status;
              fetchRes.headers.forEach((val: string, key: string) => {
                res.setHeader(key, val);
              });

              // For SSE streaming responses, pipe the body as a stream
              if (fetchRes.headers.get('Content-Type')?.includes('text/event-stream') && fetchRes.body) {
                const reader = fetchRes.body.getReader();
                const pump = async () => {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      res.end();
                      return;
                    }
                    res.write(value);
                  }
                };
                await pump();
              } else {
                const responseText = await fetchRes.text();
                res.end(responseText);
              }
            } catch (e: any) {
              console.error(`Local API Proxy Error (${handlerPath}):`, e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: e.message || "Internal server error" }));
            }
          }

          // Route: /api/generate (LLM evaluation, non-streaming)
          server.middlewares.use('/api/generate', (req, res) => {
            proxyToHandler(req, res, '/api/generate.ts');
          });

          // Route: /api/tts-stream (TTS audio, SSE streaming)
          server.middlewares.use('/api/tts-stream', (req, res) => {
            proxyToHandler(req, res, '/api/tts-stream.ts');
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
