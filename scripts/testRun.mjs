import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testCurrentSession() {
  const { data: sessionData } = await supabase
    .from('interview_sessions')
    .insert({
      jd_text: "Test",
      job_role_context: "Test",
      candidate_info: { name: "Test" },
      status: 'IN_PROGRESS',
      invite_token: "test-token-123",
    })
    .select('id')
    .single();

  const id = sessionData.id;
  const invite_token = "test-token-123";

  // insert claim
  await supabase.from('session_claims').insert({
      session_id: id, topic: "T", claim: "C", must_verify: ["Y"], rationale: "R"
  });

  const res = await fetch('http://localhost:3000/api/agent/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': id,
      'X-Interview-Token': invite_token
    },
    body: JSON.stringify({ sessionId: id, language: 'zh-CN' })
  });
  
  console.log(`HTTP Status: ${res.status}`);
  console.log(`Response Text: ${await res.text()}`);
}

testCurrentSession();
