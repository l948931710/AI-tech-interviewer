import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * next-step.ts durability + idempotency tests (C1 fix).
 *
 * Covers the paths reachable WITHOUT mocking the Gemini stream:
 *  - the requestId guard (missing/blank → 400, so no NULL-request_id row is ever inserted)
 *  - the intro turn, which persists DURABLY (awaited) before responding, tolerates a 23505
 *    unique_violation as an idempotent retry, and returns an error (not the question) when
 *    persistence genuinely fails — so the client never advances past an unpersisted turn.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let dbState: {
  sessions: Record<string, any>;
  transcripts: any[];
  claims: any[];
};

// Configurable result for the session_transcripts INSERT so we can simulate
// success, a genuine DB failure, and a 23505 unique_violation (idempotent retry).
let transcriptInsertResult: { error: any };

// Count the rate-limit RPC reports for the current window (<= limit ⇒ allowed).
let rateLimitCount: number;

// Hoisted so the mock factory (which runs at import time, when the src/agent →
// supabase.ts module chain calls createClient) can reference it without a TDZ error.
const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: {} as any }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('../../api/api-auth', () => ({
  verifyAuth: vi.fn(),
}));

// Gemini must never be reached on these paths; if it is, fail loudly.
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => {
    throw new Error('Gemini should not be called on the intro/guard paths');
  }),
}));

const ORIGINAL_ENV = process.env;

import handler from '../../api/agent/next-step';
import { verifyAuth } from '../../api/api-auth';

const mockedVerifyAuth = vi.mocked(verifyAuth);

// ---------------------------------------------------------------------------
// DB mock — a chainable Supabase stub backed by dbState
// ---------------------------------------------------------------------------

function setupMockSupabase() {
  mockSupabase.from = vi.fn((table: string) => {
    const chain: any = { _table: table, _eqs: {} };

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: any) => {
      chain._eqs[col] = val;
      return chain;
    });
    chain.order = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);

    chain.single = vi.fn(() => {
      if (table === 'interview_sessions') {
        const session = dbState.sessions[chain._eqs['id']];
        return Promise.resolve({ data: session || null, error: session ? null : { message: 'Not found' } });
      }
      // session_transcripts idempotency pre-check: no existing turn by default
      return Promise.resolve({ data: null, error: null });
    });

    // Array-returning reads (claims / transcripts) resolve via the thenable.
    chain.then = (resolve: any) => {
      if (table === 'session_transcripts') {
        return Promise.resolve({ data: dbState.transcripts, error: null }).then(resolve);
      }
      if (table === 'session_claims') {
        return Promise.resolve({ data: dbState.claims, error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    };

    chain.insert = vi.fn((rows: any) => {
      if (table === 'session_transcripts') {
        if (!transcriptInsertResult.error) {
          const toInsert = Array.isArray(rows) ? rows : [rows];
          dbState.transcripts.push(...toInsert);
        }
        return Promise.resolve(transcriptInsertResult);
      }
      return Promise.resolve({ data: null, error: null });
    });

    chain.update = vi.fn((updates: any) => {
      const updateChain: any = {};
      updateChain.eq = vi.fn((_col: string, val: any) => {
        const session = dbState.sessions[val];
        if (session) Object.assign(session, updates);
        return Promise.resolve({ data: null, error: null });
      });
      return updateChain;
    });

    return chain;
  });

  // Rate-limit RPC (api/rate-limit.ts → underRateLimit → supabase.rpc('incr_rate_limit')).
  mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: rateLimitCount, error: null }));
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
  };

  dbState = {
    sessions: {
      'sess-1': {
        id: 'sess-1',
        status: 'IN_PROGRESS',
        phase: 'intro',
        first_question: 'Tell me about the migration you led.',
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        job_role_context: 'Backend role',
      },
    },
    transcripts: [],
    claims: [{
      id: 'c1', session_id: 'sess-1', topic: 'Migration',
      claim: 'Led the DB migration', experience_name: 'Acme',
      must_verify: ['rollback strategy'], ranking_signals: {},
    }],
  };
  transcriptInsertResult = { error: null };
  rateLimitCount = 1;

  setupMockSupabase();

  mockedVerifyAuth.mockResolvedValue({ user: { id: 'candidate-sess-1' } });
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

function makeRequest(body: any): Request {
  return new Request('https://test.com/api/agent/next-step', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': body.sessionId || 'sess-1',
      'X-Interview-Token': 'test-token',
    },
    body: JSON.stringify(body),
  });
}

const INTRO_BODY = {
  sessionId: 'sess-1',
  requestId: 'req-1',
  answer: 'Hi, I am a backend engineer.',
  question: 'Please introduce yourself.',
  questionId: 'q-intro',
  language: 'zh-CN',
};

// ===========================================================================
// 1. requestId guard — prevents un-dedupable NULL-request_id rows
// ===========================================================================
describe('next-step — requestId guard (C1)', () => {
  it('rejects a missing requestId with 400', async () => {
    const { requestId, ...noReqId } = INTRO_BODY;
    const res = await handler(makeRequest(noReqId), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('requestId');
    // Nothing should have been persisted.
    expect(dbState.transcripts.length).toBe(0);
  });

  it('rejects a blank requestId with 400', async () => {
    const res = await handler(makeRequest({ ...INTRO_BODY, requestId: '' }), {});
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 2. Intro turn — durable persistence before responding
// ===========================================================================
describe('next-step — intro turn durable persistence (C1)', () => {
  it('persists the turn + advances phase to technical, then returns the first question', async () => {
    const res = await handler(makeRequest(INTRO_BODY), {});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.nextQuestion).toBe('Tell me about the migration you led.');

    // Turn was durably written and phase advanced BEFORE the response.
    expect(dbState.transcripts.length).toBe(1);
    expect(dbState.transcripts[0].request_id).toBe('req-1');
    expect(dbState.sessions['sess-1'].phase).toBe('technical');
  });

  it('returns 503 (no advance) when the insert genuinely fails', async () => {
    transcriptInsertResult = { error: { code: '08006', message: 'connection failure' } };

    const res = await handler(makeRequest(INTRO_BODY), {});
    expect(res.status).toBe(503);

    // The client must NOT be handed the next question, and phase must NOT advance,
    // so it retries the SAME requestId instead of silently losing the turn.
    const body = await res.json();
    expect(body.nextQuestion).toBeUndefined();
    expect(dbState.sessions['sess-1'].phase).toBe('intro');
  });

  it('treats a 23505 unique_violation as an idempotent success (200)', async () => {
    transcriptInsertResult = { error: { code: '23505', message: 'duplicate key' } };

    const res = await handler(makeRequest(INTRO_BODY), {});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.nextQuestion).toBe('Tell me about the migration you led.');
    // Idempotent: phase still advances even though the row already existed.
    expect(dbState.sessions['sess-1'].phase).toBe('technical');
  });
});

// ===========================================================================
// 3. Rate limiting (C4)
// ===========================================================================
describe('next-step — rate limiting (C4)', () => {
  it('returns 429 when the per-session rate limit is exceeded', async () => {
    rateLimitCount = 999; // over any configured limit

    const res = await handler(makeRequest(INTRO_BODY), {});
    expect(res.status).toBe(429);
    // Nothing is persisted when throttled.
    expect(dbState.transcripts.length).toBe(0);
  });
});

// ===========================================================================
// 4. Per-session cost ceiling (C4)
// ===========================================================================
describe('next-step — cost ceiling (C4)', () => {
  it('gracefully ends the interview when the session is over budget', async () => {
    dbState.sessions['sess-1'].phase = 'technical';
    dbState.sessions['sess-1'].estimated_total_cost = 5; // over the $2 default ceiling

    const res = await handler(makeRequest(INTRO_BODY), {});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.decision).toBe('END_INTERVIEW');
    expect(body.decisionRationale).toBe('SERVER_COST_CEILING');
    expect(dbState.sessions['sess-1'].status).toBe('INTERVIEW_ENDED');
  });
});

// ===========================================================================
// 5. Non-answer fast-path — verifies next-step correctly wires the extracted,
//    unit-tested decision-engine logic (task #6 de-duplication).
// ===========================================================================
describe('next-step — non-answer fast-path wiring', () => {
  it('a first non-answer returns FOLLOW_UP without invoking the LLM', async () => {
    dbState.sessions['sess-1'].phase = 'technical';

    const res = await handler(makeRequest({ ...INTRO_BODY, answer: '不知道' }), {});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.answerStatus).toBe('non_answer');
    expect(body.decision).toBe('FOLLOW_UP'); // first non-answer → CLARIFY, no Gemini call
  });
});
