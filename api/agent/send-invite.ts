import { createClient } from '@supabase/supabase-js';
import { verifyAuth } from '../api-auth';

export const config = { runtime: 'edge' };

/**
 * Emails an interview invite link to the candidate on file for a session.
 *
 * Mirrors api/send-report-email.ts: all EmailJS identifiers stay server-side
 * (non-VITE_ env vars) and a valid HR Supabase JWT is required. Ownership of the
 * session is enforced the same way as api/agent/generate-invite.ts — the calling
 * HR user must be the session's creator.
 *
 * The candidate email is read from the session's stored candidate_info (never
 * trusted from the client), while the tokenized invite link is passed in by the
 * caller (it holds the raw token returned by generate-invite, which is never
 * persisted server-side).
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

  // Require HR Auth (JWT). Candidate invite-token auth cannot satisfy the
  // ownership check below, so this endpoint is effectively HR-only.
  const auth = await verifyAuth(req);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { sessionId, inviteLink } = body || {};
    if (typeof sessionId !== 'string' || !sessionId) {
      return new Response(JSON.stringify({ error: 'Session ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (typeof inviteLink !== 'string' || !/^https?:\/\//.test(inviteLink)) {
      return new Response(JSON.stringify({ error: 'A valid inviteLink is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Admin client to read the session owner + candidate email.
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[SendInvite] Missing Supabase config');
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, created_by, candidate_info')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Ownership check (matches generate-invite.ts).
    if (sessionData.created_by !== auth.user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized to send invite for this session' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const candidateInfo = (sessionData.candidate_info || {}) as { name?: string; email?: string };
    const toEmail = candidateInfo.email;
    const candidateName = candidateInfo.name || '';
    if (typeof toEmail !== 'string' || !toEmail.includes('@')) {
      return new Response(JSON.stringify({ error: 'No candidate email on file for this session' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load server-side EmailJS credentials (same vars as send-report-email).
    const serviceId = process.env.EMAILJS_SERVICE_ID;
    const templateId = process.env.EMAILJS_TEMPLATE_ID;
    const publicKey = process.env.EMAILJS_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_PRIVATE_KEY;
    if (!serviceId || !templateId || !publicKey || !privateKey) {
      console.error('[SendInvite] EmailJS env vars not configured');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const greeting = candidateName ? `Hi ${candidateName},` : 'Hello,';
    const message =
      `${greeting}\n\n` +
      `You have been invited to complete an AI-assisted interview. ` +
      `Use the secure link below to begin:\n\n${inviteLink}\n\n` +
      `This link expires in 24 hours. If it has expired, please reply and we will send a new one.`;

    // Send via the EmailJS REST API (server-to-server, private key required).
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
          candidate_name: candidateName,
          message,
        },
      }),
    });

    if (!emailRes.ok) {
      const detail = await emailRes.text().catch(() => '');
      console.error('[SendInvite] EmailJS send failed:', emailRes.status, detail);
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, sentTo: toEmail }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[SendInvite] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
