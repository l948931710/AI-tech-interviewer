import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Centralized LLM usage logger.
 *
 * Every LLM call in the system (start, next-step, generate-report, tts-stream)
 * calls this after completion. It:
 *  1. Calculates estimated cost from a centralized pricing table
 *  2. Inserts a row into llm_usage_logs
 *  3. The Postgres trigger auto-increments interview_sessions counters
 *
 * Fire-and-forget: errors are caught and logged, never thrown.
 */

// ---------------------------------------------------------------------------
// Pricing table (USD per 1M tokens)
// Update these when model pricing changes — single source of truth.
// ---------------------------------------------------------------------------
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Text generation models
  "gemini-3-flash-preview":        { input: 0.10,  output: 0.40  },
  "gemini-3.1-pro-preview":        { input: 1.25,  output: 5.00  },
  // TTS model (audio output pricing differs from text)
  "gemini-2.5-flash-preview-tts":  { input: 0.10,  output: 0.80  },
};

// Fallback pricing for unknown models
const DEFAULT_PRICING = { input: 0.50, output: 2.00 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type LLMEndpoint = 'start' | 'next-step' | 'generate-report' | 'tts-stream';
export type BillingMode = 'text' | 'tts_audio' | 'approx_tts';

export interface LLMUsageParams {
  sessionId: string;
  endpoint: LLMEndpoint;
  model: string;
  billingMode: BillingMode;
  latencyMs: number;
  success: boolean;

  // Optional context
  requestId?: string;
  transcriptId?: string;

  // Token usage from Gemini usageMetadata
  promptTokenCount?: number;
  responseTokenCount?: number;
  totalTokenCount?: number;

  // Error info
  errorCode?: string;
  segmentIndex?: number;
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------
function estimateCost(params: LLMUsageParams): number {
  const pricing = MODEL_PRICING[params.model] || DEFAULT_PRICING;
  const promptTokens = params.promptTokenCount || 0;
  const completionTokens = params.responseTokenCount || 0;

  const inputCost  = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

// ---------------------------------------------------------------------------
// Main logger function
// ---------------------------------------------------------------------------
export async function logLLMUsage(
  supabase: SupabaseClient,
  params: LLMUsageParams
): Promise<void> {
  try {
    const estimatedCost = estimateCost(params);

    let payload: any = {
      session_id: params.sessionId,
      transcript_id: params.transcriptId || null,
      request_id: params.requestId || null,
      endpoint: params.endpoint,
      provider: 'google',
      model: params.model,
      billing_mode: params.billingMode,
      prompt_tokens: params.promptTokenCount || null,
      completion_tokens: params.responseTokenCount || null,
      total_tokens: params.totalTokenCount || null,
      latency_ms: params.latencyMs,
      estimated_cost: estimatedCost,
      success: params.success,
      error_code: params.errorCode || null
    };

    if (params.segmentIndex !== undefined) {
      payload.segment_index = params.segmentIndex;
    }

    const { error } = await supabase
      .from('llm_usage_logs')
      .insert(payload);

    if (error) {
      if (error.message.includes('segment_index')) {
        console.warn('[LLM-Logger] segment_index missing in DB schema cache. Retrying without it.');
        delete payload.segment_index;
        // Optionally append it to error_code to preserve the data temporarily
        payload.error_code = `${payload.error_code || 'SCHEMA_NOCACHE'} [segment_index:${params.segmentIndex}]`.trim();
        const retry = await supabase.from('llm_usage_logs').insert(payload);
        if (retry.error) {
           console.error('[LLM-Logger] Retry failed:', retry.error.message);
        }
      } else {
        console.error('[LLM-Logger] Failed to log usage:', error.message);
      }
    }
  } catch (e: any) {
    // Fire-and-forget: never let logging failures break the interview flow
    console.error('[LLM-Logger] Unexpected error:', e.message || e);
  }
}

// ---------------------------------------------------------------------------
// Helper to extract usageMetadata from a Gemini response
// ---------------------------------------------------------------------------
export function extractUsageMetadata(response: any): {
  promptTokenCount?: number;
  responseTokenCount?: number;
  totalTokenCount?: number;
} {
  const meta = response?.usageMetadata;
  if (!meta) return {};
  return {
    promptTokenCount: meta.promptTokenCount,
    responseTokenCount: meta.responseTokenCount,
    totalTokenCount: meta.totalTokenCount,
  };
}
