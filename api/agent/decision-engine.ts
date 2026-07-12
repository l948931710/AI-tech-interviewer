import { Claim } from '../../src/agent/types';

/**
 * Pure decision functions for the interview state machine.
 *
 * These functions contain the deterministic rules that gate, override, or
 * short-circuit the LLM's per-turn decision. They have ZERO side effects —
 * no DB, no network, no LLM calls — which keeps them fully unit-testable.
 *
 * IMPORTANT: buildDecisionRules() is the prompt-facing mirror of
 * applyDecisionOverrides(). The LLM is told the same constraints the ladder
 * enforces, so overrides should only fire on model mistakes. If you change a
 * threshold or rule in one place, update the other (and the tests) together.
 */

// ---------------------------------------------------------------------------
// 1. Non-answer fast-path detection
// ---------------------------------------------------------------------------

const NON_ANSWER_PATTERNS = /^(不知道|不清楚|不了解|没做过|没有|不会|不记得|不太清楚|不太了解|不太知道|我不知道|我不清楚|我不了解|我没做过|我不会|我不记得|没什么|没有了|就这些|说不上来|想不起来|pass|skip|i don'?t know|no idea|not sure|i'?m not sure)$/i;

// The client submits these exact markers when the silence-escalation ladder
// auto-skips a question. They are machine-generated, so handle them
// deterministically here instead of spending an LLM call to interpret them.
const SKIP_MARKER_PATTERNS = [/^（候选人长时间未作答/, /^\(Candidate did not answer/i];

export interface NonAnswerContext {
  consecutiveNonAnswers: number;
  isGracefulEnd: boolean;
  nextClaim: Claim | null;
  consecutiveFailedClaims: number;
  currentClaimMustVerify: string[];
  previouslyCoveredPoints: string[];
  language: 'zh-CN' | 'en-US';
  /** Depth/time limit reached — a retry follow-up is no longer allowed. */
  forceNextClaim?: boolean;
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
  const isSkipMarker = SKIP_MARKER_PATTERNS.some((p) => p.test(trimmed));
  // ASR often appends terminal punctuation ("不知道。", "not sure..."); strip
  // it so the exact-match patterns still hit the fast path.
  const normalized = trimmed.replace(/[\s。．.，,！!？?~～…]+$/g, '');
  if (!isSkipMarker && (trimmed.length >= 30 || !NON_ANSWER_PATTERNS.test(normalized))) {
    return null;
  }

  const mustVerifyPoints = ctx.currentClaimMustVerify;
  const missingPts = mustVerifyPoints.filter(p => !ctx.previouslyCoveredPoints.includes(p));

  // forceNextClaim means the depth/time budget for this claim is spent — a
  // gentle retry follow-up is no longer an option even on a first non-answer.
  if (ctx.consecutiveNonAnswers >= 1 || ctx.isGracefulEnd || !!ctx.forceNextClaim) {
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
  /** Points covered on earlier turns — keeps the LLM from resurrecting them as "missing". */
  previouslyCoveredPoints?: string[];
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
  // Sanitize coveredPoints and missingPoints against mustVerify. A point the
  // LLM lists as missing but that an earlier turn already covered is dropped,
  // so covered points can never be resurrected into the missing list.
  const mustVerifyPoints = ctx.currentClaimMustVerify;
  const prevCovered = ctx.previouslyCoveredPoints || [];
  parsed.coveredPoints = (parsed.coveredPoints || []).filter((p: string) => mustVerifyPoints.includes(p));
  parsed.missingPoints = (parsed.missingPoints || []).filter((p: string) =>
    mustVerifyPoints.includes(p) && !parsed.coveredPoints.includes(p) && !prevCovered.includes(p));

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
      // Target a concrete missing must-verify point when we know one, instead
      // of a contextless "go deeper" prompt.
      const targetPoint = (parsed.missingPoints || [])[0];
      if (targetPoint) {
        parsed.nextQuestion = ctx.language === 'zh-CN'
          ? `关于这段经历，我还想具体了解「${targetPoint}」，能展开说说吗？`
          : `On this experience, I'd like to hear more about "${targetPoint}". Could you walk me through it?`;
      } else {
        parsed.nextQuestion = ctx.language === 'zh-CN'
          ? "关于这一点，你能再深入讲讲技术细节吗？"
          : "Regarding that, could you dive deeper into the technical details?";
      }
      parsed.spokenQuestion = parsed.nextQuestion;
    }
  }

  return decisionOverridden;
}

// ---------------------------------------------------------------------------
// 3. Prompt-side decision rules (pre-LLM)
// ---------------------------------------------------------------------------

export interface DecisionRulesContext {
  forceNextClaim: boolean;
  hasNextClaim: boolean;
  repeatCountForCurrentQuestion: number;
  consecutiveNonAnswers: number;
  totalQuestionsAskedForCurrentClaim: number;
  minQuestionsPerClaim: number;
  followUpCountForCurrentClaim: number;
  maxFollowUpsPerClaim: number;
  hardLimitFollowUps: number;
}

/**
 * Renders the decision rules for the system prompt from the same state that
 * applyDecisionOverrides() enforces. Telling the LLM the real constraints
 * upfront keeps its streamed spoken question consistent with the decision the
 * state machine will accept — the override ladder stays as a backstop for
 * model mistakes rather than the normal path for claim transitions.
 */
export function buildDecisionRules(ctx: DecisionRulesContext): string {
  const advanceTarget = ctx.hasNextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW';

  if (ctx.forceNextClaim) {
    return ctx.hasNextClaim
      ? `- CRITICAL: You MUST decide NEXT_CLAIM — a time/depth limit was reached. Formulate the next question as a natural transition into the Next Claim.`
      : `- CRITICAL: You MUST decide END_INTERVIEW — a time/depth limit was reached. nextQuestion/spokenQuestion must be a brief, courteous closing statement (not a question).`;
  }

  const lines: string[] = [];

  if (ctx.repeatCountForCurrentQuestion === 0) {
    lines.push(`- REPEAT_QUESTION: Only if answerStatus is 'clarification_request' (candidate didn't hear or asked you to repeat).`);
  } else {
    lines.push(`- NEVER decide REPEAT_QUESTION: this question was already repeated once. If the candidate is still confused, decide FOLLOW_UP and rephrase it more simply.`);
  }

  if (ctx.consecutiveNonAnswers >= 1) {
    lines.push(`- If answerStatus is 'non_answer': decide ${advanceTarget} — do not press this claim again.`);
  } else {
    lines.push(`- If answerStatus is 'non_answer': decide FOLLOW_UP, re-approaching the same claim from an easier, more concrete angle.`);
  }

  if (ctx.totalQuestionsAskedForCurrentClaim < ctx.minQuestionsPerClaim) {
    lines.push(`- If answerStatus is 'answered' or 'partial': decide FOLLOW_UP. Do NOT choose NEXT_CLAIM or END_INTERVIEW yet — this claim still needs at least one more probing question.`);
  } else if (ctx.followUpCountForCurrentClaim >= ctx.maxFollowUpsPerClaim) {
    lines.push(`- Depth limit on this claim: decide FOLLOW_UP ONLY if a Must-Verify point is still missing (at most one more follow-up); otherwise decide ${advanceTarget}.`);
  } else {
    lines.push(`- If all Must-Verify points are covered, or the answers are consistently strong and further probing is low-value: decide ${advanceTarget} rather than over-probing.`);
    lines.push(`- Otherwise decide FOLLOW_UP, targeting the highest-value item in Remaining Missing Points (probe depth, ownership, and concrete evidence).`);
  }

  if (ctx.hasNextClaim) {
    lines.push(`- If you decide NEXT_CLAIM: formulate the next question as a natural transition into the Next Claim (briefly acknowledge the current topic first).`);
  } else {
    lines.push(`- There is no Next Claim left: never output NEXT_CLAIM; once this claim is done, decide END_INTERVIEW.`);
  }
  lines.push(`- If you decide END_INTERVIEW: nextQuestion/spokenQuestion must be a brief, courteous closing statement thanking the candidate (not a question).`);

  return lines.join('\n   ');
}
