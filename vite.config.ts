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
              // Load ALL env vars so local API middleware has access to
              // GEMINI_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
              // SUPABASE_SERVICE_ROLE_KEY, etc.
              for (const [key, value] of Object.entries(localEnv)) {
                if (value && !process.env[key]) {
                  process.env[key] = value;
                }
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

          // Route: /api/generate-report (Server-side report generation)
          server.middlewares.use('/api/generate-report', (req, res) => {
            proxyToHandler(req, res, '/api/generate-report.ts');
          });

          // Route: /api/agent/start (First question)
          server.middlewares.use('/api/agent/start', (req, res) => {
            proxyToHandler(req, res, '/api/agent/start.ts');
          });

          // Route: /api/agent/next-step (Follow up evaluation and next question)
          server.middlewares.use('/api/agent/next-step', (req, res) => {
            proxyToHandler(req, res, '/api/agent/next-step.ts');
          });

          // Route: /api/agent/generate-invite (Token generation for interview links)
          server.middlewares.use('/api/agent/generate-invite', (req, res) => {
            proxyToHandler(req, res, '/api/agent/generate-invite.ts');
          });

          // Route: /api/agent/update-status (Session status transitions)
          server.middlewares.use('/api/agent/update-status', (req, res) => {
            proxyToHandler(req, res, '/api/agent/update-status.ts');
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
