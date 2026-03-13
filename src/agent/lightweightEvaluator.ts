// The lightweight evaluation logic is currently handled in the same LLM call as follow-up planning
// to reduce latency and token usage.
export { getNextInterviewStep as evaluateAnswer } from './followUpPlanner';
