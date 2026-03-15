import { getAi, MODELS } from "../agent/core";
import { PersonaType } from "./metrics";
import fs from "fs";
import path from "path";

export async function generateFakeAnswer(
  personaType: PersonaType, 
  question: string, 
  claimContext: string,
  interviewHistoryStr: string
): Promise<{ text: string, tokens: number }> {
  
  // Load the persona prompt
  const personaPath = path.resolve(process.cwd(), `benchmarks/personas/${personaType}.json`);
  let systemPrompt = "";
  try {
    const rawData = fs.readFileSync(personaPath, 'utf-8');
    const parsed = JSON.parse(rawData);
    systemPrompt = parsed.systemPrompt;
  } catch(e) {
    console.warn(`Could not load persona ${personaType}, falling back to default.`);
    systemPrompt = "You are a candidate in a technical interview.";
  }

  const prompt = `
${systemPrompt}

Current Topic / Claim Context:
${claimContext}

Interview History So Far:
${interviewHistoryStr}

The Interviewer asks you:
"${question}"

Respond directly to the interviewer in the exact style of your persona. Do not break character. Do not include action text like '*sighs*'. Just output your dialogue response.
`;

  const ai = getAi();
  
  try {
    const response = await ai.models.generateContent({
      model: MODELS.INTERVIEW,
      contents: prompt,
    });
    
    // Naive token estimation: ~4 chars per token
    const estimatedTokens = Math.ceil((prompt.length + (response.text?.length || 0)) / 4);

    return { 
      text: response.text || "I'm not sure.", 
      tokens: estimatedTokens 
    };
  } catch (error) {
    console.error("Failed to generate fake answer:", error);
    return { text: "Can you repeat the question? We might have a connection issue.", tokens: 0 };
  }
}
