import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase config in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const inviteToken = crypto.randomUUID();

  const { data: sessionData, error: sessionError } = await supabase
    .from('interview_sessions')
    .insert({
      jd_text: "Senior Frontend Engineer proficient in React, Node, and edge computing.",
      job_role_context: "You are interviewing a candidate for a Senior Frontend Engineer role. The role focuses on building resilient, edge-rendered web applications.",
      candidate_info: { name: "Test Candidate", workExperience: [], education: [], technicalSkills: ["React", "Typescript", "Node"] },
      status: 'PENDING',
      invite_token: inviteToken,
    })
    .select('id')
    .single();

  if (sessionError || !sessionData) {
    console.error("Failed to create session:", sessionError);
    process.exit(1);
  }

  const { error: claimError } = await supabase
    .from('session_claims')
    .insert({
      session_id: sessionData.id,
      topic: "Frontend Optimization",
      claim: "Migrated a legacy React SPA to SSR on Edge, improving LCP by 40%.",
      experience_name: "Tech Corp",
      claim_type: "implementation",
      must_verify: ["How state was hydrated", "How edge caching was configured", "Metrics used to measure LCP"],
      nice_to_have: [],
      evidence_hints: [],
      ranking_signals: { relevanceToRole: 10, technicalImportance: 10, ambiguityRisk: 5, businessImpact: 10, interviewValue: 10 },
      rationale: "Testing edge engineering skills."
    });

  if (claimError) {
    console.error("Failed to create claim:", claimError);
    process.exit(1);
  }

  console.log(`\n✅ Created Test Session successfully!`);
  console.log(`🔗 Local Test Link: http://localhost:3000/interview?token=${inviteToken}\n`);
}

main();
