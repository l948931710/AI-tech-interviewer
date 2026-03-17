import { callAiBackend, withRetry, MODELS } from "../agent/core";

/**
 * Real streaming TTS via the /api/tts-stream SSE endpoint.
 * Yields base64 audio chunks as they arrive from the server,
 * letting the playback layer start playing before the full response is ready.
 */
export async function* generateTTSStream(text: string): AsyncGenerator<string, void, unknown> {
  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:5173/api';

  // Abort the fetch if the server doesn't start responding within 10 seconds
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(`${baseUrl}/tts-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceName: 'Kore' }),
    signal: controller.signal
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`TTS Stream Error: ${response.status} - ${errorBody}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from the buffer (format: "data: ...\n\n")
    const events = buffer.split('\n\n');
    // Keep the last partial event in the buffer
    buffer = events.pop() || '';

    for (const event of events) {
      const line = event.trim();
      if (!line.startsWith('data: ')) continue;

      const payload = line.slice(6); // Remove "data: " prefix
      if (payload === '[DONE]') return;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed.audioData) {
          yield parsed.audioData;
        }
      } catch (e: any) {
        if (e.message && !e.message.includes('JSON')) {
          throw e; // Re-throw non-parse errors (e.g. server errors)
        }
        // Skip malformed SSE lines
      }
    }
  }
}

/**
 * Non-streaming TTS for pre-fetching use cases (e.g. first question).
 * Uses the regular /api/generate endpoint with maxRetries=1 for fast fallback.
 */
export async function generateTTS(text: string): Promise<string | null> {
  try {
    // Use maxRetries = 1 for TTS so it fails fast and immediately uses the browser fallback TTS
    const response = await withRetry(() => callAiBackend(
      MODELS.TTS,
      [{ parts: [{ text: `Read the following text aloud exactly as written:\n\n${text}` }] }],
      {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      }
    ), 1);

    return (response as any).audioData || response.text || null;
  } catch (error: any) {
    const errorStr = typeof error === 'object' ? JSON.stringify(error) : String(error);
    // Only log non-quota errors, since quota errors are expected and handled by the browser fallback
    if (!errorStr.includes('429') && !errorStr.toLowerCase().includes('quota')) {
      console.error("TTS Error:", error);
    }
    return null;
  }
}
