import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, ArrowRight, ShieldCheck, EyeOff, Loader2 } from 'lucide-react';
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

  const inputBase =
    'w-full bg-white/5 border border-white/10 rounded-xl py-3.5 pl-12 pr-12 text-[14px] focus:border-primary focus:ring-1 focus:ring-primary/40 transition-all outline-none text-white placeholder:text-white/25';

  // Guard: Show loading while verifying session
  if (hasValidSession === null) {
    return (
      <div className="bg-background text-white min-h-[100dvh] flex items-center justify-center font-body">
        <div className="text-center flex flex-col items-center gap-4">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
          <div className="text-xl font-bold tracking-tight font-display">AURA</div>
          <p className="text-white/50 text-[13px] tracking-wide">{authStatusMsg}</p>
        </div>
      </div>
    );
  }

  // Guard: No valid session — block access
  if (hasValidSession === false) {
    return (
      <div className="bg-background text-white min-h-[100dvh] flex items-center justify-center font-body p-6">
        <div className="glass-panel rounded-2xl p-10 max-w-md text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-error/50 to-transparent" />
          <div className="inline-flex items-center justify-center w-14 h-14 bg-error/10 border border-error/25 rounded-2xl mb-5">
            <ShieldCheck className="text-error w-7 h-7" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight mb-3">Access denied</h1>
          <p className="text-sm text-white/60 leading-relaxed mb-5">
            This link is invalid or expired — please request a new one from the sign-in page. If you followed an
            email link, open it in a browser rather than inside the email app.
          </p>
          <p className="text-[10px] text-white/30 uppercase tracking-wider">{authStatusMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-white font-body grid lg:grid-cols-2 relative overflow-hidden">
      {/* ---- Left: brand panel (desktop only) ------------------------------- */}
      <aside className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden border-r border-white/5">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute -top-[10%] -left-[10%] w-[70%] h-[70%] rounded-full bg-primary/10 blur-[150px] animate-[auroraDrift_20s_ease-in-out_infinite]" />
        </div>
        <div className="relative z-10 flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_14px_rgba(198,242,78,0.7)]" />
          <span className="text-xl font-display font-bold tracking-tight">AURA</span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="font-display font-bold tracking-tight leading-[1.05] text-5xl xl:text-[3.5rem] mb-6">
            Set a new
            <br />
            <span className="text-primary">passcode.</span>
          </h1>
          <p className="text-white/55 text-lg leading-relaxed max-w-sm">
            Choose a strong passcode. You'll use it every time you sign in to the Command Center.
          </p>
        </div>
        <div className="relative z-10 flex items-center gap-2 text-white/35">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-[0.2em]">End-to-end encrypted session</span>
        </div>
      </aside>

      {/* ---- Right: form card --------------------------------------------- */}
      <main className="flex items-center justify-center px-6 py-14 relative">
        <div className="w-full max-w-[400px] animate-[fadeIn_0.6s_ease-out]">
          <div className="flex lg:hidden items-center gap-2.5 justify-center mb-10">
            <span className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_14px_rgba(198,242,78,0.7)]" />
            <span className="text-xl font-display font-bold tracking-tight">AURA</span>
          </div>

          <div className="mb-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary/80 mb-2">Secure your account</p>
            <h2 className="font-display text-3xl font-bold tracking-tight">Update password</h2>
          </div>

          <form className="glass-panel rounded-2xl p-8 relative overflow-hidden edge-accent space-y-6" onSubmit={handleUpdate}>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block ml-1">New password</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-5 h-5 group-focus-within:text-primary transition-colors" />
                <input
                  required
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  className={inputBase}
                  placeholder="••••••••"
                  type={showPassword ? 'text' : 'password'}
                  minLength={6}
                />
                <button
                  type="button"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-primary transition-colors flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block ml-1">Confirm password</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-5 h-5 group-focus-within:text-primary transition-colors" />
                <input
                  required
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  className={inputBase}
                  placeholder="••••••••"
                  type={showPassword ? 'text' : 'password'}
                  minLength={6}
                />
              </div>
            </div>

            {error && (
              <div className="bg-error/10 border border-error/25 rounded-lg p-3">
                <p className="text-error text-xs font-medium text-center">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-13 py-4 bg-primary text-background font-bold text-[13px] tracking-widest uppercase rounded-xl hover:bg-[#b6e63a] active:translate-y-px transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isSubmitting ? 'Updating…' : 'Set password'}</span>
              {!isSubmitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <div className="mt-8 flex lg:hidden items-center justify-center gap-2 text-white/30">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-[0.2em]">End-to-end encrypted session</span>
          </div>
        </div>
      </main>
    </div>
  );
}
