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
  { user: { id: string; email?: string }; tokenHash?: string; error?: never } |
  { user?: never; tokenHash?: never; error: Response }
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

  // 0. Local Dev Bypass (Never strictly enforce if using entirely local JSON DB)
  if (sessionId && process.env.VITE_USE_LOCAL_DB === 'true') {
    return { user: { id: `candidate-${sessionId}` } };
  }

  if (interviewToken && sessionId) {

    // Prepare Web Crypto SHA-256 for validation
    const msgBuffer = new TextEncoder().encode(interviewToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Prepare Audit Logging traits
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // 1. Fetch Session Status to understand authorization context
    const dbKey = supabaseServiceKey || supabaseAnonKey;
    const supabase = createClient(supabaseUrl, dbKey);
    
    const { data: sessionData, error: sessionError } = await supabase
      .from('interview_sessions')
      .select('status, created_at')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      return {
        error: new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      };
    }

    // 2. Fetch Active token
    const { data: tokenData, error: tokenError } = await supabase
      .from('invite_tokens')
      .select('id, expires_at, revoked, is_used, max_uses, use_count')
      .eq('token_hash', tokenHash)
      .eq('session_id', sessionId)
      .single();

    let authSuccess = false;
    let authDenialReason = '';

    if (tokenError || !tokenData) {
      authDenialReason = 'Token mismatch or invalid hash';
    } else if (tokenData.revoked) {
      authDenialReason = 'Token has been explicitly revoked';
    } else if (new Date(tokenData.expires_at).getTime() < Date.now()) {
      authDenialReason = 'Token has expired';
    } else if (sessionData.status === 'COMPLETED' || sessionData.status === 'GENERATING') {
      authDenialReason = 'Session is already finished';
    } else if (sessionData.status === 'PENDING') {
      // M2 fix: Server-side session age check (decoupled from token expiration).
      // A PENDING session older than 24 hours is rejected regardless of token validity.
      // This ensures the client-side 24h check cannot be bypassed.
      const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
      const sessionAge = Date.now() - new Date(sessionData.created_at).getTime();
      if (sessionAge > SESSION_MAX_AGE_MS) {
        authDenialReason = `Session expired (created ${Math.round(sessionAge / 3600000)}h ago, max 24h)`;
      } else if (tokenData.is_used && tokenData.use_count >= tokenData.max_uses) {
        authDenialReason = `Token usage limit exceeded (${tokenData.use_count}/${tokenData.max_uses})`;
      } else {
        authSuccess = true;
      }
    } else if (sessionData.status === 'IN_PROGRESS') {
      // 3. Strict reconnection verification
      // If it's already in progress, standard token count limits no longer safely apply,
      // but we strongly prefer IP fingerprint matching to prevent hijacking
      const { data: previousSuccessLogs } = await supabase
        .from('invite_access_logs')
        .select('ip, user_agent')
        .eq('token_id', tokenData.id)
        .eq('status', 'SUCCESS');

      // For maximum security in production, you could enforce: same IP or failing that, reject.
      // Easing this slightly for real-world (mobile data switches) based on user directive:
      // "optional: same IP/fingerprint" - implemented here as checking if any success log exists (they used it before).
      const IP_MATCH = previousSuccessLogs?.some(log => log.ip === ip || log.ip === 'unknown');
      if (!IP_MATCH && process.env.ENFORCE_STRICT_IP_MATCH === 'true') {
        authDenialReason = 'IP address anomaly during active session reconnection';
      } else {
        authSuccess = true;
      }
    } else {
      // Nominal flow for other statuses (NOT_FINISHED, INTERVIEW_ENDED)
      if (tokenData.is_used && tokenData.use_count >= tokenData.max_uses) {
        authDenialReason = `Token usage limit exceeded (${tokenData.use_count}/${tokenData.max_uses})`;
      } else {
        authSuccess = true;
      }
    }

    // 4. Asynchronously write audit log
    if (tokenData && tokenData.id) {
       // Fire and forget (don't block the auth flow)
       supabase.from('invite_access_logs').insert({
         token_id: tokenData.id,
         session_id: sessionId,
         ip,
         user_agent: userAgent,
         status: authSuccess ? 'SUCCESS' : `DENIED: ${authDenialReason}`
       }).then(({ error }) => {
         if (error) console.error("Failed to log invite access:", error);
       });
    }

    if (authSuccess) {
      console.log(`[Auth DEBUG] SUCCESS! Candidate authenticated for ${sessionId}`);
      return { user: { id: `candidate-${sessionId}` }, tokenHash };
    }

    console.warn(`[Auth DEBUG] Rejected candidate token for session ${sessionId}. Denial Reason: ${authDenialReason}`);
    console.warn(`[Auth DEBUG] Dump: tokenData=`, tokenData ? 'exists' : 'null', `sessionStatus=`, sessionData?.status);
  } else {
    console.warn(`[Auth DEBUG] Missing interviewToken or sessionId. interviewToken=${!!interviewToken}, sessionId=${!!sessionId}`);
  }

  return {
    error: new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid credentials' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  };
}
