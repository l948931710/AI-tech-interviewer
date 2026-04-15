import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "../api-auth";

export const config = { runtime: 'edge' };

async function sha256(message: string) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// S9 fix: Module-level cache
let cachedAdmin: any = null;
function getSupabaseAdmin() {
  if (!cachedAdmin) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase config.");
    cachedAdmin = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
  }
  return cachedAdmin;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // Require HR Auth
  const auth = await verifyAuth(req);
  if (auth.error) return auth.error;

  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Session ID required" }), { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify the session is owned by this user (or allow if admin)
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, created_by')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      return new Response(JSON.stringify({ error: "Session not found" }), { status: 404 });
    }

    // S1 fix: Verify the session is owned by the calling HR user
    if (sessionData.created_by !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Not authorized to generate invite for this session" }), { status: 403 });
    }

    // Generate crypto-secure raw token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const rawToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Hash it
    const tokenHash = await sha256(rawToken);

    // Revoke all existing tokens for this session
    await supabaseAdmin
      .from('invite_tokens')
      .update({ revoked: true })
      .eq('session_id', sessionId)
      .eq('revoked', false);

    // Calculate expiration (24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Insert new token
    const { error: insertError } = await supabaseAdmin
      .from('invite_tokens')
      .insert({
        session_id: sessionId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: auth.user.id
      });

    if (insertError) {
      console.error("[Generate Invite] Insert Error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create token" }), { status: 500 });
    }

    return new Response(JSON.stringify({ token: rawToken, expiresAt }), { 
      status: 200, 
      headers: { "Content-Type": "application/json" } 
    });

  } catch (error: any) {
    console.error("[Generate Invite] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    });
  }
}
