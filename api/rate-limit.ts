import { SupabaseClient } from "@supabase/supabase-js";

/**
 * C4 fix: shared rate-limiting + per-session cost-ceiling guard.
 *
 * Rate limiting is backed by Postgres (supabase/migrations/*_rate_limiting.sql) so it needs
 * no external Redis. The cost ceiling reads the denormalized
 * interview_sessions.estimated_total_cost / llm_call_count counters maintained by
 * the llm_usage_logs trigger.
 *
 * Tunable via env (all optional, safe defaults below).
 */

// --- Per-session hard spend backstop --------------------------------------
// A legitimate interview costs well under $0.50 (a few dozen flash calls + TTS).
// This ceiling exists to stop runaway/abusive spend, NOT to gate normal use.
export const MAX_SESSION_COST_USD = Number(process.env.MAX_SESSION_COST_USD || '2');
// Secondary cap on total LLM calls per session (defends against cost mis-estimation).
export const MAX_SESSION_LLM_CALLS = Number(process.env.MAX_SESSION_LLM_CALLS || '250');

// --- Fixed-window rate limits: [limit] requests per [windowSeconds] --------
export const LIMITS = {
  // A real interview turn takes >10s end-to-end, so 20/min per session is very
  // generous for a human yet caps scripted floods.
  nextStep: { limit: 20, windowSeconds: 60 },
  // Several sentences may be synthesized per turn.
  tts:      { limit: 45, windowSeconds: 60 },
  // HR-only generic proxy.
  generate: { limit: 30, windowSeconds: 60 },
  // HR-only, runs the expensive pro model.
  report:   { limit: 10, windowSeconds: 60 },
} as const;

export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Atomic fixed-window increment via the incr_rate_limit RPC.
 *
 * FAILS OPEN: if the limiter backend errors (e.g. the migration hasn't been
 * applied yet), we do NOT block a legitimate interview — the per-session cost
 * ceiling is the hard backstop. Returns true when the request is within limit.
 */
export async function underRateLimit(
  supabase: SupabaseClient,
  bucketKey: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('incr_rate_limit', {
      p_bucket_key: bucketKey,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('[RateLimit] RPC failed (failing open):', error.message);
      return true;
    }
    return typeof data === 'number' ? data <= limit : true;
  } catch (e: any) {
    console.error('[RateLimit] Unexpected error (failing open):', e?.message || e);
    return true;
  }
}

export function tooManyRequestsResponse(): Response {
  return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
  });
}

/**
 * Returns true when a session has blown its cumulative spend/call budget.
 * Reads the denormalized counters (kept in sync by the llm_usage_logs trigger).
 * When true, callers should stop making billable calls for this session.
 *
 * Emits a structured error log so a log-based billing-anomaly alert can fire.
 */
export function isSessionOverBudget(session: { estimated_total_cost?: number; llm_call_count?: number } | null | undefined): boolean {
  const cost = Number(session?.estimated_total_cost || 0);
  const calls = Number(session?.llm_call_count || 0);
  const over = cost >= MAX_SESSION_COST_USD || calls >= MAX_SESSION_LLM_CALLS;
  if (over) {
    // BILLING ANOMALY: greppable, structured line for Vercel/Datadog log alerts.
    console.error(JSON.stringify({
      level: 'ERROR',
      event: 'SESSION_BUDGET_EXCEEDED',
      estimated_total_cost: cost,
      llm_call_count: calls,
      max_cost_usd: MAX_SESSION_COST_USD,
      max_calls: MAX_SESSION_LLM_CALLS,
      timestamp: new Date().toISOString(),
    }));
  }
  return over;
}

export function usageLimitResponse(): Response {
  return new Response(JSON.stringify({ error: 'This interview has reached its usage limit.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  });
}
