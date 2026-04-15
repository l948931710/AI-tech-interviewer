import { supabase } from '../lib/supabase';

export const MODELS = {
  INTERVIEW: "gemini-3-flash-preview",
  REPORT: "gemini-3.1-pro-preview",
  TTS: "gemini-2.5-flash-preview-tts"
};

/**
 * Module-level interview context for candidate auth.
 * Set once when the InterviewPortal loads a valid session.
 */
let interviewContext: { sessionId: string; inviteToken: string } | null = null;

export function setInterviewContext(sessionId: string, inviteToken: string) {
  interviewContext = { sessionId, inviteToken };
}

export function getInterviewSessionId(): string | undefined {
  return interviewContext?.sessionId;
}

/**
 * Get auth headers for API calls.
 * - HR users: returns Supabase JWT Bearer token
 * - Candidates: returns X-Interview-Token + X-Session-Id headers
 * - Fallback: returns empty object (e.g. local dev)
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  // Candidate priority: If we are actively in an interview session,
  // we must authenticate as the candidate to access the sandboxed backend.
  if (interviewContext) {
    return {
      'X-Interview-Token': interviewContext.inviteToken,
      'X-Session-Id': interviewContext.sessionId,
    };
  }

  // Fallback: HR users authenticate with JWT
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { 'Authorization': `Bearer ${session.access_token}` };
    }
  } catch {
    // Silently fall through
  }

  return {};
}


export function parseJsonResponse<T>(text: string | undefined): T {
  let t = text || "{}";
  t = t.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(t) as T;
}

export async function callAiBackend(model: string, contents: any, config?: any, onChunk?: (chunk: { text?: string, audioData?: string }) => void) {
  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:5173/api';
  const authHeaders = await getAuthHeaders();

  const response = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ model, contents, config })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AI Backend Error: ${response.status} - ${errorBody}`);
  }

  // Consume SSE stream and reassemble the full response
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let lastAudioData: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events (format: "data: ...\n\n")
    const events = buffer.split('\n\n');
    buffer = events.pop() || ''; // keep last partial event

    for (const event of events) {
      const line = event.trim();
      if (!line.startsWith('data: ')) continue;

      const payload = line.slice(6);
      if (payload === '[DONE]') break;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed.text) {
          fullText += parsed.text;
        }
        if (parsed.audioData) {
          lastAudioData = parsed.audioData;
        }
        if (onChunk) {
          onChunk({ text: parsed.text, audioData: parsed.audioData });
        }
      } catch (e: any) {
        if (e.message && !e.message.includes('JSON')) {
          throw e;
        }
        // Skip malformed SSE lines
      }
    }
  }

  return {
    text: fullText,
    audioData: lastAudioData
  };
}

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
