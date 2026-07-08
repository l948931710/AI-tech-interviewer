import { describe, it, expect } from 'vitest';
import { InterviewMemory } from '../../src/agent/memory';
import { detectNonAnswer, applyDecisionOverrides, OverrideContext } from '../../api/agent/decision-engine';
import { CLAIM_A, CLAIM_B, THREE_CLAIMS, TEST_JD } from '../fixtures/claims';
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
 * Behavioral Metrics — Deterministic Layer
 *
 * These tests compute actual metrics (ratios, counts, rates) from
 * the deterministic interview logic, NOT from LLM calls.
 *
 * Metrics covered:
 * - claim_coverage_ratio: % of claims visited vs total
 * - followup_count_per_claim: behavioral bounds per scenario
 * - premature_end_rate: % of scenarios that incorrectly trigger END_INTERVIEW
 * - malformed_output_recovery_rate: % of malformed LLM shapes handled without crash
 */

// ===========================================================================
// 1. claim_coverage_ratio
// ===========================================================================
describe('Metric: claim_coverage_ratio', () => {
  it('computes correct coverage ratio for a full traversal (3/3 = 1.0)', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');

    // Visit claim 0
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    mem.updateLatestTurnEvaluation({
      decision: 'NEXT_CLAIM', answerStatus: 'answered',
      nextQuestion: 'Next?', spokenQuestion: 'Next?',
      decisionRationale: 'Moving on',
      coveredPoints: CLAIM_A.mustVerify, missingPoints: [],
      lightweightScores: { relevance: 8, specificity: 7, technicalDepth: 7, ownership: 8, evidence: 7 },
    });
    mem.determineStatusAndAdvance('NEXT_CLAIM');

    // Visit claim 1
    mem.addTurnToCurrentClaim('Q2', 'A2', 'main', 'q-2');
    mem.updateLatestTurnEvaluation({
      decision: 'NEXT_CLAIM', answerStatus: 'answered',
      nextQuestion: 'Next?', spokenQuestion: 'Next?',
      decisionRationale: 'Moving on',
      coveredPoints: CLAIM_B.mustVerify, missingPoints: [],
      lightweightScores: { relevance: 8, specificity: 7, technicalDepth: 7, ownership: 8, evidence: 7 },
    });
    mem.determineStatusAndAdvance('NEXT_CLAIM');

    // Visit claim 2
    mem.addTurnToCurrentClaim('Q3', 'A3', 'main', 'q-3');

    // Compute metric
    const claimsVisited = mem.getClaimStates().length;
    const totalClaims = THREE_CLAIMS.length;
    const coverageRatio = claimsVisited / totalClaims;

    expect(coverageRatio).toBe(1.0);
    expect(claimsVisited).toBe(3);
  });

  it('computes correct coverage ratio for partial traversal (1/3 = 0.33)', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');

    // Only visit claim 0 — simulate END_INTERVIEW before moving on
    mem.addTurnToCurrentClaim('Q1', 'I dont know', 'main', 'q-1');
    mem.updateLatestTurnEvaluation({
      decision: 'END_INTERVIEW', answerStatus: 'non_answer',
      nextQuestion: 'Goodbye', spokenQuestion: 'Goodbye',
      decisionRationale: 'Ending',
      coveredPoints: [], missingPoints: CLAIM_A.mustVerify,
      lightweightScores: { relevance: 0, specificity: 0, technicalDepth: 0, ownership: 0, evidence: 0 },
    });

    const claimsVisited = mem.getClaimStates().length;
    const totalClaims = THREE_CLAIMS.length;
    const coverageRatio = claimsVisited / totalClaims;

    expect(coverageRatio).toBeCloseTo(1 / 3, 2);
    expect(claimsVisited).toBe(1);
  });

  it('computes coverage ratio for 2/3 traversal with early end on claim 2', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');

    // Visit claim 0 → NEXT_CLAIM
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    mem.updateLatestTurnEvaluation({
      decision: 'NEXT_CLAIM', answerStatus: 'answered',
      nextQuestion: 'Next', spokenQuestion: 'Next',
      decisionRationale: 'ok', coveredPoints: [], missingPoints: [],
      lightweightScores: { relevance: 5, specificity: 5, technicalDepth: 5, ownership: 5, evidence: 5 },
    });
    mem.determineStatusAndAdvance('NEXT_CLAIM');

    // Visit claim 1 → END_INTERVIEW
    mem.addTurnToCurrentClaim('Q2', 'A2', 'main', 'q-2');
    mem.updateLatestTurnEvaluation({
      decision: 'END_INTERVIEW', answerStatus: 'answered',
      nextQuestion: 'Bye', spokenQuestion: 'Bye',
      decisionRationale: 'ending', coveredPoints: [], missingPoints: [],
      lightweightScores: { relevance: 5, specificity: 5, technicalDepth: 5, ownership: 5, evidence: 5 },
    });

    const coverageRatio = mem.getClaimStates().length / THREE_CLAIMS.length;
    expect(coverageRatio).toBeCloseTo(2 / 3, 2);
  });
});

// ===========================================================================
// 2. followup_count_per_claim
// ===========================================================================
describe('Metric: followup_count_per_claim', () => {
  /**
   * Test behavioral bounds: the override rules should enforce that
   * follow-ups stay within [0, hardLimitFollowUps] per claim.
   */
  it('enforces maxFollowUpsPerClaim via override Rule 5', () => {
    const maxFollowUps = 2;
    const hardLimit = 3;

    // Simulate LLM wanting FOLLOW_UP when we're AT the soft limit
    // with no missing points → should override to NEXT_CLAIM
    const parsed = {
      decision: 'FOLLOW_UP', answerStatus: 'answered',
      nextQuestion: 'More?', spokenQuestion: 'More?',
      decisionRationale: 'want more', coveredPoints: CLAIM_A.mustVerify,
      missingPoints: [],
    };
    const ctx: OverrideContext = {
      question: 'Tell me more',
      repeatCountForCurrentQuestion: 0,
      forceNextClaim: false,
      consecutiveNonAnswers: 0,
      totalQuestionsAskedForCurrentClaim: 4,
      minQuestionsPerClaim: 2,
      followUpCountForCurrentClaim: maxFollowUps, // at soft limit
      maxFollowUpsPerClaim: maxFollowUps,
      hardLimitFollowUps: hardLimit,
      nextClaim: CLAIM_B,
      currentClaimMustVerify: CLAIM_A.mustVerify,
      language: 'en-US',
    };

    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });

  it('allows extra follow-up at soft limit if missing points remain', () => {
    const parsed = {
      decision: 'FOLLOW_UP', answerStatus: 'partial',
      nextQuestion: 'More?', spokenQuestion: 'More?',
      decisionRationale: 'gaps remain',
      coveredPoints: ['Service decomposition strategy'],
      missingPoints: ['Ownership of migration decision'],
    };
    const ctx: OverrideContext = {
      question: 'Tell me more',
      repeatCountForCurrentQuestion: 0,
      forceNextClaim: false,
      consecutiveNonAnswers: 0,
      totalQuestionsAskedForCurrentClaim: 4,
      minQuestionsPerClaim: 2,
      followUpCountForCurrentClaim: 2, // at soft limit
      maxFollowUpsPerClaim: 2,
      hardLimitFollowUps: 3,
      nextClaim: CLAIM_B,
      currentClaimMustVerify: CLAIM_A.mustVerify,
      language: 'en-US',
    };

    const overridden = applyDecisionOverrides(parsed, ctx);
    // With missing points at soft limit but below hard limit → NOT overridden
    expect(overridden).toBe(false);
    expect(parsed.decision).toBe('FOLLOW_UP');
  });

  it('forces NEXT_CLAIM at hard limit even with missing points', () => {
    const parsed = {
      decision: 'FOLLOW_UP', answerStatus: 'partial',
      nextQuestion: 'More?', spokenQuestion: 'More?',
      decisionRationale: 'gaps',
      coveredPoints: ['Service decomposition strategy'],
      missingPoints: ['Ownership of migration decision'],
    };
    const ctx: OverrideContext = {
      question: 'Tell me more',
      repeatCountForCurrentQuestion: 0,
      forceNextClaim: false,
      consecutiveNonAnswers: 0,
      totalQuestionsAskedForCurrentClaim: 5,
      minQuestionsPerClaim: 2,
      followUpCountForCurrentClaim: 3, // AT hard limit
      maxFollowUpsPerClaim: 2,
      hardLimitFollowUps: 3,
      nextClaim: CLAIM_B,
      currentClaimMustVerify: CLAIM_A.mustVerify,
      language: 'en-US',
    };

    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });

  it('computes followup_count_per_claim from InterviewMemory', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');

    // Main question (not a follow-up)
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    expect(mem.getFollowUpCountForCurrentClaim()).toBe(0);

    // First follow-up
    mem.addTurnToCurrentClaim('FU1', 'A2', 'follow_up', 'q-2');
    expect(mem.getFollowUpCountForCurrentClaim()).toBe(1);

    // Second follow-up
    mem.addTurnToCurrentClaim('FU2', 'A3', 'follow_up', 'q-3');
    expect(mem.getFollowUpCountForCurrentClaim()).toBe(2);

    // Metric: follow-ups per this claim = 2
    const followUpsThisClaim = mem.getFollowUpCountForCurrentClaim();
    expect(followUpsThisClaim).toBe(2);
    expect(followUpsThisClaim).toBeLessThanOrEqual(3); // within hard limit
  });
});

// ===========================================================================
// 3. premature_end_rate
// ===========================================================================
describe('Metric: premature_end_rate', () => {
  /**
   * Define a set of scenarios. For each, we know whether END_INTERVIEW
   * should or should not fire. premature_end_rate = (#unexpected ends) / total.
   * Expected: 0%.
   */
  interface EndScenario {
    label: string;
    answer: string;
    consecutiveNonAnswers: number;
    consecutiveFailedClaims: number;
    isGracefulEnd: boolean;
    hasNextClaim: boolean;
    expectEnd: boolean;
  }

  const scenarios: EndScenario[] = [
    { label: 'first non-answer with next claim', answer: '不知道', consecutiveNonAnswers: 0, consecutiveFailedClaims: 0, isGracefulEnd: false, hasNextClaim: true, expectEnd: false },
    { label: 'second non-answer with next claim, <2 failed', answer: '不清楚', consecutiveNonAnswers: 1, consecutiveFailedClaims: 0, isGracefulEnd: false, hasNextClaim: true, expectEnd: false },
    { label: 'second non-answer with next claim, >=2 failed', answer: 'skip', consecutiveNonAnswers: 1, consecutiveFailedClaims: 2, isGracefulEnd: false, hasNextClaim: true, expectEnd: true },
    { label: 'second non-answer, no next claim', answer: 'pass', consecutiveNonAnswers: 1, consecutiveFailedClaims: 0, isGracefulEnd: false, hasNextClaim: false, expectEnd: true },
    { label: 'graceful end, first non-answer', answer: '不知道', consecutiveNonAnswers: 0, consecutiveFailedClaims: 0, isGracefulEnd: true, hasNextClaim: true, expectEnd: true },
    { label: 'substantive answer, should not trigger', answer: 'We used DDD to decompose the monolith into 12 services', consecutiveNonAnswers: 0, consecutiveFailedClaims: 0, isGracefulEnd: false, hasNextClaim: true, expectEnd: false },
    { label: 'graceful end, no next claim', answer: '没有', consecutiveNonAnswers: 0, consecutiveFailedClaims: 0, isGracefulEnd: true, hasNextClaim: false, expectEnd: true },
  ];

  let prematureEndCount = 0;
  let totalScenarios = 0;

  for (const s of scenarios) {
    it(`${s.label} → ${s.expectEnd ? 'END expected' : 'should NOT end'}`, () => {
      totalScenarios++;
      const ctx = {
        consecutiveNonAnswers: s.consecutiveNonAnswers,
        isGracefulEnd: s.isGracefulEnd,
        nextClaim: s.hasNextClaim ? CLAIM_B : null,
        consecutiveFailedClaims: s.consecutiveFailedClaims,
        currentClaimMustVerify: CLAIM_A.mustVerify,
        previouslyCoveredPoints: [],
        language: 'zh-CN' as const,
      };

      const result = detectNonAnswer(s.answer, ctx);
      const ended = result?.decision === 'END_INTERVIEW';

      if (ended && !s.expectEnd) prematureEndCount++;

      if (s.expectEnd) {
        expect(ended).toBe(true);
      } else {
        expect(ended).toBe(false);
      }
    });
  }

  it('premature_end_rate = 0%', () => {
    expect(prematureEndCount).toBe(0);
    const rate = prematureEndCount / totalScenarios;
    expect(rate).toBe(0);
  });
});

// ===========================================================================
// 4. malformed_output_recovery_rate
// ===========================================================================
describe('Metric: malformed_output_recovery_rate', () => {
  /**
   * Feed every LLM response fixture through the parse pipeline.
   * recovery_rate = (# successfully parsed without crash) / total.
   * We expect 100% for parseable shapes and count truncated as known-failure.
   */

  function makeCtx(): OverrideContext {
    return {
      question: 'Test question',
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
    };
  }

  interface FixtureCase {
    label: string;
    input: any;
    isRawString: boolean; // true = needs JSON.parse first (truncated, markdown)
    expectedParseable: boolean;
  }

  const fixtures: FixtureCase[] = [
    { label: 'VALID_RESPONSE', input: VALID_RESPONSE, isRawString: false, expectedParseable: true },
    { label: 'MISSING_DECISION', input: MISSING_DECISION, isRawString: false, expectedParseable: true },
    { label: 'MISSING_SPOKEN_QUESTION', input: MISSING_SPOKEN_QUESTION, isRawString: false, expectedParseable: true },
    { label: 'EMPTY_STRINGS', input: EMPTY_STRINGS, isRawString: false, expectedParseable: true },
    { label: 'INVALID_DECISION_ENUM', input: INVALID_DECISION_ENUM, isRawString: false, expectedParseable: true },
    { label: 'INVALID_ANSWER_STATUS', input: INVALID_ANSWER_STATUS, isRawString: false, expectedParseable: true },
    { label: 'EXTRA_FIELDS', input: EXTRA_FIELDS, isRawString: false, expectedParseable: true },
    { label: 'HALLUCINATED_POINTS', input: HALLUCINATED_POINTS, isRawString: false, expectedParseable: true },
    { label: 'TRUNCATED_JSON', input: TRUNCATED_JSON, isRawString: true, expectedParseable: false },
    { label: 'MARKDOWN_WRAPPED', input: MARKDOWN_WRAPPED, isRawString: true, expectedParseable: true },
  ];

  let recoveredCount = 0;
  let crashedCount = 0;
  let knownFailureCount = 0;

  for (const f of fixtures) {
    it(`${f.label} → ${f.expectedParseable ? 'recoverable' : 'known failure'}`, () => {
      const ctx = makeCtx();
      try {
        let parsed: Record<string, any>;
        if (f.isRawString) {
          const cleaned = (f.input as string).trim().replace(/```json/gi, '').replace(/```/g, '');
          parsed = JSON.parse(cleaned);
        } else {
          parsed = { ...f.input };
        }
        applyDecisionOverrides(parsed, ctx);
        recoveredCount++;

        if (f.expectedParseable) {
          expect(true).toBe(true); // confirmed recovery
        }
      } catch (e) {
        if (!f.expectedParseable) {
          knownFailureCount++;
          expect(true).toBe(true); // expected failure
        } else {
          crashedCount++;
          expect.fail(`${f.label} crashed unexpectedly: ${e}`);
        }
      }
    });
  }

  it('malformed_output_recovery_rate = 100% (of parseable shapes)', () => {
    // Parseable fixtures: all except TRUNCATED_JSON = 9
    const parseableTotal = fixtures.filter(f => f.expectedParseable).length;
    expect(recoveredCount).toBe(parseableTotal);
    expect(crashedCount).toBe(0);

    const recoveryRate = recoveredCount / parseableTotal;
    expect(recoveryRate).toBe(1.0);

    console.log(`\n[Metric: malformed_output_recovery_rate]`);
    console.log(`  Recovered: ${recoveredCount}/${parseableTotal} = ${(recoveryRate * 100).toFixed(0)}%`);
    console.log(`  Known failures (truncated JSON): ${knownFailureCount}`);
    console.log(`  Unexpected crashes: ${crashedCount}`);
  });
});
