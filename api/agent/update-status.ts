import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "../api-auth";

export const config = { runtime: 'edge' };

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

  const auth = await verifyAuth(req);
  if (auth.error) return auth.error;

  try {
    const { sessionId, status } = await req.json();

    if (sessionId !== auth.user.id.replace('candidate-', '')) {
      return new Response(JSON.stringify({ error: "Context mismatch" }), { status: 403 });
    }

    const allowedStatuses = ['NOT_FINISHED', 'INTERVIEW_ENDED'];
    if (!allowedStatuses.includes(status)) {
       return new Response(JSON.stringify({ error: "Invalid status" }), { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: updated, error } = await supabaseAdmin
      .from('interview_sessions')
      .update({ status })
      .eq('id', sessionId)
      .in('status', ['IN_PROGRESS'])  // S5 fix: Only allow transitions from IN_PROGRESS
      .select('id')
      .single();
      
    if (error || !updated) {
      return new Response(JSON.stringify({ error: 'Status transition not allowed from current state' }), { status: 409 });
    }
    
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("[Update-Status] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
