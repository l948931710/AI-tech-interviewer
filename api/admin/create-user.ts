import { createClient } from '@supabase/supabase-js';

// Vercel Edge configuration
export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  // 1. Strictly enforce POST method
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 2. Security Check: Validate the frontend user's existing Supabase session.
    // The frontend must pass the currently logged in user's access token in the Authorization header.
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn("[Admin API] Unauthorized access attempt detected. Missing or invalid Bearer token.");
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables.");
    }

    // Initialize regular client to verify the caller's JWT token
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      console.warn("[Admin API] Invalid session token:", authError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Check if the current user is an allowed admin
    const allowedAdmins = ['l948931710@gmail.com'];
    if (!user.email || !allowedAdmins.includes(user.email)) {
      console.warn(`[Admin API] Forbidden access attempt from email: ${user.email}`);
      return new Response(JSON.stringify({ error: 'Forbidden: You do not have admin access' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Parse and validate input
    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Initialize Supabase Admin Client using the Service Role Key
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase admin environment variables.");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
         autoRefreshToken: false,
         persistSession: false,
      }
    });

    console.log(`[Admin API] Attempting to create user: ${email}`);

    // 5. Create the user with no password. email_confirm: true bypasses the standard verification email
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    });

    if (createError) {
      console.error("[Admin API] Error creating user:", createError.message);
      // Handle the duplicate user scenario
      if (createError.message.includes('already exists') || createError.status === 422) {
         return new Response(JSON.stringify({ error: 'User already exists' }), {
           status: 409,
           headers: { 'Content-Type': 'application/json' },
         });
      }
      throw createError;
    }

    const userId = userData.user.id;
    console.log(`[Admin API] Successfully created user: ${userId}`);

    // 6. Automatically trigger the password setup/reset email
    const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/update-password`,
    });

    if (resetError) {
      console.error("[Admin API] Error sending setup email:", resetError.message);
      // We still return 200, but let the client know the email failed so they can manually resend it
      return new Response(JSON.stringify({ 
        success: true, 
        userId, 
        warning: 'User created, but failed to send password setup email.' 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Admin API] Setup email sent to: ${email}`);

    // 7. Successful Exit
    return new Response(JSON.stringify({ 
      success: true, 
      userId,
      message: 'User created and setup email sent.'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("[Admin API] Fatal Server Error:", error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
