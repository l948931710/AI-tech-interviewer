import { SimulationCase, SimulationMetrics, TurnResult, ExpectedBehavior } from "./metrics";
import { generateFakeAnswer } from "./fakeCandidate";
import { evaluateTurn } from "./simulationJudge";
import { InterviewMemory } from "../agent/memory";
import { getNextInterviewStep } from "../agent/followUpPlanner";
import { generateFirstQuestion } from "../agent/questionGenerator";
import { generateReport } from "../agent/reportGenerator";
import { Claim, StructuredInterviewTurn, NextStep } from "../agent/types";

const MAX_TURNS = 15;

export async function runSimulation(testCase: SimulationCase): Promise<SimulationMetrics> {
  console.log(`Starting Simulation Case: ${testCase.id} [Persona: ${testCase.persona}]`);
  
  // Setup a mock claim based on the test case
  const mockClaim: Claim = {
    id: 'sim-claim-1',
    topic: 'Architecture',
    claim: testCase.targetClaims[0],
    sourceBullet: testCase.targetClaims[0],
    claimType: 'implementation',
    mustVerify: ['Implementation details', 'Ownership'],
    rankingSignals: { relevanceToRole: 10, technicalImportance: 10, ambiguityRisk: 5, businessImpact: 8, interviewValue: 9 },
    rationale: 'Simulation testing'
  };

  // 1. Initialize Memory
  const memory = new InterviewMemory([mockClaim], testCase.jd);
  
  // Generate Intro
  const introRes = await generateFirstQuestion(
    { name: "Simulation Candidate", education: [], technicalSkills: [], workExperience: [] }, 
    mockClaim, 
    testCase.jd
  );

  memory.initializeIntroPhase(introRes.question, "Hi!", "q-intro");

  let currentSystemQuestion = introRes.question;
  let currentQuestionId = 'q-1';
  let currentTurnType: 'main' | 'follow_up' | 'repeat' | 'clarify' = 'main';
  
  const metrics: SimulationMetrics = {
    caseId: testCase.id,
    persona: testCase.persona,
    turns: 0,
    followUpQualityScore: 0,
    claimDetectionScore: 0,
    nonAnswerCaught: false,
    totalTokens: 0,
    estimatedCost: 0,
    crashed: false,
    loopDetected: false,
    finalRecommendation: "PENDING",
    turnDetails: []
  };

  let isComplete = false;
  let loopingCount = 0;

  // 2. Main Interview Loop
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n--- Turn ${turn + 1} ---`);
    console.log(`SYSTEM: ${currentSystemQuestion}`);

    // Generate Candidate Answer
    const historyStr = memory.getFlatHistory().map(t => `Q: ${t.q}\nA: ${t.a}`).join("\n\n");
    const fakeResp = await generateFakeAnswer(testCase.persona, currentSystemQuestion, mockClaim.claim, historyStr);
    console.log(`CANDIDATE: ${fakeResp.text}`);
    
    metrics.turns++;
    metrics.totalTokens += fakeResp.tokens;

    // Simulate Candidate Portal submitting the answer
    memory.addTurnToCurrentClaim(currentSystemQuestion, fakeResp.text, currentTurnType, currentQuestionId);

    // AI Interviewer Processing (Plan Next Step)
    const followUpCountForCurrentClaim = memory.getFollowUpCountForCurrentClaim();
    const isLastQuestionOverall = false; // single claim sim
    const isLastQuestionForClaim = followUpCountForCurrentClaim >= 3;

    let nextStep: NextStep;
    if (isLastQuestionForClaim) {
        nextStep = await getNextInterviewStep(currentSystemQuestion, currentQuestionId, fakeResp.text, memory, false, true, 3);
    } else {
        nextStep = await getNextInterviewStep(currentSystemQuestion, currentQuestionId, fakeResp.text, memory, isLastQuestionOverall, false, 3);
    }
    
    memory.updateLatestTurnEvaluation(nextStep);

    if (nextStep.answerStatus === 'non_answer') {
      metrics.nonAnswerCaught = true;
    }

    // Evaluate if AI behaved well
    const judgeResult = evaluateTurn(testCase.persona, fakeResp.text, nextStep);
    
    metrics.turnDetails.push({
      question: currentSystemQuestion,
      answer: fakeResp.text,
      answerStatus: nextStep.answerStatus,
      nextQuestionDecision: nextStep.decision,
      expectedBehavior: judgeResult.expectedBehavior,
      judgeScore: judgeResult.isCorrect ? 1 : 0,
      judgeRationale: judgeResult.rationale,
      tokens: fakeResp.tokens
    });

    if (judgeResult.isCorrect) {
      metrics.followUpQualityScore++;
    }

    if (nextStep.decision === 'REPEAT_QUESTION') {
      loopingCount++;
      if (loopingCount > 2) {
        metrics.loopDetected = true;
        console.log("SIMULATION: Infinite loop detected.");
        break;
      }
    } else {
      loopingCount = 0;
    }

    if (nextStep.decision === 'NEXT_CLAIM' || nextStep.decision === 'END_INTERVIEW') {
      isComplete = true;
      console.log(`SIMULATION: Claim testing completed. Finished naturally.`);
      break;
    }

    memory.determineStatusAndAdvance(nextStep.decision);
    
    if (nextStep.decision === 'FOLLOW_UP') currentTurnType = 'follow_up';
    else if (nextStep.decision === 'REPEAT_QUESTION') currentTurnType = nextStep.answerStatus === 'clarification_request' ? 'clarify' : 'repeat';
    
    currentSystemQuestion = nextStep.nextQuestion;
    currentQuestionId = `q-${turn + 2}`;
  }

  // Final Scoring Logic
  metrics.followUpQualityScore = metrics.followUpQualityScore / metrics.turns;
  metrics.estimatedCost = metrics.totalTokens * 0.000005; // Rough estimate
  
  // Format history to be consumed by the report generator
  const finalTranscript = memory.getFlatHistory().map((t, i) => ({
      questionId: t.questionId,
      timestamp: t.timestamp,
      question: t.q,
      answer: t.a,
      claimId: mockClaim.id,
      claimText: mockClaim.claim,
      experienceName: mockClaim.experienceName,
      turnType: t.turnType,
      answerStatus: t.evaluation?.answerStatus
  } as StructuredInterviewTurn));

  const report = await generateReport(finalTranscript, [mockClaim]);
  const verifiedStatus = report.claimEvaluations[0]?.verificationStatus || 'unverified';
  
  if (testCase.persona === 'strong' && (verifiedStatus === 'strong' || verifiedStatus === 'partial')) {
    metrics.claimDetectionScore = 1;
  } else if ((testCase.persona === 'bluffer' || testCase.persona === 'evasive') && (verifiedStatus === 'weak' || verifiedStatus === 'unverified' || metrics.nonAnswerCaught)) {
    metrics.claimDetectionScore = 1;
  } else if (testCase.persona === 'average' && (verifiedStatus === 'partial' || verifiedStatus === 'weak')) {
     metrics.claimDetectionScore = 1;
  }

  metrics.finalRecommendation = report.overallRecommendation || verifiedStatus;

  console.log(`Simulation Case ${testCase.id} Finished. Loop: ${metrics.loopDetected}, Crashed: ${metrics.crashed}, Final Status: ${verifiedStatus}, Final Recommendation: ${metrics.finalRecommendation}`);
  return metrics;
}
