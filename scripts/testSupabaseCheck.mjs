import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('interview_sessions')
    .select('*')
    .limit(1);

  console.log("Session Select * Error:", error);
  
  const { data: d2, error: e2 } = await supabase
    .from('invite_tokens')
    .select('*')
    .limit(1);
    
  console.log("Tokens Select * Error:", e2);
}

check();
