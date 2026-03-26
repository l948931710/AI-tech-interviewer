import { Claim, NextStep } from './types';

export type TurnType = 'intro' | 'main' | 'follow_up' | 'repeat' | 'clarify' | 'transition';

export interface InterviewTurn {
  questionId: string;
  q: string;
  a: string;
  turnType: TurnType;
  timestamp: string;
  evaluation?: NextStep;
}

export interface ClaimState {
  claim: Claim;
  turns: InterviewTurn[];
  
  askedPoints: string[];
  coveredPoints: string[];
  missingPoints: string[];
  verificationStatus: 'unverified' | 'weak' | 'partial' | 'strong';

  followUpCount: number;
  repeatCount: number;
  consecutiveNonAnswers: number;

  isCompleted: boolean;
  isSkipped: boolean;
}

export class InterviewMemory {
  private claims: Claim[];
  private currentClaimIndex: number;
  private introTurns: InterviewTurn[];
  private claimStates: ClaimState[];
  private jobRoleContext: string;

  // Global Session Counters
  private totalQuestionsAsked: number;
  private totalNonAnswers: number;
  private failedClaimsCount: number;
  private consecutiveFailedClaims: number;
  private isInterviewEnded: boolean;

  constructor(claims: Claim[], jobRoleContext: string) {
    this.claims = claims;
    this.currentClaimIndex = 0;
    this.introTurns = [];
    this.claimStates = [];
    this.jobRoleContext = jobRoleContext;
    
    this.totalQuestionsAsked = 0;
    this.totalNonAnswers = 0;
    this.failedClaimsCount = 0;
    this.consecutiveFailedClaims = 0;
    this.isInterviewEnded = false;
  }

  public getJobRoleContext(): string {
    return this.jobRoleContext;
  }

  public getClaims(): Claim[] {
    return this.claims;
  }

  public getCurrentClaimIndex(): number {
    return this.currentClaimIndex;
  }

  public getIntroTurns(): InterviewTurn[] {
    return this.introTurns;
  }

  public getClaimStates(): ClaimState[] {
    return this.claimStates;
  }

  public getCurrentClaim(): Claim | null {
    if (this.currentClaimIndex >= this.claims.length) return null;
    return this.claims[this.currentClaimIndex];
  }

  // --- Global Counter Getters ---
  
  public getTotalQuestionsAsked(): number {
    return this.totalQuestionsAsked;
  }

  public getTotalNonAnswers(): number {
    return this.totalNonAnswers;
  }

  public getFailedClaimsCount(): number {
    return this.failedClaimsCount;
  }

  public getConsecutiveFailedClaims(): number {
    return this.consecutiveFailedClaims;
  }

  public getIsInterviewEnded(): boolean {
    return this.isInterviewEnded;
  }

  public getNextClaim(): Claim | null {
    if (this.currentClaimIndex + 1 >= this.claims.length) return null;
    return this.claims[this.currentClaimIndex + 1];
  }

  public isLastClaim(): boolean {
    return this.getNextClaim() === null;
  }

  public getCurrentClaimState(): ClaimState | null {
    if (this.claimStates.length === 0) return null;
    return this.claimStates[this.claimStates.length - 1];
  }

  public getFlatHistory(): InterviewTurn[] {
    return [...this.introTurns, ...this.claimStates.flatMap(ch => ch.turns)];
  }

  private createInitialClaimState(claim: Claim): ClaimState {
    return {
      claim,
      turns: [],
      askedPoints: [],
      coveredPoints: [],
      missingPoints: claim?.mustVerify ? [...claim.mustVerify] : [],
      verificationStatus: 'unverified',
      followUpCount: 0,
      repeatCount: 0,
      consecutiveNonAnswers: 0,
      isCompleted: false,
      isSkipped: false
    };
  }

  // --- Actions ---

  public initializeIntroPhase(introQuestion: string, introAnswer: string, questionId: string): void {
    this.introTurns.push({ 
      questionId, 
      q: introQuestion, 
      a: introAnswer, 
      turnType: 'intro',
      timestamp: new Date().toISOString()
    });
    this.totalQuestionsAsked++;
    
    // Auto-advance to the first technical claim
    if (this.claims.length > 0 && this.claimStates.length === 0) {
      this.claimStates.push(this.createInitialClaimState(this.claims[0]));
    }
  }

  public addTurnToCurrentClaim(question: string, answer: string, turnType: TurnType, questionId: string): void {
    const currentState = this.getCurrentClaimState();
    const newTurn: InterviewTurn = {
      questionId,
      q: question,
      a: answer,
      turnType,
      timestamp: new Date().toISOString()
    };

    if (currentState) {
      currentState.turns.push(newTurn);
    } else {
       // Should only happen if called before any phases/claims are initialized
       const currentClaim = this.getCurrentClaim();
       if (currentClaim) {
         const newState = this.createInitialClaimState(currentClaim);
         newState.turns.push(newTurn);
         this.claimStates.push(newState);
       } else {
         // Fallback if no claims exist at all, push as an intro turn
         this.introTurns.push(newTurn);
       }
    }
    
    // Only increment questions if it's not a direct LLM resubmission of an identical string?
    // Actually, every addTurn is a discrete interaction. A repeat question is technically a new turn conceptually.
    // If we want just unique distinct questions, we'd do that elsewhere. A "turn" counter = totalQuestionsAsked.
    this.totalQuestionsAsked++;
  }

  public updateLatestTurnEvaluation(evaluation: NextStep): void {
    const currentState = this.getCurrentClaimState();
    if (currentState && currentState.turns.length > 0) {
      currentState.turns[currentState.turns.length - 1].evaluation = evaluation;
      
      if (evaluation.answerStatus === 'non_answer') {
        currentState.consecutiveNonAnswers++;
        this.totalNonAnswers++;
      } else {
        currentState.consecutiveNonAnswers = 0;
      }
      
      if (evaluation.decision === 'FOLLOW_UP') {
        currentState.followUpCount++;
      }
      
      if (evaluation.decision === 'REPEAT_QUESTION') {
        currentState.repeatCount++;
      }
      
      if (evaluation.decision === 'NEXT_CLAIM' || evaluation.decision === 'END_INTERVIEW') {
        currentState.isCompleted = true;
        
        // If it was skipped due to non_answer, or otherwise aborted early
        if (evaluation.answerStatus === 'non_answer' || (currentState.missingPoints.length === currentState.claim.mustVerify.length && currentState.claim.mustVerify.length > 0)) {
          currentState.isSkipped = true;
          this.failedClaimsCount++;
          this.consecutiveFailedClaims++;
        } else {
          // If the claim was successfully covered, reset the consecutive failure counter
          this.consecutiveFailedClaims = 0;
        }
      }
      
      if (evaluation.decision === 'END_INTERVIEW') {
        this.isInterviewEnded = true;
      }
      
      if (evaluation.coveredPoints) {
        currentState.coveredPoints = Array.from(new Set([...currentState.coveredPoints, ...evaluation.coveredPoints]));
      }
      if (evaluation.missingPoints) {
        currentState.missingPoints = evaluation.missingPoints;
      }
    }
  }

  public determineStatusAndAdvance(decision: NextStep['decision']): void {
     if (decision === 'NEXT_CLAIM' && !this.isLastClaim()) {
       const currentState = this.getCurrentClaimState();
       if (currentState) currentState.isCompleted = true;
       
       this.currentClaimIndex++;
       this.claimStates.push(this.createInitialClaimState(this.claims[this.currentClaimIndex]));
     }
  }

  // --- Derived Calculations ---

  public getFollowUpCountForCurrentClaim(): number {
    return this.getCurrentClaimState()?.turns.filter((t) => t.turnType === 'follow_up').length || 0;
  }

  public getTotalQuestionsForCurrentClaim(): number {
    return this.getCurrentClaimState()?.turns.length || 0;
  }

  public getRepeatCountForQuestion(questionId: string): number {
    let repeatCount = 0;
    const flatHistory = this.getFlatHistory();
    for (let i = flatHistory.length - 1; i >= 0; i--) {
      if (flatHistory[i].questionId === questionId) {
        repeatCount++;
      }
    }
    return Math.max(0, repeatCount - 1);
  }

  public getConsecutiveNonAnswers(): number {
    return this.getCurrentClaimState()?.consecutiveNonAnswers || 0;
  }

  public getPreviousTurnContext(): { 
    answerStatus: string | null; 
    missingPoints: string[]; 
    coveredPoints: string[] 
  } {
    const currentState = this.getCurrentClaimState();
    if (!currentState) {
      return { answerStatus: null, missingPoints: [], coveredPoints: [] };
    }
    
    // answerStatus still dynamically checked from the 2nd to last turn, because it's contextual to the specific interaction
    let answerStatus = null;
    if (currentState.turns.length > 1) {
      const prevTurn = currentState.turns[currentState.turns.length - 2];
      answerStatus = prevTurn.evaluation?.answerStatus || null;
    }

    return {
      answerStatus,
      missingPoints: currentState.missingPoints,
      coveredPoints: currentState.coveredPoints
    };
  }

  public getQuestionsAskedForCurrentClaim(): string[] {
    const currentClaimState = this.getCurrentClaimState();
    if (!currentClaimState) return [];
    return currentClaimState.turns.map(t => t.q);
  }
}
