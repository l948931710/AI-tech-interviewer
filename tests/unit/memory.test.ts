import { describe, it, expect, beforeEach } from 'vitest';
import { InterviewMemory } from '../../src/agent/memory';
import { NextStep } from '../../src/agent/types';
import { CLAIM_A, CLAIM_B, CLAIM_C, THREE_CLAIMS, TEST_JD } from '../fixtures/claims';
import {
  INTRO_ONLY,
  INTRO_PLUS_ONE_MAIN,
  CLAIM_A_FULL_SEQUENCE,
  TWO_CLAIM_SEQUENCE,
  NON_ANSWER_SEQUENCE,
  LEGACY_NO_DECISION
} from '../fixtures/transcripts';

// ---------------------------------------------------------------------------
// Helper: create a minimal NextStep for updateLatestTurnEvaluation
// ---------------------------------------------------------------------------
function makeEval(overrides: Partial<NextStep> = {}): NextStep {
  return {
    decision: 'FOLLOW_UP',
    answerStatus: 'answered',
    nextQuestion: 'Next question?',
    spokenQuestion: 'Next question?',
    decisionRationale: 'test',
    coveredPoints: [],
    missingPoints: [],
    lightweightScores: { relevance: 0, specificity: 0, technicalDepth: 0, ownership: 0, evidence: 0 },
    ...overrides,
  };
}

// ===========================================================================
// 1. Constructor
// ===========================================================================
describe('InterviewMemory — Constructor', () => {
  it('initializes with correct claim count and zero counters', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);

    expect(mem.getClaims()).toHaveLength(3);
    expect(mem.getCurrentClaimIndex()).toBe(0);
    expect(mem.getIntroTurns()).toHaveLength(0);
    expect(mem.getClaimStates()).toHaveLength(0);
    expect(mem.getTotalQuestionsAsked()).toBe(0);
    expect(mem.getTotalNonAnswers()).toBe(0);
    expect(mem.getFailedClaimsCount()).toBe(0);
    expect(mem.getConsecutiveFailedClaims()).toBe(0);
    expect(mem.getIsInterviewEnded()).toBe(false);
    expect(mem.getJobRoleContext()).toBe(TEST_JD);
  });

  it('handles empty claims array', () => {
    const mem = new InterviewMemory([], TEST_JD);
    expect(mem.getClaims()).toHaveLength(0);
    expect(mem.getCurrentClaim()).toBeNull();
    expect(mem.isLastClaim()).toBe(true);
  });
});

// ===========================================================================
// 2. initializeIntroPhase
// ===========================================================================
describe('InterviewMemory — initializeIntroPhase', () => {
  let mem: InterviewMemory;

  beforeEach(() => {
    mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
  });

  it('adds intro turn and increments totalQuestionsAsked', () => {
    mem.initializeIntroPhase('Welcome!', 'Hi!', 'q-intro');

    expect(mem.getIntroTurns()).toHaveLength(1);
    expect(mem.getIntroTurns()[0].q).toBe('Welcome!');
    expect(mem.getIntroTurns()[0].a).toBe('Hi!');
    expect(mem.getIntroTurns()[0].turnType).toBe('intro');
    expect(mem.getTotalQuestionsAsked()).toBe(1);
  });

  it('auto-creates first ClaimState', () => {
    mem.initializeIntroPhase('Welcome!', 'Hi!', 'q-intro');

    expect(mem.getClaimStates()).toHaveLength(1);
    expect(mem.getClaimStates()[0].claim.id).toBe('claim-a');
    expect(mem.getClaimStates()[0].followUpCount).toBe(0);
    expect(mem.getClaimStates()[0].missingPoints).toEqual(CLAIM_A.mustVerify);
  });

  it('does not create ClaimState if no claims exist', () => {
    const emptyMem = new InterviewMemory([], TEST_JD);
    emptyMem.initializeIntroPhase('Welcome!', 'Hi!', 'q-intro');

    expect(emptyMem.getClaimStates()).toHaveLength(0);
    expect(emptyMem.getIntroTurns()).toHaveLength(1);
  });
});

// ===========================================================================
// 3. restoreFromTranscript
// ===========================================================================
describe('InterviewMemory — restoreFromTranscript', () => {
  let mem: InterviewMemory;

  beforeEach(() => {
    mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
  });

  it('restores intro-only transcript correctly', () => {
    mem.restoreFromTranscript(INTRO_ONLY);

    expect(mem.getIntroTurns()).toHaveLength(1);
    expect(mem.getTotalQuestionsAsked()).toBe(1);
  });

  it('restores intro + one main question', () => {
    mem.restoreFromTranscript(INTRO_PLUS_ONE_MAIN);

    expect(mem.getIntroTurns()).toHaveLength(1);
    expect(mem.getClaimStates()).toHaveLength(1);
    expect(mem.getClaimStates()[0].turns).toHaveLength(1);
    expect(mem.getCurrentClaimIndex()).toBe(0);
    expect(mem.getTotalQuestionsAsked()).toBe(2);
  });

  it('restores full claim A sequence (intro + main + 2 follow-ups with NEXT_CLAIM)', () => {
    mem.restoreFromTranscript(CLAIM_A_FULL_SEQUENCE);

    // After NEXT_CLAIM, claim index should advance
    expect(mem.getCurrentClaimIndex()).toBe(1);
    expect(mem.getClaimStates()).toHaveLength(2); // claim-a (completed) + claim-b (initialized)
    expect(mem.getClaimStates()[0].isCompleted).toBe(true);
    expect(mem.getTotalQuestionsAsked()).toBe(4); // intro + main + 2 follow-ups
  });

  it('restores two-claim sequence', () => {
    mem.restoreFromTranscript(TWO_CLAIM_SEQUENCE);

    expect(mem.getCurrentClaimIndex()).toBe(1);
    expect(mem.getClaimStates()).toHaveLength(2);
    expect(mem.getClaimStates()[1].turns).toHaveLength(1);
    expect(mem.getCurrentClaim()?.id).toBe('claim-b');
    expect(mem.getTotalQuestionsAsked()).toBe(5);
  });

  it('restores non-answer sequence and tracks counters', () => {
    mem.restoreFromTranscript(NON_ANSWER_SEQUENCE);

    expect(mem.getTotalNonAnswers()).toBe(2);
    // After 2nd non-answer with NEXT_CLAIM, the claim is skipped
    expect(mem.getFailedClaimsCount()).toBe(1);
    expect(mem.getConsecutiveFailedClaims()).toBe(1);
  });

  it('handles empty transcript gracefully', () => {
    mem.restoreFromTranscript([]);

    expect(mem.getIntroTurns()).toHaveLength(0);
    expect(mem.getClaimStates()).toHaveLength(0);
    expect(mem.getTotalQuestionsAsked()).toBe(0);
  });

  it('handles legacy transcript with no decision field', () => {
    mem.restoreFromTranscript(LEGACY_NO_DECISION);

    expect(mem.getIntroTurns()).toHaveLength(1);
    expect(mem.getClaimStates().length).toBeGreaterThanOrEqual(1);
    // Without explicit decision, should default to FOLLOW_UP
    const lastTurnEval = mem.getClaimStates()[0]?.turns[0]?.evaluation;
    expect(lastTurnEval?.decision).toBe('FOLLOW_UP');
  });

  it('resets all state before replay (idempotency)', () => {
    // First restore
    mem.restoreFromTranscript(CLAIM_A_FULL_SEQUENCE);
    expect(mem.getTotalQuestionsAsked()).toBe(4);

    // Second restore — should produce identical state
    mem.restoreFromTranscript(CLAIM_A_FULL_SEQUENCE);
    expect(mem.getTotalQuestionsAsked()).toBe(4);
    expect(mem.getCurrentClaimIndex()).toBe(1);
    expect(mem.getClaimStates()).toHaveLength(2);
  });
});

// ===========================================================================
// 4. Claim navigation
// ===========================================================================
describe('InterviewMemory — Claim Navigation', () => {
  it('getCurrentClaim returns correct claim at each index', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    expect(mem.getCurrentClaim()?.id).toBe('claim-a');
  });

  it('getNextClaim returns the next claim', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    expect(mem.getNextClaim()?.id).toBe('claim-b');
  });

  it('getNextClaim returns null on last claim', () => {
    const mem = new InterviewMemory([CLAIM_A], TEST_JD);
    expect(mem.getNextClaim()).toBeNull();
  });

  it('isLastClaim is true when on the final claim', () => {
    const mem = new InterviewMemory([CLAIM_A], TEST_JD);
    expect(mem.isLastClaim()).toBe(true);
  });

  it('isLastClaim is false when more claims remain', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    expect(mem.isLastClaim()).toBe(false);
  });
});

// ===========================================================================
// 5. determineStatusAndAdvance
// ===========================================================================
describe('InterviewMemory — determineStatusAndAdvance', () => {
  it('advances currentClaimIndex and creates new ClaimState on NEXT_CLAIM', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'NEXT_CLAIM' }));

    mem.determineStatusAndAdvance('NEXT_CLAIM');

    expect(mem.getCurrentClaimIndex()).toBe(1);
    expect(mem.getClaimStates()).toHaveLength(2);
    expect(mem.getCurrentClaim()?.id).toBe('claim-b');
  });

  it('does not advance past the last claim', () => {
    const mem = new InterviewMemory([CLAIM_A], TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');

    mem.determineStatusAndAdvance('NEXT_CLAIM');

    expect(mem.getCurrentClaimIndex()).toBe(0);
    expect(mem.getClaimStates()).toHaveLength(1);
  });

  it('no-ops on FOLLOW_UP decision', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');
    const indexBefore = mem.getCurrentClaimIndex();

    mem.determineStatusAndAdvance('FOLLOW_UP');

    expect(mem.getCurrentClaimIndex()).toBe(indexBefore);
  });
});

// ===========================================================================
// 6. Counter tracking via updateLatestTurnEvaluation
// ===========================================================================
describe('InterviewMemory — Counter Tracking', () => {
  let mem: InterviewMemory;

  beforeEach(() => {
    mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');
  });

  it('getFollowUpCountForCurrentClaim counts only follow_up turns', () => {
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'FOLLOW_UP' }));
    mem.addTurnToCurrentClaim('Q2', 'A2', 'follow_up', 'q-2');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'FOLLOW_UP' }));
    mem.addTurnToCurrentClaim('Q3', 'A3', 'follow_up', 'q-3');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'FOLLOW_UP' }));

    expect(mem.getFollowUpCountForCurrentClaim()).toBe(2); // Only the follow_up typed turns
  });

  it('getConsecutiveNonAnswers increments on non_answer and resets on answered', () => {
    mem.addTurnToCurrentClaim('Q1', '不知道', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({ answerStatus: 'non_answer' }));
    expect(mem.getConsecutiveNonAnswers()).toBe(1);

    mem.addTurnToCurrentClaim('Q2', '不清楚', 'follow_up', 'q-2');
    mem.updateLatestTurnEvaluation(makeEval({ answerStatus: 'non_answer' }));
    expect(mem.getConsecutiveNonAnswers()).toBe(2);

    mem.addTurnToCurrentClaim('Q3', 'Real answer', 'follow_up', 'q-3');
    mem.updateLatestTurnEvaluation(makeEval({ answerStatus: 'answered' }));
    expect(mem.getConsecutiveNonAnswers()).toBe(0);
  });

  it('getConsecutiveFailedClaims increments on skipped claims, resets on success', () => {
    // Fail claim A (non-answer → skipped)
    mem.addTurnToCurrentClaim('Q1', '不知道', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({
      decision: 'NEXT_CLAIM',
      answerStatus: 'non_answer',
      missingPoints: CLAIM_A.mustVerify
    }));
    mem.determineStatusAndAdvance('NEXT_CLAIM');

    expect(mem.getConsecutiveFailedClaims()).toBe(1);
    expect(mem.getFailedClaimsCount()).toBe(1);

    // Pass claim B: first reduce missingPoints via a follow-up, then NEXT_CLAIM.
    // The failure check in updateLatestTurnEvaluation uses missingPoints state
    // BEFORE the current eval updates it, so we need a prior turn to reduce it.
    mem.addTurnToCurrentClaim('Q2', 'Detailed answer about recommendation engine...', 'main', 'q-2');
    mem.updateLatestTurnEvaluation(makeEval({
      decision: 'FOLLOW_UP',
      answerStatus: 'answered',
      coveredPoints: ['System architecture', 'Scale validation'],
      missingPoints: ['Model serving approach']  // Reduce from 3 to 1
    }));
    mem.addTurnToCurrentClaim('Q3', 'We use TensorFlow Serving with batching...', 'follow_up', 'q-3');
    mem.updateLatestTurnEvaluation(makeEval({
      decision: 'NEXT_CLAIM',
      answerStatus: 'answered',
      coveredPoints: CLAIM_B.mustVerify,
      missingPoints: []
    }));
    mem.determineStatusAndAdvance('NEXT_CLAIM');

    // Now missingPoints was [1 item] at check time, which != mustVerify.length (3)
    // AND answerStatus is 'answered', so consecutiveFailedClaims resets
    expect(mem.getConsecutiveFailedClaims()).toBe(0); // reset
    expect(mem.getFailedClaimsCount()).toBe(1); // cumulative stays
  });

  it('getRepeatCountForQuestion counts same questionId appearances minus 1', () => {
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'REPEAT_QUESTION' }));

    expect(mem.getRepeatCountForQuestion('q-1')).toBe(0); // Only 1 appearance so far

    mem.addTurnToCurrentClaim('Q1 rephrased', 'A1 again', 'repeat', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'FOLLOW_UP' }));

    expect(mem.getRepeatCountForQuestion('q-1')).toBe(1); // 2 appearances - 1
  });

  it('isInterviewEnded set to true on END_INTERVIEW decision', () => {
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'END_INTERVIEW' }));

    expect(mem.getIsInterviewEnded()).toBe(true);
  });

  it('totalNonAnswers is cumulative across claims', () => {
    mem.addTurnToCurrentClaim('Q1', '不知道', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({
      decision: 'NEXT_CLAIM',
      answerStatus: 'non_answer'
    }));
    mem.determineStatusAndAdvance('NEXT_CLAIM');

    mem.addTurnToCurrentClaim('Q2', 'pass', 'main', 'q-2');
    mem.updateLatestTurnEvaluation(makeEval({
      decision: 'FOLLOW_UP',
      answerStatus: 'non_answer'
    }));

    expect(mem.getTotalNonAnswers()).toBe(2);
  });
});

// ===========================================================================
// 7. getPreviousTurnContext
// ===========================================================================
describe('InterviewMemory — getPreviousTurnContext', () => {
  it('returns null answerStatus when only one turn on current claim', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');

    const ctx = mem.getPreviousTurnContext();
    expect(ctx.answerStatus).toBeNull();
  });

  it('returns previous turn answerStatus after 2+ turns', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({ answerStatus: 'partial' }));
    mem.addTurnToCurrentClaim('Q2', 'A2', 'follow_up', 'q-2');

    const ctx = mem.getPreviousTurnContext();
    expect(ctx.answerStatus).toBe('partial');
  });

  it('returns cumulative covered/missing points', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');
    mem.addTurnToCurrentClaim('Q1', 'A1', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({
      coveredPoints: ['Point A'],
      missingPoints: ['Point B', 'Point C']
    }));

    const ctx = mem.getPreviousTurnContext();
    expect(ctx.coveredPoints).toContain('Point A');
    expect(ctx.missingPoints).toEqual(['Point B', 'Point C']);
  });
});

// ===========================================================================
// 8. Multi-claim traversal (end-to-end memory walk)
// ===========================================================================
describe('InterviewMemory — Multi-Claim Traversal', () => {
  it('walks through 3 claims with mixed decisions, final state is correct', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);

    // Intro
    mem.initializeIntroPhase('Welcome', 'Hi', 'q-intro');

    // Claim A: main → follow_up → NEXT_CLAIM
    mem.addTurnToCurrentClaim('Q about A', 'A about A', 'main', 'q-1');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'FOLLOW_UP', answerStatus: 'answered', coveredPoints: ['Point 1'] }));
    mem.addTurnToCurrentClaim('Follow-up A', 'More about A', 'follow_up', 'q-2');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'NEXT_CLAIM', answerStatus: 'answered', coveredPoints: ['Point 1', 'Point 2'] }));
    mem.determineStatusAndAdvance('NEXT_CLAIM');

    expect(mem.getCurrentClaimIndex()).toBe(1);
    expect(mem.getCurrentClaim()?.id).toBe('claim-b');
    expect(mem.getClaimStates()[0].isCompleted).toBe(true);

    // Claim B: main → non_answer → NEXT_CLAIM (failed)
    mem.addTurnToCurrentClaim('Q about B', '不知道', 'main', 'q-3');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'NEXT_CLAIM', answerStatus: 'non_answer', missingPoints: CLAIM_B.mustVerify }));
    mem.determineStatusAndAdvance('NEXT_CLAIM');

    expect(mem.getCurrentClaimIndex()).toBe(2);
    expect(mem.getCurrentClaim()?.id).toBe('claim-c');
    expect(mem.getFailedClaimsCount()).toBe(1);
    expect(mem.getConsecutiveFailedClaims()).toBe(1);

    // Claim C: main → END_INTERVIEW
    mem.addTurnToCurrentClaim('Q about C', 'C answer', 'main', 'q-4');
    mem.updateLatestTurnEvaluation(makeEval({ decision: 'END_INTERVIEW', answerStatus: 'answered' }));

    expect(mem.getIsInterviewEnded()).toBe(true);
    expect(mem.getTotalQuestionsAsked()).toBe(5); // intro + 4 questions
    expect(mem.getTotalNonAnswers()).toBe(1);
    expect(mem.getFlatHistory()).toHaveLength(5);
    expect(mem.isLastClaim()).toBe(true);
  });
});

// ===========================================================================
// 9. getFlatHistory
// ===========================================================================
describe('InterviewMemory — getFlatHistory', () => {
  it('returns intro turns followed by all claim turns in order', () => {
    const mem = new InterviewMemory(THREE_CLAIMS, TEST_JD);
    mem.restoreFromTranscript(TWO_CLAIM_SEQUENCE);

    const flat = mem.getFlatHistory();
    expect(flat).toHaveLength(5);
    expect(flat[0].turnType).toBe('intro');
    expect(flat[1].turnType).toBe('main');
    expect(flat[4].turnType).toBe('main'); // Second claim's main question
  });
});
