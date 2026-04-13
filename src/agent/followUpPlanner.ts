import { getAuthHeaders, withRetry } from "./core";
import { NextStep, InterviewMemory } from "./types";

export async function getNextInterviewStep(
  question: string,
  questionId: string,
  answer: string,
  memory: InterviewMemory,
  isLastQuestion: boolean = false,
  forceNextClaim: boolean = false,
  maxFollowUpsPerClaim: number = 2,
  minQuestionsPerClaim: number = 2,
  language: 'zh-CN' | 'en-US' = 'zh-CN'
): Promise<NextStep> {
  
  return await withRetry(async () => {
    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:5173/api';
    const authHeaders = await getAuthHeaders();
    
    // The server rebuilds the memory state via transcript. We only need to provide the raw params.
    const sessionId = authHeaders['X-Session-Id'];
    if (!sessionId) throw new Error("No active session ID for backend agent call");

    const response = await fetch(`${baseUrl}/agent/next-step`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        sessionId,
        answer,
        question,
        questionId,
        language
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Server Agent Error: ${response.status} - ${errorBody}`);
    }

    return await response.json() as NextStep;
  });
}
