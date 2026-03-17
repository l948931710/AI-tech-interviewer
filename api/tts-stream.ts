import { getAI } from "./generate";

/**
 * Streaming TTS endpoint using Server-Sent Events (SSE).
 * Uses Gemini's generateContentStream to progressively send audio chunks
 * so the client can start playing audio before the full response is ready.
 * 
 * API key stays server-side (Vercel env vars) — never exposed to the client.
 */
export async function POST(req: Request) {
  try {
    const ai = getAI();
    const { text, voiceName } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: "Missing required field: text" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

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
          for await (const chunk of streamResponse) {
            const audioData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ audioData })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e: any) {
          // Send the error as an SSE event so the client can handle it gracefully
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
    console.error("TTS Stream Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
