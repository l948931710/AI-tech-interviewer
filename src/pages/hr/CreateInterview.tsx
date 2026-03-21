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
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle className="text-emerald-500 w-16 h-16 mb-6" />
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Interview Ready!</h1>
        <p className="text-gray-600 max-w-md mb-8">
          The AI has successfully analyzed the resume and generated a personalized interview plan. 
          Send the securely generated link below to the candidate.
        </p>
        
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4 mb-8 max-w-lg w-full">
          <input 
            type="text" 
            readOnly 
            value={getInviteLink()} 
            className="flex-1 bg-gray-50 text-gray-600 px-3 py-2 rounded-lg text-sm border border-gray-100 outline-none"
          />
          <button 
            onClick={handleCopy}
            className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg font-medium hover:bg-indigo-100 transition"
          >
            {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <button 
          onClick={() => navigate('/hr/dashboard')}
          className="text-gray-500 hover:text-gray-900 font-medium transition flex items-center gap-2"
        >
          <ArrowLeft size={18} />
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-8">
      <div className="max-w-4xl mx-auto px-6 mb-4">
        <button 
          onClick={() => navigate('/hr/dashboard')}
          className="text-gray-500 hover:text-gray-900 font-medium transition flex items-center gap-2"
        >
          <ArrowLeft size={18} />
          Back to Dashboard
        </button>
      </div>
      <SetupScreen onStart={handleStart} isLoading={isAnalyzing} />
    </div>
  );
}
