import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Auth verification tests for api/api-auth.ts.
 * 
 * Tests the verifyAuth function by mocking the Supabase client and
 * crypto.subtle.digest. Each test constructs a Request object with
 * specific headers and verifies the auth outcome.
 * 
 * IMPORTANT: These tests verify the decision logic (which code path
 * fires for which input), not the actual SHA-256 computation or
 * real Supabase network calls.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before imports
// ---------------------------------------------------------------------------
const mockSupabaseClient: any = {};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

// Mock environment variables
const ORIGINAL_ENV = process.env;

import { verifyAuth } from '../../api/api-auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(headers: Record<string, string> = {}, url = 'https://test.com/api/agent/next-step'): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Set up mockSupabaseClient to return controlled data for each table.
 * This mimics the fluent chain: supabase.from('table').select('...').eq('...').single()
 */
function setupMockDB(tableResponses: Record<string, { data: any; error: any }>) {
  mockSupabaseClient.from = vi.fn((table: string) => {
    const response = tableResponses[table] || { data: null, error: { message: `No mock for: ${table}` } };
    const chain: any = {
      select: () => chain,
      insert: () => Promise.resolve(response),
      update: () => chain,
      eq: () => chain,
      single: () => Promise.resolve(response),
      then: (resolve: any) => Promise.resolve(response).then(resolve),
    };
    return chain;
  });

  mockSupabaseClient.auth = {
    getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: { message: 'Invalid token' } })),
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    VITE_SUPABASE_URL: 'https://mock.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'mock-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
    VITE_USE_LOCAL_DB: 'false',
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Missing Environment Variables
// ===========================================================================
describe('verifyAuth — Environment', () => {
  it('returns 500 when Supabase env vars are missing', async () => {
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_URL;

    const result = await verifyAuth(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(500);
  });
});

// ===========================================================================
// 2. JWT Path (HR Users)
// ===========================================================================
describe('verifyAuth — JWT Path', () => {
  it('authenticates HR user with valid Bearer token', async () => {
    mockSupabaseClient.auth = {
      getUser: vi.fn(() => Promise.resolve({
        data: { user: { id: 'hr-user-123', email: 'hr@company.com' } },
        error: null,
      })),
    };
    // The createClient mock is module-level — it returns mockSupabaseClient

    const req = makeRequest({ Authorization: 'Bearer valid-jwt-token' });
    const result = await verifyAuth(req);

    expect(result.error).toBeUndefined();
    expect(result.user).toBeDefined();
    expect(result.user!.id).toBe('hr-user-123');
    expect(result.user!.email).toBe('hr@company.com');
  });

  it('falls through to token path when JWT is invalid', async () => {
    mockSupabaseClient.auth = {
      getUser: vi.fn(() => Promise.resolve({
        data: { user: null },
        error: { message: 'Invalid JWT' },
      })),
    };

    // No token headers either → should end up at 401
    const req = makeRequest({ Authorization: 'Bearer invalid-jwt' });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });
});

// ===========================================================================
// 3. Token Path (Candidates) — Happy Path
// ===========================================================================
describe('verifyAuth — Token Path (Success)', () => {
  it('authenticates candidate with valid token + PENDING session', async () => {
    setupMockDB({
      'interview_sessions': {
        data: { status: 'PENDING', created_at: new Date().toISOString() },
        error: null,
      },
      'invite_tokens': {
        data: {
          id: 'token-1',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          revoked: false,
          is_used: false,
          max_uses: 100,
          use_count: 0,
        },
        error: null,
      },
      'invite_access_logs': { data: null, error: null },
    });

    const req = makeRequest({
      'X-Interview-Token': 'raw-token-abc',
      'X-Session-Id': 'session-123',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeUndefined();
    expect(result.user).toBeDefined();
    expect(result.user!.id).toBe('candidate-session-123');
    expect(result.tokenHash).toBeDefined();
  });

  it('authenticates candidate with IN_PROGRESS session (reconnection)', async () => {
    setupMockDB({
      'interview_sessions': {
        data: { status: 'IN_PROGRESS', created_at: new Date().toISOString() },
        error: null,
      },
      'invite_tokens': {
        data: {
          id: 'token-1',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          revoked: false,
          is_used: true,
          max_uses: 100,
          use_count: 5,
        },
        error: null,
      },
      // Return a previous success log for IP matching
      'invite_access_logs': {
        data: [{ ip: 'unknown', user_agent: 'test' }],
        error: null,
      },
    });

    const req = makeRequest({
      'X-Interview-Token': 'raw-token-abc',
      'X-Session-Id': 'session-123',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeUndefined();
    expect(result.user!.id).toBe('candidate-session-123');
  });
});

// ===========================================================================
// 4. Token Path — Denial Cases
// ===========================================================================
describe('verifyAuth — Token Path (Denial)', () => {
  it('rejects expired token', async () => {
    setupMockDB({
      'interview_sessions': {
        data: { status: 'PENDING', created_at: new Date().toISOString() },
        error: null,
      },
      'invite_tokens': {
        data: {
          id: 'token-1',
          expires_at: new Date(Date.now() - 1000).toISOString(), // expired 1s ago
          revoked: false,
          is_used: false,
          max_uses: 100,
          use_count: 0,
        },
        error: null,
      },
      'invite_access_logs': { data: null, error: null },
    });

    const req = makeRequest({
      'X-Interview-Token': 'raw-token',
      'X-Session-Id': 'session-123',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('rejects revoked token', async () => {
    setupMockDB({
      'interview_sessions': {
        data: { status: 'PENDING', created_at: new Date().toISOString() },
        error: null,
      },
      'invite_tokens': {
        data: {
          id: 'token-1',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          revoked: true,  // explicitly revoked
          is_used: false,
          max_uses: 100,
          use_count: 0,
        },
        error: null,
      },
      'invite_access_logs': { data: null, error: null },
    });

    const req = makeRequest({
      'X-Interview-Token': 'raw-token',
      'X-Session-Id': 'session-123',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('rejects token for COMPLETED session', async () => {
    setupMockDB({
      'interview_sessions': {
        data: { status: 'COMPLETED', created_at: new Date().toISOString() },
        error: null,
      },
      'invite_tokens': {
        data: {
          id: 'token-1',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          revoked: false,
          is_used: false,
          max_uses: 100,
          use_count: 0,
        },
        error: null,
      },
      'invite_access_logs': { data: null, error: null },
    });

    const req = makeRequest({
      'X-Interview-Token': 'raw-token',
      'X-Session-Id': 'session-123',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('rejects PENDING session older than 24 hours', async () => {
    setupMockDB({
      'interview_sessions': {
        data: {
          status: 'PENDING',
          created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
        },
        error: null,
      },
      'invite_tokens': {
        data: {
          id: 'token-1',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          revoked: false,
          is_used: false,
          max_uses: 100,
          use_count: 0,
        },
        error: null,
      },
      'invite_access_logs': { data: null, error: null },
    });

    const req = makeRequest({
      'X-Interview-Token': 'raw-token',
      'X-Session-Id': 'session-123',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('rejects token at max use_count', async () => {
    setupMockDB({
      'interview_sessions': {
        data: { status: 'PENDING', created_at: new Date().toISOString() },
        error: null,
      },
      'invite_tokens': {
        data: {
          id: 'token-1',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          revoked: false,
          is_used: true,
          max_uses: 5,
          use_count: 5,  // at max
        },
        error: null,
      },
      'invite_access_logs': { data: null, error: null },
    });

    const req = makeRequest({
      'X-Interview-Token': 'raw-token',
      'X-Session-Id': 'session-123',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('returns 404 when session does not exist', async () => {
    setupMockDB({
      'interview_sessions': {
        data: null,
        error: { message: 'Not found' },
      },
      'invite_tokens': { data: null, error: null },
      'invite_access_logs': { data: null, error: null },
    });

    const req = makeRequest({
      'X-Interview-Token': 'raw-token',
      'X-Session-Id': 'nonexistent-session',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(404);
  });

  it('rejects token with hash mismatch (token not found in DB)', async () => {
    setupMockDB({
      'interview_sessions': {
        data: { status: 'PENDING', created_at: new Date().toISOString() },
        error: null,
      },
      'invite_tokens': {
        data: null,
        error: { message: 'No rows found' },
      },
      'invite_access_logs': { data: null, error: null },
    });

    const req = makeRequest({
      'X-Interview-Token': 'wrong-token',
      'X-Session-Id': 'session-123',
    });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });
});

// ===========================================================================
// 5. Missing Headers
// ===========================================================================
describe('verifyAuth — Missing Credentials', () => {
  it('returns 401 when no auth headers provided at all', async () => {
    const req = makeRequest({});
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('returns 401 when only X-Session-Id but no X-Interview-Token', async () => {
    const req = makeRequest({ 'X-Session-Id': 'session-123' });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });
});

// ===========================================================================
// 6. Local Dev Bypass (C2 fix — hardened, fails closed in production)
//
// The bypass now requires BOTH a dedicated server-only opt-in
// (ALLOW_INSECURE_LOCAL_AUTH) AND a non-production runtime. These tests pin the
// secure contract: the old unsafe trigger (VITE_USE_LOCAL_DB=true) must NO
// LONGER authenticate anyone, and the bypass must fail closed in production
// even when the opt-in flag is set.
// ===========================================================================
describe('verifyAuth — Local Dev Bypass (C2 hardened)', () => {
  it('does NOT bypass on the old VITE_USE_LOCAL_DB flag alone', async () => {
    process.env.VITE_USE_LOCAL_DB = 'true';
    delete process.env.ALLOW_INSECURE_LOCAL_AUTH;

    const req = makeRequest({ 'X-Session-Id': 'local-session-456' });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('bypasses when ALLOW_INSECURE_LOCAL_AUTH=true in a non-production runtime', async () => {
    process.env.ALLOW_INSECURE_LOCAL_AUTH = 'true';
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL_ENV;

    const req = makeRequest({ 'X-Session-Id': 'local-session-456' });
    const result = await verifyAuth(req);

    expect(result.error).toBeUndefined();
    expect(result.user).toBeDefined();
    expect(result.user!.id).toBe('candidate-local-session-456');
  });

  it('fails closed: no bypass when NODE_ENV=production even with the opt-in set', async () => {
    process.env.ALLOW_INSECURE_LOCAL_AUTH = 'true';
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL_ENV;

    const req = makeRequest({ 'X-Session-Id': 'local-session-456' });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('fails closed: no bypass when VERCEL_ENV=production even with the opt-in set', async () => {
    process.env.ALLOW_INSECURE_LOCAL_AUTH = 'true';
    process.env.NODE_ENV = 'development';
    process.env.VERCEL_ENV = 'production';

    const req = makeRequest({ 'X-Session-Id': 'local-session-456' });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it('does NOT bypass when no bypass flag is set', async () => {
    delete process.env.ALLOW_INSECURE_LOCAL_AUTH;

    const req = makeRequest({ 'X-Session-Id': 'session-123' });
    const result = await verifyAuth(req);

    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });
});
