import { createClient } from '@supabase/supabase-js';

/**
 * Shared authentication helper for Vercel Edge API endpoints.
 * 
 * Validates a Supabase JWT from the Authorization header.
 * Returns the authenticated user on success, or a 401 Response on failure.
 */
export async function verifyAuth(req: Request): Promise<
  { user: { id: string; email?: string }; error?: never } |
  { user?: never; error: Response }
> {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: new Response(JSON.stringify({ error: 'Unauthorized: Missing token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[Auth] Missing Supabase environment variables');
    return {
      error: new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return {
      error: new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  return { user: { id: user.id, email: user.email ?? undefined } };
}
