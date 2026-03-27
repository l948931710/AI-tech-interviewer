import { CandidateInfo, Claim, InterviewReport, StructuredInterviewTurn } from '../agent';
import { dbLocal } from './db_local';
import { dbSupabase } from './db_supabase';

export type InterviewStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_FINISHED' | 'INTERVIEW_ENDED';

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

  // C3 fix: secure invite token for candidate access
  inviteToken?: string;
}

const USE_LOCAL = import.meta.env.VITE_USE_LOCAL_DB === 'true';

export const db = {
  createSession: (data: Omit<InterviewSession, 'id' | 'createdAt' | 'status' | 'transcript' | 'report' | 'inviteToken'>) => 
    USE_LOCAL ? dbLocal.createSession(data) : dbSupabase.createSession(data),

  getSession: (id: string) => 
    USE_LOCAL ? dbLocal.getSession(id) : dbSupabase.getSession(id),

  listSessions: () => 
    USE_LOCAL ? dbLocal.listSessions() : dbSupabase.listSessions(),

  startSession: (id: string) => 
    USE_LOCAL ? dbLocal.startSession(id) : dbSupabase.startSession(id),

  updateTranscript: (id: string, transcript: StructuredInterviewTurn[]) => 
    USE_LOCAL ? dbLocal.updateTranscript(id, transcript) : dbSupabase.updateTranscript(id, transcript),

  completeSession: (id: string, report: InterviewReport) => 
    USE_LOCAL ? dbLocal.completeSession(id, report) : dbSupabase.completeSession(id, report),

  markNotFinished: (id: string) =>
    USE_LOCAL ? dbLocal.markNotFinished(id) : dbSupabase.markNotFinished(id),

  markInterviewEnded: (id: string) =>
    USE_LOCAL ? dbLocal.markInterviewEnded(id) : dbSupabase.markInterviewEnded(id),

  deleteSession: (id: string) => 
    USE_LOCAL ? dbLocal.deleteSession(id) : dbSupabase.deleteSession(id)
};
