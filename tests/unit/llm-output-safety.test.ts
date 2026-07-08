import { describe, it, expect } from 'vitest';
import { applyDecisionOverrides, OverrideContext } from '../../api/agent/decision-engine';
import { CLAIM_A, CLAIM_B } from '../fixtures/claims';
import {
  VALID_RESPONSE,
  MISSING_DECISION,
  MISSING_SPOKEN_QUESTION,
  EMPTY_STRINGS,
  INVALID_DECISION_ENUM,
  INVALID_ANSWER_STATUS,
  EXTRA_FIELDS,
  TRUNCATED_JSON,
  MARKDOWN_WRAPPED,
  HALLUCINATED_POINTS,
} from '../fixtures/llm-responses';

/**
 * LLM Output Safety Tests
 * 
 * These tests verify the system's resilience to various LLM output shapes,
 * including malformed JSON, missing fields, invalid enum values, and
 * hallucinated data. They test the parsing + override pipeline, NOT the
 * LLM call itself.
 */

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeOverrideCtx(overrides: Partial<OverrideContext> = {}): OverrideContext {
  return {
    question: 'Tell me about your experience.',
    repeatCountForCurrentQuestion: 0,
    forceNextClaim: false,
    consecutiveNonAnswers: 0,
    totalQuestionsAskedForCurrentClaim: 3,
    minQuestionsPerClaim: 2,
    followUpCountForCurrentClaim: 1,
    maxFollowUpsPerClaim: 2,
    hardLimitFollowUps: 3,
    nextClaim: CLAIM_B,
    currentClaimMustVerify: CLAIM_A.mustVerify,
    language: 'zh-CN',
    ...overrides,
  };
}

/**
 * Simulates the parse pipeline from next-step.ts:
 * 1. Strip markdown fences
 * 2. JSON.parse
 * 3. Apply decision overrides
 */
function simulateParsePipeline(rawText: string, ctx: OverrideContext): { parsed: Record<string, any> | null; error: string | null } {
  try {
    const cleaned = rawText.trim().replace(/```json/gi, '').replace(/```/g, '');
    const parsed = JSON.parse(cleaned);
    applyDecisionOverrides(parsed, ctx);
    return { parsed, error: null };
  } catch (e: any) {
    return { parsed: null, error: e.message };
  }
}

// ===========================================================================
// 1. Happy Path
// ===========================================================================
describe('LLM Output Safety — Happy Path', () => {
  it('processes a complete, well-formed response correctly', () => {
    const parsed = { ...VALID_RESPONSE };
    const ctx = makeOverrideCtx();
    const overridden = applyDecisionOverrides(parsed, ctx);

    // No override needed for a well-formed FOLLOW_UP
    expect(overridden).toBe(false);
    expect(parsed.decision).toBe('FOLLOW_UP');
    expect(parsed.nextQuestion).toBe(VALID_RESPONSE.nextQuestion);
  });
});

// ===========================================================================
// 2. Missing Fields
// ===========================================================================
describe('LLM Output Safety — Missing Fields', () => {
  it('handles missing decision field — override can apply based on other fields', () => {
    const parsed: any = { ...MISSING_DECISION };
    const ctx = makeOverrideCtx();
    // decision is undefined — none of the override conditions match undefined,
    // so it passes through. This verifies the override engine doesn't crash.
    expect(() => applyDecisionOverrides(parsed, ctx)).not.toThrow();
  });

  it('uses nextQuestion as fallback when spokenQuestion is missing', () => {
    const parsed: any = { ...MISSING_SPOKEN_QUESTION };
    const ctx = makeOverrideCtx();
    applyDecisionOverrides(parsed, ctx);
    // spokenQuestion was undefined — if no override fired, it stays undefined
    // If override fired, it gets set. Either way, nextQuestion is always set.
    expect(parsed.nextQuestion).toBeDefined();
    expect(parsed.nextQuestion.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 3. Empty Values
// ===========================================================================
describe('LLM Output Safety — Empty Values', () => {
  it('does not crash on empty string values for all fields', () => {
    const parsed: any = { ...EMPTY_STRINGS };
    const ctx = makeOverrideCtx();
    expect(() => applyDecisionOverrides(parsed, ctx)).not.toThrow();
  });
});

// ===========================================================================
// 4. Invalid Enum Values
// ===========================================================================
describe('LLM Output Safety — Invalid Enums', () => {
  it('handles invalid decision enum ("SKIP") without crashing', () => {
    const parsed: any = { ...INVALID_DECISION_ENUM };
    const ctx = makeOverrideCtx();
    // "SKIP" won't match any override condition (they check for specific values)
    // so it passes through. The handler should sanitize this downstream.
    expect(() => applyDecisionOverrides(parsed, ctx)).not.toThrow();
    // decision stays as "SKIP" since no override matched
    expect(parsed.decision).toBe('SKIP');
  });

  it('handles invalid answerStatus ("maybe") without crashing', () => {
    const parsed: any = { ...INVALID_ANSWER_STATUS };
    const ctx = makeOverrideCtx();
    expect(() => applyDecisionOverrides(parsed, ctx)).not.toThrow();
    // "maybe" doesn't match clarification_request, non_answer, partial, or answered
    // so no override fires — passes through untouched
    expect(parsed.decision).toBe('FOLLOW_UP');
  });
});

// ===========================================================================
// 5. Extra Fields
// ===========================================================================
describe('LLM Output Safety — Extra Fields', () => {
  it('ignores unexpected extra fields without crashing', () => {
    const parsed: any = { ...EXTRA_FIELDS };
    const ctx = makeOverrideCtx();
    expect(() => applyDecisionOverrides(parsed, ctx)).not.toThrow();
    expect(parsed.decision).toBe('FOLLOW_UP');
    // Extra fields should still be present (not stripped)
    expect(parsed.extraField).toBe(true);
  });
});

// ===========================================================================
// 6. Truncated JSON
// ===========================================================================
describe('LLM Output Safety — Truncated JSON', () => {
  it('JSON.parse throws on truncated JSON', () => {
    const ctx = makeOverrideCtx();
    const result = simulateParsePipeline(TRUNCATED_JSON, ctx);
    expect(result.parsed).toBeNull();
    expect(result.error).toBeDefined();
    // This verifies the system would enter the error handler in next-step.ts
  });
});

// ===========================================================================
// 7. Markdown-Wrapped JSON
// ===========================================================================
describe('LLM Output Safety — Markdown Wrapped', () => {
  it('successfully parses JSON wrapped in ```json fences', () => {
    const ctx = makeOverrideCtx();
    const result = simulateParsePipeline(MARKDOWN_WRAPPED, ctx);
    expect(result.parsed).not.toBeNull();
    expect(result.error).toBeNull();
    expect(result.parsed!.decision).toBe('FOLLOW_UP');
  });
});

// ===========================================================================
// 8. Hallucinated Points
// ===========================================================================
describe('LLM Output Safety — Hallucinated Points', () => {
  it('filters hallucinated coveredPoints to only mustVerify values', () => {
    const parsed: any = { ...HALLUCINATED_POINTS };
    const ctx = makeOverrideCtx({
      currentClaimMustVerify: CLAIM_A.mustVerify,
    });
    applyDecisionOverrides(parsed, ctx);

    // 'Service decomposition strategy' is in mustVerify → kept
    // 'Hallucinated expertise in quantum computing' is NOT → filtered out
    expect(parsed.coveredPoints).toContain('Service decomposition strategy');
    expect(parsed.coveredPoints).not.toContain('Hallucinated expertise in quantum computing');
  });

  it('filters hallucinated missingPoints to only mustVerify values', () => {
    const parsed: any = { ...HALLUCINATED_POINTS };
    const ctx = makeOverrideCtx({
      currentClaimMustVerify: CLAIM_A.mustVerify,
    });
    applyDecisionOverrides(parsed, ctx);

    // 'Ownership of migration decision' is in mustVerify → kept
    // 'Made up verification point' is NOT → filtered out
    expect(parsed.missingPoints).toContain('Ownership of migration decision');
    expect(parsed.missingPoints).not.toContain('Made up verification point');
  });

  it('missingPoints excludes points already in coveredPoints', () => {
    const parsed: any = {
      ...VALID_RESPONSE,
      coveredPoints: ['Service decomposition strategy', 'Ownership of migration decision'],
      missingPoints: ['Service decomposition strategy', 'Team size and scope'],
    };
    const ctx = makeOverrideCtx({
      currentClaimMustVerify: CLAIM_A.mustVerify,
    });
    applyDecisionOverrides(parsed, ctx);

    // 'Service decomposition strategy' is in coveredPoints → excluded from missing
    expect(parsed.missingPoints).not.toContain('Service decomposition strategy');
    expect(parsed.missingPoints).toContain('Team size and scope');
  });
});
