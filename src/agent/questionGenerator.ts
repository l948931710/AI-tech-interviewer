import { getAuthHeaders, withRetry } from "./core";
import { CandidateInfo, Claim } from "./types";

export async function generateFirstQuestion(
  candidateInfo: CandidateInfo, 
  firstClaim: Claim, 
  jdText: string, 
  language: 'zh-CN' | 'en-US' = 'zh-CN'
): Promise<{ question: string, spokenQuestion: string, rationale: string }> {

  return await withRetry(async () => {
    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:5173/api';
    const authHeaders = await getAuthHeaders();
    
    // The server handles prompt construction securely based on session context
    const sessionId = authHeaders['X-Session-Id'];
    if (!sessionId) throw new Error("No active session ID for backend agent call");

    const response = await fetch(`${baseUrl}/agent/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        sessionId,
        language
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Server Agent Error: ${response.status} - ${errorBody}`);
    }

    return await response.json();
  });
}
