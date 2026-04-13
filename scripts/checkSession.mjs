import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSession() {
  const sessionId = "mnwrfbh7shb255ys8nj";
  
  const { data, error } = await supabase
    .from('interview_sessions')
    .select('id, invite_token, status')
    .eq('id', sessionId)
    .single();

  console.log("Error:", error);
  console.log("Data:", data);
}

checkSession();
