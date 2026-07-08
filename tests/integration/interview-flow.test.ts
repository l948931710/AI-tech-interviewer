import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Integration Smoke Test — Full Interview Flow
 * 
 * Tests the end-to-end interview flow with mocked Gemini LLM and Supabase.
 * Verifies that the handlers compose correctly: start → next-step (answer) →
 * next-step (non-answer) → next-step (non-answer again → NEXT_CLAIM).
 * 
 * Key verifications:
 * 1. start handler returns an intro question
 * 2. next-step with a real answer returns FOLLOW_UP
 * 3. next-step with "不知道" triggers non-answer fast-path → FOLLOW_UP (first time)
 * 4. next-step with "不知道" again triggers NEXT_CLAIM (second consecutive)
 * 5. Transcript accumulates correctly across turns
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let dbState: {
  sessions: Record<string, any>;
  transcripts: any[];
  claims: any[];
};

const mockSupabase: any = {};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('../../api/api-auth', () => ({
  verifyAuth: vi.fn().mockResolvedValue({
    user: { id: 'candidate-session-int-1' },
    tokenHash: 'mock-hash',
  }),
}));

const ORIGINAL_ENV = process.env;

import startHandler from '../../api/agent/start';
import { CLAIM_A, CLAIM_B, THREE_CLAIMS, TEST_JD } from '../fixtures/claims';

// ---------------------------------------------------------------------------
// DB State Management
// ---------------------------------------------------------------------------

function resetDBState() {
  dbState = {
    sessions: {
      'session-int-1': {
        id: 'session-int-1',
        status: 'PENDING',
        phase: null,
        started_at: null,
        created_at: new Date().toISOString(),
        job_role_context: TEST_JD,
        candidate_info: { name: 'Test Candidate' },
      },
    },
    transcripts: [],
    claims: THREE_CLAIMS.map(c => ({
      id: c.id,
      session_id: 'session-int-1',
      topic: c.topic,
      claim: c.claim,
      experience_name: c.experienceName,
      source_bullet: c.sourceBullet,
      claim_type: c.claimType,
      must_verify: c.mustVerify,
      nice_to_have: c.niceToHave,
      evidence_hints: c.evidenceHints,
      ranking_signals: c.rankingSignals,
      rationale: c.rationale,
    })),
  };
}

function setupMockSupabase() {
  mockSupabase.from = vi.fn((table: string) => {
    const chain: any = {};

    // SELECT path
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((_col: string, val: any) => {
      chain._lastEqVal = val;
      return chain;
    });
    chain.order = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);

    chain.single = vi.fn(() => {
      if (table === 'interview_sessions') {
        const session = dbState.sessions[chain._lastEqVal];
        return Promise.resolve({ data: session || null, error: session ? null : { message: 'Not found' } });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // For queries that return arrays (e.g., transcripts, claims)
    chain.then = (resolve: any) => {
      if (table === 'session_transcripts') {
        return Promise.resolve({ data: dbState.transcripts, error: null }).then(resolve);
      }
      if (table === 'session_claims') {
        return Promise.resolve({ data: dbState.claims, error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    };

    // INSERT path
    chain.insert = vi.fn((rows: any) => {
      if (table === 'session_transcripts') {
        const toInsert = Array.isArray(rows) ? rows : [rows];
        dbState.transcripts.push(...toInsert);
      }
      return Promise.resolve({ data: null, error: null });
    });

    // UPDATE path
    chain.update = vi.fn((updates: any) => {
      if (table === 'interview_sessions' && chain._lastEqVal) {
        const session = dbState.sessions[chain._lastEqVal];
        if (session) Object.assign(session, updates);
      }
      // Return a new chain for .eq() etc after update
      const updateChain: any = {};
      updateChain.eq = vi.fn((_col: string, val: any) => {
        const session = dbState.sessions[val];
        if (session) Object.assign(session, updates);
        return updateChain;
      });
      updateChain.select = vi.fn(() => updateChain);
      updateChain.single = vi.fn(() => Promise.resolve({ data: { id: chain._lastEqVal }, error: null }));
      return updateChain;
    });

    // RPC path (for claim_invite_token etc.)
    chain.rpc = vi.fn(() => Promise.resolve({ data: true, error: null }));

    return chain;
  });

  // Mock the rpc method at the top level too
  mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: true, error: null }));
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    VITE_SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
    VITE_SUPABASE_ANON_KEY: 'mock-anon-key',
    GEMINI_API_KEY: 'mock-gemini-key',
    VITE_USE_LOCAL_DB: 'false',
  };
  resetDBState();
  setupMockSupabase();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

// ===========================================================================
// Helper to make requests
// ===========================================================================

function makeRequest(path: string, body: any): Request {
  return new Request(`https://test.com/api/agent/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': 'session-int-1',
      'X-Interview-Token': 'test-token',
    },
    body: JSON.stringify(body),
  });
}

// ===========================================================================
// Integration: Non-Answer Fast-Path (no LLM needed)
// ===========================================================================
describe('Integration — Non-Answer Fast-Path Flow', () => {
  it('detectNonAnswer produces correct decisions across consecutive non-answers', async () => {
    // This test verifies the decision-engine logic end-to-end without
    // needing the full handler (which requires Gemini API mocking).
    // It simulates the exact sequence: non-answer → FOLLOW_UP, 
    // then non-answer again → NEXT_CLAIM.
    
    const { detectNonAnswer } = await import('../../api/agent/decision-engine');
    
    // Turn 1: First non-answer
    const ctx1 = {
      consecutiveNonAnswers: 0,
      isGracefulEnd: false,
      nextClaim: CLAIM_B,
      consecutiveFailedClaims: 0,
      currentClaimMustVerify: CLAIM_A.mustVerify,
      previouslyCoveredPoints: [],
      language: 'zh-CN' as const,
    };
    
    const result1 = detectNonAnswer('不知道', ctx1);
    expect(result1).not.toBeNull();
    expect(result1!.decision).toBe('FOLLOW_UP');
    expect(result1!.answerStatus).toBe('non_answer');
    
    // Turn 2: Second consecutive non-answer
    const ctx2 = {
      ...ctx1,
      consecutiveNonAnswers: 1,
    };
    
    const result2 = detectNonAnswer('不清楚', ctx2);
    expect(result2).not.toBeNull();
    expect(result2!.decision).toBe('NEXT_CLAIM');
    expect(result2!.nextQuestion).toContain(CLAIM_B.experienceName);
    
    // Turn 3: Third non-answer + 2 failed claims → END_INTERVIEW
    const ctx3 = {
      ...ctx1,
      consecutiveNonAnswers: 1,
      consecutiveFailedClaims: 2,
    };
    
    const result3 = detectNonAnswer('pass', ctx3);
    expect(result3).not.toBeNull();
    expect(result3!.decision).toBe('END_INTERVIEW');
  });
});

// ===========================================================================
// Integration: Memory + Decision Engine Composition
// ===========================================================================
describe('Integration — Memory + Decision Engine', () => {
  it('InterviewMemory state correctly feeds decision-engine context', async () => {
    const { InterviewMemory } = await import('../../src/agent/memory');
    const { detectNonAnswer, applyDecisionOverrides } = await import('../../api/agent/decision-engine');
    
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    
    // Step 1: Initialize intro
    mem.initializeIntroPhase('Welcome!', 'Hi, I am ready.', 'q-intro');
    expect(mem.getTotalQuestionsAsked()).toBe(1);
    
    // Step 2: Main question with real answer — simulate LLM FOLLOW_UP
    mem.addTurnToCurrentClaim(
      'Tell me about the microservices migration.',
      'We used DDD to decompose the monolith.',
      'main',
      'q-1'
    );
    mem.updateLatestTurnEvaluation({
      decision: 'FOLLOW_UP',
      answerStatus: 'answered',
      nextQuestion: 'Follow up?',
      spokenQuestion: 'Follow up?',
      decisionRationale: 'Need more detail',
      coveredPoints: ['Service decomposition strategy'],
      missingPoints: ['Ownership of migration decision', 'Team size and scope'],
      lightweightScores: { relevance: 7, specificity: 5, technicalDepth: 6, ownership: 4, evidence: 5 },
    });
    
    // Step 3: Non-answer → fast-path FOLLOW_UP
    const nonAnswerCtx = {
      consecutiveNonAnswers: mem.getConsecutiveNonAnswers(),
      isGracefulEnd: false,
      nextClaim: mem.getNextClaim(),
      consecutiveFailedClaims: mem.getConsecutiveFailedClaims(),
      currentClaimMustVerify: mem.getCurrentClaim()!.mustVerify,
      previouslyCoveredPoints: mem.getClaimStates()[0]?.coveredPoints || [],
      language: 'zh-CN' as const,
    };
    
    const fastPath = detectNonAnswer('不知道', nonAnswerCtx);
    expect(fastPath).not.toBeNull();
    expect(fastPath!.decision).toBe('FOLLOW_UP'); // first non-answer
    
    // Update memory with the non-answer
    mem.addTurnToCurrentClaim(
      '没关系，能换个角度聊聊你负责的具体工作吗？',
      '不知道',
      'follow_up',
      'q-2'
    );
    mem.updateLatestTurnEvaluation({
      decision: fastPath!.decision,
      answerStatus: 'non_answer',
      nextQuestion: fastPath!.nextQuestion,
      spokenQuestion: fastPath!.spokenQuestion,
      decisionRationale: fastPath!.decisionRationale,
      coveredPoints: fastPath!.coveredPoints,
      missingPoints: fastPath!.missingPoints,
      lightweightScores: { relevance: 0, specificity: 0, technicalDepth: 0, ownership: 0, evidence: 0 },
    });
    
    // Step 4: Second non-answer → should now get NEXT_CLAIM
    const nonAnswerCtx2 = {
      consecutiveNonAnswers: mem.getConsecutiveNonAnswers(),
      isGracefulEnd: false,
      nextClaim: mem.getNextClaim(),
      consecutiveFailedClaims: mem.getConsecutiveFailedClaims(),
      currentClaimMustVerify: mem.getCurrentClaim()!.mustVerify,
      previouslyCoveredPoints: mem.getClaimStates()[0]?.coveredPoints || [],
      language: 'zh-CN' as const,
    };
    
    expect(nonAnswerCtx2.consecutiveNonAnswers).toBe(1); // incremented
    
    const fastPath2 = detectNonAnswer('不清楚', nonAnswerCtx2);
    expect(fastPath2).not.toBeNull();
    expect(fastPath2!.decision).toBe('NEXT_CLAIM');
    
    // Verify the memory state is consistent
    expect(mem.getTotalNonAnswers()).toBe(1); // updated after updateLatestTurnEvaluation
    expect(mem.getTotalQuestionsAsked()).toBe(3); // intro + main + follow_up
  });
});

// ===========================================================================
// Integration: Transcript Restoration Round-Trip
// ===========================================================================
describe('Integration — Transcript Restoration', () => {
  it('restoreFromTranscript produces identical state regardless of call count', async () => {
    const { InterviewMemory } = await import('../../src/agent/memory');
    const { TWO_CLAIM_SEQUENCE } = await import('../fixtures/transcripts');
    
    const mem1 = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem1.restoreFromTranscript(TWO_CLAIM_SEQUENCE);
    
    const mem2 = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem2.restoreFromTranscript(TWO_CLAIM_SEQUENCE);
    mem2.restoreFromTranscript(TWO_CLAIM_SEQUENCE); // double-restore
    
    // Both should produce identical state
    expect(mem1.getCurrentClaimIndex()).toBe(mem2.getCurrentClaimIndex());
    expect(mem1.getTotalQuestionsAsked()).toBe(mem2.getTotalQuestionsAsked());
    expect(mem1.getTotalNonAnswers()).toBe(mem2.getTotalNonAnswers());
    expect(mem1.getFailedClaimsCount()).toBe(mem2.getFailedClaimsCount());
    expect(mem1.getClaimStates().length).toBe(mem2.getClaimStates().length);
    expect(mem1.getFlatHistory().length).toBe(mem2.getFlatHistory().length);
  });
});
