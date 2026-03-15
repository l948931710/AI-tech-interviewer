import { GoogleGenAI } from "@google/genai";

export function parseJsonResponse<T>(text: string | undefined): T {
  let t = text || "{}";
  t = t.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(t) as T;
}

export const MODELS = {
  INTERVIEW: "gemini-3-flash-preview",
  REPORT: "gemini-3.1-pro-preview",
  TTS: "gemini-2.5-flash-preview-tts"
};

export const getAi = () => new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 2000): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;

      const errorStr = typeof error === 'object' ? JSON.stringify(error) : String(error);
      const isQuotaError =
        error?.message?.toLowerCase().includes('quota') ||
        error?.status === 429 ||
        error?.error?.code === 429 ||
        errorStr.includes('429') ||
        errorStr.toLowerCase().includes('quota');

      const isDailyQuota = errorStr.toLowerCase().includes('per_day');

      if (isQuotaError && !isDailyQuota && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`Quota exceeded. Retrying in ${delay}ms... (Attempt ${attempt} of ${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries reached");
}
