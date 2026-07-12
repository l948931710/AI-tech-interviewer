import { describe, it, expect } from 'vitest';
import { detectNonAnswer, applyDecisionOverrides, buildDecisionRules, NonAnswerContext, OverrideContext, DecisionRulesContext } from '../../api/agent/decision-engine';
import { CLAIM_A, CLAIM_B, CLAIM_C } from '../fixtures/claims';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNonAnswerCtx(overrides: Partial<NonAnswerContext> = {}): NonAnswerContext {
  return {
    consecutiveNonAnswers: 0,
    isGracefulEnd: false,
    nextClaim: CLAIM_B,
    consecutiveFailedClaims: 0,
    currentClaimMustVerify: CLAIM_A.mustVerify,
    previouslyCoveredPoints: [],
    language: 'zh-CN',
    ...overrides,
  };
}

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

function makeParsed(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    answerStatus: 'answered',
    decision: 'FOLLOW_UP',
    nextQuestion: 'LLM question?',
    spokenQuestion: 'LLM question?',
    decisionRationale: 'LLM rationale',
    coveredPoints: [],
    missingPoints: [],
    ...overrides,
  };
}

// ===========================================================================
// 1. detectNonAnswer — Pattern Matching
// ===========================================================================
describe('detectNonAnswer — Pattern Matching', () => {
  it('detects Chinese non-answer: 不知道', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx());
    expect(result).not.toBeNull();
    expect(result!.answerStatus).toBe('non_answer');
  });

  it('detects Chinese non-answer: 不清楚', () => {
    const result = detectNonAnswer('不清楚', makeNonAnswerCtx());
    expect(result).not.toBeNull();
  });

  it('detects Chinese non-answer: 我不记得', () => {
    const result = detectNonAnswer('我不记得', makeNonAnswerCtx());
    expect(result).not.toBeNull();
  });

  it('detects Chinese non-answer: 没有', () => {
    const result = detectNonAnswer('没有', makeNonAnswerCtx());
    expect(result).not.toBeNull();
  });

  it('detects Chinese non-answer: 想不起来', () => {
    const result = detectNonAnswer('想不起来', makeNonAnswerCtx());
    expect(result).not.toBeNull();
  });

  it('detects English non-answer: "i don\'t know"', () => {
    const result = detectNonAnswer("i don't know", makeNonAnswerCtx({ language: 'en-US' }));
    expect(result).not.toBeNull();
    expect(result!.answerStatus).toBe('non_answer');
  });

  it('detects English non-answer: "pass"', () => {
    const result = detectNonAnswer('pass', makeNonAnswerCtx({ language: 'en-US' }));
    expect(result).not.toBeNull();
  });

  it('detects English non-answer: "not sure"', () => {
    const result = detectNonAnswer('not sure', makeNonAnswerCtx({ language: 'en-US' }));
    expect(result).not.toBeNull();
  });

  it('detects English non-answer: "skip" (case-insensitive)', () => {
    const result = detectNonAnswer('SKIP', makeNonAnswerCtx({ language: 'en-US' }));
    expect(result).not.toBeNull();
  });

  it('detects "i dont know" (without apostrophe)', () => {
    const result = detectNonAnswer('i dont know', makeNonAnswerCtx({ language: 'en-US' }));
    expect(result).not.toBeNull();
  });

  it('returns null for a substantive answer', () => {
    const result = detectNonAnswer('We used domain-driven design to decompose the monolith into 12 microservices.', makeNonAnswerCtx());
    expect(result).toBeNull();
  });

  it('returns null for answers >= 30 chars even if they contain a non-answer pattern', () => {
    // This is >30 chars and starts with a non-answer phrase
    const result = detectNonAnswer('不知道但是我可以从另外一个角度来分析一下这个事情的处理方式', makeNonAnswerCtx());
    expect(result).toBeNull();
  });

  it('returns null for empty string (does not match regex)', () => {
    const result = detectNonAnswer('', makeNonAnswerCtx());
    expect(result).toBeNull();
  });

  it('handles whitespace-padded non-answer', () => {
    const result = detectNonAnswer('  不知道  ', makeNonAnswerCtx());
    expect(result).not.toBeNull();
  });

  it('detects non-answer with trailing ASR punctuation: 不知道。', () => {
    const result = detectNonAnswer('不知道。', makeNonAnswerCtx());
    expect(result).not.toBeNull();
    expect(result!.answerStatus).toBe('non_answer');
  });

  it('detects non-answer with trailing ellipsis: "not sure..."', () => {
    const result = detectNonAnswer('not sure...', makeNonAnswerCtx({ language: 'en-US' }));
    expect(result).not.toBeNull();
  });

  it('does NOT match punctuation-only input', () => {
    const result = detectNonAnswer('。。。', makeNonAnswerCtx());
    expect(result).toBeNull();
  });

  it('detects the zh auto-skip marker despite not matching the phrase list', () => {
    const result = detectNonAnswer('（候选人长时间未作答，跳过此问题）', makeNonAnswerCtx());
    expect(result).not.toBeNull();
    expect(result!.answerStatus).toBe('non_answer');
    expect(result!.decision).toBe('FOLLOW_UP'); // first skip → gentle retry
  });

  it('detects the en auto-skip marker even though it is >= 30 chars', () => {
    const result = detectNonAnswer(
      '(Candidate did not answer for a long time, skipping question)',
      makeNonAnswerCtx({ language: 'en-US' })
    );
    expect(result).not.toBeNull();
    expect(result!.answerStatus).toBe('non_answer');
  });
});

// ===========================================================================
// 2. detectNonAnswer — Decision Branching
// ===========================================================================
describe('detectNonAnswer — Decision Branching', () => {
  it('first non-answer (consecutiveNonAnswers=0) → FOLLOW_UP', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx({ consecutiveNonAnswers: 0 }));
    expect(result).not.toBeNull();
    expect(result!.decision).toBe('FOLLOW_UP');
    expect(result!.followUpIntent).toBe('CLARIFY_GAP');
  });

  it('second consecutive non-answer with nextClaim → NEXT_CLAIM', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx({
      consecutiveNonAnswers: 1,
      nextClaim: CLAIM_B,
    }));
    expect(result!.decision).toBe('NEXT_CLAIM');
  });

  it('second consecutive non-answer, no next claim → END_INTERVIEW', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx({
      consecutiveNonAnswers: 1,
      nextClaim: null,
    }));
    expect(result!.decision).toBe('END_INTERVIEW');
  });

  it('second consecutive non-answer during graceful end → END_INTERVIEW', () => {
    const result = detectNonAnswer('pass', makeNonAnswerCtx({
      consecutiveNonAnswers: 1,
      isGracefulEnd: true,
      nextClaim: CLAIM_B,
    }));
    expect(result!.decision).toBe('END_INTERVIEW');
  });

  it('second consecutive non-answer + 2 consecutive failed claims → END_INTERVIEW', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx({
      consecutiveNonAnswers: 1,
      consecutiveFailedClaims: 2,
      nextClaim: CLAIM_B,
    }));
    expect(result!.decision).toBe('END_INTERVIEW');
  });

  it('graceful end (first non-answer) → END_INTERVIEW (isGracefulEnd overrides consecutiveNonAnswers)', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx({
      consecutiveNonAnswers: 0,
      isGracefulEnd: true,
      nextClaim: null,
    }));
    expect(result!.decision).toBe('END_INTERVIEW');
  });

  it('produces Chinese text for zh-CN first non-answer', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx({ language: 'zh-CN', consecutiveNonAnswers: 0 }));
    expect(result!.nextQuestion).toContain('没关系');
  });

  it('produces English text for en-US first non-answer', () => {
    const result = detectNonAnswer('pass', makeNonAnswerCtx({ language: 'en-US', consecutiveNonAnswers: 0 }));
    expect(result!.nextQuestion).toContain("That's alright");
  });

  it('missingPoints excludes previously covered points', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx({
      currentClaimMustVerify: ['Point A', 'Point B', 'Point C'],
      previouslyCoveredPoints: ['Point A'],
    }));
    expect(result!.missingPoints).toEqual(['Point B', 'Point C']);
    expect(result!.coveredPoints).toEqual(['Point A']);
  });

  it('forceNextClaim skips the gentle-retry branch even on a FIRST non-answer', () => {
    const result = detectNonAnswer('不知道', makeNonAnswerCtx({
      consecutiveNonAnswers: 0,
      forceNextClaim: true,
      nextClaim: CLAIM_B,
    }));
    expect(result!.decision).toBe('NEXT_CLAIM'); // depth budget spent — no more retries here
  });

  it('forceNextClaim with no next claim → END_INTERVIEW on a first non-answer', () => {
    const result = detectNonAnswer('pass', makeNonAnswerCtx({
      consecutiveNonAnswers: 0,
      forceNextClaim: true,
      nextClaim: null,
      language: 'en-US',
    }));
    expect(result!.decision).toBe('END_INTERVIEW');
  });
});

// ===========================================================================
// 3. applyDecisionOverrides — Rule 1: clarification_request → REPEAT
// ===========================================================================
describe('applyDecisionOverrides — Clarification Repeat', () => {
  it('overrides to REPEAT_QUESTION when clarification_request + repeatCount=0', () => {
    const parsed = makeParsed({ answerStatus: 'clarification_request', decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ repeatCountForCurrentQuestion: 0 });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('REPEAT_QUESTION');
    expect(parsed.nextQuestion).toBe(ctx.question);
  });

  it('does NOT override if repeatCount > 0 (already repeated)', () => {
    const parsed = makeParsed({ answerStatus: 'clarification_request', decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ repeatCountForCurrentQuestion: 1 });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(false);
    expect(parsed.decision).toBe('FOLLOW_UP');
  });

  it('does NOT override if LLM already decided REPEAT_QUESTION', () => {
    const parsed = makeParsed({ answerStatus: 'clarification_request', decision: 'REPEAT_QUESTION' });
    const ctx = makeOverrideCtx({ repeatCountForCurrentQuestion: 0 });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(false);
  });
});

// ===========================================================================
// 4. applyDecisionOverrides — Rule 2: forceNextClaim
// ===========================================================================
describe('applyDecisionOverrides — Force Next Claim', () => {
  it('forces NEXT_CLAIM when forceNextClaim=true and LLM says FOLLOW_UP', () => {
    const parsed = makeParsed({ decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ forceNextClaim: true, nextClaim: CLAIM_B });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });

  it('forces END_INTERVIEW when forceNextClaim=true and no nextClaim', () => {
    const parsed = makeParsed({ decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ forceNextClaim: true, nextClaim: null });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('END_INTERVIEW');
  });

  it('does NOT override if LLM already says NEXT_CLAIM', () => {
    const parsed = makeParsed({ decision: 'NEXT_CLAIM' });
    const ctx = makeOverrideCtx({ forceNextClaim: true });
    const overridden = applyDecisionOverrides(parsed, ctx);
    // Rule 2 doesn't fire (condition: decision !== NEXT_CLAIM && !== END_INTERVIEW)
    // But Rule 6 may fire if nextClaim is set — that's a no-op since already NEXT_CLAIM
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });
});

// ===========================================================================
// 5. applyDecisionOverrides — Rule 3: consecutive non-answers
// ===========================================================================
describe('applyDecisionOverrides — Consecutive Non-Answers', () => {
  it('overrides to NEXT_CLAIM when non_answer + consecutive>=1 + LLM says FOLLOW_UP', () => {
    const parsed = makeParsed({ answerStatus: 'non_answer', decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ consecutiveNonAnswers: 1, nextClaim: CLAIM_B });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });

  it('overrides to END_INTERVIEW when non_answer + consecutive>=1 + no nextClaim', () => {
    const parsed = makeParsed({ answerStatus: 'non_answer', decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ consecutiveNonAnswers: 2, nextClaim: null });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('END_INTERVIEW');
  });

  it('does NOT override if LLM already says NEXT_CLAIM for non_answer', () => {
    const parsed = makeParsed({ answerStatus: 'non_answer', decision: 'NEXT_CLAIM' });
    const ctx = makeOverrideCtx({ consecutiveNonAnswers: 1 });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });
});

// ===========================================================================
// 6. applyDecisionOverrides — Rule 4: minimum questions floor
// ===========================================================================
describe('applyDecisionOverrides — Min Questions Floor', () => {
  it('forces FOLLOW_UP when LLM says NEXT_CLAIM but too few questions asked', () => {
    const parsed = makeParsed({ answerStatus: 'answered', decision: 'NEXT_CLAIM' });
    const ctx = makeOverrideCtx({
      totalQuestionsAskedForCurrentClaim: 1,
      minQuestionsPerClaim: 2,
      forceNextClaim: false,
    });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('FOLLOW_UP');
  });

  it('forces FOLLOW_UP when LLM says END_INTERVIEW but too few questions', () => {
    const parsed = makeParsed({ answerStatus: 'partial', decision: 'END_INTERVIEW' });
    const ctx = makeOverrideCtx({
      totalQuestionsAskedForCurrentClaim: 1,
      minQuestionsPerClaim: 2,
      forceNextClaim: false,
    });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('FOLLOW_UP');
  });

  it('does NOT force FOLLOW_UP if forceNextClaim is active', () => {
    const parsed = makeParsed({ answerStatus: 'answered', decision: 'NEXT_CLAIM' });
    const ctx = makeOverrideCtx({
      totalQuestionsAskedForCurrentClaim: 1,
      minQuestionsPerClaim: 2,
      forceNextClaim: true,
    });
    const overridden = applyDecisionOverrides(parsed, ctx);
    // forceNextClaim (Rule 2) fires first — decision stays NEXT_CLAIM
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });

  it('does NOT force FOLLOW_UP if enough questions asked', () => {
    const parsed = makeParsed({ answerStatus: 'answered', decision: 'NEXT_CLAIM' });
    const ctx = makeOverrideCtx({
      totalQuestionsAskedForCurrentClaim: 3,
      minQuestionsPerClaim: 2,
    });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });
});

// ===========================================================================
// 7. applyDecisionOverrides — Rule 5: follow-up limit
// ===========================================================================
describe('applyDecisionOverrides — Follow-Up Limit', () => {
  it('overrides FOLLOW_UP to NEXT_CLAIM when at maxFollowUps + no missing points', () => {
    const parsed = makeParsed({ decision: 'FOLLOW_UP', missingPoints: [] });
    const ctx = makeOverrideCtx({
      followUpCountForCurrentClaim: 2,
      maxFollowUpsPerClaim: 2,
      nextClaim: CLAIM_B,
    });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });

  it('allows FOLLOW_UP past maxFollowUps if missing points remain AND under hardLimit', () => {
    const parsed = makeParsed({
      decision: 'FOLLOW_UP',
      missingPoints: ['Point A'],
      coveredPoints: [],
    });
    const ctx = makeOverrideCtx({
      followUpCountForCurrentClaim: 2,
      maxFollowUpsPerClaim: 2,
      hardLimitFollowUps: 3,
      currentClaimMustVerify: ['Point A'],
    });
    const overridden = applyDecisionOverrides(parsed, ctx);
    // hasMissing=true AND followUpCount(2) < hardLimit(3), so override does NOT fire
    expect(overridden).toBe(false);
    expect(parsed.decision).toBe('FOLLOW_UP');
  });

  it('forces NEXT_CLAIM at hardLimit even with missing points', () => {
    const parsed = makeParsed({
      decision: 'FOLLOW_UP',
      missingPoints: ['Point A'],
      coveredPoints: [],
    });
    const ctx = makeOverrideCtx({
      followUpCountForCurrentClaim: 3,
      maxFollowUpsPerClaim: 2,
      hardLimitFollowUps: 3,
      nextClaim: CLAIM_B,
      currentClaimMustVerify: ['Point A'],
    });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });
});

// ===========================================================================
// 8. applyDecisionOverrides — Rule 6: no next claim
// ===========================================================================
describe('applyDecisionOverrides — No Next Claim', () => {
  it('overrides NEXT_CLAIM → END_INTERVIEW when there is no next claim', () => {
    const parsed = makeParsed({ decision: 'NEXT_CLAIM' });
    const ctx = makeOverrideCtx({ nextClaim: null });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(true);
    expect(parsed.decision).toBe('END_INTERVIEW');
  });
});

// ===========================================================================
// 9. applyDecisionOverrides — Override Text Generation
// ===========================================================================
describe('applyDecisionOverrides — Text Generation', () => {
  it('generates zh-CN transition text on NEXT_CLAIM override', () => {
    const parsed = makeParsed({ decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ forceNextClaim: true, nextClaim: CLAIM_B, language: 'zh-CN' });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.nextQuestion).toContain('接下来聊聊');
    expect(parsed.nextQuestion).toContain(CLAIM_B.experienceName);
    expect(parsed.spokenQuestion).toBe(parsed.nextQuestion);
  });

  it('generates en-US transition text on NEXT_CLAIM override', () => {
    const parsed = makeParsed({ decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ forceNextClaim: true, nextClaim: CLAIM_B, language: 'en-US' });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.nextQuestion).toContain("Let's move to");
    expect(parsed.nextQuestion).toContain(CLAIM_B.experienceName!);
  });

  it('generates zh-CN goodbye text on END_INTERVIEW override', () => {
    const parsed = makeParsed({ decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ forceNextClaim: true, nextClaim: null, language: 'zh-CN' });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.nextQuestion).toContain('感谢');
  });

  it('generates en-US goodbye text on END_INTERVIEW override', () => {
    const parsed = makeParsed({ decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({ forceNextClaim: true, nextClaim: null, language: 'en-US' });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.nextQuestion).toContain('Thank you');
  });

  it('generates zh-CN follow-up text on FOLLOW_UP override', () => {
    const parsed = makeParsed({ answerStatus: 'answered', decision: 'NEXT_CLAIM' });
    const ctx = makeOverrideCtx({
      totalQuestionsAskedForCurrentClaim: 1,
      minQuestionsPerClaim: 2,
      forceNextClaim: false,
      language: 'zh-CN',
    });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.nextQuestion).toContain('技术细节');
  });

  it('FOLLOW_UP override targets the first missing must-verify point when one is known', () => {
    const parsed = makeParsed({
      answerStatus: 'answered',
      decision: 'NEXT_CLAIM',
      coveredPoints: [],
      missingPoints: ['rollback strategy', 'team size'],
    });
    const ctx = makeOverrideCtx({
      totalQuestionsAskedForCurrentClaim: 1,
      minQuestionsPerClaim: 2,
      forceNextClaim: false,
      currentClaimMustVerify: ['rollback strategy', 'team size'],
      language: 'en-US',
    });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.decision).toBe('FOLLOW_UP');
    expect(parsed.nextQuestion).toContain('rollback strategy');
    expect(parsed.spokenQuestion).toBe(parsed.nextQuestion);
  });
});

// ===========================================================================
// 10. applyDecisionOverrides — No Override (Pass-Through)
// ===========================================================================
describe('applyDecisionOverrides — No Override', () => {
  it('passes through a well-formed LLM FOLLOW_UP untouched', () => {
    const llmQuestion = 'Can you tell me more about the architecture?';
    const parsed = makeParsed({
      answerStatus: 'answered',
      decision: 'FOLLOW_UP',
      nextQuestion: llmQuestion,
      spokenQuestion: llmQuestion,
    });
    const ctx = makeOverrideCtx({
      totalQuestionsAskedForCurrentClaim: 3,
      followUpCountForCurrentClaim: 1,
    });
    const overridden = applyDecisionOverrides(parsed, ctx);
    expect(overridden).toBe(false);
    expect(parsed.nextQuestion).toBe(llmQuestion);
    expect(parsed.decision).toBe('FOLLOW_UP');
  });
});

// ===========================================================================
// 11. applyDecisionOverrides — coveredPoints/missingPoints Sanitization
// ===========================================================================
describe('applyDecisionOverrides — Point Sanitization', () => {
  it('filters coveredPoints to only include values from mustVerify', () => {
    const parsed = makeParsed({
      coveredPoints: ['Valid Point', 'Hallucinated Point'],
      missingPoints: ['Also Hallucinated', 'Another Valid Point'],
    });
    const ctx = makeOverrideCtx({
      currentClaimMustVerify: ['Valid Point', 'Another Valid Point'],
    });
    applyDecisionOverrides(parsed, ctx);
    // 'Valid Point' is in mustVerify → kept. 'Hallucinated Point' is not → removed.
    expect(parsed.coveredPoints).toEqual(['Valid Point']);
    // 'Another Valid Point' is in mustVerify and NOT in coveredPoints → kept.
    // 'Also Hallucinated' is NOT in mustVerify → removed.
    expect(parsed.missingPoints).toEqual(['Another Valid Point']);
  });

  it('missingPoints excludes already-covered points', () => {
    const parsed = makeParsed({
      coveredPoints: ['Point A', 'Point B'],
      missingPoints: ['Point A', 'Point C'], // Point A is both covered and missing
    });
    const ctx = makeOverrideCtx({
      currentClaimMustVerify: ['Point A', 'Point B', 'Point C'],
    });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.coveredPoints).toEqual(['Point A', 'Point B']);
    expect(parsed.missingPoints).toEqual(['Point C']);
  });

  it('handles null/undefined coveredPoints and missingPoints', () => {
    const parsed = makeParsed({
      coveredPoints: undefined,
      missingPoints: null,
    });
    const ctx = makeOverrideCtx();
    // Should not throw
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.coveredPoints).toEqual([]);
    expect(parsed.missingPoints).toEqual([]);
  });

  it('missingPoints cannot resurrect points covered on EARLIER turns', () => {
    const parsed = makeParsed({
      coveredPoints: [],                    // LLM forgot Point A was covered before...
      missingPoints: ['Point A', 'Point B'], // ...and lists it as missing again
    });
    const ctx = makeOverrideCtx({
      currentClaimMustVerify: ['Point A', 'Point B'],
      previouslyCoveredPoints: ['Point A'],
    });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.missingPoints).toEqual(['Point B']);
  });
});

// ===========================================================================
// 12. Rule Precedence
// ===========================================================================
describe('applyDecisionOverrides — Precedence', () => {
  it('Rule 1 (clarification) wins over Rule 3 (non_answer) when both could match', () => {
    // Edge case: answerStatus=clarification_request AND consecutiveNonAnswers>=1
    // Rule 1 should fire first because it appears first in the if-else chain
    const parsed = makeParsed({ answerStatus: 'clarification_request', decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({
      repeatCountForCurrentQuestion: 0,
      consecutiveNonAnswers: 2,
    });
    applyDecisionOverrides(parsed, ctx);
    // Rule 1 fires → REPEAT_QUESTION (not NEXT_CLAIM from Rule 3)
    expect(parsed.decision).toBe('REPEAT_QUESTION');
  });

  it('Rule 2 (forceNextClaim) wins over Rule 4 (min questions)', () => {
    // forceNextClaim=true AND totalQuestions < min. Rule 2 fires first.
    const parsed = makeParsed({ answerStatus: 'answered', decision: 'FOLLOW_UP' });
    const ctx = makeOverrideCtx({
      forceNextClaim: true,
      totalQuestionsAskedForCurrentClaim: 1,
      minQuestionsPerClaim: 2,
      nextClaim: CLAIM_B,
    });
    applyDecisionOverrides(parsed, ctx);
    expect(parsed.decision).toBe('NEXT_CLAIM');
  });
});

// ===========================================================================
// 13. buildDecisionRules — prompt-side mirror of the override ladder
// ===========================================================================
describe('buildDecisionRules', () => {
  function makeRulesCtx(overrides: Partial<DecisionRulesContext> = {}): DecisionRulesContext {
    return {
      forceNextClaim: false,
      hasNextClaim: true,
      repeatCountForCurrentQuestion: 0,
      consecutiveNonAnswers: 0,
      totalQuestionsAskedForCurrentClaim: 3,
      minQuestionsPerClaim: 2,
      followUpCountForCurrentClaim: 1,
      maxFollowUpsPerClaim: 2,
      hardLimitFollowUps: 3,
      ...overrides,
    };
  }

  it('forceNextClaim + next claim → mandates NEXT_CLAIM with a transition', () => {
    const rules = buildDecisionRules(makeRulesCtx({ forceNextClaim: true, hasNextClaim: true }));
    expect(rules).toContain('MUST decide NEXT_CLAIM');
    expect(rules).not.toContain('FOLLOW_UP:');
  });

  it('forceNextClaim + no next claim → mandates END_INTERVIEW with a closing statement', () => {
    const rules = buildDecisionRules(makeRulesCtx({ forceNextClaim: true, hasNextClaim: false }));
    expect(rules).toContain('MUST decide END_INTERVIEW');
    expect(rules).toContain('closing statement');
  });

  it('mirrors Rule 4: below the min-question floor, forbids leaving the claim', () => {
    const rules = buildDecisionRules(makeRulesCtx({ totalQuestionsAskedForCurrentClaim: 1 }));
    expect(rules).toContain('Do NOT choose NEXT_CLAIM or END_INTERVIEW yet');
  });

  it('mirrors Rule 5: at the follow-up cap, allows one more only for missing points', () => {
    const rules = buildDecisionRules(makeRulesCtx({ followUpCountForCurrentClaim: 2 }));
    expect(rules).toContain('ONLY if a Must-Verify point is still missing');
  });

  it('mid-claim: allows adaptive advancement once coverage is achieved', () => {
    const rules = buildDecisionRules(makeRulesCtx());
    expect(rules).toContain('If all Must-Verify points are covered');
    expect(rules).toContain('decide NEXT_CLAIM');
  });

  it('adaptive advancement points at END_INTERVIEW on the last claim', () => {
    const rules = buildDecisionRules(makeRulesCtx({ hasNextClaim: false }));
    expect(rules).toContain('never output NEXT_CLAIM');
    expect(rules).toContain('decide END_INTERVIEW');
  });

  it('mirrors Rule 1: forbids a second repeat of the same question', () => {
    const rules = buildDecisionRules(makeRulesCtx({ repeatCountForCurrentQuestion: 1 }));
    expect(rules).toContain('NEVER decide REPEAT_QUESTION');
  });

  it('mirrors Rule 3: after a prior non-answer, directs away from the claim', () => {
    const rules = buildDecisionRules(makeRulesCtx({ consecutiveNonAnswers: 1 }));
    expect(rules).toContain("If answerStatus is 'non_answer': decide NEXT_CLAIM");
  });
});
