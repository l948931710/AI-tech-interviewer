import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { verifyAuth } from "../api-auth";

export const config = { runtime: 'edge' };

let cachedAI: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured.");
  if (!cachedAI) cachedAI = new GoogleGenAI({ apiKey });
  return cachedAI;
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase config.");
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const auth = await verifyAuth(req);
  if (auth.error) return auth.error;

  try {
    const { sessionId, language = 'zh-CN' } = await req.json();

    if (sessionId !== auth.user.id.replace('candidate-', '')) {
      return new Response(JSON.stringify({ error: "Context mismatch" }), { status: 403 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from('interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      return new Response(JSON.stringify({ error: "Session not found" }), { status: 404 });
    }

    const { data: claimsData } = await supabaseAdmin.from('session_claims').select('*').eq('session_id', sessionId);
    if (!claimsData || claimsData.length === 0) {
      return new Response(JSON.stringify({ error: "No claims in session" }), { status: 400 });
    }

    const firstClaim = claimsData[0];
    const candidateInfo = sessionData.candidate_info;
    const jdText = sessionData.jd_text;

    // SECURE PROMPT CONSTRUCTION
    const prompt = `
      You are an expert technical AI interviewer.
      Generate the first deep-dive technical interview question for the candidate.
      
      Candidate Info: ${JSON.stringify(candidateInfo)}
      Job Description: ${JSON.stringify(jdText)}
      
      The question should probe the following high-priority claim from their resume:
      Topic: ${JSON.stringify(firstClaim.topic)}
      Claim: ${JSON.stringify(firstClaim.claim)}
      Experience/Project Name: ${JSON.stringify(firstClaim.experience_name || 'Not specified')}
      Must Verify Points: ${JSON.stringify(firstClaim.must_verify || [])}
      Nice-to-Have Points: ${JSON.stringify(firstClaim.nice_to_have || [])}
      Evidence Hints: ${JSON.stringify(firstClaim.evidence_hints || [])}
      Rationale for probing: ${JSON.stringify(firstClaim.rationale)}
      
      The question should probe technical depth, implementation details, architecture/design decisions, tradeoffs, debugging/failure handling, metric attribution, and personal contribution/ownership. Avoid generic questions. It should feel like a real experienced interviewer is asking it.
      
      IMPORTANT: This is the first technical question AFTER the candidate's self-introduction. You MUST include a brief, natural transition acknowledging their intro.
      IMPORTANT: You MUST explicitly mention the specific experience, project, or company from their resume that you are asking about to make it conversational and natural.
      IMPORTANT: The generated question MUST be in ${language === 'zh-CN' ? 'Chinese (Simplified)' : 'English'}.
      IMPORTANT: Generate a \`spokenQuestion\` which is a concise, conversational version of the \`question\` optimized for Text-to-Speech. It must include the transition but keep the actual question part short to minimize TTS latency.
    `;

    const ai = getAI();
    const streamResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            question: { type: "STRING" },
            spokenQuestion: { type: "STRING" },
            rationale: { type: "STRING" }
          },
          required: ["question", "spokenQuestion", "rationale"]
        }
      }
    });

    let rawText = streamResponse.text || "{}";
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(rawText);

    return new Response(JSON.stringify(parsed), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("[Start] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
