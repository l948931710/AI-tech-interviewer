const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('session_transcripts')
    .select('session_id, timestamp, turn_type')
    .order('timestamp', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const sessions = {};
  for (const row of data) {
    if (!sessions[row.session_id]) sessions[row.session_id] = [];
    sessions[row.session_id].push(row);
  }

  for (const [id, transcript] of Object.entries(sessions)) {
    console.log(`\nSession: ${id}`);
    console.log(`Length: ${transcript.length}`);
    if (transcript.length > 0) {
      const first = transcript[0].timestamp;
      const last = transcript[transcript.length - 1].timestamp;
      console.log(`First Turn: ${first}`);
      console.log(`Last Turn: ${last}`);

      // Replicate the db_supabase formatting
      const formattedFirst = new Date(first).getTime().toString();
      const formattedLast = new Date(last).getTime().toString();
      
      console.log(`Formatted First: ${formattedFirst}`);
      
      // Replicate Dashboard parsing
      const parsedStart = !isNaN(Number(formattedFirst)) ? Number(formattedFirst) : formattedFirst;
      const parsedEnd = !isNaN(Number(formattedLast)) ? Number(formattedLast) : formattedLast;
      
      const start = new Date(parsedStart).getTime();
      const end = new Date(parsedEnd).getTime();
      console.log(`Start Time ms: ${start}`);
      console.log(`End Time ms: ${end}`);
      if (isNaN(start) || isNaN(end)) {
         console.log("-> returns N/A");
      } else {
         const diffMins = Math.max(1, Math.round((end - start) / 60000));
         console.log(`-> returns ${diffMins} min(s)`);
      }
    }
  }
}
check();
