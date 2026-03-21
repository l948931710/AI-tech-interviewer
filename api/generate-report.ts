import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "./api-auth";

/**
 * Server-side report generation endpoint.
 * 
 * Pulls session data (transcript, claims) directly from Supabase using the
 * service role key, constructs the evaluation prompt, calls Gemini, saves
 * the report, and marks the session as COMPLETED — all server-side.
 * 
 * This prevents candidates from tampering with their own evaluation.
 */

// Edge Runtime: 30s limit on all plans (vs 10s for Serverless on Hobby plan).
// Report generation with Gemini Pro must complete within 30s.
export const config = { runtime: 'edge' };

// Module-level SDK cache
let cachedAI: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured.");
  }
  if (!cachedAI) {
    cachedAI = new GoogleGenAI({ apiKey });
  }
  return cachedAI;
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables for admin client.");
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Authenticate the caller
  const auth = await verifyAuth(req);
  if (auth.error) return auth.error;

  try {
    const { sessionId } = await req.json();

    if (!sessionId || typeof sessionId !== 'string') {
      return new Response(JSON.stringify({ error: "Missing required field: sessionId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`[Generate-Report] Starting for session ${sessionId} by user ${auth.user.id}`);

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch session data from Supabase (server-side, not from client)
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from('interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    // C1 fix: Validate session status to prevent abuse
    // - PENDING: interview never started, no transcript to report on
    // - COMPLETED: report already generated, prevent re-generation
    const validStatuses = ['IN_PROGRESS', 'NOT_FINISHED'];
    if (!validStatuses.includes(sessionData.status)) {
      const message = sessionData.status === 'COMPLETED'
        ? 'Report already generated for this session'
        : 'Session has not started yet';
      return new Response(JSON.stringify({ error: message }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      });
    }

    // C1 fix: Verify session ownership — only the HR user who created this session can generate the report
    if (sessionData.created_by && sessionData.created_by !== auth.user.id) {
      console.warn(`[Generate-Report] Ownership violation: user ${auth.user.id} tried to access session owned by ${sessionData.created_by}`);
      return new Response(JSON.stringify({ error: 'Forbidden: You do not own this session' }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Fetch claims
    const { data: claimsData } = await supabaseAdmin
      .from('session_claims')
      .select('*')
      .eq('session_id', sessionId);

    const claims = (claimsData || []).map((row: any) => ({
      id: row.id,
      topic: row.topic,
      claim: row.claim,
      experienceName: row.experience_name,
      sourceBullet: row.source_bullet,
      claimType: row.claim_type,
      mustVerify: row.must_verify || [],
      niceToHave: row.nice_to_have,
      evidenceHints: row.evidence_hints,
      rankingSignals: row.ranking_signals || { relevanceToRole: 0, technicalImportance: 0, ambiguityRisk: 0, businessImpact: 0, interviewValue: 0 },
      rationale: row.rationale
    }));

    // 3. Fetch transcript
    const { data: transcriptData } = await supabaseAdmin
      .from('session_transcripts')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    const transcript = (transcriptData || []).map((row: any) => ({
      questionId: row.question_id,
      timestamp: row.timestamp,
      question: row.question,
      answer: row.answer,
      claimId: row.claim_id,
      claimText: row.claim_text,
      experienceName: row.experience_name,
      turnType: row.turn_type,
      answerStatus: row.answer_status
    }));

    if (transcript.length === 0) {
      return new Response(JSON.stringify({ error: "No transcript found for this session" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 4. Build the report generation prompt (same as the old client-side one)
    const historyText = transcript.map((t: any, i: number) => `
--- Turn ${i + 1} ---
Type: ${t.turnType || 'unknown'}
Target Claim ID: ${t.claimId || 'N/A'}
Target Claim: ${t.claimText || 'N/A'}
Experience: ${t.experienceName || 'N/A'}
Answer Status (Agent Evaluated): ${t.answerStatus || 'N/A'}
Q: ${t.question}
A: ${t.answer}
`).join('\n');

    const prompt = `
      You are an expert technical hiring manager.
      Evaluate the following structured interview transcript and generate a comprehensive final report.
      
      The candidate was evaluated against the following claims from their resume:
      ${JSON.stringify(claims, null, 2)}
      
      Structured Interview Transcript:
      ${historyText}
      
      INSTRUCTIONS:
      1. Evaluate the candidate PER CLAIM. For each claim evaluated in the transcript, determine if the "Must Verify Points" were successfully verified.
      2. Assign a verificationStatus to each claim: strong, partial, weak, or unverified.
      3. Assign a riskLevel to each claim: low, medium, or high.
      4. List missingPoints for the claim (what was not verified or missing).
      5. List specific strengths and weaknesses for the claim based on the candidate's answers.
      6. Provide 1-10 scores across the specified dimensions for the claim overall.
      7. Under each claim, nest the specific Q&A turns (turnEvaluations) that support your evaluation, along with brief notes on how that specific turn contributed to the claim's evaluation. Make sure to accurately copy the 'answerStatus' for each turn.
      8. EVALUATION FAIRNESS RULE: Base your core score and verification status primarily on how well the candidate handled the standardized verification rounds (e.g. initial questions and necessary clarifications). Questions intended to DEEPEN or CHALLENGE should be treated as opportunities for bonus points or risk reduction, NOT as baseline penalties. A candidate should not be penalized simply because they faced more follow-up questions.
      9. Finally, provide an overall recommendation, an overall score out of 100, a summary, strongest areas, riskFlags (overall), and suggested focus for the next round.
      10. **CRITICAL LOCALIZATION RULE**: All generated text MUST be in Chinese (zh-CN), EXCEPT for the enum values \`verificationStatus\`, \`riskLevel\`, and \`overallRecommendation\` which must strictly remain in English as defined below. Output \`summary\`, \`strongestAreas\`, \`riskFlags\`, \`suggestedNextRoundFocus\`, \`missingPoints\`, \`strengths\`, \`weaknesses\`, and \`notes\` entirely in Chinese.
      
      RECOMMENDATION GUIDANCE (DO NOT TRANSLATE THESE KEYS):
      Use recommendation labels consistently:
      - STRONG_HIRE: strong, credible evidence across most critical claims with low risk
      - HIRE: generally solid evidence with some minor gaps
      - LEAN_HIRE: promising but with meaningful gaps requiring another round
      - LEAN_NO_HIRE: multiple important gaps or weak verification
      - NO_HIRE: major claims unverified, weak evidence, or strong risk signals
      
      OVERALL SCORE GUIDANCE:
      90-100 = exceptional and strongly verified
      75-89 = solid and likely hireable
      60-74 = mixed signals / needs more verification
      40-59 = weak evidence / substantial gaps
      0-39 = poor interview signal
    `;

    // 5. Call Gemini server-side
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            overallRecommendation: { type: "STRING", description: "STRONG_HIRE, HIRE, LEAN_HIRE, LEAN_NO_HIRE, NO_HIRE" },
            overallScore: { type: "NUMBER", description: "Overall score from 0 to 100" },
            summary: { type: "STRING" },
            strongestAreas: { type: "ARRAY", items: { type: "STRING" } },
            riskFlags: { type: "ARRAY", items: { type: "STRING" } },
            suggestedNextRoundFocus: { type: "ARRAY", items: { type: "STRING" } },
            claimEvaluations: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  claimId: { type: "STRING" },
                  claimText: { type: "STRING" },
                  experienceName: { type: "STRING" },
                  verificationStatus: { type: "STRING", description: "strong, partial, weak, or unverified" },
                  riskLevel: { type: "STRING", description: "low, medium, or high" },
                  missingPoints: { type: "ARRAY", items: { type: "STRING" } },
                  strengths: { type: "ARRAY", items: { type: "STRING" } },
                  weaknesses: { type: "ARRAY", items: { type: "STRING" } },
                  scores: {
                    type: "OBJECT",
                    properties: {
                      relevance: { type: "NUMBER" },
                      specificity: { type: "NUMBER" },
                      technicalDepth: { type: "NUMBER" },
                      ownership: { type: "NUMBER" },
                      evidence: { type: "NUMBER" },
                      clarity: { type: "NUMBER" },
                    },
                    required: ["relevance", "specificity", "technicalDepth", "ownership", "evidence", "clarity"]
                  },
                  turnEvaluations: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        question: { type: "STRING" },
                        answer: { type: "STRING" },
                        turnType: { type: "STRING" },
                        answerStatus: { type: "STRING" },
                        notes: { type: "STRING" }
                      },
                      required: ["question", "answer", "answerStatus", "notes"]
                    }
                  }
                },
                required: ["claimId", "claimText", "verificationStatus", "riskLevel", "missingPoints", "strengths", "weaknesses", "scores", "turnEvaluations"]
              }
            }
          },
          required: ["overallRecommendation", "overallScore", "summary", "strongestAreas", "riskFlags", "suggestedNextRoundFocus", "claimEvaluations"]
        }
      }
    });

    // Parse the response
    let reportText = result.text || '{}';
    reportText = reportText.replace(/```json/g, '').replace(/```/g, '').trim();
    const report = JSON.parse(reportText);

    // Post-process: zero out scores for claims where all turns were non-answers
    if (report.claimEvaluations) {
      report.claimEvaluations.forEach((evaluation: any) => {
        const claimTurns = transcript.filter((t: any) =>
          (t.claimId && evaluation.claimId) ? t.claimId === evaluation.claimId : t.claimText === evaluation.claimText
        );
        if (claimTurns.length > 0 && claimTurns.every((t: any) => t.answerStatus === 'non_answer')) {
          evaluation.scores = {
            relevance: 0, specificity: 0, technicalDepth: 0,
            ownership: 0, evidence: 0, clarity: 0
          };
          evaluation.verificationStatus = 'unverified';
        }
      });
    }

    // 6. Save report and mark session as COMPLETED — server-side
    const { error: updateError } = await supabaseAdmin
      .from('interview_sessions')
      .update({ status: 'COMPLETED', report })
      .eq('id', sessionId);

    if (updateError) {
      console.error("[Generate-Report] Failed to save report:", updateError);
      // Still return the report even if save fails, so the client can retry
    }

    console.log(`[Generate-Report] Completed for session ${sessionId}`);

    return new Response(JSON.stringify({ success: true, report }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("[Generate-Report] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
