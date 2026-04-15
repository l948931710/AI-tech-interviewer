-- Supabase SQL Migration to add invite_tokens and access logging

-- 1. Create invite_tokens table
CREATE TABLE IF NOT EXISTS public.invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,         -- SHA-256 hash of the generated raw token
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  is_used BOOLEAN DEFAULT FALSE,    -- Soft marker for initial use
  max_uses INT DEFAULT 1,           -- How many distinct times this can be used
  use_count INT DEFAULT 0,          -- Track total starts

  created_by UUID REFERENCES auth.users(id), -- HR user who generated it
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  revoked BOOLEAN DEFAULT FALSE
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS invite_tokens_hash_idx ON public.invite_tokens(token_hash);
CREATE INDEX IF NOT EXISTS invite_tokens_session_idx ON public.invite_tokens(session_id);

-- 2. Create invite_access_logs table
CREATE TABLE IF NOT EXISTS public.invite_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID REFERENCES public.invite_tokens(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  accessed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ip TEXT,
  user_agent TEXT,
  status TEXT  -- SUCCESS / DENIED
);

-- Index for log lookups
CREATE INDEX IF NOT EXISTS invite_access_logs_session_idx ON public.invite_access_logs(session_id);

-- 3. RLS Policies

-- Enable RLS
ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_access_logs ENABLE ROW LEVEL SECURITY;

-- invite_tokens: HR users can select tokens for their sessions, and insert tokens for their sessions
CREATE POLICY "Users can create tokens for their sessions"
ON public.invite_tokens FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.interview_sessions 
    WHERE id = session_id AND created_by = auth.uid()
  )
);

CREATE POLICY "Users can view tokens for their sessions"
ON public.invite_tokens FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.interview_sessions 
    WHERE id = session_id AND created_by = auth.uid()
  )
);

-- Note: edge APIs using SUPABASE_SERVICE_ROLE_KEY bypass RLS to read tokens and write to access logs
