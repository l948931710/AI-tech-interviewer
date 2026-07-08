-- =============================================================================
-- LLM Usage Logging — Schema Migration
-- =============================================================================
-- Run in Supabase SQL Editor.
-- Creates the llm_usage_logs table, adds denormalized counters to
-- interview_sessions, and installs a trigger to keep them in sync.
-- =============================================================================

-- 1. Create llm_usage_logs table
CREATE TABLE IF NOT EXISTS public.llm_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  transcript_id UUID NULL REFERENCES public.session_transcripts(id) ON DELETE SET NULL,
  request_id UUID NULL,

  -- Call metadata
  endpoint TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  model TEXT NOT NULL,
  billing_mode TEXT NOT NULL DEFAULT 'text',

  -- Token usage (from Gemini usageMetadata)
  prompt_tokens INT NULL,
  completion_tokens INT NULL,
  total_tokens INT NULL,

  -- Performance & cost
  latency_ms INT NULL,
  estimated_cost NUMERIC(12,6) NULL,

  -- Status
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_code TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT chk_endpoint CHECK (endpoint IN ('start', 'next-step', 'generate-report', 'tts-stream')),
  CONSTRAINT chk_billing_mode CHECK (billing_mode IN ('text', 'tts_audio', 'approx_tts'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_session_id ON public.llm_usage_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_request_id ON public.llm_usage_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_created_at ON public.llm_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_endpoint ON public.llm_usage_logs(endpoint);

-- RLS: server-side writes only (service_role bypasses RLS)
ALTER TABLE public.llm_usage_logs ENABLE ROW LEVEL SECURITY;

-- HR can read logs for sessions they own (for dashboard cost display)
CREATE POLICY "HR can read own session logs"
  ON public.llm_usage_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.interview_sessions
      WHERE id = session_id AND created_by = auth.uid()
    )
  );

-- 2. Add denormalized counters to interview_sessions
ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS llm_call_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_token_usage INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_total_cost NUMERIC(12,6) NOT NULL DEFAULT 0;

-- 3. Trigger function: auto-increment session counters on log INSERT
CREATE OR REPLACE FUNCTION public.fn_update_session_llm_counters()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.interview_sessions
  SET
    llm_call_count = llm_call_count + 1,
    total_token_usage = total_token_usage + COALESCE(NEW.total_tokens, 0),
    estimated_total_cost = estimated_total_cost + COALESCE(NEW.estimated_cost, 0)
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_update_session_llm_counters ON public.llm_usage_logs;
CREATE TRIGGER trg_update_session_llm_counters
  AFTER INSERT ON public.llm_usage_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_session_llm_counters();
