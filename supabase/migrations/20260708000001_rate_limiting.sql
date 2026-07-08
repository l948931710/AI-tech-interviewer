-- Rate limiting (C4) — Postgres-backed fixed-window counter, no external Redis.
-- Purely additive: a table + an atomic RPC. Zero risk to existing data.
-- Used by api/rate-limit.ts (underRateLimit → rpc('incr_rate_limit')).

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket_key   TEXT   NOT NULL,
  window_start BIGINT NOT NULL,          -- epoch seconds, floored to the window
  count        INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits(window_start);

-- Server-side only: no anon/authenticated access. All access is via the
-- SECURITY DEFINER RPC below, invoked with the service-role key.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.incr_rate_limit(
  p_bucket_key    TEXT,
  p_window_seconds INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start BIGINT;
  v_count        INT;
BEGIN
  v_window_start := (floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds)::BIGINT;

  INSERT INTO public.rate_limits (bucket_key, window_start, count)
    VALUES (p_bucket_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.incr_rate_limit(TEXT, INT) TO service_role;
