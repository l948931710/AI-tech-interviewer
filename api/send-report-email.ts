import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

/**
 * Sends an interview report by email via EmailJS — server-side.
 *
 * L1 fix: previously the frontend called @emailjs/browser directly, shipping the
 * EmailJS service/template/public IDs in the client bundle (anyone could extract
 * them and burn the account's send quota). This endpoint keeps all EmailJS
 * identifiers server-side (non-VITE_ env vars) and requires a valid HR Supabase
 * JWT before sending.
 *
 * Required server env vars (never prefix with VITE_):
 *   EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
 * The EmailJS dashboard must have "Allow EmailJS API for non-browser applications"
 * enabled (Account → Security) for the private-key REST call to succeed.
 */
export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Require a valid HR Supabase JWT.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[SendReportEmail] Missing Supabase env vars');
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Validate input.
    const body = await req.json();
    const { toEmail, candidateName, message } = body || {};
    if (typeof toEmail !== 'string' || !toEmail.includes('@') || typeof message !== 'string' || !message) {
      return new Response(JSON.stringify({ error: 'Valid toEmail and message are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Load server-side EmailJS credentials.
    const serviceId = process.env.EMAILJS_SERVICE_ID;
    const templateId = process.env.EMAILJS_TEMPLATE_ID;
    const publicKey = process.env.EMAILJS_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_PRIVATE_KEY;
    if (!serviceId || !templateId || !publicKey || !privateKey) {
      console.error('[SendReportEmail] EmailJS env vars not configured');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Send via the EmailJS REST API (server-to-server, private key required).
    const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        accessToken: privateKey,
        template_params: {
          to_email: toEmail,
          candidate_name: typeof candidateName === 'string' ? candidateName : '',
          message,
        },
      }),
    });

    if (!emailRes.ok) {
      const detail = await emailRes.text().catch(() => '');
      console.error('[SendReportEmail] EmailJS send failed:', emailRes.status, detail);
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[SendReportEmail] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
