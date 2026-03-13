import { Type } from "@google/genai";
import { getAi, withRetry, MODELS, parseJsonResponse } from "./core";
import { InterviewReport, Claim, StructuredInterviewTurn } from "./types";

export async function generateReport(history: StructuredInterviewTurn[], claims: Claim[]): Promise<InterviewReport> {
  const ai = getAi();
  
  const historyText = history.map((t, i) => `
--- Turn ${i + 1} ---
Type: ${t.turnType || 'unknown'}
Target Claim: ${t.claimText || 'N/A'}
Experience: ${t.experienceName || 'N/A'}
Q: ${t.question}
A: ${t.answer}
`).join('\n');

  const prompt = `
    You are an expert technical hiring manager.
    Evaluate the following structured interview transcript and generate a comprehensive final report.
    
    The candidate was evaluated against the following claims from their resume:
    ${JSON.stringify(claims, null, 2)}
    
    Structured Interview Transcript:
    ${historyText}
    
    INSTRUCTIONS:
    1. Evaluate the candidate PER CLAIM. For each claim evaluated in the transcript, determine if the "Must Verify Points" were successfully verified.
    2. Assign a verificationStatus to each claim: strong, partial, weak, or unverified.
    3. Assign a riskLevel to each claim: low, medium, or high.
    4. List missingPoints for the claim (what was not verified or missing).
    5. List specific strengths and weaknesses for the claim based on the candidate's answers.
    6. Provide 1-10 scores across the specified dimensions for the claim overall.
    7. Under each claim, nest the specific Q&A turns (turnEvaluations) that support your evaluation, along with brief notes on how that specific turn contributed to the claim's evaluation.
    8. Finally, provide an overall recommendation, an overall score out of 100, a summary, strongest areas, riskFlags (overall), and suggested focus for the next round.
    
    RECOMMENDATION GUIDANCE:
    Use recommendation labels consistently:
    - STRONG_HIRE: strong, credible evidence across most critical claims with low risk
    - HIRE: generally solid evidence with some minor gaps
    - LEAN_HIRE: promising but with meaningful gaps requiring another round
    - LEAN_NO_HIRE: multiple important gaps or weak verification
    - NO_HIRE: major claims unverified, weak evidence, or strong risk signals
    
    OVERALL SCORE GUIDANCE:
    90-100 = exceptional and strongly verified
    75-89 = solid and likely hireable
    60-74 = mixed signals / needs more verification
    40-59 = weak evidence / substantial gaps
    0-39 = poor interview signal
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model: MODELS.REPORT,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallRecommendation: { type: Type.STRING, description: "STRONG_HIRE, HIRE, LEAN_HIRE, LEAN_NO_HIRE, NO_HIRE" },
          overallScore: { type: Type.NUMBER, description: "Overall score from 0 to 100" },
          summary: { type: Type.STRING },
          strongestAreas: { type: Type.ARRAY, items: { type: Type.STRING } },
          riskFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedNextRoundFocus: { type: Type.ARRAY, items: { type: Type.STRING } },
          claimEvaluations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                claimId: { type: Type.STRING },
                claimText: { type: Type.STRING },
                experienceName: { type: Type.STRING },
                verificationStatus: { type: Type.STRING, description: "strong, partial, weak, or unverified" },
                riskLevel: { type: Type.STRING, description: "low, medium, or high" },
                missingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
                scores: {
                  type: Type.OBJECT,
                  properties: {
                    relevance: { type: Type.NUMBER },
                    specificity: { type: Type.NUMBER },
                    technicalDepth: { type: Type.NUMBER },
                    ownership: { type: Type.NUMBER },
                    evidence: { type: Type.NUMBER },
                    clarity: { type: Type.NUMBER },
                  },
                  required: ["relevance", "specificity", "technicalDepth", "ownership", "evidence", "clarity"]
                },
                turnEvaluations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      answer: { type: Type.STRING },
                      turnType: { type: Type.STRING },
                      notes: { type: Type.STRING }
                    },
                    required: ["question", "answer", "notes"]
                  }
                }
              },
              required: ["claimText", "verificationStatus", "riskLevel", "missingPoints", "strengths", "weaknesses", "scores", "turnEvaluations"]
            }
          }
        },
        required: ["overallRecommendation", "overallScore", "summary", "strongestAreas", "riskFlags", "suggestedNextRoundFocus", "claimEvaluations"]
      }
    }
  }), 3, 5000); // Longer delay for pro model

  const parsedReport = parseJsonResponse<InterviewReport>(response.text);

  // Hardcode scores to 0 if all turns for a claim were 'non_answer'
  parsedReport.claimEvaluations.forEach(evaluation => {
    const claimTurns = history.filter(t => t.claimText === evaluation.claimText);
    if (claimTurns.length > 0 && claimTurns.every(t => t.answerStatus === 'non_answer')) {
      evaluation.scores = {
        relevance: 0,
        specificity: 0,
        technicalDepth: 0,
        ownership: 0,
        evidence: 0,
        clarity: 0
      };
      evaluation.verificationStatus = 'unverified';
    }
  });

  return parsedReport;
}
