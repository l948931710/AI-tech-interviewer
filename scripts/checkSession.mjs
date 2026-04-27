import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSession() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("Usage: node scripts/checkSession.mjs <session-id>");
    process.exit(1);
  }
  
  const { data, error } = await supabase
    .from('interview_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .single();

  console.log("Error:", error);
  console.log("Data:", data);
}

checkSession();
