import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Eye, EyeOff, ShieldCheck, ArrowRight, Mail, MailCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function Login() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Forgot-password (Recover Access) flow
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverError, setRecoverError] = useState('');
  const [recoverSent, setRecoverSent] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  const openRecover = () => {
    setRecoverMode(true);
    setRecoverEmail(employeeId);
    setRecoverError('');
    setRecoverSent(false);
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoverEmail) return;

    setRecoverError('');
    setIsRecovering(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(recoverEmail, {
      redirectTo: `${window.location.origin}/hr/update-password`,
    });

    setIsRecovering(false);

    if (resetError) {
      console.error('[Login] Password reset request failed:', resetError);
      setRecoverError('Could not send the reset link. Please check the email address and try again.');
      return;
    }

    // Always show a neutral success state (avoids leaking which emails exist).
    setRecoverSent(true);
  };

  // Auto-redirect if already authenticated
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/hr/dashboard', { replace: true });
      }
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !password) return;

    setError('');
    setIsSubmitting(true);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: employeeId,
      password: password,
    });

    setIsSubmitting(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    // Success: redirect to HR dashboard
    navigate('/hr/dashboard');
  };

  const inputBase =
    'w-full bg-white/5 border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-[14px] focus:border-primary focus:ring-1 focus:ring-primary/40 transition-all outline-none text-white placeholder:text-white/25';

  return (
    <div className="min-h-[100dvh] bg-background text-white font-body grid lg:grid-cols-2 relative overflow-hidden">
      {/* ---- Left: brand panel (desktop only) ------------------------------- */}
      <aside className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden border-r border-white/5">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute -top-[10%] -left-[10%] w-[70%] h-[70%] rounded-full bg-primary/10 blur-[150px] animate-[auroraDrift_20s_ease-in-out_infinite]" />
          <div className="absolute bottom-[-15%] left-[20%] w-[50%] h-[50%] rounded-full bg-primary/[0.05] blur-[140px]" />
        </div>

        <div className="relative z-10 flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_14px_rgba(198,242,78,0.7)]" />
          <span className="text-xl font-display font-bold tracking-tight">AURA</span>
        </div>

        <div className="relative z-10 max-w-md">
          <h1 className="font-display font-bold tracking-tight leading-[1.05] text-5xl xl:text-[3.5rem] mb-6">
            Structured interviews.
            <br />
            <span className="text-primary">Evidence-scored</span> reports.
          </h1>
          <p className="text-white/55 text-lg leading-relaxed mb-10 max-w-sm">
            Sign in to launch sessions, track candidates, and read the reports your team acts on.
          </p>

          <ul className="space-y-4">
            {[
              'Adaptive, claim-by-claim questioning',
              'Six-dimension evidence scoring',
              'Decision-ready reports in one click',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3 text-white/70 text-[15px]">
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-white/35">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-[0.2em]">AES-256 encrypted connection</span>
        </div>
      </aside>

      {/* ---- Right: auth card ---------------------------------------------- */}
      <main className="flex items-center justify-center px-6 py-14 relative">
        <div className="w-full max-w-[400px] animate-[fadeIn_0.6s_ease-out]">
          {/* Compact wordmark for mobile */}
          <div className="flex lg:hidden items-center gap-2.5 justify-center mb-10">
            <span className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_14px_rgba(198,242,78,0.7)]" />
            <span className="text-xl font-display font-bold tracking-tight">AURA</span>
          </div>

          <div className="mb-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary/80 mb-2">
              Human resources gateway
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tight">
              {recoverMode ? (recoverSent ? 'Check your email' : 'Recover access') : 'Command Center'}
            </h2>
          </div>

          {recoverMode ? (
            recoverSent ? (
              <div className="glass-panel rounded-2xl p-8 relative overflow-hidden edge-accent space-y-5">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/10 border border-primary/20 rounded-xl">
                  <MailCheck className="text-primary w-6 h-6" />
                </div>
                <p className="text-white/60 text-[14px] leading-relaxed">
                  If an account exists for <span className="text-white">{recoverEmail}</span>, we've sent a link to
                  reset your passcode. Open it in a browser to set a new one.
                </p>
                <button
                  type="button"
                  onClick={() => setRecoverMode(false)}
                  className="text-[11px] font-bold uppercase tracking-wider text-primary hover:text-white transition-colors"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form className="glass-panel rounded-2xl p-8 relative overflow-hidden edge-accent space-y-6" onSubmit={handleRecover}>
                <p className="text-white/55 text-[13px] leading-relaxed">
                  Enter your email and we'll send a reset link.
                </p>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block ml-1">
                    System ID / Email
                  </label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-5 h-5 group-focus-within:text-primary transition-colors" />
                    <input
                      required
                      autoFocus
                      value={recoverEmail}
                      onChange={(e) => { setRecoverEmail(e.target.value); setRecoverError(''); }}
                      className={inputBase}
                      placeholder="e.g. hr@aura.dev"
                      type="email"
                    />
                  </div>
                </div>

                {recoverError && (
                  <div className="bg-error/10 border border-error/25 rounded-lg p-3">
                    <p className="text-error text-xs font-medium text-center">{recoverError}</p>
                  </div>
                )}

                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={isRecovering}
                    className="w-full h-13 py-4 bg-primary text-background font-bold text-[13px] tracking-widest uppercase rounded-xl hover:bg-[#b6e63a] active:translate-y-px transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>{isRecovering ? 'Sending…' : 'Send reset link'}</span>
                    {!isRecovering && <ArrowRight className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecoverMode(false)}
                    className="w-full text-center text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white transition-colors"
                  >
                    Back to sign in
                  </button>
                </div>
              </form>
            )
          ) : (
            <form className="glass-panel rounded-2xl p-8 relative overflow-hidden edge-accent space-y-6" onSubmit={handleLogin}>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block ml-1">
                  System ID / Email
                </label>
                <div className="relative group">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-5 h-5 group-focus-within:text-primary transition-colors" />
                  <input
                    required
                    value={employeeId}
                    onChange={(e) => { setEmployeeId(e.target.value); setError(''); }}
                    className={inputBase}
                    placeholder="e.g. hr@aura.dev"
                    type="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">Passcode</label>
                  <button
                    type="button"
                    onClick={openRecover}
                    className="text-[10px] font-bold uppercase tracking-wider text-primary/80 hover:text-primary transition-colors"
                  >
                    Recover access
                  </button>
                </div>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-5 h-5 group-focus-within:text-primary transition-colors" />
                  <input
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputBase.replace('pr-4', 'pr-12')}
                    placeholder="••••••••"
                    type={showPassword ? 'text' : 'password'}
                  />
                  <button
                    type="button"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-primary transition-colors flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide passcode' : 'Show passcode'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
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
                <span>{isSubmitting ? 'Authenticating…' : 'Initialize session'}</span>
                {!isSubmitting && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>
          )}

          <div className="mt-8 flex lg:hidden items-center justify-center gap-2 text-white/30">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-[0.2em]">AES-256 encrypted connection</span>
          </div>
        </div>
      </main>
    </div>
  );
}
