import { StructuredInterviewTurn } from '../../src/agent/types';

/**
 * Reusable transcript fixtures for restoreFromTranscript tests.
 * Each represents a realistic sequence of interview turns.
 */

/** Single intro turn */
export const INTRO_ONLY: StructuredInterviewTurn[] = [
  {
    questionId: 'q-intro',
    question: 'Welcome! Tell me about your experience at Company X.',
    answer: 'Hi, I worked at Company X for 3 years as a senior engineer.',
    turnType: 'intro',
    answerStatus: 'answered',
  }
];

/** Intro + 1 main question on claim A */
export const INTRO_PLUS_ONE_MAIN: StructuredInterviewTurn[] = [
  ...INTRO_ONLY,
  {
    questionId: 'q-1',
    question: 'Tell me about the monolith to microservices migration.',
    answer: 'We broke the monolith into 12 services using domain-driven design.',
    claimId: 'claim-a',
    claimText: 'Led migration from monolith to microservices at Company X',
    experienceName: 'Company X',
    turnType: 'main',
    answerStatus: 'answered',
    decision: 'FOLLOW_UP',
    coveredPoints: ['Service decomposition strategy'],
    missingPoints: ['Ownership of migration decision', 'Team size and scope'],
  }
];

/** Intro + main + 2 follow-ups on claim A */
export const CLAIM_A_FULL_SEQUENCE: StructuredInterviewTurn[] = [
  ...INTRO_PLUS_ONE_MAIN,
  {
    questionId: 'q-2',
    question: 'Who made the decision to migrate? What was your role?',
    answer: 'I proposed and led the initiative. I managed a team of 5 engineers.',
    claimId: 'claim-a',
    claimText: 'Led migration from monolith to microservices at Company X',
    experienceName: 'Company X',
    turnType: 'follow_up',
    answerStatus: 'answered',
    decision: 'FOLLOW_UP',
    coveredPoints: ['Ownership of migration decision', 'Team size and scope'],
    missingPoints: [],
  },
  {
    questionId: 'q-3',
    question: 'What challenges did you face during the migration?',
    answer: 'Data consistency across services was the biggest challenge. We used saga pattern.',
    claimId: 'claim-a',
    claimText: 'Led migration from monolith to microservices at Company X',
    experienceName: 'Company X',
    turnType: 'follow_up',
    answerStatus: 'answered',
    decision: 'NEXT_CLAIM',
    coveredPoints: ['Service decomposition strategy', 'Ownership of migration decision', 'Team size and scope'],
    missingPoints: [],
  }
];

/** Full sequence across 2 claims (A completed, B started) */
export const TWO_CLAIM_SEQUENCE: StructuredInterviewTurn[] = [
  ...CLAIM_A_FULL_SEQUENCE,
  {
    questionId: 'q-4',
    question: 'Now let\'s discuss your recommendation engine at Company Y.',
    answer: 'We built a collaborative filtering system using Spark and served predictions via a gRPC service.',
    claimId: 'claim-b',
    claimText: 'Built real-time recommendation engine serving 10M+ users',
    experienceName: 'Company Y',
    turnType: 'main',
    answerStatus: 'answered',
    decision: 'FOLLOW_UP',
    coveredPoints: ['System architecture'],
    missingPoints: ['Scale validation', 'Model serving approach'],
  }
];

/** Sequence with non-answers */
export const NON_ANSWER_SEQUENCE: StructuredInterviewTurn[] = [
  ...INTRO_ONLY,
  {
    questionId: 'q-1',
    question: 'Tell me about the monolith to microservices migration.',
    answer: '不知道',
    claimId: 'claim-a',
    claimText: 'Led migration from monolith to microservices at Company X',
    experienceName: 'Company X',
    turnType: 'main',
    answerStatus: 'non_answer',
    decision: 'FOLLOW_UP',
    coveredPoints: [],
    missingPoints: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
  },
  {
    questionId: 'q-2',
    question: '没关系，能换个角度聊聊你负责的具体工作吗？',
    answer: '不清楚',
    claimId: 'claim-a',
    claimText: 'Led migration from monolith to microservices at Company X',
    experienceName: 'Company X',
    turnType: 'follow_up',
    answerStatus: 'non_answer',
    decision: 'NEXT_CLAIM',
    coveredPoints: [],
    missingPoints: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
  }
];

/** Legacy transcript with no decision field (backwards compat) */
export const LEGACY_NO_DECISION: StructuredInterviewTurn[] = [
  {
    questionId: 'q-intro',
    question: 'Welcome!',
    answer: 'Hi!',
    turnType: 'intro',
    answerStatus: 'answered',
    // no decision field
  },
  {
    questionId: 'q-1',
    question: 'Tell me about X.',
    answer: 'I did X.',
    claimId: 'claim-a',
    claimText: 'Led migration from monolith to microservices at Company X',
    turnType: 'follow_up',
    answerStatus: 'answered',
    // no decision field — should default to FOLLOW_UP
  }
];
