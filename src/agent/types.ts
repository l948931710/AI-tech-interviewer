export interface WorkExperience {
  company: string;
  title: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  bullets?: string[];
}

export interface CandidateInfo {
  name: string;
  email?: string;
  jobRole?: string;
  education: string[];
  workExperience: WorkExperience[];
  technicalSkills: string[];
}

export interface RankingSignals {
  relevanceToRole: number;
  technicalImportance: number;
  ambiguityRisk: number;
  businessImpact: number;
  interviewValue: number;
}

export interface Claim {
  id: string;
  topic: string;
  claim: string;
  experienceName?: string;
  sourceBullet?: string;
  claimType?: 'ownership' | 'implementation' | 'system_design' | 'experimentation' | 'impact' | 'deployment' | 'leadership' | 'domain_knowledge';
  mustVerify: string[];
  niceToHave?: string[];
  evidenceHints?: string[];
  rankingSignals: RankingSignals;
  rationale: string;
}

export interface ResumeAnalysis {
  candidateInfo: CandidateInfo;
  prioritizedClaims: Claim[];
  jobRoleContext: string;
}

export interface EvaluationScores {
  relevance: number;
  specificity: number;
  technicalDepth: number;
  ownership: number;
  evidence: number;
  clarity: number;
}

export interface TurnEvaluation {
  question: string;
  answer: string;
  turnType?: string;
  answerStatus?: string;
  notes: string;
}

export interface ClaimEvaluation {
  claimId?: string;
  claimText: string;
  experienceName?: string;
  verificationStatus: 'strong' | 'partial' | 'weak' | 'unverified';
  riskLevel: 'low' | 'medium' | 'high';
  missingPoints: string[];
  strengths: string[];
  weaknesses: string[];
  scores: EvaluationScores;
  turnEvaluations: TurnEvaluation[];
}

export interface InterviewReport {
  overallRecommendation: string;
  overallScore: number;
  summary: string;
  strongestAreas: string[];
  riskFlags: string[];
  suggestedNextRoundFocus: string[];
  claimEvaluations: ClaimEvaluation[];
}

export interface StructuredInterviewTurn {
  requestId?: string;
  questionId?: string;
  timestamp?: string;
  question: string;
  answer: string;
  claimId?: string;
  claimText?: string;
  experienceName?: string;
  turnType?: "intro" | "main" | "follow_up" | "transition" | "closing" | "repeat" | "clarify";
  answerStatus?: 'answered' | 'partial' | 'clarification_request' | 'non_answer';
  decision?: 'FOLLOW_UP' | 'NEXT_CLAIM' | 'END_INTERVIEW' | 'REPEAT_QUESTION';
  coveredPoints?: string[];
  missingPoints?: string[];
}

export interface NextStep {
  decision: 'FOLLOW_UP' | 'NEXT_CLAIM' | 'END_INTERVIEW' | 'REPEAT_QUESTION';
  followUpIntent?: 'CLARIFY_GAP' | 'DEEPEN' | 'CHALLENGE';
  answerStatus: 'answered' | 'partial' | 'clarification_request' | 'non_answer';
  nextQuestion: string;
  spokenQuestion: string;
  decisionRationale: string;
  missingPoints: string[];
  coveredPoints: string[];
  lightweightScores: {
    relevance: number;
    specificity: number;
    technicalDepth: number;
    ownership: number;
    evidence: number;
  };
}

export * from './memory';
