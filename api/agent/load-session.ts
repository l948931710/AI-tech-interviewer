import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "../api-auth";

export const config = { runtime: 'edge' };

/**
 * M4 fix: Server-side session loader for the candidate portal.
 * 
 * Instead of the client reading session data directly via the Supabase anon key
 * (which would require permissive anon RLS policies or no RLS at all), the candidate
 * portal calls this endpoint. It validates the invite token via verifyAuth() first,
 * then returns the session data using the service role key.
 * 
 * This eliminates the need for any anon-key direct DB access for candidates.
 */
export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // 1. Authenticate the candidate via invite token
  const auth = await verifyAuth(req);
  if (auth.error) return auth.error;

  // 2. Parse session ID from request body
  const { sessionId } = await req.json();
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing sessionId' }), { status: 400 });
  }

  // S3 fix: Verify the sessionId matches the authenticated candidate identity
  if (sessionId !== auth.user.id.replace('candidate-', '')) {
    return new Response(JSON.stringify({ error: 'Context mismatch' }), { status: 403 });
  }

  // 3. Fetch full session data using service role key (bypasses RLS)
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), { status: 500 });
  }
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch session
  const { data: sessionData, error: sessionError } = await supabaseAdmin
    .from('interview_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sessionError || !sessionData) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  // Fetch claims
  const { data: claimsData } = await supabaseAdmin
    .from('session_claims')
    .select('*')
    .eq('session_id', sessionId)
    .order('experience_name', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true });

  // Fetch transcript
  const { data: transcriptData } = await supabaseAdmin
    .from('session_transcripts')
    .select('*')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: true });

  // 4. Shape the response (same format as db_supabase.getSession)
  const claims = (claimsData || []).map((row: any) => ({
    id: row.id,
    topic: row.topic,
    claim: row.claim,
    experienceName: row.experience_name,
    sourceBullet: row.source_bullet,
    claimType: row.claim_type,
    mustVerify: row.must_verify || [],
    niceToHave: row.nice_to_have,
    evidenceHints: row.evidence_hints,
    rankingSignals: row.ranking_signals || { relevanceToRole: 0, technicalImportance: 0, ambiguityRisk: 0, businessImpact: 0, interviewValue: 0 },
    rationale: row.rationale
  }));

  const transcript = (transcriptData || []).map((row: any) => ({
    requestId: row.request_id,
    questionId: row.question_id,
    timestamp: new Date(row.timestamp).getTime().toString(),
    question: row.question,
    answer: row.answer,
    claimId: row.claim_id,
    claimText: row.claim_text,
    experienceName: row.experience_name,
    turnType: row.turn_type,
    answerStatus: row.answer_status,
    decision: row.decision,
    coveredPoints: row.covered_points || [],
    missingPoints: row.missing_points || []
  }));

  const session = {
    id: sessionData.id,
    createdAt: new Date(sessionData.created_at).getTime(),
    status: sessionData.status,
    jdText: sessionData.jd_text,
    jobRoleContext: sessionData.job_role_context,
    candidateInfo: sessionData.candidate_info,
    report: sessionData.report,
    claims,
    transcript
  };

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
