import { Claim } from '../../src/agent/types';

/**
 * Pure decision functions extracted from next-step.ts.
 * 
 * These functions contain the deterministic interview state machine rules
 * that override or supplement the LLM's decision. They have ZERO side effects —
 * no DB, no network, no LLM calls. This makes them fully unit-testable.
 * 
 * IMPORTANT: This is a strict behavioral extract from next-step.ts.
 * Do NOT add new logic, change thresholds, or modify enum values here.
 */

// ---------------------------------------------------------------------------
// 1. Non-answer fast-path detection
// ---------------------------------------------------------------------------

const NON_ANSWER_PATTERNS = /^(不知道|不清楚|不了解|没做过|没有|不会|不记得|不太清楚|不太了解|不太知道|我不知道|我不清楚|我不了解|我没做过|我不会|我不记得|没什么|没有了|就这些|说不上来|想不起来|pass|skip|i don'?t know|no idea|not sure|i'?m not sure)$/i;

export interface NonAnswerContext {
  consecutiveNonAnswers: number;
  isGracefulEnd: boolean;
  nextClaim: Claim | null;
  consecutiveFailedClaims: number;
  currentClaimMustVerify: string[];
  previouslyCoveredPoints: string[];
  language: 'zh-CN' | 'en-US';
}

/**
 * Detects if a candidate answer is a non-answer and returns a deterministic
 * fast-path response if so. Returns null if the answer should go to the LLM.
 */
export function detectNonAnswer(
  answer: string,
  ctx: NonAnswerContext
): Record<string, any> | null {
  const trimmed = answer.trim();
  if (trimmed.length >= 30 || !NON_ANSWER_PATTERNS.test(trimmed)) {
    return null;
  }

  const mustVerifyPoints = ctx.currentClaimMustVerify;
  const missingPts = mustVerifyPoints.filter(p => !ctx.previouslyCoveredPoints.includes(p));

  if (ctx.consecutiveNonAnswers >= 1 || ctx.isGracefulEnd) {
    if (ctx.nextClaim && !ctx.isGracefulEnd && ctx.consecutiveFailedClaims < 2) {
      const fallbackQ = ctx.language === 'zh-CN'
        ? `好的，关于这点我了解了。接下来我们聊聊你的另一段经历：${ctx.nextClaim.experienceName || '相关项目'}。关于"${ctx.nextClaim.claim}"，你能详细说说吗？`
        : `Alright, I understand. Next, let's discuss another experience of yours: ${ctx.nextClaim.experienceName || 'a related project'}. Could you elaborate on "${ctx.nextClaim.claim}"?`;
      return {
        answerStatus: 'non_answer', decision: 'NEXT_CLAIM',
        nextQuestion: fallbackQ, spokenQuestion: fallbackQ,
        decisionRationale: '[FastPath] Skipping claim.',
        coveredPoints: ctx.previouslyCoveredPoints,
        missingPoints: missingPts
      };
    } else {
      const fallbackQ = ctx.language === 'zh-CN'
        ? "非常感谢你的回答。我们今天的面试就到此结束了。感谢你抽出时间与我交流。祝你生活愉快，再见！"
        : "Thank you for your answers. We will conclude our interview here for today. Have a great day, goodbye!";
      return {
        answerStatus: 'non_answer', decision: 'END_INTERVIEW',
        nextQuestion: fallbackQ, spokenQuestion: fallbackQ,
        decisionRationale: '[FastPath] Ending interview.',
        coveredPoints: ctx.previouslyCoveredPoints,
        missingPoints: missingPts
      };
    }
  } else {
    const fallbackQ = ctx.language === 'zh-CN'
      ? "没关系，能换个角度聊聊你负责的具体工作吗？"
      : "That's alright. Could you talk about your responsibilities from another perspective?";
    return {
      answerStatus: 'non_answer', decision: 'FOLLOW_UP',
      followUpIntent: 'CLARIFY_GAP',
      nextQuestion: fallbackQ, spokenQuestion: fallbackQ,
      decisionRationale: '[FastPath] First non-answer.',
      coveredPoints: ctx.previouslyCoveredPoints,
      missingPoints: missingPts
    };
  }
}

// ---------------------------------------------------------------------------
// 2. Decision override logic (post-LLM)
// ---------------------------------------------------------------------------

export interface OverrideContext {
  question: string;
  repeatCountForCurrentQuestion: number;
  forceNextClaim: boolean;
  consecutiveNonAnswers: number;
  totalQuestionsAskedForCurrentClaim: number;
  minQuestionsPerClaim: number;
  followUpCountForCurrentClaim: number;
  maxFollowUpsPerClaim: number;
  hardLimitFollowUps: number;
  nextClaim: Claim | null;
  currentClaimMustVerify: string[];
  language: 'zh-CN' | 'en-US';
}

/**
 * Applies deterministic override rules to the LLM's parsed decision.
 * Mutates `parsed` in place and returns whether any override was applied.
 * 
 * Rule precedence (first match wins):
 * 1. clarification_request + first occurrence → REPEAT_QUESTION
 * 2. forceNextClaim active → NEXT_CLAIM or END_INTERVIEW
 * 3. non_answer + consecutive ≥ 1 → NEXT_CLAIM or END_INTERVIEW
 * 4. too few questions asked + LLM says leave → FOLLOW_UP (min-question floor)
 * 5. follow-up limit reached + LLM says FOLLOW_UP → NEXT_CLAIM or END_INTERVIEW
 * 6. no next claim + LLM says NEXT_CLAIM → END_INTERVIEW
 */
export function applyDecisionOverrides(parsed: Record<string, any>, ctx: OverrideContext): boolean {
  // Sanitize coveredPoints and missingPoints against mustVerify
  const mustVerifyPoints = ctx.currentClaimMustVerify;
  parsed.coveredPoints = (parsed.coveredPoints || []).filter((p: string) => mustVerifyPoints.includes(p));
  parsed.missingPoints = (parsed.missingPoints || []).filter((p: string) => mustVerifyPoints.includes(p) && !parsed.coveredPoints.includes(p));

  let decisionOverridden = false;

  if (parsed.answerStatus === 'clarification_request' && ctx.repeatCountForCurrentQuestion === 0 && parsed.decision !== 'REPEAT_QUESTION') {
    parsed.decision = 'REPEAT_QUESTION';
    parsed.nextQuestion = ctx.question;
    parsed.spokenQuestion = ctx.question;
    decisionOverridden = true;
  } else if (ctx.forceNextClaim && parsed.decision !== 'NEXT_CLAIM' && parsed.decision !== 'END_INTERVIEW') {
    parsed.decision = ctx.nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW';
    decisionOverridden = true;
  } else if (parsed.answerStatus === 'non_answer' && ctx.consecutiveNonAnswers >= 1 && parsed.decision !== 'NEXT_CLAIM' && parsed.decision !== 'END_INTERVIEW') {
    parsed.decision = ctx.nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW';
    decisionOverridden = true;
  } else if ((parsed.answerStatus === 'partial' || parsed.answerStatus === 'answered') && ctx.totalQuestionsAskedForCurrentClaim < ctx.minQuestionsPerClaim && (parsed.decision === 'NEXT_CLAIM' || parsed.decision === 'END_INTERVIEW') && !ctx.forceNextClaim) {
    parsed.decision = 'FOLLOW_UP';
    decisionOverridden = true;
  } else if (ctx.followUpCountForCurrentClaim >= ctx.maxFollowUpsPerClaim && parsed.decision === 'FOLLOW_UP') {
    const hasMissing = (parsed.missingPoints || []).length > 0;
    if (!hasMissing || ctx.followUpCountForCurrentClaim >= ctx.hardLimitFollowUps) {
      parsed.decision = ctx.nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW';
      decisionOverridden = true;
    }
  } else if (!ctx.nextClaim && parsed.decision === 'NEXT_CLAIM') {
    parsed.decision = 'END_INTERVIEW';
    decisionOverridden = true;
  }

  if (decisionOverridden) {
    if (parsed.decision === 'NEXT_CLAIM' && ctx.nextClaim) {
      parsed.nextQuestion = ctx.language === 'zh-CN'
        ? `好的。接下来聊聊另一段经历：${ctx.nextClaim.experienceName}。关于"${ctx.nextClaim.claim}"，能详细说说吗？`
        : `Alright. Let's move to ${ctx.nextClaim.experienceName}. Could you elaborate on "${ctx.nextClaim.claim}"?`;
      parsed.spokenQuestion = parsed.nextQuestion;
    } else if (parsed.decision === 'END_INTERVIEW') {
      parsed.nextQuestion = ctx.language === 'zh-CN'
        ? "非常感谢你的回答。我们今天的面试就到此结束了。祝你生活愉快，再见！"
        : "Thank you for your answers. We will conclude our interview here for today. Have a great day, goodbye!";
      parsed.spokenQuestion = parsed.nextQuestion;
    } else if (parsed.decision === 'FOLLOW_UP') {
      parsed.nextQuestion = ctx.language === 'zh-CN'
        ? "关于这一点，你能再深入讲讲技术细节吗？"
        : "Regarding that, could you dive deeper into the technical details?";
      parsed.spokenQuestion = parsed.nextQuestion;
    }
  }

  return decisionOverridden;
}
