import { GoogleGenAI } from "@google/genai";

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

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const ai = getAI();
    const { text, voiceName } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: "Missing required field: text" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`[TTS-Stream] Generating audio for ${text.length} chars, voice=${voiceName || 'Kore'}`);

    const streamResponse = await ai.models.generateContentStream({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Read the following text aloud exactly as written:\n\n${text}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
          },
        },
      }
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let chunkCount = 0;
          for await (const chunk of streamResponse) {
            const audioData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              chunkCount++;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ audioData })}\n\n`));
            }
          }
          console.log(`[TTS-Stream] Finished: sent ${chunkCount} audio chunks`);
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e: any) {
          console.error("[TTS-Stream] Stream iteration error:", e);
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
