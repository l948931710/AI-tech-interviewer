import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const inviteToken = crypto.randomUUID();

  // 1. Create a session
  console.log("Creating session...");
  const { data: sessionData, error: sessionError } = await supabase
    .from('interview_sessions')
    .insert({
      jd_text: "Test JD",
      job_role_context: "Test context",
      candidate_info: { name: "Test Candidate", workExperience: [], education: [], technicalSkills: [] },
      status: 'IN_PROGRESS',
      invite_token: inviteToken,
    })
    .select('id')
    .single();

  if (sessionError) { console.error(sessionError); return; }

  console.log("Created session:", sessionData.id);

  // 2. Insert a claim
  await supabase
    .from('session_claims')
    .insert({
      session_id: sessionData.id,
      topic: "Test Topic",
      claim: "Test Claim",
      claim_type: "implementation",
      must_verify: [],
      ranking_signals: { relevanceToRole: 1, technicalImportance: 1, ambiguityRisk: 1, businessImpact: 1, interviewValue: 1 },
      rationale: "Test rationale"
    });

  // 3. Call local proxy API /api/agent/start
  console.log("Calling /api/agent/start...");
  const resStart = await fetch('http://localhost:3000/api/agent/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionData.id,
      'X-Interview-Token': inviteToken
    },
    body: JSON.stringify({
      sessionId: sessionData.id,
      language: 'zh-CN'
    })
  });

  console.log("Status:", resStart.status);
  const textStart = await resStart.text();
  console.log("Response:", textStart);

}

main();
