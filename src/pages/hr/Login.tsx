import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Eye, EyeOff, ShieldCheck, ArrowRight } from 'lucide-react';
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
        {/* Login Container */}
        <div className="w-full max-w-[420px] animate-[fadeIn_0.6s_ease-out]">
          
          {/* Branding Header */}
          <div className="text-center mb-10">
            <h1 className="font-display text-4xl font-bold tracking-tight text-white mb-2">Command Center</h1>
            <p className="font-body text-[11px] font-bold uppercase tracking-[0.2em] text-primary/70">Human Resources Gateway</p>
          </div>

          {/* Login Card */}
          <div className="glass-panel rounded-2xl p-8 md:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] aura-gradient opacity-50"></div>
            
            <form className="space-y-6" onSubmit={handleLogin}>
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
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-[14px] focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none text-white placeholder:text-white/20 font-light"
                    placeholder="e.g. hr@aura.dev"
                    type="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                    Passcode
                  </label>
                  <a className="text-[10px] font-bold uppercase tracking-wider text-primary/80 hover:text-primary transition-colors" href="#">
                    Recover Access
                  </a>
                </div>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-5 h-5 group-focus-within:text-primary transition-colors" />
                  <input
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3.5 pl-12 pr-12 text-[14px] focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none text-white placeholder:text-white/20 font-light"
                    placeholder="••••••••"
                    type={showPassword ? 'text' : 'password'}
                  />
                  <div 
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 cursor-pointer hover:text-primary transition-colors flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </div>
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
                  <span>{isSubmitting ? 'Authenticating...' : 'Initialize Session'}</span>
                  {!isSubmitting && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </form>
          </div>

          {/* Security Notice */}
          <div className="mt-8 flex items-center justify-center gap-2 text-white/30">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-[0.2em]">AES-256 Encrypted Connection</span>
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
