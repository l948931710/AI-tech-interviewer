import { GoogleGenAI } from "@google/genai";

// Cache SDK instance at module level to avoid re-initialization overhead per request.
// The API key is read from process.env (Vercel env vars) — never exposed to the client.
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

export async function POST(req: Request) {
  console.log("=== API/GENERATE TRIGGERED ===");

  try {
    const ai = getAI();
    const body = await req.json();

    const { model, contents, config } = body;

    if (!model || !contents) {
       return new Response(JSON.stringify({ error: "Missing required fields: model or contents" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`Generating content using model: ${model}`);
    
    const response = await ai.models.generateContent({
      model,
      contents,
      config
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
