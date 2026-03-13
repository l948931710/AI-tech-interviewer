import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContentStream({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: 'Say exactly this text: Hello, this is a test of streaming text to speech. I am going to speak a long sentence to see if it chunks the audio.' }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    let chunkCount = 0;
    for await (const chunk of response) {
      chunkCount++;
      const base64Audio = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      console.log(`Chunk ${chunkCount}: ${base64Audio ? base64Audio.length : 0} bytes`);
    }
  } catch (e) {
    console.error(e);
  }
}
test();
