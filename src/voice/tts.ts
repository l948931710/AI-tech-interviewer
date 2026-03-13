import { Modality } from "@google/genai";
import { getAi, withRetry, MODELS } from "../agent/core";

export async function* generateTTSStream(text: string): AsyncGenerator<string, void, unknown> {
  try {
    const ai = getAi();
    const response = await ai.models.generateContentStream({
      model: MODELS.TTS,
      contents: [{ parts: [{ text: `Read the following text aloud exactly as written:\n\n${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    for await (const chunk of response) {
      const base64Audio = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        yield base64Audio;
      }
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
    const ai = getAi();
    // Use maxRetries = 1 for TTS so it fails fast and immediately uses the browser fallback TTS
    const response = await withRetry(() => ai.models.generateContent({
      model: MODELS.TTS,
      contents: [{ parts: [{ text: `Read the following text aloud exactly as written:\n\n${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    }), 1);

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error: any) {
    const errorStr = typeof error === 'object' ? JSON.stringify(error) : String(error);
    // Only log non-quota errors, since quota errors are expected and handled by the browser fallback
    if (!errorStr.includes('429') && !errorStr.toLowerCase().includes('quota')) {
      console.error("TTS Error:", error);
    }
    return null;
  }
}
