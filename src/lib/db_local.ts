import type { InterviewSession } from './db';
import { StructuredInterviewTurn, InterviewReport } from '../agent';

const STORAGE_KEY = 'ai_tech_interviewer_sessions';

function getSessions(): Record<string, InterviewSession> {
  if (typeof window === 'undefined') return {};
  try {
    const data = window.localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error("Failed to load sessions from local storage", e);
    return {};
  }
}

function saveSessions(sessions: Record<string, InterviewSession>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.error("Failed to save sessions to local storage", e);
  }
}

export const dbLocal = {
  createSession: async (data: Omit<InterviewSession, 'id' | 'createdAt' | 'status' | 'transcript' | 'report'>): Promise<string> => {
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

  getSession: async (id: string): Promise<InterviewSession | null> => {
    const sessions = getSessions();
    return sessions[id] || null;
  },

  listSessions: async (): Promise<InterviewSession[]> => {
    const sessions = getSessions();
    return Object.values(sessions).sort((a, b) => b.createdAt - a.createdAt);
  },

  startSession: async (id: string): Promise<void> => {
    const sessions = getSessions();
    if (sessions[id] && sessions[id].status === 'PENDING') {
      sessions[id].status = 'IN_PROGRESS';
      saveSessions(sessions);
    }
  },

  updateTranscript: async (id: string, transcript: StructuredInterviewTurn[]): Promise<void> => {
    const sessions = getSessions();
    if (sessions[id]) {
      sessions[id].transcript = transcript;
      saveSessions(sessions);
    }
  },

  completeSession: async (id: string, report: InterviewReport): Promise<void> => {
    const sessions = getSessions();
    if (sessions[id]) {
      sessions[id].status = 'COMPLETED';
      sessions[id].report = report;
      saveSessions(sessions);
    }
  },

  markNotFinished: async (id: string): Promise<void> => {
    const sessions = getSessions();
    if (sessions[id]) {
      sessions[id].status = 'NOT_FINISHED';
      saveSessions(sessions);
    }
  },

  deleteSession: async (id: string): Promise<void> => {
    const sessions = getSessions();
    if (sessions[id]) {
        delete sessions[id];
        saveSessions(sessions);
    }
  }
};
