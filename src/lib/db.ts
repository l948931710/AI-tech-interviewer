import { CandidateInfo, Claim, InterviewReport, StructuredInterviewTurn } from '../agent';

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

const STORAGE_KEY = 'ai_tech_interviewer_sessions';

function getSessions(): Record<string, InterviewSession> {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error("Failed to load sessions from local storage", e);
    return {};
  }
}

function saveSessions(sessions: Record<string, InterviewSession>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.error("Failed to save sessions to local storage", e);
  }
}

export const db = {
  // Create a new interview session (HR Side)
  createSession: (data: Omit<InterviewSession, 'id' | 'createdAt' | 'status' | 'transcript' | 'report'>): string => {
    const sessions = getSessions();
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    sessions[id] = {
      id,
      createdAt: Date.now(),
      status: 'PENDING',
      transcript: [],
      report: null,
      ...data
    };
    
    saveSessions(sessions);
    return id;
  },

  // Get a single session by ID
  getSession: (id: string): InterviewSession | null => {
    const sessions = getSessions();
    return sessions[id] || null;
  },

  // List all sessions (HR Side)
  listSessions: (): InterviewSession[] => {
    const sessions = getSessions();
    return Object.values(sessions).sort((a, b) => b.createdAt - a.createdAt);
  },

  // Mark the interview as actively started by the candidate
  startSession: (id: string) => {
    const sessions = getSessions();
    if (sessions[id] && sessions[id].status === 'PENDING') {
      sessions[id].status = 'IN_PROGRESS';
      saveSessions(sessions);
    }
  },

  // Save candidate transcript during the interview
  updateTranscript: (id: string, transcript: StructuredInterviewTurn[]) => {
    const sessions = getSessions();
    if (sessions[id]) {
      sessions[id].transcript = transcript;
      saveSessions(sessions);
    }
  },

  // Complete the interview and attach the final report
  completeSession: (id: string, report: InterviewReport) => {
    const sessions = getSessions();
    if (sessions[id]) {
      sessions[id].status = 'COMPLETED';
      sessions[id].report = report;
      saveSessions(sessions);
    }
  },

  // Mark the interview as not finished (ended early)
  markNotFinished: (id: string) => {
    const sessions = getSessions();
    if (sessions[id]) {
      sessions[id].status = 'NOT_FINISHED';
      saveSessions(sessions);
    }
  },

  // Utility to delete a session (Optional)
  deleteSession: (id: string) => {
    const sessions = getSessions();
    if (sessions[id]) {
        delete sessions[id];
        saveSessions(sessions);
    }
  }
};
