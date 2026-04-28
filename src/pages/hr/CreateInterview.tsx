import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SetupScreen from '../../components/SetupScreen';
import { analyzeResume } from '../../agent';
import { db } from '../../lib/db';
import { ArrowLeft, CheckCircle, Copy } from 'lucide-react';

export default function CreateInterview() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const handleStart = async (resumeData: string | { inlineData: { data: string, mimeType: string } }, jd: string) => {
    setIsAnalyzing(true);
    try {
      const analysis = await analyzeResume(resumeData, jd);
      
      if (analysis.prioritizedClaims.length === 0) {
        throw new Error("No verifiable claims extracted from the resume.");
      }

      // Instead of starting the interview, we save it to the DB
      const { id: sessionId, inviteToken } = await db.createSession({
        jdText: jd,
        jobRoleContext: analysis.jobRoleContext,
        candidateInfo: analysis.candidateInfo,
        claims: analysis.prioritizedClaims
      });

      setCreatedSessionId(sessionId);
      setCreatedInviteToken(inviteToken);
    } catch (error) {
      console.error("Setup failed:", error);
      alert("Failed to generate interview plan. Please check the console.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getInviteLink = () => {
    return `${window.location.origin}/invite/${createdSessionId}?token=${createdInviteToken}`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getInviteLink());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (createdSessionId) {
    return (
      <div className="min-h-screen bg-background text-white flex flex-col items-center justify-center p-6 text-center relative overflow-hidden font-body">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none"></div>

        <div className="relative z-10 animate-[fadeIn_0.5s_ease-out] flex flex-col items-center">
          <div className="relative mb-8">
            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full"></div>
            <CheckCircle className="text-primary w-20 h-20 relative z-10 drop-shadow-[0_0_15px_rgba(0,240,255,0.5)]" />
          </div>
          
          <h1 className="text-4xl font-display font-bold text-white mb-4 tracking-tight">Interview Initialized</h1>
          <p className="text-white/60 max-w-md mb-10 text-[14px] font-light leading-relaxed">
            The AI has successfully analyzed the resume and generated a personalized interview protocol. 
            Send the secure access link below to the candidate.
          </p>
          
          <div className="glass-panel p-4 rounded-2xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4 mb-10 max-w-lg w-full relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] aura-gradient opacity-30"></div>
            <input 
              type="text" 
              readOnly 
              value={getInviteLink()} 
              className="flex-1 bg-black/40 text-white/80 px-4 py-3 rounded-xl text-[13px] border border-white/5 outline-none font-mono"
            />
            <button 
              onClick={handleCopy}
              className="flex items-center gap-2 aura-gradient text-background px-6 py-3 rounded-xl font-bold text-[13px] tracking-wider uppercase hover:opacity-90 transition-all shadow-[0_0_15px_rgba(0,240,255,0.2)] whitespace-nowrap"
            >
              {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <button 
            onClick={() => navigate('/hr/dashboard')}
            className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors flex items-center gap-2"
          >
            <ArrowLeft size={14} />
            Return to Command Center
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-white pt-8 font-body relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full aura-gradient opacity-[0.03] blur-[150px] pointer-events-none"></div>
      
      <div className="max-w-4xl mx-auto px-6 mb-8 relative z-10 flex items-center justify-between">
        <button 
          onClick={() => navigate('/hr/dashboard')}
          className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 hover:text-white transition-colors flex items-center gap-2 bg-white/5 px-4 py-2 rounded-lg border border-white/10"
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </button>
        <div className="text-2xl font-bold tracking-tight font-display aura-gradient-text">AURA</div>
      </div>
      <div className="relative z-10">
        <SetupScreen onStart={handleStart} isLoading={isAnalyzing} />
      </div>
    </div>
  );
}
