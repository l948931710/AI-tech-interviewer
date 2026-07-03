import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, ArrowRight, ShieldCheck, EyeOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function UpdatePassword() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasValidSession, setHasValidSession] = useState<boolean | null>(null);
  const [authStatusMsg, setAuthStatusMsg] = useState('Verifying your reset link…');

  useEffect(() => {
    // 1. Diagnose URL state. Keep user-facing copy plain; log technical detail
    //    (PKCE code vs. recovery token) to the console only.
    const hash = window.location.hash;
    const search = window.location.search;

    if (!hash && !search) {
      console.warn('[UpdatePassword] No token found in URL (hash and query are both empty).');
      setAuthStatusMsg('This link is invalid or expired — please request a new one.');
    } else {
      if (search.includes('code=')) {
        console.log('[UpdatePassword] Detected PKCE code in query string; exchanging for session.');
      } else if (hash.includes('access_token=')) {
        console.log('[UpdatePassword] Detected recovery token in URL fragment; establishing session.');
      }
      setAuthStatusMsg('Verifying your reset link…');
    }

    // 2. Base check for existing session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      setHasValidSession(!!session);
      if (error) {
        console.error('[UpdatePassword] Supabase getSession error:', error);
        setAuthStatusMsg('This link is invalid or expired — please request a new one.');
      } else if (session) {
        setAuthStatusMsg('Ready to update your password.');
      }
    });

    // 3. Precise listener for the PASSWORD_RECOVERY event triggered by the email link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[UpdatePassword] Supabase Auth Event:', event);
      if (event === 'PASSWORD_RECOVERY') {
        setHasValidSession(true);
        setAuthStatusMsg('Ready to update your password.');
      } else if (session) {
        setHasValidSession(true);
      } else {
        setHasValidSession(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!hasValidSession) {
      setError('This link is invalid or expired — please request a new one.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setError('');
    setIsSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    setIsSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Success: Redirect to dashboard
    navigate('/hr/dashboard');
  };

  // Guard: Show loading while verifying session
  if (hasValidSession === null) {
    return (
      <div className="bg-background text-white min-h-screen flex items-center justify-center font-body">
        <div className="text-center">
          <div className="text-2xl font-bold tracking-tight font-display aura-gradient-text mb-4 animate-pulse">AURA</div>
          <p className="text-white/50 text-[13px] tracking-wide">{authStatusMsg}</p>
        </div>
      </div>
    );
  }

  // Guard: No valid session — block access
  if (hasValidSession === false) {
    return (
      <div className="bg-background text-white min-h-screen flex items-center justify-center font-body">
        <div className="text-center max-w-md px-6">
          <div className="inline-flex items-center justify-center p-4 bg-red-500/10 border border-red-500/20 rounded-xl mb-4">
            <ShieldCheck className="text-red-400 w-9 h-9" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white mb-2">Access Denied</h1>
          <p className="font-body text-sm text-white/60 mb-6">
            This link is invalid or expired — please request a new one from the sign-in page. If you followed
            an email link, open it in a browser rather than inside the email app.
          </p>
          <p className="font-body text-[10px] text-white/30 uppercase tracking-wider">{authStatusMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background text-white min-h-screen flex flex-col font-body relative overflow-hidden">

      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full aura-gradient opacity-[0.05] blur-[150px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full aura-gradient opacity-[0.05] blur-[150px]"></div>
      </div>

      {/* Shared TopNavBar */}
      <nav className="fixed top-0 w-full z-50 flex justify-between items-center px-8 py-6 bg-background/50 backdrop-blur-md border-b border-white/5">
        <div className="text-2xl font-bold tracking-tight font-display aura-gradient-text">AURA</div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-8 text-[13px] tracking-wide font-medium">
            <span className="text-white/50 hover:text-white cursor-pointer transition-colors">Portal Home</span>
            <span className="text-white/50 hover:text-white cursor-pointer transition-colors">Employee Guidelines</span>
          </div>
        </div>
      </nav>

      <main className="flex-grow flex items-center justify-center px-4 relative z-10 pt-20">
        {/* Update Password Container */}
        <div className="w-full max-w-[420px] animate-[fadeIn_0.6s_ease-out]">

          {/* Branding Header */}
          <div className="text-center mb-10">
            <h1 className="font-display text-4xl font-bold tracking-tight text-white mb-2">Update Password</h1>
            <p className="font-body text-[11px] font-bold uppercase tracking-[0.2em] text-primary/70">Secure your HR Account</p>
          </div>

          {/* Form Card */}
          <div className="glass-panel rounded-2xl p-8 md:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] aura-gradient opacity-50"></div>

            <form className="space-y-6" onSubmit={handleUpdate}>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block ml-1">
                  New Password
                </label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-5 h-5 group-focus-within:text-primary transition-colors" />
                  <input
                    required
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3.5 pl-12 pr-12 text-[14px] focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none text-white placeholder:text-white/20 font-light"
                    placeholder="••••••••"
                    type={showPassword ? 'text' : 'password'}
                    minLength={6}
                  />
                  <div
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 cursor-pointer hover:text-primary transition-colors flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block ml-1">
                  Confirm Password
                </label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-5 h-5 group-focus-within:text-primary transition-colors" />
                  <input
                    required
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3.5 pl-12 pr-12 text-[14px] focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none text-white placeholder:text-white/20 font-light"
                    placeholder="••••••••"
                    type={showPassword ? 'text' : 'password'}
                    minLength={6}
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <p className="text-red-400 text-xs font-medium text-center">{error}</p>
                </div>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-14 aura-gradient text-background font-bold text-[13px] tracking-widest uppercase rounded-xl hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(0,240,255,0.3)]"
                >
                  <span>{isSubmitting ? 'Updating...' : 'Set Password'}</span>
                  {!isSubmitting && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </form>
          </div>

          {/* Security Notice */}
          <div className="mt-8 flex items-center justify-center gap-2 text-white/30">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-[0.2em]">End-to-End Encrypted Session</span>
          </div>
        </div>
      </main>

      {/* Shared Footer Component */}
      <footer className="relative z-10 flex justify-between items-center px-8 py-6">
        <div className="text-[10px] uppercase tracking-[0.1em] text-white/30">
          © {new Date().getFullYear()} AURA SYSTEM. SECURE TERMINAL.
        </div>
        <div className="flex gap-6 text-[10px] uppercase tracking-[0.1em] text-white/30">
          <a className="hover:text-primary transition-colors" href="#">Security Protocol</a>
          <a className="hover:text-primary transition-colors" href="#">Terms</a>
        </div>
      </footer>
    </div>
  );
}
