export type PersonaType = "strong" | "average" | "bluffer" | "evasive";

export interface SimulationCase {
  id: string;
  jd: string;
  candidateResume: string;
  targetClaims: string[];
  persona: PersonaType;
}

export type ExpectedBehavior = "deepen" | "clarify" | "challenge" | "move_on";

export interface TurnResult {
  question: string;
  answer: string;
  answerStatus: 'answered' | 'partial' | 'clarification_request' | 'non_answer';
  nextQuestionDecision: string;
  expectedBehavior: ExpectedBehavior;
  judgeScore: number; // 0 to 1 based on if expectedBehavior matched NextStep decision logic
  judgeRationale: string;
  tokens: number;
}

export interface SimulationMetrics {
  caseId: string;
  persona: PersonaType;
  turns: number;
  followUpQualityScore: number;
  claimDetectionScore: number;
  nonAnswerCaught: boolean;
  totalTokens: number;
  estimatedCost: number;
  crashed: boolean;
  loopDetected: boolean;
  finalRecommendation: string;
  turnDetails: TurnResult[];
}
