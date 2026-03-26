import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Maximum session age before forcing re-login (8 hours)
const MAX_SESSION_AGE_MS = 8 * 60 * 60 * 1000;

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const verifySession = async () => {
      try {
        // 1. Server-side validation: getUser() makes a network request to Supabase
        //    to verify the token is actually valid, unlike getSession() which only reads localStorage
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error || !user) {
          // Token is invalid or expired — clear local session and redirect
          await supabase.auth.signOut();
          setIsAuthenticated(false);
          return;
        }

        // 2. Session age check: force re-login after MAX_SESSION_AGE_MS
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const issuedAt = session.expires_at 
            ? (session.expires_at * 1000) - (3600 * 1000) // expires_at - 1hr (default JWT lifetime) = issued_at
            : 0;
          const sessionAge = Date.now() - issuedAt;
          
          if (sessionAge > MAX_SESSION_AGE_MS) {
            console.log('[Auth] Session expired (age check). Forcing re-login.');
            await supabase.auth.signOut();
            setIsAuthenticated(false);
            return;
          }
        }

        setIsAuthenticated(true);
      } catch (e) {
        console.error('[Auth] Verification failed:', e);
        setIsAuthenticated(false);
      }
    };

    verifySession();

    // Listen for auth changes (e.g. logout from another tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 text-gray-400">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="font-medium text-sm">Verifying Session...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/hr" replace />;
  }

  return <>{children}</>;
}
