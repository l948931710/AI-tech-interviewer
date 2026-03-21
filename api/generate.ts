import { GoogleGenAI } from "@google/genai";
import { verifyAuth } from "./api-auth";

/**
 * Streaming generate endpoint using Server-Sent Events (SSE).
 *
 * Runs on Vercel **Edge Runtime** for:
 *  - Native streaming / SSE support (no buffering)
 *  - 30 s execution limit (vs 10 s for Serverless on the free plan)
 *  - Faster cold starts
 *
 * Streams text chunks as they arrive from Gemini, keeping the connection
 * alive and avoiding FUNCTION_INVOCATION_TIMEOUT on the Hobby tier.
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

  // Authenticate: require a valid Supabase JWT
  const auth = await verifyAuth(req);
  if (auth.error) return auth.error;

  console.log(`=== API/GENERATE (streaming) TRIGGERED by user ${auth.user.id} ===`);

  try {
    const ai = getAI();
    const body = await req.json();
    const { model, contents, config: aiConfig } = body;

    if (!model || !contents) {
      return new Response(JSON.stringify({ error: "Missing required fields: model or contents" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`Streaming content using model: ${model}`);

    const streamResponse = await ai.models.generateContentStream({
      model,
      contents,
      config: aiConfig
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let chunkCount = 0;
          for await (const chunk of streamResponse) {
            const part = chunk.candidates?.[0]?.content?.parts?.[0];
            const text = part?.text;
            const audioData = part?.inlineData?.data;

            if (text || audioData) {
              chunkCount++;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: text || '', audioData: audioData || null })}\n\n`)
              );
            }
          }
          console.log(`[Generate-Stream] Finished: sent ${chunkCount} chunks`);
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e: any) {
          console.error("[Generate-Stream] Stream iteration error:", e);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: e.message || "Stream error" })}\n\n`)
          );
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
    console.error("[Generate-Stream] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
