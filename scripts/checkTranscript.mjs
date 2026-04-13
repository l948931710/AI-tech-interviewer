import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase env vars");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLastTranscript() {
  const { data, error } = await supabase
    .from('interview_sessions')
    .select('id, transcript, status')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error("DB Error:", error);
    return;
  }

  for (const row of data) {
    console.log(`Session ${row.id} [${row.status}] transcript length: ${row.transcript?.length}`);
    if (row.transcript && row.transcript.length > 0) {
      console.log(`- Turn 0 timestamp:`, row.transcript[0]?.timestamp);
      if (row.transcript.length > 1) {
        console.log(`- Turn ${row.transcript.length - 1} timestamp:`, row.transcript[row.transcript.length - 1]?.timestamp);
      }
      console.log("Full Turn 0:", JSON.stringify(row.transcript[0]));
    }
  }
}

checkLastTranscript();
