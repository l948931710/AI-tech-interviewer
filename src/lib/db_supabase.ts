import type { InterviewSession } from './db';
import { supabase } from './supabase';
import { Claim, StructuredInterviewTurn, InterviewReport } from '../agent';

export const dbSupabase = {
  createSession: async (data: Omit<InterviewSession, 'id' | 'createdAt' | 'status' | 'transcript' | 'report'>): Promise<{ id: string; inviteToken: string }> => {
    // Get the authenticated HR user's ID to store as session owner
    const { data: { user } } = await supabase.auth.getUser();

    const { data: sessionData, error: sessionError } = await supabase
      .from('interview_sessions')
      .insert({
        jd_text: data.jdText,
        job_role_context: data.jobRoleContext,
        candidate_info: data.candidateInfo,
        status: 'PENDING',
        created_by: user?.id || null,   // C1 fix: track session owner
      })
      .select('id')
      .single();

    if (sessionError || !sessionData) {
      console.error('Error creating session:', sessionError);
      throw new Error('Failed to create session');
    }

    const sessionId = sessionData.id;

    const claimsToInsert = data.claims.map(claim => ({
      session_id: sessionId,
      topic: claim.topic,
      claim: claim.claim,
      experience_name: claim.experienceName,
      source_bullet: claim.sourceBullet,
      claim_type: claim.claimType,
      must_verify: claim.mustVerify,
      nice_to_have: claim.niceToHave,
      evidence_hints: claim.evidenceHints,
      ranking_signals: claim.rankingSignals,
      rationale: claim.rationale
    }));

    if (claimsToInsert.length > 0) {
      const { error: claimsError } = await supabase
        .from('session_claims')
        .insert(claimsToInsert);

      if (claimsError) {
        console.error('Error creating claims:', claimsError);
        throw new Error('Failed to create claims');
      }
    }

    // Dynamically generate the token via backend API to securely store the hash
    let generatedToken = 'local-dev-fallback-token';
    try {
      const { getAuthHeaders } = await import('../agent/core');
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/agent/generate-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sessionId })
      });
      if (res.ok) {
        const data = await res.json();
        generatedToken = data.token;
      } else {
        console.warn("Failed to generate token from API. Are backend APIs deployed?");
      }
    } catch (e) {
      console.warn("Error calling generate-invite API, falling back:", e);
    }

    return { id: sessionId, inviteToken: generatedToken };
  },

  getSession: async (id: string): Promise<InterviewSession | null> => {
    const { data: sessionData, error: sessionError } = await supabase
      .from('interview_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (sessionError || !sessionData) {
      console.error('Error fetching session:', sessionError);
      return null;
    }

    const { data: claimsData, error: claimsError } = await supabase
      .from('session_claims')
      .select('*')
      .eq('session_id', id)
      .order('experience_name', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (claimsError) {
      console.error('Error fetching claims:', claimsError);
      return null;
    }

    const { data: transcriptData, error: transcriptError } = await supabase
      .from('session_transcripts')
      .select('*')
      .eq('session_id', id)
      .order('timestamp', { ascending: true });

    if (transcriptError) {
      console.error('Error fetching transcript:', transcriptError);
      return null;
    }

    const claims: Claim[] = (claimsData || []).map((row: any) => ({
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

    const transcript: StructuredInterviewTurn[] = (transcriptData || []).map((row: any) => ({
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

    return {
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
  },

  listSessions: async (): Promise<InterviewSession[]> => {
    const { data: sessionsData, error } = await supabase
      .from('interview_sessions')
      .select('id, created_at, status, candidate_info, report')
      .order('created_at', { ascending: false });

    if (error || !sessionsData || sessionsData.length === 0) {
      console.error('Error fetching sessions:', error);
      return [];
    }

    const sessionIds = sessionsData.map((s: any) => s.id);
    const { data: transcriptsData } = await supabase
      .from('session_transcripts')
      .select('session_id, timestamp')
      .in('session_id', sessionIds)
      .order('timestamp', { ascending: true });

    const transcriptMap: Record<string, any[]> = {};
    if (transcriptsData) {
      transcriptsData.forEach((ts: any) => {
        if (!transcriptMap[ts.session_id]) transcriptMap[ts.session_id] = [];
        transcriptMap[ts.session_id].push({ timestamp: ts.timestamp });
      });
    }

    return sessionsData.map((session: any) => ({
      id: session.id,
      createdAt: new Date(session.created_at).getTime(),
      status: session.status,
      jdText: '',
      jobRoleContext: '',
      candidateInfo: session.candidate_info,
      report: session.report,
      claims: [],
      transcript: transcriptMap[session.id] || []
    }));
  },


  completeSession: async (id: string, report: InterviewReport): Promise<void> => {
    const { error } = await supabase
      .from('interview_sessions')
      .update({
        status: 'COMPLETED',
        report: report
      })
      .eq('id', id);

    if (error) {
      console.error('Error completing session:', error);
    }
  },

  deleteSession: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('interview_sessions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting session:', error);
    }
  }
};
