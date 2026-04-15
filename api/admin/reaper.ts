import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  // 1. Verify Vercel Cron Secret (optional but recommended for security)
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Server Configuration Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  // Calculate the timeout window (45 minutes grace period)
  const TIMEOUT_MS = 45 * 60 * 1000;
  const cutoffTime = new Date(Date.now() - TIMEOUT_MS).toISOString();

  try {
    // Collect IDs of stale IN_PROGRESS sessions
    let reapedCount = 0;

    // First slice: IN_PROGRESS sessions with started_at < 45m ago
    const { data: staleSessions, error: fetchError } = await supabaseAdmin
      .from('interview_sessions')
      .select('id')
      .eq('status', 'IN_PROGRESS')
      .lt('started_at', cutoffTime);

    if (fetchError) throw fetchError;

    if (staleSessions && staleSessions.length > 0) {
      const idsToReap = staleSessions.map(s => s.id);
      const { error: updateError } = await supabaseAdmin
        .from('interview_sessions')
        .update({ status: 'NOT_FINISHED' })
        .in('id', idsToReap);

      if (updateError) throw updateError;
      reapedCount += idsToReap.length;
    }

    // Second slice: IN_PROGRESS sessions missing started_at but created_at < 45m ago
    const { data: staleNullSessions, error: fetchNullError } = await supabaseAdmin
      .from('interview_sessions')
      .select('id')
      .eq('status', 'IN_PROGRESS')
      .is('started_at', null)
      .lt('created_at', cutoffTime);

    if (fetchNullError) throw fetchNullError;

    if (staleNullSessions && staleNullSessions.length > 0) {
      const idsToReapNull = staleNullSessions.map(s => s.id);
      const { error: updateNullError } = await supabaseAdmin
        .from('interview_sessions')
        .update({ status: 'NOT_FINISHED' })
        .in('id', idsToReapNull);
        
      if (updateNullError) throw updateNullError;
      reapedCount += idsToReapNull.length;
    }

    return new Response(JSON.stringify({ message: `Successfully reaped ${reapedCount} stale session(s)` }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err: any) {
    console.error("[Session Reaper] Error cleaning up sessions:", err);
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}
