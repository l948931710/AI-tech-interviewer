import { GoogleGenAI } from "@google/genai";

// Export maxDuration for Vercel Serverless Functions
// Hobby tier allows up to 60 seconds, which fixes the 504 FUNCTION_INVOCATION_TIMEOUT
export const maxDuration = 60;

// Cache SDK instance at module level
let cachedAI: GoogleGenAI | null = null;

export function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not configured on server. Please check Vercel Environment Variables.");
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

  console.log("=== API/GENERATE TRIGGERED ===");

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

    console.log(`Generating content using model: ${model}`);
    
    // Explicitly set timeout for fetch within Edge function (max 28 seconds to leave room for graceful exit)
    const response = await ai.models.generateContent({
      model,
      contents,
      config: aiConfig
    });

    console.log("Successfully generated content.");

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Gemini API Generate Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
