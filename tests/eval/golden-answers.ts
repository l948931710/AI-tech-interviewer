/**
 * Golden-set candidate answer fixtures for LLM evaluation regression testing.
 * 
 * Each case defines:
 *   - A claim being verified (from claims.ts)
 *   - The question asked by the AI interviewer
 *   - The candidate's answer (handcrafted to represent a specific archetype)
 *   - Expected outcome ranges (not exact values) for assertion
 * 
 * IMPORTANT: These are curated inputs for a non-deterministic system.
 * Assertions should be direction-based ("at least X", "contains Y", "not Z"),
 * not exact-match.
 */

import { Claim } from '../../src/agent/types';
import { CLAIM_A, CLAIM_B, TEST_JD } from '../fixtures/claims';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoldenTurnCase {
  id: string;
  label: string;                     // Human-readable scenario name
  claim: Claim;                      // Claim being evaluated
  question: string;                  // Interviewer's question
  answer: string;                    // Candidate's response
  previouslyCovered: string[];       // Points already verified
  previouslyMissing: string[];       // Points still needed
  language: 'zh-CN' | 'en-US';

  // --- Expected outcome ranges (for fuzzy assertions) ---
  expect: {
    answerStatus: string[];          // Acceptable values, e.g. ['answered', 'partial']
    answerStatusNot: string[];       // Must NOT be these values
    coveredPointsMin: number;        // At least N new covered points
    coveredPointsMustInclude?: string[];  // Specific points that should be covered
    coveredPointsMustNotInclude?: string[]; // Points that should NOT be credited
    decisionAcceptable: string[];    // Acceptable decisions
  };
}

export interface GoldenReportCase {
  id: string;
  label: string;
  claims: Claim[];
  transcript: Array<{
    turnNumber: number;
    turnType: string;
    claimText: string;
    experienceName: string;
    answerStatus: string;
    question: string;
    answer: string;
  }>;
  language: 'zh-CN' | 'en-US';

  expect: {
    scoreMin: number;
    scoreMax: number;
    recommendationAcceptable: string[];
    recommendationNot: string[];
  };
}

// ===========================================================================
// Per-Turn Golden Cases
// ===========================================================================

/** Case 1: Strong answer with specific details, data, and ownership */
export const STRONG_ANSWER: GoldenTurnCase = {
  id: 'turn-strong',
  label: 'Strong answer — specific details, data, ownership',
  claim: CLAIM_A,
  question: 'Tell me about the monolith to microservices migration you led at Company X.',
  answer: `I led this initiative directly — I wrote the original RFC and got VP approval. We had a legacy Django monolith serving 50k RPM. I broke it into 12 bounded-context services using domain-driven design. My team was 5 engineers, I did the service decomposition and owned the data migration strategy. We used the strangler fig pattern — routing traffic service-by-service over 6 months. The core challenge was cross-service data consistency, which we solved with the saga pattern and eventual consistency via Kafka. After the migration, p99 latency dropped from 800ms to 200ms and deploy frequency went from weekly to 15x/day.`,
  previouslyCovered: [],
  previouslyMissing: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
  language: 'en-US',
  expect: {
    answerStatus: ['answered'],
    answerStatusNot: ['non_answer', 'clarification_request'],
    coveredPointsMin: 2,
    coveredPointsMustInclude: ['Ownership of migration decision'],
    decisionAcceptable: ['FOLLOW_UP', 'NEXT_CLAIM'],
  },
};

/** Case 2: Evasive answer — lots of words, no substance */
export const EVASIVE_ANSWER: GoldenTurnCase = {
  id: 'turn-evasive',
  label: 'Evasive answer — verbose but no specific details',
  claim: CLAIM_A,
  question: 'Tell me about the monolith to microservices migration you led at Company X.',
  answer: `Yeah, so the microservices migration was really a team effort. We all worked together to make it happen. It was challenging but rewarding. There were many meetings and planning sessions involved. The architecture improved significantly and everyone was happy with the outcome. It was a great learning experience for the whole team and I think we all grew a lot from it.`,
  previouslyCovered: [],
  previouslyMissing: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
  language: 'en-US',
  expect: {
    answerStatus: ['partial'],
    answerStatusNot: ['answered'],
    coveredPointsMin: 0,
    coveredPointsMustNotInclude: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
    decisionAcceptable: ['FOLLOW_UP'],
  },
};

/** Case 3: Off-topic answer — completely unrelated to the question */
export const OFF_TOPIC_ANSWER: GoldenTurnCase = {
  id: 'turn-off-topic',
  label: 'Off-topic answer — talks about something else entirely',
  claim: CLAIM_A,
  question: 'Can you explain the service decomposition strategy you used during the migration?',
  answer: `Actually, I wanted to talk about something I'm really proud of — our CI/CD pipeline. I set up GitHub Actions with automated testing and deployment to Kubernetes. We had a really cool canary deployment system. It reduced our deploy failures by 90%. I also introduced SonarQube for code quality scanning.`,
  previouslyCovered: [],
  previouslyMissing: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
  language: 'en-US',
  expect: {
    answerStatus: ['partial', 'non_answer'],
    answerStatusNot: ['answered'],
    coveredPointsMin: 0,
    coveredPointsMustNotInclude: ['Service decomposition strategy'],
    decisionAcceptable: ['FOLLOW_UP'],
  },
};

/** Case 4: Resume restatement — just repeats the resume bullet without new info */
export const RESUME_RESTATEMENT: GoldenTurnCase = {
  id: 'turn-resume-restate',
  label: 'Resume restatement — repeats resume text verbatim, no new evidence',
  claim: CLAIM_A,
  question: 'You mentioned leading a migration from monolith to microservices. Can you walk me through the details?',
  answer: `Yes, I led the migration from monolith to microservices at Company X. It was a major initiative and I was responsible for the architecture decisions.`,
  previouslyCovered: [],
  previouslyMissing: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
  language: 'en-US',
  expect: {
    answerStatus: ['partial'],
    answerStatusNot: ['answered'],
    coveredPointsMin: 0,
    // "Ownership of migration decision" should NOT be credited here —
    // the candidate just restated the resume claim without evidence
    coveredPointsMustNotInclude: ['Service decomposition strategy', 'Team size and scope'],
    decisionAcceptable: ['FOLLOW_UP'],
  },
};

/** Case 5: Strong answer in Chinese */
export const STRONG_ANSWER_ZH: GoldenTurnCase = {
  id: 'turn-strong-zh',
  label: 'Strong answer (Chinese) — 具体细节、数据、ownership',
  claim: CLAIM_A,
  question: '请详细讲讲你在Company X主导的从单体到微服务的迁移。',
  answer: `这个项目是我主导发起的。当时我们的Django单体应用每天处理5万QPS，部署周期长达一周。我写了技术方案书并拿到了VP审批。我带领5个工程师，用领域驱动设计把系统拆分成了12个独立服务。我们采用了绞杀者模式，花了6个月逐步把流量切过去。最大的挑战是跨服务数据一致性，我们用了Saga模式和Kafka做最终一致性。迁移完成后p99延迟从800ms降到200ms，部署频率从每周一次提升到每天15次。`,
  previouslyCovered: [],
  previouslyMissing: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
  language: 'zh-CN',
  expect: {
    answerStatus: ['answered'],
    answerStatusNot: ['non_answer', 'clarification_request'],
    coveredPointsMin: 2,
    coveredPointsMustInclude: ['Ownership of migration decision'],
    decisionAcceptable: ['FOLLOW_UP', 'NEXT_CLAIM'],
  },
};

export const ALL_TURN_CASES = [STRONG_ANSWER, EVASIVE_ANSWER, OFF_TOPIC_ANSWER, RESUME_RESTATEMENT, STRONG_ANSWER_ZH];

// ===========================================================================
// End-to-End Report Golden Cases
// ===========================================================================

/** Full transcript: strong candidate across 2 claims */
export const STRONG_CANDIDATE_TRANSCRIPT: GoldenReportCase = {
  id: 'report-strong',
  label: 'Strong candidate — good answers across all claims',
  claims: [CLAIM_A, CLAIM_B],
  transcript: [
    {
      turnNumber: 1, turnType: 'intro', claimText: 'N/A', experienceName: 'N/A',
      answerStatus: 'answered',
      question: 'Welcome! Tell me about your background.',
      answer: 'I am a senior backend engineer with 6 years of experience in distributed systems.',
    },
    {
      turnNumber: 2, turnType: 'main', claimText: CLAIM_A.claim, experienceName: CLAIM_A.experienceName!,
      answerStatus: 'answered',
      question: 'Tell me about the monolith to microservices migration.',
      answer: 'I led this initiative — I wrote the RFC, got VP approval. My team of 5 engineers broke a Django monolith into 12 bounded-context services using DDD. We used the strangler fig pattern over 6 months. P99 latency dropped from 800ms to 200ms.',
    },
    {
      turnNumber: 3, turnType: 'follow_up', claimText: CLAIM_A.claim, experienceName: CLAIM_A.experienceName!,
      answerStatus: 'answered',
      question: 'How did you handle data consistency across services?',
      answer: 'We implemented the saga pattern with compensating transactions. For event-driven flows, we used Kafka with exactly-once semantics via idempotency keys. For read queries spanning services, we used CQRS with materialized views.',
    },
    {
      turnNumber: 4, turnType: 'main', claimText: CLAIM_B.claim, experienceName: CLAIM_B.experienceName!,
      answerStatus: 'answered',
      question: 'Now let\'s discuss your recommendation engine at Company Y.',
      answer: 'We built a collaborative filtering system using Spark for batch feature generation and a gRPC service for real-time inference. The model was a two-tower architecture with 50ms p99 latency. We served 10M+ DAU with autoscaling on Kubernetes.',
    },
    {
      turnNumber: 5, turnType: 'follow_up', claimText: CLAIM_B.claim, experienceName: CLAIM_B.experienceName!,
      answerStatus: 'answered',
      question: 'How did you validate the model\'s performance?',
      answer: 'We ran A/B tests with 5% traffic for 2 weeks. The new model improved click-through rate by 12% and average session duration by 8%. We monitored for position bias and popularity bias using custom metrics dashboards.',
    },
  ],
  language: 'en-US',
  expect: {
    scoreMin: 70,
    scoreMax: 100,
    recommendationAcceptable: ['STRONG_HIRE', 'HIRE', 'LEAN_HIRE'],
    recommendationNot: ['NO_HIRE', 'LEAN_NO_HIRE'],
  },
};

/** Full transcript: weak candidate — evasive and non-answers */
export const WEAK_CANDIDATE_TRANSCRIPT: GoldenReportCase = {
  id: 'report-weak',
  label: 'Weak candidate — evasive answers and knowledge gaps',
  claims: [CLAIM_A, CLAIM_B],
  transcript: [
    {
      turnNumber: 1, turnType: 'intro', claimText: 'N/A', experienceName: 'N/A',
      answerStatus: 'answered',
      question: 'Welcome! Tell me about your background.',
      answer: 'Hi, I have worked as an engineer for a few years.',
    },
    {
      turnNumber: 2, turnType: 'main', claimText: CLAIM_A.claim, experienceName: CLAIM_A.experienceName!,
      answerStatus: 'partial',
      question: 'Tell me about the monolith to microservices migration.',
      answer: 'Yeah we did a microservices migration. It was a team effort. We used microservices and it improved things.',
    },
    {
      turnNumber: 3, turnType: 'follow_up', claimText: CLAIM_A.claim, experienceName: CLAIM_A.experienceName!,
      answerStatus: 'partial',
      question: 'Can you walk me through the specific decomposition strategy?',
      answer: 'We just... split things up based on what made sense. The senior architect made most of the technical decisions.',
    },
    {
      turnNumber: 4, turnType: 'main', claimText: CLAIM_B.claim, experienceName: CLAIM_B.experienceName!,
      answerStatus: 'partial',
      question: 'Tell me about the recommendation engine at Company Y.',
      answer: 'I was part of the team that worked on recommendations. We used machine learning. I mostly handled some data pipeline tasks.',
    },
    {
      turnNumber: 5, turnType: 'follow_up', claimText: CLAIM_B.claim, experienceName: CLAIM_B.experienceName!,
      answerStatus: 'non_answer',
      question: 'What was the system architecture for serving predictions?',
      answer: 'I\'m not really sure about the details of that part. I was more on the data side.',
    },
  ],
  language: 'en-US',
  expect: {
    scoreMin: 0,
    scoreMax: 55,
    recommendationAcceptable: ['NO_HIRE', 'LEAN_NO_HIRE'],
    recommendationNot: ['STRONG_HIRE', 'HIRE'],
  },
};

export const ALL_REPORT_CASES = [STRONG_CANDIDATE_TRANSCRIPT, WEAK_CANDIDATE_TRANSCRIPT];
