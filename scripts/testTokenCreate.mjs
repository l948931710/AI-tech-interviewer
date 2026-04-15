import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // 1. Get most recent session
  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select('id, status')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!sessions || sessions.length === 0) {
    console.log("No sessions found!");
    return;
  }

  const sessionId = sessions[0].id;
  console.log("Using session:", sessionId, "status:", sessions[0].status);

  // 2. Try to directly insert a test token
  const rawToken = 'test-debug-token-' + Date.now();
  const msgBuffer = new TextEncoder().encode(rawToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  console.log("Attempting to insert token with hash:", tokenHash.substring(0, 16) + "...");
  
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: insertedToken, error: insertError } = await supabase
    .from('invite_tokens')
    .insert({
      session_id: sessionId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: null
    })
    .select('*')
    .single();

  if (insertError) {
    console.error("INSERT FAILED:", insertError);
    console.error("Error details:", JSON.stringify(insertError, null, 2));
  } else {
    console.log("INSERT SUCCESS:", insertedToken);
  }

  // 3. Verify by reading it back
  const { data: tokens, error: readError } = await supabase
    .from('invite_tokens')
    .select('*')
    .eq('session_id', sessionId);

  console.log("Tokens for session:", tokens);
  if (readError) console.error("Read error:", readError);
}

main().catch(console.error);
