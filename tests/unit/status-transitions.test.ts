import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Status Transition Tests
 * 
 * Tests the business rules enforced by update-status.ts:
 * - Only specific status values are allowed
 * - Only transitions from IN_PROGRESS are permitted
 * - Session ID must match the authenticated candidate
 * 
 * These tests mock verifyAuth (for auth) and Supabase (for DB),
 * then call the handler directly with a constructed Request.
 */

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockUpdateResult = { data: null as any, error: null as any };
const mockSupabase: any = {
  from: vi.fn(() => ({
    update: () => ({
      eq: () => ({
        in: () => ({
          select: () => ({
            single: () => Promise.resolve(mockUpdateResult),
          }),
        }),
      }),
    }),
  })),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('../../api/api-auth', () => ({
  verifyAuth: vi.fn(),
}));

const ORIGINAL_ENV = process.env;

import handler from '../../api/agent/update-status';
import { verifyAuth } from '../../api/api-auth';

const mockedVerifyAuth = vi.mocked(verifyAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: any): Request {
  return new Request('https://test.com/api/agent/update-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': body.sessionId || 'session-123',
      'X-Interview-Token': 'test-token',
    },
    body: JSON.stringify(body),
  });
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
  };

  // Default: authenticated as candidate-session-123
  mockedVerifyAuth.mockResolvedValue({
    user: { id: 'candidate-session-123' },
  });
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Method Enforcement
// ===========================================================================
describe('update-status — Method Enforcement', () => {
  it('rejects non-POST requests with 405', async () => {
    const req = new Request('https://test.com/api/agent/update-status', {
      method: 'GET',
    });
    const res = await handler(req);
    expect(res.status).toBe(405);
  });
});

// ===========================================================================
// 2. Valid Transitions
// ===========================================================================
describe('update-status — Valid Transitions', () => {
  it('allows IN_PROGRESS → NOT_FINISHED', async () => {
    mockUpdateResult.data = { id: 'session-123' };
    mockUpdateResult.error = null;

    const req = makeRequest({ sessionId: 'session-123', status: 'NOT_FINISHED' });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('allows IN_PROGRESS → INTERVIEW_ENDED', async () => {
    mockUpdateResult.data = { id: 'session-123' };
    mockUpdateResult.error = null;

    const req = makeRequest({ sessionId: 'session-123', status: 'INTERVIEW_ENDED' });
    const res = await handler(req);
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// 3. Invalid Status Values
// ===========================================================================
describe('update-status — Invalid Status Values', () => {
  it('rejects invalid status value with 400', async () => {
    const req = makeRequest({ sessionId: 'session-123', status: 'INVALID_STATUS' });
    const res = await handler(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid status');
  });

  it('rejects COMPLETED status (not in allowedStatuses)', async () => {
    const req = makeRequest({ sessionId: 'session-123', status: 'COMPLETED' });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it('rejects GENERATING status (not in allowedStatuses)', async () => {
    const req = makeRequest({ sessionId: 'session-123', status: 'GENERATING' });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 4. Transition from Non-IN_PROGRESS (409 Conflict)
// ===========================================================================
describe('update-status — Invalid Source State', () => {
  it('returns 409 when session is not IN_PROGRESS', async () => {
    // DB returns no match because .in('status', ['IN_PROGRESS']) filters it out
    mockUpdateResult.data = null;
    mockUpdateResult.error = { message: 'No rows found' };

    const req = makeRequest({ sessionId: 'session-123', status: 'NOT_FINISHED' });
    const res = await handler(req);
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain('not allowed');
  });
});

// ===========================================================================
// 5. Context Mismatch (403)
// ===========================================================================
describe('update-status — Context Mismatch', () => {
  it('returns 403 when sessionId does not match auth context', async () => {
    // Auth returns candidate-session-123 but request has sessionId: different-session
    const req = makeRequest({ sessionId: 'different-session', status: 'NOT_FINISHED' });
    const res = await handler(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toContain('mismatch');
  });
});

// ===========================================================================
// 6. Auth Failure
// ===========================================================================
describe('update-status — Auth Failure', () => {
  it('returns 401 when not authenticated', async () => {
    mockedVerifyAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const req = makeRequest({ sessionId: 'session-123', status: 'NOT_FINISHED' });
    const res = await handler(req);
    expect(res.status).toBe(401);
  });
});
