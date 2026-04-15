import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Checking latest sessions...");
  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select('id, status, created_at')
    .order('created_at', { ascending: false })
    .limit(3);
    
  console.log("Latest Sessions:", sessions);
  
  console.log("Checking latest invite tokens...");
  const { data: tokens } = await supabase
    .from('invite_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);
    
  console.log("Latest Tokens:", tokens);
}

main().catch(console.error);
