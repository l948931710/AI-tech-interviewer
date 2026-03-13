import { Type } from "@google/genai";
import { getAi, withRetry, MODELS, parseJsonResponse } from "./core";
import { CandidateInfo, Claim } from "./types";

export async function generateFirstQuestion(candidateInfo: CandidateInfo, firstClaim: Claim, jdText: string): Promise<{ question: string, spokenQuestion: string, rationale: string }> {
  const ai = getAi();
  const prompt = `
    You are an expert technical AI interviewer.
    Generate the first deep-dive technical interview question for the candidate.
    
    Candidate Name: ${candidateInfo.name}
    Job Description: ${jdText}
    
    The question should probe the following high-priority claim from their resume:
    Topic: ${firstClaim.topic}
    Claim: ${firstClaim.claim}
    Experience/Project Name: ${firstClaim.experienceName || 'Not specified'}
    Must Verify Points: ${firstClaim.mustVerify?.join(', ') || 'None specified'}
    Nice-to-Have Points: ${firstClaim.niceToHave?.join(', ') || 'None specified'}
    Evidence Hints: ${firstClaim.evidenceHints?.join(', ') || 'None specified'}
    Rationale for probing: ${firstClaim.rationale}
    
    The question should probe technical depth, implementation details, architecture/design decisions, tradeoffs, debugging/failure handling, metric attribution, and personal contribution/ownership. Avoid generic questions. It should feel like a real experienced interviewer is asking it.
    
    IMPORTANT: This is the first technical question AFTER the candidate's self-introduction. You MUST include a brief, natural transition acknowledging their intro (e.g., "好的，感谢你的介绍。我仔细看了你的简历，对你的经历很感兴趣。我们先来聊聊你在 [Company/Project] 的工作...").
    IMPORTANT: You MUST explicitly mention the specific experience, project, or company from their resume that you are asking about to make it conversational and natural.
    IMPORTANT: The generated question MUST be in Chinese (Simplified).
    IMPORTANT: Generate a \`spokenQuestion\` which is a concise, conversational version of the \`question\` optimized for Text-to-Speech. It must include the transition but keep the actual question part short to minimize TTS latency.
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model: MODELS.INTERVIEW,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          spokenQuestion: { type: Type.STRING, description: "A shorter, conversational version of the question optimized for TTS." },
          rationale: { type: Type.STRING }
        },
        required: ["question", "spokenQuestion", "rationale"]
      }
    }
  }));

  return parseJsonResponse<{ question: string, spokenQuestion: string, rationale: string }>(response.text);
}
