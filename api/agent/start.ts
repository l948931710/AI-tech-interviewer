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

    const { data: claimsData } = await supabaseAdmin.from('session_claims').select('*').eq('session_id', sessionId).order('experience_name', { ascending: true, nullsFirst: false }).order('id', { ascending: true });
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

    // Save the pre-computed first question to DB, and transition the session cleanly.
    const updates: any = { 
      status: 'IN_PROGRESS', 
      phase: 'intro', 
      first_question: parsed.question 
    };

    // Fix 30-minute race condition: only set started_at ONCE when the candidate clicks Begin Session
    if (!sessionData.started_at) {
      updates.started_at = new Date().toISOString();
    }

    const { error: updateError } = await supabaseAdmin
      .from('interview_sessions')
      .update(updates)
      .eq('id', sessionId);

    if (updateError) {
      console.error("[Start] DB Update error:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
    }

    // Mark Token as used & increment usage count
    const interviewToken = req.headers.get('X-Interview-Token');
    if (interviewToken && process.env.VITE_USE_LOCAL_DB !== 'true') {
      const msgBuffer = new TextEncoder().encode(interviewToken);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const { data: tokData } = await supabaseAdmin
        .from('invite_tokens')
        .select('id, use_count')
        .eq('token_hash', tokenHash)
        .single();
        
      if (tokData) {
        await supabaseAdmin
          .from('invite_tokens')
          .update({ is_used: true, use_count: tokData.use_count + 1 })
          .eq('id', tokData.id);
      }
    }

    const introText = language === 'zh-CN' 
      ? "你好！欢迎参加今天的技术面试。在正式开始深入探讨你的项目之前，能先简单做个自我介绍吗？" 
      : "Hello! Welcome to your technical interview today. Before we dive deep into your projects, could you give me a brief self-introduction?";

    // We return the intro question to kick off the candidate's turn
    return new Response(JSON.stringify({
      nextQuestion: introText,
      spokenQuestion: introText,
      decision: "NEXT_CLAIM",
      answerStatus: "answered",
      decisionRationale: "[System] Started interview, returning intro question."
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("[Start] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
