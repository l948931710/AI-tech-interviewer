import { Type } from "@google/genai";
import { getAi, withRetry, MODELS, parseJsonResponse } from "./core";
import { Claim, NextStep } from "./types";

export async function getNextInterviewStep(
  question: string, 
  answer: string, 
  currentClaim: Claim, 
  nextClaim: Claim | null, 
  jdText: string,
  history: {q: string, a: string}[],
  isLastQuestion: boolean = false,
  repeatCountForCurrentQuestion: number = 0,
  forceNextClaim: boolean = false,
  followUpCountForCurrentClaim: number = 0,
  totalQuestionsAskedForCurrentClaim: number = 0,
  maxFollowUpsPerClaim: number = 2,
  consecutiveNonAnswers: number = 0,
  previousAnswerStatus: string | null = null,
  previouslyMissingPoints: string[] = [],
  previouslyCoveredPoints: string[] = [],
  questionsAskedForCurrentClaim: string[] = []
): Promise<NextStep> {
  const ai = getAi();
  
  const historyText = history.length > 0 
    ? history.slice(-2).map(t => `Q: ${t.q}\nA: ${t.a}`).join('\n\n')
    : 'None';

  const prompt = `
    You are an expert technical AI interviewer. Your task is to evaluate the candidate's last answer and determine the next step in the interview.
    
    Job Description (JD):
    ${jdText}
    
    Current Claim being evaluated: ${currentClaim.claim}
    Experience/Project Name: ${currentClaim.experienceName || 'Not specified'}
    Must Verify Points: ${currentClaim.mustVerify?.join(', ') || 'None specified'}
    Nice-to-Have Points: ${currentClaim.niceToHave?.join(', ') || 'None specified'}
    Evidence Hints: ${currentClaim.evidenceHints?.join(', ') || 'None specified'}
    
    Next Claim to evaluate (if current is satisfied): ${nextClaim?.claim || 'None (End of Interview)'}
    
    Recent Context (Last 2 turns):
    ${historyText}
    
    --- Current Claim Progress ---
    Questions already asked for this claim (including current):
    ${questionsAskedForCurrentClaim.length > 0 ? questionsAskedForCurrentClaim.map((q, i) => `${i+1}. ${q}`).join('\n') : 'None (First question)'}
    
    Previously Covered Points: ${previouslyCoveredPoints.length > 0 ? previouslyCoveredPoints.join(', ') : 'None yet'}
    Previously Missing Points: ${previouslyMissingPoints.length > 0 ? previouslyMissingPoints.join(', ') : 'N/A'}
    Previous Answer Status: ${previousAnswerStatus || 'N/A'}
    ------------------------------
    
    Current Question: ${question}
    Candidate's Answer: ${answer}
    Repeat Count for Current Question: ${repeatCountForCurrentQuestion}
    Follow-up Count for Current Claim: ${followUpCountForCurrentClaim}
    Total Questions Asked for Current Claim: ${totalQuestionsAskedForCurrentClaim}
    Max Follow-ups Allowed per Claim: ${maxFollowUpsPerClaim}
    Consecutive Non-Answers so far: ${consecutiveNonAnswers}
    
    INSTRUCTIONS:
    1. Evaluate the Candidate's Answer and determine the 'answerStatus':
       - 'answered': The candidate provided a substantial answer that directly addresses the question.
       - 'partial': The candidate answered part of the question but missed key details, or the answer lacked sufficient depth.
       - 'clarification_request': The candidate clearly indicated they didn't hear, didn't understand, or requested clarification of the current question.
       - 'non_answer': The candidate completely dodged the question, gave a very short empty answer, said "I don't remember", repeated the JD without substance, or gave an off-topic/nonsense response.
       
       Provide lightweight scores (1-10) for relevance, specificity, technical depth, ownership, and evidence based on this single turn.
       Provide a 'decisionRationale' (1 sentence) explaining the internal reasoning for the decision.
    
    2. Identify Missing & Covered Points:
       - Based on the "Must Verify Points" and "Evidence Hints", list the specific technical details, metrics, or ownership proof that are still missing ('missingPoints').
       - List the technical details or metrics that have been successfully verified so far ('coveredPoints').
       
    3. Determine the Decision:
       ${forceNextClaim 
         ? (nextClaim ? `- CRITICAL: You MUST decide NEXT_CLAIM because we have reached the time limit for the current claim.` : `- CRITICAL: You MUST decide END_INTERVIEW because we have reached the time limit for the interview.`)
         : `- REPEAT_QUESTION: If answerStatus is 'clarification_request' AND Repeat Count for Current Question is 0.
       - NEXT_CLAIM: If answerStatus is 'non_answer' AND Consecutive Non-Answers so far >= 1 (meaning this is the second non-answer in a row, so we should skip the current claim). Also decide NEXT_CLAIM if the current claim is fully verified and there is a Next Claim.
       - END_INTERVIEW: If the current claim is fully verified (or skipped due to non-answers) and there is no Next Claim.
       - FOLLOW_UP: If answerStatus is 'partial', OR if answerStatus is 'non_answer' but it's the first one, OR if answerStatus is 'clarification_request' but Repeat Count is >= 1, OR if there are missing points in the current claim.
       
       CRITICAL FOLLOW-UP CONSTRAINTS:
       - If followUpCountForCurrentClaim >= ${maxFollowUpsPerClaim}, unless the answer has significantly improved, you MUST prioritize NEXT_CLAIM (or END_INTERVIEW if no next claim).
       - If you have asked multiple times and still haven't received substantial information, stop pursuing this point and move on.`}
       
    4. Formulate the Next Question (in Simplified Chinese):
       - If REPEAT_QUESTION: 
         * If they didn't hear clearly (repeat): Output the exact same Current Question.
         * If they didn't understand the focus (clarify): Rephrase the Current Question to be clearer and more specific.
       - If FOLLOW_UP: 
         * If answerStatus is 'non_answer', gently acknowledge it (e.g., "没关系...") and try asking a different, perhaps easier, angle of the current claim.
         * Otherwise, ask a probing question about the missing points. Explicitly mention the specific experience/project from their resume. Ensure the question aligns with the skills and requirements in the Job Description.
       - If NEXT_CLAIM: Ask an introductory question about the Next Claim. You MUST include a smooth, natural transition acknowledging that we are moving to a new topic (e.g., "好的，关于这段经历我了解得差不多了。接下来我们聊聊你在 [Company/Project] 的工作..."). Explicitly mention the specific experience/project. Ensure the question aligns with the skills and requirements in the Job Description.
       - If END_INTERVIEW: Provide a polite closing statement thanking them for their time.
       
    5. Formulate the Spoken Question (in Simplified Chinese):
       - Generate a \`spokenQuestion\` which is a concise, conversational version of the \`nextQuestion\` optimized for Text-to-Speech. It must be short to minimize TTS latency, but retain the core meaning. Explicitly mention the specific work or project experience name before asking the question.
       
    CONSTRAINTS FOR NEXT QUESTION:
    - DO NOT reveal your evaluation to the candidate (no praising, critiquing, or summarizing). Just ask the question directly.
    ${isLastQuestion ? '- CRITICAL: If decision is FOLLOW_UP or NEXT_CLAIM, you MUST start the question with "这是我们今天的最后一个问题" (This is our final question for today).' : '- Do not mention how many questions are left.'}
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model: MODELS.INTERVIEW,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answerStatus: { type: Type.STRING, description: "answered, partial, clarification_request, or non_answer" },
          decisionRationale: { type: Type.STRING, description: "A 1-sentence internal reasoning for the decision." },
          missingPoints: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of missing technical details, if any." },
          coveredPoints: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of technical details or metrics that have been successfully verified so far." },
          decision: { type: Type.STRING, description: "FOLLOW_UP, NEXT_CLAIM, REPEAT_QUESTION, or END_INTERVIEW" },
          nextQuestion: { type: Type.STRING, description: "The actual question or statement to speak to the candidate." },
          spokenQuestion: { type: Type.STRING, description: "A shorter, conversational version of the nextQuestion optimized for TTS." },
          lightweightScores: {
            type: Type.OBJECT,
            properties: {
              relevance: { type: Type.NUMBER },
              specificity: { type: Type.NUMBER },
              technicalDepth: { type: Type.NUMBER },
              ownership: { type: Type.NUMBER },
              evidence: { type: Type.NUMBER }
            },
            required: ["relevance", "specificity", "technicalDepth", "ownership", "evidence"]
          }
        },
        required: ["answerStatus", "decisionRationale", "missingPoints", "coveredPoints", "decision", "nextQuestion", "spokenQuestion", "lightweightScores"]
      }
    }
  }));

  const parsed = parseJsonResponse<NextStep>(response.text);
  if (!parsed.missingPoints) {
    parsed.missingPoints = [];
  }
  if (!parsed.coveredPoints) {
    parsed.coveredPoints = [];
  }

  // Deterministic Overrides
  let decisionOverridden = false;

  // 1. Clarification Request (Highest Priority)
  if (parsed.answerStatus === 'clarification_request' && repeatCountForCurrentQuestion === 0 && parsed.decision !== 'REPEAT_QUESTION') {
    parsed.decision = 'REPEAT_QUESTION';
    parsed.nextQuestion = question;
    parsed.spokenQuestion = question;
    parsed.decisionRationale = "[Deterministic Override] Candidate requested clarification, repeating the question.";
  } 
  // 2. Force Next Claim (Time Limit Reached)
  else if (forceNextClaim && parsed.decision !== 'NEXT_CLAIM' && parsed.decision !== 'END_INTERVIEW') {
    parsed.decision = nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW';
    decisionOverridden = true;
    parsed.decisionRationale = "[Deterministic Override] Time limit reached for current claim.";
  } 
  // 3. Consecutive Non-Answers
  else if (parsed.answerStatus === 'non_answer' && consecutiveNonAnswers >= 1 && parsed.decision !== 'NEXT_CLAIM' && parsed.decision !== 'END_INTERVIEW') {
    parsed.decision = nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW';
    decisionOverridden = true;
    parsed.decisionRationale = "[Deterministic Override] Consecutive non-answers, skipping current claim.";
  } 
  // 4. Max Follow-ups Reached
  else if (followUpCountForCurrentClaim >= maxFollowUpsPerClaim && parsed.decision === 'FOLLOW_UP') {
    parsed.decision = nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW';
    decisionOverridden = true;
    parsed.decisionRationale = "[Deterministic Override] Max follow-ups reached for current claim.";
  } 
  // 5. No Next Claim Available
  else if (!nextClaim && parsed.decision === 'NEXT_CLAIM') {
    parsed.decision = 'END_INTERVIEW';
    decisionOverridden = true;
    parsed.decisionRationale = "[Deterministic Override] No next claim available, ending interview.";
  }
  // 6. Prevent Infinite Repeat Loop
  else if (parsed.decision === 'REPEAT_QUESTION' && repeatCountForCurrentQuestion >= 1) {
    parsed.decision = 'FOLLOW_UP';
    // We don't set decisionOverridden = true here because we don't have a generic FOLLOW_UP fallback question.
    // We just change the decision state so the system doesn't get stuck, and let it use the model's generated question (which might be a rephrase).
    parsed.decisionRationale = "[Deterministic Override] Max repeats reached, forcing state to FOLLOW_UP.";
  }

  if (decisionOverridden) {
    if (parsed.decision === 'NEXT_CLAIM' && nextClaim) {
      const fallbackQ = `好的，关于这点我了解了。接下来我们聊聊你的另一段经历：${nextClaim.experienceName || '相关项目'}。关于“${nextClaim.claim}”，你能详细说说吗？`;
      parsed.nextQuestion = fallbackQ;
      parsed.spokenQuestion = fallbackQ;
    } else if (parsed.decision === 'END_INTERVIEW') {
      const fallbackQ = "非常感谢你的回答。我们今天的面试就到此结束了，感谢你抽出时间与我交流。后续如果有任何进展，我们的招聘团队会与你联系。祝你生活愉快，再见！";
      parsed.nextQuestion = fallbackQ;
      parsed.spokenQuestion = fallbackQ;
    }
  }

  // Hardcode scores to 0 if the answer is a non-answer
  if (parsed.answerStatus === 'non_answer') {
    parsed.lightweightScores = {
      relevance: 0,
      specificity: 0,
      technicalDepth: 0,
      ownership: 0,
      evidence: 0
    };
  }

  return parsed;
}
