import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "./api-auth";
import { logLLMUsage } from "./llm-logger";
import { underRateLimit, tooManyRequestsResponse, LIMITS } from "./rate-limit";

/**
 * Streaming TTS endpoint using Server-Sent Events (SSE).
 * 
 * Runs on Vercel **Edge Runtime** for:
 *  - Native streaming / SSE support (no buffering)
 *  - 30 s execution limit (vs 10 s for Serverless on the free plan)
 *  - Faster cold starts
 * 
 * Self-contained (doesn't import from generate.ts) to avoid
 * cross-runtime bundling issues between Edge and Node functions.
 * 
 * API key stays server-side (Vercel env vars) — never exposed to the client.
 */

// Tell Vercel to deploy this function on the Edge Runtime
export const config = { runtime: 'edge' };

// Module-level SDK cache (persists across warm invocations)
let cachedAI: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured. Check Vercel Environment Variables.");
  }
  if (!cachedAI) {
    cachedAI = new GoogleGenAI({ apiKey });
  }
  return cachedAI;
}

// 4.7 CACHEABLE: the interviewer emits a small, finite set of fixed override /
// non-answer / closing strings (see api/agent/next-step.ts). Their synthesized
// audio is identical every time, so we memoize the decoded audio chunks in a
// tiny, bounded, per-instance in-memory cache keyed by voice+text. This is a
// best-effort warm-instance optimization only (edge instances are ephemeral and
// unshared) — a cache MISS always falls through to normal generation, so the
// response contract is unchanged. Bounds are deliberately conservative to keep
// edge memory usage negligible.
//   TODO: for a cross-instance / durable cache, move this to Supabase storage or
//   a KV and prewarm the fixed strings at deploy time.
const TTS_CACHE_MAX_ENTRIES = 32;          // at most this many distinct strings
const TTS_CACHE_MAX_CHARS = 200;           // only cache short (fixed) strings
const TTS_CACHE_MAX_CHUNKS = 512;          // guard against unexpectedly large audio
const ttsAudioCache = new Map<string, string[]>();

function ttsCacheKey(voice: string, text: string): string {
  return `${voice}::${text}`;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Authenticate: require a valid Supabase JWT
  const auth = await verifyAuth(req);
  if (auth.error) return auth.error;

  try {
    const ai = getAI();
    const { text, sessionId, segmentIndex, warmup } = await req.json();

    // 4.9 COLD-START WARMUP: the client prewarms this function on interview
    // screen mount by POSTing { warmup: true }. We touch getAI() above (which
    // instantiates + module-caches the Gemini SDK client on a cold container)
    // and return 200 immediately WITHOUT generating any audio. This keeps the
    // heavy first-invocation cost (bundle init + SDK construction) off the
    // critical path of the first real TTS request. Normal path is unchanged.
    if (warmup === true) {
      return new Response(JSON.stringify({ warmed: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!text) {
      return new Response(JSON.stringify({ error: "Missing required field: text" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // C4: bound per-call cost with a hard length cap (a spoken sentence is far shorter).
    const MAX_TTS_TEXT_LENGTH = 800;
    if (typeof text !== 'string' || text.length > MAX_TTS_TEXT_LENGTH) {
      return new Response(JSON.stringify({ error: "Text too long" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    // C4: tie a candidate's TTS to their own session (defends against cross-session abuse).
    if (auth.user.id.startsWith('candidate-') && sessionId && sessionId !== auth.user.id.replace('candidate-', '')) {
      return new Response(JSON.stringify({ error: "Context mismatch" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Supabase admin client (needed for rate limiting + usage logging).
    let supabaseAdmin: any = null;
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseServiceKey) {
      supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
    }

    // C4: per-session (or per-user) TTS rate limit — fails open if the limiter is down.
    if (supabaseAdmin) {
      const rlKey = `tts:${sessionId || auth.user.id}`;
      if (!(await underRateLimit(supabaseAdmin, rlKey, LIMITS.tts.limit, LIMITS.tts.windowSeconds))) {
        return tooManyRequestsResponse();
      }
    }

    const VOICE_NAME = 'Kore';
    const cacheKey = ttsCacheKey(VOICE_NAME, text);

    // 4.7: Fast replay for a known fixed string (e.g. override / closing lines).
    // A cache HIT skips the model entirely and re-emits the exact same SSE audio
    // frames; there is no billable model call, so we don't log usage here.
    const cachedChunks = ttsAudioCache.get(cacheKey);
    if (cachedChunks) {
      console.log(`[TTS-Stream] Cache HIT for ${text.length} chars, ${cachedChunks.length} chunks`);
      const encoder = new TextEncoder();
      const cachedStream = new ReadableStream({
        start(controller) {
          for (const audioData of cachedChunks) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ audioData })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      });
      return new Response(cachedStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        }
      });
    }

    console.log(`[TTS-Stream] Generating audio for ${text.length} chars, voice=Kore`);

    const TTS_SYSTEM_PROMPT = 'You are a professional female AI interviewer. Maintain a calm, warm, and authoritative tone throughout. Speak clearly and at a moderate pace. Read the following text aloud exactly as written.';

    // 4.7: only short (fixed) strings are eligible for the in-memory cache.
    const cacheEligible = typeof text === 'string' && text.length <= TTS_CACHE_MAX_CHARS;
    const collectedChunks: string[] = [];

    const llmStartTime = Date.now();
    const streamResponse = await ai.models.generateContentStream({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `${TTS_SYSTEM_PROMPT}\n\n${text}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: VOICE_NAME },
          },
        },
      }
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let chunkCount = 0;
          // M11 fix: account for the audio OUTPUT so estimateCost applies the
          // output rate. Prefer real usageMetadata (Gemini usually attaches it
          // on the final chunk); otherwise estimate from decoded audio bytes.
          let lastUsage: any = null;
          let audioBytes = 0;
          for await (const chunk of streamResponse) {
            if (chunk.usageMetadata) {
              lastUsage = chunk.usageMetadata; // keep the latest non-null one
            }
            const audioData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              chunkCount++;
              // Decoded byte count from base64 length (excludes padding).
              audioBytes += Math.floor(audioData.length * 3 / 4);
              // 4.7: buffer chunks for the fixed-string cache (bounded).
              if (cacheEligible && collectedChunks.length < TTS_CACHE_MAX_CHUNKS) {
                collectedChunks.push(audioData);
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ audioData })}\n\n`));
            }
          }
          console.log(`[TTS-Stream] Finished: sent ${chunkCount} audio chunks`);

          // 4.7: memoize this fixed string's audio for warm-instance reuse.
          // Only store complete (non-truncated) captures; evict oldest to bound.
          if (cacheEligible && collectedChunks.length > 0 && collectedChunks.length === chunkCount) {
            if (ttsAudioCache.size >= TTS_CACHE_MAX_ENTRIES) {
              const oldest = ttsAudioCache.keys().next().value;
              if (oldest !== undefined) ttsAudioCache.delete(oldest);
            }
            ttsAudioCache.set(cacheKey, collectedChunks);
          }
          // S7 fix: Estimate prompt tokens from text length (~4 chars/token heuristic)
          const estimatedPromptTokens = Math.ceil(text.length / 4);

          // M11 fix: derive the completion (audio output) token count.
          // This is APPROXIMATE — we prefer real usageMetadata when present.
          // gemini-2.5-flash-preview-tts returns 24kHz 16-bit mono PCM =
          // 48000 bytes/sec. We convert accumulated audio bytes to seconds and
          // multiply by a heuristic tokens-per-second constant so the output
          // cost (priced at $0.80 / 1M) is no longer billed as zero.
          const APPROX_AUDIO_TOKENS_PER_SEC = 25; // heuristic — calibrate against real Google billing
          let estCompletionTokens: number;
          const metaCompletion = lastUsage?.candidatesTokenCount ?? lastUsage?.responseTokenCount;
          if (typeof metaCompletion === 'number') {
            estCompletionTokens = metaCompletion; // most accurate
          } else {
            const audioSeconds = audioBytes / 48000;
            estCompletionTokens = Math.ceil(audioSeconds * APPROX_AUDIO_TOKENS_PER_SEC);
          }

          if (supabaseAdmin && sessionId) {
            logLLMUsage(supabaseAdmin, {
              sessionId, endpoint: 'tts-stream',
              model: 'gemini-2.5-flash-preview-tts', billingMode: 'tts_audio',
              latencyMs: Date.now() - llmStartTime, success: true,
              promptTokenCount: estimatedPromptTokens,
              responseTokenCount: estCompletionTokens,
              totalTokenCount: estimatedPromptTokens + estCompletionTokens,
              segmentIndex
            });
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e: any) {
          console.error("[TTS-Stream] Stream iteration error:", e);
          // Log failed TTS usage
          if (supabaseAdmin && sessionId) {
            logLLMUsage(supabaseAdmin, {
              sessionId, endpoint: 'tts-stream',
              model: 'gemini-2.5-flash-preview-tts', billingMode: 'tts_audio',
              latencyMs: Date.now() - llmStartTime, success: false,
              errorCode: e.message || 'TTS_STREAM_ERROR',
              segmentIndex
            });
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: e.message || "Stream error" })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      }
    });

  } catch (error: any) {
    console.error("[TTS-Stream] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
