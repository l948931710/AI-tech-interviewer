-- M1 Fix: Atomic token claim function
-- Combines the "check use_count < max_uses" and "increment use_count" into a single SQL statement.
-- This eliminates the TOCTOU race where two concurrent requests can both read use_count=0
-- and both set use_count=1, bypassing the max_uses limit.
--
-- Usage: SELECT * FROM claim_invite_token('abc123hash', 'session-uuid');
-- Returns: the token row if successfully claimed, empty result if token is invalid/exhausted.

CREATE OR REPLACE FUNCTION public.claim_invite_token(
  p_token_hash TEXT,
  p_session_id UUID
)
RETURNS TABLE (
  token_id UUID,
  old_use_count INT,
  new_use_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs with table owner privileges (bypasses RLS)
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.invite_tokens
  SET
    is_used = TRUE,
    use_count = use_count + 1
  WHERE
    token_hash = p_token_hash
    AND session_id = p_session_id
    AND use_count < max_uses
    AND revoked = FALSE
    AND expires_at > now()
  RETURNING
    id AS token_id,
    use_count - 1 AS old_use_count,  -- What it was before this update
    use_count AS new_use_count;       -- What it is now
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.claim_invite_token(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_invite_token(TEXT, UUID) TO service_role;
