import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, User, Lock, Eye, ArrowRight, ShieldCheck, Globe, HelpCircle, EyeOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function Login() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

        {/* Login Container */}
        <div className="w-full max-w-[440px] z-10 mt-16">
          {/* Branding Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center p-4 bg-surface-container-lowest rounded-xl shadow-sm mb-4">
              <Network className="text-primary w-9 h-9" />
            </div>
            <h1 className="font-headline text-2xl font-extrabold tracking-tight text-on-surface">Fuling USA</h1>
            <p className="font-label text-[10px] font-bold uppercase tracking-wider text-outline mt-1">Human Resources Information System</p>
          </div>

          {/* Login Card */}
          <div className="bg-surface-container-lowest rounded-xl shadow-2xl p-8 md:p-10 border border-surface-container">
            <form className="space-y-6" onSubmit={handleLogin}>
              <div className="space-y-2">
                <label className="font-label text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block ml-1">
                  Employee ID / Email
                </label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-outline w-5 h-5" />
                  <input
                    required
                    value={employeeId}
                    onChange={(e) => { setEmployeeId(e.target.value); setError(''); }}
                    className="w-full bg-surface-container-low border-none rounded-lg py-3.5 pl-12 pr-4 text-[0.875rem] focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all outline-none text-on-surface placeholder:text-outline/50"
                    placeholder="e.g. name@fuling.com"
                    type="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="font-label text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Password
                  </label>
                  <a className="font-label text-[10px] font-bold uppercase tracking-wider text-primary hover:underline transition-all" href="#">
                    Forgot Password?
                  </a>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-outline w-5 h-5" />
                  <input
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-surface-container-low border-none rounded-lg py-3.5 pl-12 pr-12 text-[0.875rem] focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all outline-none text-on-surface placeholder:text-outline/50"
                    placeholder="••••••••"
                    type={showPassword ? 'text' : 'password'}
                  />
                  <div 
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-outline cursor-pointer hover:text-primary transition-colors flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </div>
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
                  <span>{isSubmitting ? 'VERIFYING...' : 'LOGIN'}</span>
                  {!isSubmitting && <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </form>

            <div className="mt-8 pt-6 border-t border-surface-container text-center">
              <p className="font-body text-[0.875rem] text-on-surface-variant">
                Don't have access yet?
                <a className="text-primary font-bold hover:underline transition-all ml-1" href="#">Request Access</a>
              </p>
            </div>
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
