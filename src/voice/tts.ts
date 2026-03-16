import { callAiBackend, withRetry, MODELS } from "../agent/core";

export async function* generateTTSStream(text: string): AsyncGenerator<string, void, unknown> {
  try {
    // Note: The /api/generate endpoint currently returns a single monolithic JSON response,
    // so real streaming requires a dedicated server endpoint that proxies standard streams.
    // For now, we fallback to awaiting the full chunk.
    const response = await callAiBackend(
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
    );

    // AI backend proxy responds with text that we assume contains the base64 string because we removed parsing layers.
    if (response.text) {
       yield response.text; 
    }
  } catch (error: any) {
    const errorStr = typeof error === 'object' ? JSON.stringify(error) : String(error);
    if (!errorStr.includes('429') && !errorStr.toLowerCase().includes('quota')) {
      console.error("TTS Stream Error:", error);
    }
    throw error;
  }
}

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

    return response.text || null;
  } catch (error: any) {
    const errorStr = typeof error === 'object' ? JSON.stringify(error) : String(error);
    // Only log non-quota errors, since quota errors are expected and handled by the browser fallback
    if (!errorStr.includes('429') && !errorStr.toLowerCase().includes('quota')) {
      console.error("TTS Error:", error);
    }
    return null;
  }
}
