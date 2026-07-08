import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isSessionOverBudget,
  underRateLimit,
  getClientIp,
  MAX_SESSION_COST_USD,
  MAX_SESSION_LLM_CALLS,
} from '../../api/rate-limit';

beforeEach(() => {
  // isSessionOverBudget logs a structured billing-anomaly line; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ===========================================================================
// Per-session cost ceiling
// ===========================================================================
describe('isSessionOverBudget', () => {
  it('is false for an under-budget session', () => {
    expect(isSessionOverBudget({ estimated_total_cost: 0.05, llm_call_count: 12 })).toBe(false);
  });

  it('is false for null/undefined (no counters yet)', () => {
    expect(isSessionOverBudget(null)).toBe(false);
    expect(isSessionOverBudget(undefined)).toBe(false);
  });

  it('is true when the cost ceiling is exceeded', () => {
    expect(isSessionOverBudget({ estimated_total_cost: MAX_SESSION_COST_USD + 0.01, llm_call_count: 3 })).toBe(true);
  });

  it('is true when the call-count ceiling is exceeded', () => {
    expect(isSessionOverBudget({ estimated_total_cost: 0, llm_call_count: MAX_SESSION_LLM_CALLS + 1 })).toBe(true);
  });
});

// ===========================================================================
// Fixed-window rate limiter (fails open)
// ===========================================================================
describe('underRateLimit', () => {
  const withRpc = (rpc: any) => ({ rpc } as any);

  it('allows when the window count is within the limit', async () => {
    const supa = withRpc(vi.fn().mockResolvedValue({ data: 5, error: null }));
    expect(await underRateLimit(supa, 'ns:s1', 10, 60)).toBe(true);
  });

  it('allows exactly at the limit, blocks above it', async () => {
    expect(await underRateLimit(withRpc(vi.fn().mockResolvedValue({ data: 10, error: null })), 'k', 10, 60)).toBe(true);
    expect(await underRateLimit(withRpc(vi.fn().mockResolvedValue({ data: 11, error: null })), 'k', 10, 60)).toBe(false);
  });

  it('fails OPEN (allows) when the limiter RPC errors', async () => {
    const supa = withRpc(vi.fn().mockResolvedValue({ data: null, error: { message: 'relation does not exist' } }));
    expect(await underRateLimit(supa, 'k', 10, 60)).toBe(true);
  });

  it('fails OPEN (allows) when the limiter RPC throws', async () => {
    const supa = withRpc(vi.fn().mockRejectedValue(new Error('network down')));
    expect(await underRateLimit(supa, 'k', 10, 60)).toBe(true);
  });
});

// ===========================================================================
// Client IP extraction
// ===========================================================================
describe('getClientIp', () => {
  it('uses the first entry of x-forwarded-for', () => {
    const req = new Request('https://x.com', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    const req = new Request('https://x.com', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('returns "unknown" with no IP headers', () => {
    expect(getClientIp(new Request('https://x.com'))).toBe('unknown');
  });
});
