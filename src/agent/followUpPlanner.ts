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
  language: 'zh-CN' | 'en-US' = 'zh-CN',
  onSentence?: (sentence: string) => void
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

    // Fast-path JSON responses (intro, timeout, idempotent cache, non-answer fast-path)
    // still come back as application/json. Substantive answers stream as SSE.
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.includes("text/event-stream")) {
      return await response.json() as NextStep;
    }

    // SSE path: parse text/event-stream frames. Each frame is a set of lines
    // ('event: <name>' + one or more 'data: <chunk>') terminated by a blank line.
    if (!response.body) throw new Error("Server Agent Error: SSE response had no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed: NextStep | null = null;

    const handleFrame = (frame: string) => {
      let eventName = "message";
      const dataLines: string[] = [];
      for (const rawLine of frame.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          // Per the SSE spec a single leading space after the colon is stripped.
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (dataLines.length === 0) return;

      const dataStr = dataLines.join("\n");

      if (eventName === "sentence") {
        // Early TTS: server emits one frame per finished sentence of spokenQuestion.
        try {
          const payload = JSON.parse(dataStr) as { text?: string; segmentIndex?: number };
          if (onSentence && payload.text) onSentence(payload.text);
        } catch {
          // Ignore malformed sentence frames; they are non-critical for correctness.
        }
      } else if (eventName === "complete") {
        completed = JSON.parse(dataStr) as NextStep;
      } else if (eventName === "error") {
        let message = "Streaming error";
        try {
          const payload = JSON.parse(dataStr) as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          // fall through with default message
        }
        throw new Error(`Server Agent Error: ${message}`);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Keep the trailing partial frame buffered.
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        if (frame.trim().length > 0) handleFrame(frame);
      }
    }

    // Flush any final frame that wasn't terminated by a trailing blank line.
    buffer += decoder.decode();
    if (buffer.trim().length > 0) handleFrame(buffer);

    if (!completed) {
      // Stream ended without a 'complete' event: do not fabricate a half-built step.
      throw new Error("Server Agent Error: interview stream ended before completion");
    }

    return completed;
  });
}
