import { Claim } from '../../src/agent/types';

/**
 * Reusable test claim fixtures.
 * These are minimal but structurally valid Claim objects
 * used across all test files.
 */

export const CLAIM_A: Claim = {
  id: 'claim-a',
  topic: 'Architecture',
  claim: 'Led migration from monolith to microservices at Company X',
  experienceName: 'Company X',
  sourceBullet: 'Led migration from monolith to microservices',
  claimType: 'implementation',
  mustVerify: ['Ownership of migration decision', 'Team size and scope', 'Service decomposition strategy'],
  niceToHave: ['Metrics on latency improvement'],
  evidenceHints: ['Ask about specific services broken out'],
  rankingSignals: { relevanceToRole: 9, technicalImportance: 8, ambiguityRisk: 6, businessImpact: 7, interviewValue: 9 },
  rationale: 'Core architecture claim — high ambiguity risk.'
};

export const CLAIM_B: Claim = {
  id: 'claim-b',
  topic: 'ML Pipeline',
  claim: 'Built real-time recommendation engine serving 10M+ users',
  experienceName: 'Company Y',
  sourceBullet: 'Built real-time recommendation engine',
  claimType: 'system_design',
  mustVerify: ['System architecture', 'Scale validation', 'Model serving approach'],
  niceToHave: ['A/B testing results'],
  evidenceHints: ['Ask about latency requirements'],
  rankingSignals: { relevanceToRole: 10, technicalImportance: 9, ambiguityRisk: 5, businessImpact: 9, interviewValue: 10 },
  rationale: 'High-impact system design claim.'
};

export const CLAIM_C: Claim = {
  id: 'claim-c',
  topic: 'Deployment',
  claim: 'Implemented CI/CD pipeline reducing deploy time by 80%',
  experienceName: 'Company Z',
  sourceBullet: 'Implemented CI/CD pipeline',
  claimType: 'deployment',
  mustVerify: ['Pipeline tooling choices', 'Before/after metrics'],
  rankingSignals: { relevanceToRole: 6, technicalImportance: 5, ambiguityRisk: 3, businessImpact: 5, interviewValue: 6 },
  rationale: 'Supplementary infrastructure claim.'
};

/** Standard 3-claim set for multi-claim traversal tests */
export const THREE_CLAIMS = [CLAIM_A, CLAIM_B, CLAIM_C];

/** Standard JD text */
export const TEST_JD = 'Senior Backend Engineer — distributed systems, real-time ML, and DevOps.';
