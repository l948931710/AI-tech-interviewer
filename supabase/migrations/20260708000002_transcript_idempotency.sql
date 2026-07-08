-- Turn idempotency (C1) — one transcript row per (session_id, request_id).
--
-- ⚠️ REVIEW BEFORE PUSH: this migration contains a DELETE. It removes DUPLICATE
-- (session_id, request_id) transcript rows, keeping the EARLIEST of each group,
-- so the UNIQUE constraint below can be added. NULL request_ids are untouched.
-- Both statements are idempotent / safe to re-run.
--
-- PREFLIGHT (run in the SQL Editor first to see exactly what the DELETE affects;
-- 0 rows ⇒ the DELETE is a no-op):
--   SELECT session_id, request_id, count(*)
--   FROM public.session_transcripts
--   WHERE request_id IS NOT NULL
--   GROUP BY session_id, request_id HAVING count(*) > 1;

DELETE FROM public.session_transcripts a
USING public.session_transcripts b
WHERE a.request_id IS NOT NULL
  AND a.session_id = b.session_id
  AND a.request_id = b.request_id
  AND (a.timestamp, a.ctid) > (b.timestamp, b.ctid);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_transcripts_session_request_uniq'
  ) THEN
    ALTER TABLE public.session_transcripts
      ADD CONSTRAINT session_transcripts_session_request_uniq
      UNIQUE (session_id, request_id);
  END IF;
END $$;
