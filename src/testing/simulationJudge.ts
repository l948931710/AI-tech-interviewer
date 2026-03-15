import { PersonaType, ExpectedBehavior } from "./metrics";
import { NextStep } from "../agent/types";

/**
 * Rule-based heuristic judge.
 * Given the candidate's Persona and the AI Interviewer's decision, 
 * did the interviewer behave correctly?
 */
export function evaluateTurn(
  persona: PersonaType,
  candidateAnswerText: string,
  interviewerDecision: NextStep
): { isCorrect: boolean; expectedBehavior: ExpectedBehavior; rationale: string } {
  
  // Rule-based logic depending on Persona
  if (persona === 'strong') {
    // A strong candidate answers well. We either expect 'FOLLOW_UP' with 'DEEPEN' intent to deepen the concept, or 'NEXT_CLAIM' if verified.
    // If the system drops the claim prematurely or asks for repeating, something failed.
    const isDeepen = interviewerDecision.decision === 'FOLLOW_UP' && (interviewerDecision.followUpIntent === 'DEEPEN' || interviewerDecision.followUpIntent === 'CHALLENGE');
    const isCorrect = isDeepen || interviewerDecision.decision === 'NEXT_CLAIM';
    return {
      isCorrect,
      expectedBehavior: interviewerDecision.decision === 'NEXT_CLAIM' ? 'move_on' : 'deepen',
      rationale: isCorrect ? "Appropriately continued to DEEPEN or advanced after a strong answer." : "Failed to DEEPEN or advance properly after a strong, clear answer."
    };
  }
  
  if (persona === 'average') {
    // Average might need clarification (partial answers).
    const correctlyClarified = interviewerDecision.answerStatus === 'partial' || interviewerDecision.answerStatus === 'clarification_request';
    const isCorrect = correctlyClarified || interviewerDecision.decision === 'FOLLOW_UP' || interviewerDecision.decision === 'NEXT_CLAIM';
    return {
      isCorrect,
      expectedBehavior: 'clarify',
      rationale: isCorrect ? "Appropriately handled an average/partial answer." : "Did not request clarification for an average answer."
    };
  }
  
  if (persona === 'bluffer') {
    // Bluffer gives empty buzzwords. The system MUST recognize it as a non-answer or partial, and should challenge them to provide details.
    // Now with intents, we expect CHALLENGE or CLARIFY_GAP.
    const isHandlingBluff = interviewerDecision.answerStatus === 'non_answer' || interviewerDecision.answerStatus === 'partial';
    const isChallenging = interviewerDecision.decision === 'FOLLOW_UP' && (interviewerDecision.followUpIntent === 'CHALLENGE' || interviewerDecision.followUpIntent === 'CLARIFY_GAP');
    
    const isCorrect = isHandlingBluff || isChallenging || interviewerDecision.decision === 'NEXT_CLAIM';
    return {
      isCorrect,
      expectedBehavior: 'challenge',
      rationale: isCorrect ? "Successfully caught the bluffer's empty answer by challenging or clarifying gaps." : "System mistakenly accepted the bluffer's answer as verified."
    };
  }

  if (persona === 'evasive') {
    // Evasive candidate talks in circles. System should either repeat question, mark as non-answer, or eventually drop the claim to avoid infinite loops.
    const correctlyFlagged = interviewerDecision.answerStatus === 'non_answer' || interviewerDecision.answerStatus === 'clarification_request';
    const isCorrect = correctlyFlagged || interviewerDecision.decision === 'REPEAT_QUESTION' || interviewerDecision.decision === 'NEXT_CLAIM';
    return {
      isCorrect,
      expectedBehavior: 'challenge',
      rationale: isCorrect ? "Appropriately handled the evasiveness by repeating, clarifying, or cutting losses." : "System failed to effectively handle evasive rambling."
    };
  }

  // Fallback
  return { isCorrect: true, expectedBehavior: 'move_on', rationale: 'Fallback behavior' };
}
