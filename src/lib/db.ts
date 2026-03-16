import { CandidateInfo, Claim, InterviewReport, StructuredInterviewTurn } from '../agent';
import { supabase } from './supabase';

export type InterviewStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_FINISHED';

export interface InterviewSession {
  id: string;
  createdAt: number;
  status: InterviewStatus;
  
  // Data from Setup (HR)
  jdText: string;
  jobRoleContext: string;
  candidateInfo: CandidateInfo;
  claims: Claim[];
  
  // Data accumulated during Candidate Interview
  transcript: StructuredInterviewTurn[];
  
  // Data generated post-interview
  report?: InterviewReport | null;
}

export const db = {
  // Create a new interview session (HR Side)
  createSession: async (data: Omit<InterviewSession, 'id' | 'createdAt' | 'status' | 'transcript' | 'report'>): Promise<string> => {
    // 1. Insert into interview_sessions
    const { data: sessionData, error: sessionError } = await supabase
      .from('interview_sessions')
      .insert({
        jd_text: data.jdText,
        job_role_context: data.jobRoleContext,
        candidate_info: data.candidateInfo,
        status: 'PENDING'
      })
      .select('id')
      .single();

    if (sessionError || !sessionData) {
      console.error('Error creating session:', sessionError);
      throw new Error('Failed to create session');
    }

    const sessionId = sessionData.id;

    // 2. Insert into session_claims
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

    return sessionId;
  },

  // Get a single session by ID
  getSession: async (id: string): Promise<InterviewSession | null> => {
    // Fetch session details
    const { data: sessionData, error: sessionError } = await supabase
      .from('interview_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (sessionError || !sessionData) {
      console.error('Error fetching session:', sessionError);
      return null;
    }

    // Fetch related claims
    const { data: claimsData, error: claimsError } = await supabase
      .from('session_claims')
      .select('*')
      .eq('session_id', id);

    if (claimsError) {
      console.error('Error fetching claims:', claimsError);
      return null;
    }

    // Fetch related transcript
    const { data: transcriptData, error: transcriptError } = await supabase
      .from('session_transcripts')
      .select('*')
      .eq('session_id', id)
      .order('timestamp', { ascending: true }); // Make sure we load the chat linearly

    if (transcriptError) {
      console.error('Error fetching transcript:', transcriptError);
      return null;
    }

    // Reconstruct the shape expected by the frontend
    const claims: Claim[] = (claimsData || []).map(row => ({
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

    const transcript: StructuredInterviewTurn[] = (transcriptData || []).map(row => ({
      questionId: row.question_id,
      timestamp: new Date(row.timestamp).getTime().toString(), // Keep string for JS frontend
      question: row.question,
      answer: row.answer,
      claimId: row.claim_id,
      claimText: row.claim_text,
      experienceName: row.experience_name,
      turnType: row.turn_type,
      answerStatus: row.answer_status
    }));

    return {
      id: sessionData.id,
      createdAt: new Date(sessionData.created_at).getTime(),
      status: sessionData.status as InterviewStatus,
      jdText: sessionData.jd_text,
      jobRoleContext: sessionData.job_role_context,
      candidateInfo: sessionData.candidate_info,
      report: sessionData.report,
      claims,
      transcript
    };
  },

  // List all sessions (HR Side)
  listSessions: async (): Promise<InterviewSession[]> => {
    // For the list view, we just need basic info and candidate details. We won't load the full transcript/claims block to save bandwidth.
    const { data: sessionsData, error } = await supabase
      .from('interview_sessions')
      .select('id, created_at, status, candidate_info, report')
      .order('created_at', { ascending: false });

    if (error || !sessionsData) {
      console.error('Error fetching sessions:', error);
      return [];
    }

    return sessionsData.map(session => ({
      id: session.id,
      createdAt: new Date(session.created_at).getTime(),
      status: session.status as InterviewStatus,
      jdText: '',
      jobRoleContext: '',
      candidateInfo: session.candidate_info,
      report: session.report,
      claims: [],
      transcript: []
    }));
  },

  // Mark the interview as actively started by the candidate
  startSession: async (id: string): Promise<void> => {
    // Only update if it's currently PENDING.
    await supabase
      .from('interview_sessions')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', id)
      .eq('status', 'PENDING');
  },

  // Save candidate transcript during the interview
  updateTranscript: async (id: string, transcript: StructuredInterviewTurn[]): Promise<void> => {
    if (!transcript || transcript.length === 0) return;

    // For safety with a simple implementation, we assume `transcript` is rolling and we're syncing the whole thing.
    // In a highly parallel system, you'd want to INSERT only new items. But to keep frontend logic 1:1, we'll
    // clear the transcript history and rewrite it, OR we can append the delta.
    // Given React re-renders call syncTranscript repeatedly, a transaction delete/insert ensures a clean sync state.
    // Actually, simple DELETE + Bulk INSERT matches the frontend's overwriting pattern perfectly.
    
    // 1. Delete old transcript rows for this session
    await supabase
      .from('session_transcripts')
      .delete()
      .eq('session_id', id);

    // 2. Insert new transcript rows
    const rowsToInsert = transcript.map(turn => ({
      session_id: id,
      question_id: turn.questionId,
      question: turn.question,
      answer: turn.answer,
      claim_id: turn.claimId,
      claim_text: turn.claimText,
      experience_name: turn.experienceName,
      turn_type: turn.turnType,
      answer_status: turn.answerStatus,
      // Default to now if not provided, else convert JS timestamp string to proper ISO
      timestamp: turn.timestamp ? new Date(parseInt(turn.timestamp)).toISOString() : new Date().toISOString()
    }));

    const { error } = await supabase
      .from('session_transcripts')
      .insert(rowsToInsert);

    if (error) {
      console.error('Error updating transcript:', error);
    }
  },

  // Complete the interview and attach the final report
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

  // Mark the interview as not finished (ended early)
  markNotFinished: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('interview_sessions')
      .update({ status: 'NOT_FINISHED' })
      .eq('id', id);

    if (error) {
       console.error('Error marking not finished:', error);
    }
  },

  // Utility to delete a session (Optional)
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
