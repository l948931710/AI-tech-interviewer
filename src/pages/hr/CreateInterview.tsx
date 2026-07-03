import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SetupScreen from '../../components/SetupScreen';
import { analyzeResume } from '../../agent';
import { db } from '../../lib/db';
import { ArrowLeft, CheckCircle, Copy, Mail, Loader2, Clock } from 'lucide-react';

type SendStatus = 'IDLE' | 'SENDING' | 'SUCCESS' | 'ERROR';

export default function CreateInterview() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [candidateEmail, setCandidateEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sendStatus, setSendStatus] = useState<SendStatus>('IDLE');
  const [sendError, setSendError] = useState<string | null>(null);
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
      setCandidateEmail(analysis.candidateInfo?.email ?? null);
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

  const handleSendToCandidate = async () => {
    if (!createdSessionId || sendStatus === 'SENDING') return;

    setSendStatus('SENDING');
    setSendError(null);
    try {
      const { getAuthHeaders } = await import('../../agent/core');
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/agent/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sessionId: createdSessionId, inviteLink: getInviteLink() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      setSendStatus('SUCCESS');
      setTimeout(() => setSendStatus('IDLE'), 4000);
    } catch (err: any) {
      console.error('Failed to send invite email', err);
      setSendError(err.message || 'Unknown error');
      setSendStatus('ERROR');
    }
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
          
          <div className="glass-panel p-4 rounded-2xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4 mb-4 max-w-lg w-full relative overflow-hidden">
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

          {/* Expiry notice — mirrors the dashboard "Link Copied" toast wording */}
          <div className="flex items-center gap-2 text-white/50 text-[12px] mb-6 max-w-lg">
            <Clock size={14} className="shrink-0 text-primary/70" />
            <span>
              This secure link expires in 24 hours — regenerate a fresh one from the dashboard if needed. Generating a new link invalidates any previous one.
            </span>
          </div>

          {/* Send-to-candidate action; copy-to-clipboard above remains the fallback */}
          <div className="max-w-lg w-full mb-10 flex flex-col items-center gap-3">
            <button
              onClick={handleSendToCandidate}
              disabled={!candidateEmail || sendStatus === 'SENDING' || sendStatus === 'SUCCESS'}
              className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-6 py-3 rounded-xl font-bold text-[13px] tracking-wider uppercase transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {sendStatus === 'SENDING' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : sendStatus === 'SUCCESS' ? (
                <CheckCircle size={16} className="text-primary" />
              ) : (
                <Mail size={16} />
              )}
              {sendStatus === 'SENDING'
                ? 'Sending…'
                : sendStatus === 'SUCCESS'
                ? 'Invite Emailed'
                : 'Send to Candidate'}
            </button>
            {candidateEmail ? (
              <p className="text-white/40 text-[11px]">
                {sendStatus === 'SUCCESS'
                  ? `Sent to ${candidateEmail}.`
                  : `Emails the invite link to ${candidateEmail}.`}
              </p>
            ) : (
              <p className="text-white/40 text-[11px]">
                No candidate email was found on the resume — use Copy to share the link manually.
              </p>
            )}
            {sendStatus === 'ERROR' && (
              <p className="text-red-400 text-[11px]">Could not send: {sendError}. Use Copy to share the link instead.</p>
            )}
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
