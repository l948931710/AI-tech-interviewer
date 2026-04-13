import { createClient } from '@supabase/supabase-js';

/**
 * Shared authentication helper for Vercel Edge API endpoints.
 * 
 * Supports two auth paths:
 *  1. Supabase JWT (for HR users logged in via dashboard)
 *  2. Interview invite token (for candidates accessing via interview link)
 * 
 * Returns the authenticated user on success, or a 401 Response on failure.
 */
export async function verifyAuth(req: Request): Promise<
  { user: { id: string; email?: string }; error?: never } |
  { user?: never; error: Response }
> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[Auth] Missing Supabase environment variables');
    return {
      error: new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  // --- Path 1: Supabase JWT (HR users) ---
  const authHeader = req.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (!authError && user) {
      return { user: { id: user.id, email: user.email ?? undefined } };
    }
    // If JWT validation fails, don't return error yet — fall through to Path 2
  }

  // --- Path 2: Interview invite token (candidates) ---
  const interviewToken = req.headers.get('X-Interview-Token');
  const sessionId = req.headers.get('X-Session-Id');

  if (interviewToken && sessionId) {
    // Use service role key if available (bypasses RLS), otherwise fall back to anon key
    const dbKey = supabaseServiceKey || supabaseAnonKey;
    const supabase = createClient(supabaseUrl, dbKey);

    const { data: sessionData, error: sessionError } = await supabase
      .from('interview_sessions')
      .select('id, invite_token, status')
      .eq('id', sessionId)
      .single();

    if (!sessionError && sessionData &&
        sessionData.invite_token === interviewToken &&
        (sessionData.status === 'IN_PROGRESS' || sessionData.status === 'PENDING' || sessionData.status === 'NOT_FINISHED')) {
      return { user: { id: `candidate-${sessionId}` } };
    }

    console.warn(`[Auth] Invalid interview token for session ${sessionId}`);
  }

  return {
    error: new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid credentials' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  };
}
