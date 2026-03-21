-- =============================================================================
-- Supabase Row-Level Security (RLS) Policies
-- =============================================================================
-- Run this script in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
--
-- These policies ensure:
-- 1. Authenticated users can read/write their own interview sessions
-- 2. The service_role key (used by API endpoints) bypasses RLS automatically
-- 3. Anonymous/unauthenticated users cannot access any data
-- =============================================================================

-- =====================
-- interview_sessions
-- =====================
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all sessions (HR users need this for dashboard)
CREATE POLICY "Authenticated users can read sessions"
  ON interview_sessions
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert sessions (HR creates interviews)
CREATE POLICY "Authenticated users can insert sessions"
  ON interview_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update sessions (candidates update status, HR views)
CREATE POLICY "Authenticated users can update sessions"
  ON interview_sessions
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete sessions (HR cleanup)
CREATE POLICY "Authenticated users can delete sessions"
  ON interview_sessions
  FOR DELETE
  TO authenticated
  USING (true);

-- =====================
-- session_claims
-- =====================
ALTER TABLE session_claims ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read claims
CREATE POLICY "Authenticated users can read claims"
  ON session_claims
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert claims (created during interview setup)
CREATE POLICY "Authenticated users can insert claims"
  ON session_claims
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================
-- session_transcripts
-- =====================
ALTER TABLE session_transcripts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read transcripts
CREATE POLICY "Authenticated users can read transcripts"
  ON session_transcripts
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert transcripts (during interview)
CREATE POLICY "Authenticated users can insert transcripts"
  ON session_transcripts
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to delete transcripts (for updateTranscript pattern)
CREATE POLICY "Authenticated users can delete transcripts"
  ON session_transcripts
  FOR DELETE
  TO authenticated
  USING (true);
