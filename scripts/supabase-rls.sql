-- =============================================================================
-- M4 Fix: Tightened Row-Level Security (RLS) Policies
-- =============================================================================
-- Run this script in the Supabase SQL Editor AFTER dropping the old permissive policies.
--
-- Changes from original:
-- 1. HR SELECT scoped to created_by = auth.uid() (was USING (true))
-- 2. HR UPDATE scoped to created_by = auth.uid() (was USING (true))
-- 3. HR DELETE scoped to created_by = auth.uid() (was USING (true))
-- 4. No anon policies — all candidate access goes through server-side
--    endpoints using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)
-- =============================================================================

-- =====================
-- interview_sessions
-- =====================

-- Drop old permissive policies
DROP POLICY IF EXISTS "Authenticated users can read sessions" ON interview_sessions;
DROP POLICY IF EXISTS "Authenticated users can insert sessions" ON interview_sessions;
DROP POLICY IF EXISTS "Authenticated users can update sessions" ON interview_sessions;
DROP POLICY IF EXISTS "Authenticated users can delete sessions" ON interview_sessions;

-- HR can only read sessions they created
CREATE POLICY "HR can read own sessions"
  ON interview_sessions
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

-- HR can insert sessions (created_by is set on insert)
CREATE POLICY "HR can insert sessions"
  ON interview_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- HR can only update their own sessions
CREATE POLICY "HR can update own sessions"
  ON interview_sessions
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- HR can only delete their own sessions
CREATE POLICY "HR can delete own sessions"
  ON interview_sessions
  FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- =====================
-- session_claims
-- =====================

-- Drop old permissive policies
DROP POLICY IF EXISTS "Authenticated users can read claims" ON session_claims;
DROP POLICY IF EXISTS "Authenticated users can insert claims" ON session_claims;

-- HR can only read claims for sessions they own
CREATE POLICY "HR can read own session claims"
  ON session_claims
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions
      WHERE id = session_id AND created_by = auth.uid()
    )
  );

-- HR can insert claims for sessions they own
CREATE POLICY "HR can insert own session claims"
  ON session_claims
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_sessions
      WHERE id = session_id AND created_by = auth.uid()
    )
  );

-- =====================
-- session_transcripts
-- =====================

-- Drop old permissive policies
DROP POLICY IF EXISTS "Authenticated users can read transcripts" ON session_transcripts;
DROP POLICY IF EXISTS "Authenticated users can insert transcripts" ON session_transcripts;
DROP POLICY IF EXISTS "Authenticated users can delete transcripts" ON session_transcripts;

-- HR can only read transcripts for sessions they own
CREATE POLICY "HR can read own session transcripts"
  ON session_transcripts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions
      WHERE id = session_id AND created_by = auth.uid()
    )
  );

-- HR can insert transcripts for sessions they own
CREATE POLICY "HR can insert own session transcripts"
  ON session_transcripts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_sessions
      WHERE id = session_id AND created_by = auth.uid()
    )
  );

-- HR can delete transcripts for sessions they own
CREATE POLICY "HR can delete own session transcripts"
  ON session_transcripts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions
      WHERE id = session_id AND created_by = auth.uid()
    )
  );

-- =============================================================================
-- NOTE: All candidate-facing API endpoints (start, next-step, load-session,
-- update-status, tts-stream) use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- This is intentional — candidate access is authenticated via invite tokens
-- in verifyAuth(), not via Supabase auth.
-- =============================================================================
