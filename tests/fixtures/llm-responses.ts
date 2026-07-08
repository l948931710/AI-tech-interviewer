/**
 * Sample LLM output shapes for testing parse resilience.
 * Each represents a different failure mode or edge case.
 */

/** Happy path: complete, well-formed response */
export const VALID_RESPONSE = {
  answerStatus: 'answered',
  decision: 'FOLLOW_UP',
  followUpIntent: 'DEEPEN',
  nextQuestion: 'Can you tell me more about the service decomposition?',
  spokenQuestion: 'Can you tell me more about the service decomposition?',
  decisionRationale: 'Candidate gave a partial answer. Need more technical depth.',
  coveredPoints: ['Service decomposition strategy'],
  missingPoints: ['Ownership of migration decision', 'Team size and scope'],
  lightweightScores: {
    relevance: 7,
    specificity: 5,
    technicalDepth: 6,
    ownership: 4,
    evidence: 5,
  },
};

/** Missing decision field */
export const MISSING_DECISION = {
  answerStatus: 'answered',
  nextQuestion: 'Follow up question?',
  spokenQuestion: 'Follow up question?',
  decisionRationale: 'test',
  coveredPoints: [],
  missingPoints: [],
};

/** Missing spokenQuestion field */
export const MISSING_SPOKEN_QUESTION = {
  answerStatus: 'answered',
  decision: 'FOLLOW_UP',
  nextQuestion: 'The written question',
  decisionRationale: 'test',
  coveredPoints: [],
  missingPoints: [],
};

/** Empty string values */
export const EMPTY_STRINGS = {
  answerStatus: '',
  decision: '',
  nextQuestion: '',
  spokenQuestion: '',
  decisionRationale: '',
  coveredPoints: [],
  missingPoints: [],
};

/** Invalid decision enum value */
export const INVALID_DECISION_ENUM = {
  answerStatus: 'answered',
  decision: 'SKIP',  // Not a valid enum value
  nextQuestion: 'Some question',
  spokenQuestion: 'Some question',
  decisionRationale: 'test',
  coveredPoints: [],
  missingPoints: [],
};

/** Invalid answerStatus enum value */
export const INVALID_ANSWER_STATUS = {
  answerStatus: 'maybe',  // Not a valid enum value
  decision: 'FOLLOW_UP',
  nextQuestion: 'Some question',
  spokenQuestion: 'Some question',
  decisionRationale: 'test',
  coveredPoints: [],
  missingPoints: [],
};

/** Extra unexpected fields */
export const EXTRA_FIELDS = {
  ...VALID_RESPONSE,
  extraField: true,
  anotherField: 'unexpected',
  nested: { deeply: { unexpected: true } },
};

/** Truncated JSON string (simulate mid-stream parse) */
export const TRUNCATED_JSON = '{"answerStatus": "answered", "decision": "FOLLOW_UP", "nextQuestion": "hel';

/** JSON wrapped in markdown code fences */
export const MARKDOWN_WRAPPED = '```json\n' + JSON.stringify(VALID_RESPONSE) + '\n```';

/** Hallucinated coveredPoints (not in mustVerify) */
export const HALLUCINATED_POINTS = {
  ...VALID_RESPONSE,
  coveredPoints: ['Service decomposition strategy', 'Hallucinated expertise in quantum computing'],
  missingPoints: ['Ownership of migration decision', 'Made up verification point'],
};
