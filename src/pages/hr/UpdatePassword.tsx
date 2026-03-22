import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Lock, Eye, ArrowRight, ShieldCheck, Globe, HelpCircle, EyeOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function UpdatePassword() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasValidSession, setHasValidSession] = useState<boolean | null>(null);
  const [authStatusMsg, setAuthStatusMsg] = useState('Verifying link security...');

  useEffect(() => {
    // 1. Diagnose URL states to catch stripped tokens
    const hash = window.location.hash;
    const search = window.location.search;
    
    if (!hash && !search) {
      setAuthStatusMsg('No security token found in URL. If you clicked an email link, your browser may have stripped it. Try copying and pasting the full link from the email.');
    } else if (search.includes('code=')) {
      setAuthStatusMsg('Processing PKCE secure code...');
    } else if (hash.includes('access_token=')) {
      setAuthStatusMsg('Parsing secure recovery token...');
    }

    // 2. Base check for existing session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      setHasValidSession(!!session);
      if (error) setAuthStatusMsg(`Supabase Error: ${error.message}`);
      if (session && authStatusMsg.includes('security')) {
        setAuthStatusMsg('Ready to update password!');
      }
    });

    // 3. Precise listener for the PASSWORD_RECOVERY event triggered by the email link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[UpdatePassword] Supabase Auth Event:", event);
      if (event === 'PASSWORD_RECOVERY') {
        setHasValidSession(true);
        setAuthStatusMsg('Recovery session established! You may now set your new password.');
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
      setError(`Cannot update: ${authStatusMsg}`);
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
      <div className="bg-background text-on-background min-h-screen flex items-center justify-center font-sans">
        <div className="text-center">
          <div className="inline-flex items-center justify-center p-4 bg-surface-container-lowest rounded-xl shadow-sm mb-4 animate-pulse">
            <Network className="text-primary w-9 h-9" />
          </div>
          <p className="font-label text-sm text-outline">{authStatusMsg}</p>
        </div>
      </div>
    );
  }

  // Guard: No valid session — block access
  if (hasValidSession === false) {
    return (
      <div className="bg-background text-on-background min-h-screen flex items-center justify-center font-sans">
        <div className="text-center max-w-md px-6">
          <div className="inline-flex items-center justify-center p-4 bg-red-50 rounded-xl shadow-sm mb-4">
            <ShieldCheck className="text-red-400 w-9 h-9" />
          </div>
          <h1 className="font-headline text-2xl font-extrabold tracking-tight text-on-surface mb-2">Access Denied</h1>
          <p className="font-body text-sm text-outline mb-6">
            This page requires a valid invitation link. Please check your email for the invitation from your administrator, and open the link in a browser (not inside the email app).
          </p>
          <p className="font-label text-[10px] text-outline/60 uppercase tracking-wider">{authStatusMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-sans">
      {/* Shared TopNavBar */}
      <nav className="fixed top-0 w-full z-50 flex justify-between items-center px-6 py-4 bg-white/40 dark:bg-black/20 backdrop-blur-sm">
        <div className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Fuling USA</div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-8 font-manrope text-[0.875rem] tracking-tight font-medium">
            <span className="text-slate-500 dark:text-slate-400 cursor-pointer">Portal Home</span>
            <span className="text-slate-500 dark:text-slate-400 cursor-pointer">Employee Guidelines</span>
          </div>
          <div className="flex gap-4">
            <Globe className="text-green-500 dark:text-green-400 cursor-pointer w-6 h-6" />
            <HelpCircle className="text-green-500 dark:text-green-400 cursor-pointer w-6 h-6" />
          </div>
        </div>
      </nav>

      <main className="flex-grow flex items-center justify-center px-4 relative overflow-hidden">
        {/* Atmospheric Glow Background */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>

        {/* Update Password Container */}
        <div className="w-full max-w-[440px] z-10 mt-16">
          {/* Branding Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center p-4 bg-surface-container-lowest rounded-xl shadow-sm mb-4">
              <Network className="text-primary w-9 h-9" />
            </div>
            <h1 className="font-headline text-2xl font-extrabold tracking-tight text-on-surface">Update Password</h1>
            <p className="font-label text-[10px] font-bold uppercase tracking-wider text-outline mt-1">Secure your HR Account</p>
          </div>

          {/* Form Card */}
          <div className="bg-surface-container-lowest rounded-xl shadow-2xl p-8 md:p-10 border border-surface-container">
            <form className="space-y-6" onSubmit={handleUpdate}>
              
              <div className="space-y-2">
                <label className="font-label text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block ml-1">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-outline w-5 h-5" />
                  <input
                    required
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    className="w-full bg-surface-container-low border-none rounded-lg py-3.5 pl-12 pr-12 text-[0.875rem] focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all outline-none text-on-surface placeholder:text-outline/50"
                    placeholder="••••••••"
                    type={showPassword ? 'text' : 'password'}
                    minLength={6}
                  />
                  <div 
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-outline cursor-pointer hover:text-primary transition-colors flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="font-label text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block ml-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-outline w-5 h-5" />
                  <input
                    required
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                    className="w-full bg-surface-container-low border-none rounded-lg py-3.5 pl-12 pr-12 text-[0.875rem] focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all outline-none text-on-surface placeholder:text-outline/50"
                    placeholder="••••••••"
                    type={showPassword ? 'text' : 'password'}
                    minLength={6}
                  />
                </div>
              </div>

              {error && (
                <p className="text-red-500 text-xs font-bold px-1">{error}</p>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-primary hover:bg-secondary text-on-primary font-bold py-4 rounded-full shadow-[0_0_15px_rgba(17,212,17,0.3)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <span>{isSubmitting ? 'UPDATING...' : 'SET PASSWORD'}</span>
                  {!isSubmitting && <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </form>
          </div>

          {/* Security Notice */}
          <div className="mt-6 flex items-center justify-center gap-2 text-outline">
            <ShieldCheck className="w-4 h-4" />
            <span className="font-label text-[8px] uppercase tracking-wider">End-to-End Encrypted Session</span>
          </div>
        </div>
      </main>

      {/* Shared Footer Component */}
      <footer className="fixed bottom-0 w-full flex justify-between items-center px-8 py-6 bg-transparent">
        <div className="font-manrope text-[8px] uppercase tracking-wider font-medium text-slate-400">
          © 2024 Fuling USA. Secure HR Portal.
        </div>
        <div className="flex gap-6 font-manrope text-[8px] uppercase tracking-wider font-medium text-slate-400">
          <a className="hover:text-green-500 transition-colors opacity-80 hover:opacity-100" href="#">Privacy Policy</a>
          <a className="hover:text-green-500 transition-colors opacity-80 hover:opacity-100" href="#">Terms of Service</a>
          <a className="hover:text-green-500 transition-colors opacity-80 hover:opacity-100" href="#">Support</a>
        </div>
      </footer>
    </div>
  );
}
