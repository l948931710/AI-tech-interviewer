// The claim prioritization logic is currently handled in the same LLM call as resume parsing
// to reduce latency and token usage.
export { analyzeResume as prioritizeClaims } from './resumeParser';
