import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request) {
  console.log("=== API/GENERATE TRIGGERED ===");

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    console.log(`=== GEMINI_API_KEY Loaded: ${apiKey ? apiKey.substring(0, 4) + '...' : 'NONE'} ===`);
    
    if (!apiKey) {
      console.error("FATAL: GEMINI_API_KEY is completely missing from process.env!");
      return new Response(JSON.stringify({ error: "API Key not configured on server. Please check Vercel Environment Variables." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Initialize SDK on the secure backend
    const ai = new GoogleGenAI({ apiKey });
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
