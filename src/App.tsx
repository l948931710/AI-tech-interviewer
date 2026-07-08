import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import Login from './pages/hr/Login';
import Dashboard from './pages/hr/Dashboard';
import CreateInterview from './pages/hr/CreateInterview';
import ReportView from './pages/hr/ReportView';
import UpdatePassword from './pages/hr/UpdatePassword';
import InterviewPortal from './pages/candidate/InterviewPortal';
import ThankYouScreen from './pages/candidate/ThankYouScreen';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, ArrowUpRight, ShieldCheck, KeyRound } from 'lucide-react';

import ProtectedRoute from './components/ProtectedRoute';

// The product's signature motif — an abstract voice waveform, the same visual
// language used throughout the interview UI. Lime = the live signal.
function HeroWaveform() {
  const reduce = useReducedMotion();
  const bars = [0.35, 0.6, 0.9, 0.5, 1, 0.7, 0.45, 0.85, 1, 0.55, 0.75, 0.4, 0.9, 0.6, 0.3, 0.7, 0.5];
  return (
    <div className="flex h-28 items-center justify-center gap-1.5" aria-hidden="true">
      {bars.map((peak, i) => (
        <motion.span
          key={i}
          className="w-1.5 rounded-full bg-primary/80"
          style={{ height: `${peak * 100}%`, transformOrigin: 'center' }}
          initial={{ scaleY: 0.25 }}
          animate={reduce ? { scaleY: 0.6 } : { scaleY: [0.25, 1, 0.4, 0.85, 0.25] }}
          transition={reduce ? { duration: 0 } : { duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: (i % 5) * 0.12 }}
        />
      ))}
    </div>
  );
}

export default function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  // Intercept Supabase invite/recovery tokens landing on wrong page and redirect to /update-password
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const isAuthRedirect = hash.includes('type=invite') || hash.includes('type=recovery') || hash.includes('type=signup');
    const isAlreadyOnUpdatePage = window.location.pathname.includes('update-password');
    if (isAuthRedirect && !isAlreadyOnUpdatePage) {
      // Redirect immediately, preserving the hash so UpdatePassword can process the tokens
      window.location.replace(`/update-password${hash}`);
    }
  }, []);

  useEffect(() => {
    const checkKey = async () => {
      if ((window as any).aistudio && (window as any).aistudio.hasSelectedApiKey) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if ((window as any).aistudio && (window as any).aistudio.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  if (hasApiKey === false) {
    return (
      <div className="min-h-[100dvh] bg-background text-white font-body flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] rounded-full bg-primary/10 blur-[160px]" />
        </div>
        <div className="glass-panel rounded-3xl p-10 md:p-12 max-w-md w-full relative overflow-hidden edge-accent z-10">
          <div className="w-14 h-14 rounded-2xl bg-primary/12 border border-primary/25 flex items-center justify-center mx-auto mb-6">
            <KeyRound className="text-primary" size={26} />
          </div>
          <h2 className="text-2xl font-display font-bold tracking-tight mb-3">API key required</h2>
          <p className="text-white/60 text-sm leading-relaxed mb-8">
            To run the Pro models without strict quota limits, connect your Google Cloud API key.{' '}
            <a
              href="https://ai.google.dev/gemini-api/docs/billing"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline underline-offset-4"
            >
              Learn about billing and keys
            </a>
            .
          </p>
          <button
            onClick={handleSelectKey}
            className="w-full h-13 py-4 bg-primary text-background rounded-xl font-bold text-[13px] uppercase tracking-widest hover:bg-[#b6e63a] active:translate-y-px transition-all flex items-center justify-center gap-2"
          >
            Select API key <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  const LandingPage = () => (
    <div className="min-h-[100dvh] bg-background text-white font-body relative overflow-hidden flex flex-col">
      {/* Ambient accent glow (single hue, low opacity, drifting) */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute -top-[15%] -left-[10%] w-[55%] h-[55%] rounded-full bg-primary/10 blur-[160px] animate-[auroraDrift_18s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-20%] right-[-5%] w-[45%] h-[45%] rounded-full bg-primary/[0.06] blur-[150px]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-10 h-[68px] max-w-[1400px] mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_14px_rgba(198,242,78,0.7)]" />
          <span className="text-xl font-display font-bold tracking-tight">AURA</span>
        </div>
        <Link
          to="/hr"
          className="text-[13px] font-semibold text-white/70 hover:text-white transition-colors flex items-center gap-1.5"
        >
          HR sign in <ArrowUpRight size={15} />
        </Link>
      </nav>

      {/* Hero — asymmetric split */}
      <main className="relative z-10 flex-1 flex items-center max-w-[1400px] mx-auto w-full px-6 md:px-10 py-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center w-full">
          {/* Left: message */}
          <motion.div
            className="lg:col-span-7"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white/50 mb-7">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Autonomous technical interviews
            </div>
            <h1 className="font-display font-bold tracking-tight leading-[1.03] text-balance text-[2.5rem] md:text-5xl xl:text-[3.5rem] mb-6">
              Every résumé claim,
              <br />
              put to the <span className="text-primary">test.</span>
            </h1>
            <p className="text-lg text-white/60 leading-relaxed max-w-[40ch] mb-10">
              AURA runs adaptive voice interviews that probe each claim, score the evidence,
              and hand your team a decision-ready report.
            </p>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Link
                to="/hr"
                className="group inline-flex items-center gap-2.5 h-13 px-7 py-4 bg-primary text-background rounded-xl font-bold text-[13px] uppercase tracking-widest hover:bg-[#b6e63a] active:translate-y-px transition-all"
              >
                Enter HR portal
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <p className="text-[13px] text-white/45 leading-snug max-w-[24ch]">
                Candidate? Open the secure link your recruiter sent you.
              </p>
            </div>
          </motion.div>

          {/* Right: signal panel (product motif, not a fake screenshot) */}
          <motion.div
            className="lg:col-span-5"
            initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="glass-panel rounded-3xl p-7 md:p-8 relative overflow-hidden edge-accent">
              <div className="flex items-center justify-between mb-5">
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">Live signal</span>
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Recording
                </span>
              </div>

              <div className="rounded-2xl bg-black/30 border border-white/8 py-4 mb-6">
                <HeroWaveform />
              </div>

              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45 mb-3">
                Scored on
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {['Relevance', 'Technical depth', 'Ownership', 'Evidence', 'Specificity', 'Clarity'].map((d) => (
                  <div
                    key={d}
                    className="flex items-center gap-2 text-[13px] text-white/75 rounded-lg bg-white/[0.03] border border-white/8 px-3 py-2"
                  >
                    <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
                    {d}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-[1400px] mx-auto w-full px-6 md:px-10 py-6 flex items-center justify-between border-t border-white/5">
        <span className="text-[11px] uppercase tracking-[0.15em] text-white/30">
          © {new Date().getFullYear()} AURA
        </span>
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-white/30">
          <ShieldCheck size={13} /> Secure by design
        </span>
      </footer>
    </div>
  );

  return (
    <Router>
      <Routes>
        {/* Core Entry */}
        <Route path="/" element={<LandingPage />} />

        {/* HR Portal */}
        <Route path="/hr" element={<Login />} />
        <Route path="/hr/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/hr/new" element={<ProtectedRoute><CreateInterview /></ProtectedRoute>} />
        <Route path="/hr/report/:id" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/update-password" element={<UpdatePassword />} />

        {/* Candidate Portal */}
        <Route path="/invite/:id" element={<InterviewPortal />} />
        <Route path="/thank-you" element={<ThankYouScreen />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
