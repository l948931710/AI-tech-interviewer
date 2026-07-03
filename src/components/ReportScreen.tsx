import React, { useState } from 'react';
import { InterviewReport, CandidateInfo, StructuredInterviewTurn, TurnEvaluation } from '../agent';
import { CheckCircle, AlertTriangle, Target, Award, ChevronRight, Send, Loader2, Download, ArrowDownRight } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { motion } from 'motion/react';
import { useAudio, generateTTS } from '../voice';
import { supabase } from '../lib/supabase';

interface ReportScreenProps {
  report: InterviewReport;
  candidateInfo: CandidateInfo;
  history: StructuredInterviewTurn[];
}

// Shared recommendation palette — mirrors the HR Dashboard's getRecommendationColor
// so a STRONG_HIRE badge reads identically in the table and in this report.
// Contract: (rec: string) => tailwind classes "bg-*-500/10 text-*-400 border-*-500/20".
const getRecommendationColor = (rec: string) => {
  switch (rec) {
    case 'STRONG_HIRE': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'HIRE': return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'LEAN_HIRE': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    case 'LEAN_NO_HIRE': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    case 'NO_HIRE': return 'bg-red-500/10 text-red-400 border-red-500/20';
    default: return 'bg-white/5 text-white/70 border-white/10';
  }
};

// Solid accent strip color for the decision banner, keyed to the same recommendation.
const getRecommendationAccent = (rec: string) => {
  switch (rec) {
    case 'STRONG_HIRE': return 'bg-emerald-500';
    case 'HIRE': return 'bg-green-500';
    case 'LEAN_HIRE': return 'bg-yellow-500';
    case 'LEAN_NO_HIRE': return 'bg-orange-500';
    case 'NO_HIRE': return 'bg-red-500';
    default: return 'bg-white/20';
  }
};

// Per-turn answerStatus → humanized label + colored pill classes.
const STATUS_META: Record<string, { label: string; className: string }> = {
  answered: { label: 'Answered', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  partial: { label: 'Partial', className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  clarification_request: { label: 'Clarification Requested', className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  non_answer: { label: 'Non-Answer', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

const getStatusMeta = (status?: string) =>
  STATUS_META[status ?? ''] ?? {
    label: status ? status.replace(/_/g, ' ') : 'Unknown',
    className: 'bg-white/5 text-white/60 border-white/10',
  };

function StatusPill({ status }: { status?: string }) {
  const meta = getStatusMeta(status);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap ${meta.className}`}>
      {meta.label}
    </span>
  );
}

export default function ReportScreen({ report, candidateInfo, history }: ReportScreenProps) {
  const [emailTo, setEmailTo] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR'>('IDLE');

  // Replay State
  const { playTTS, fallbackTTS, stopAudio } = useAudio();
  const [isPlayingReplay, setIsPlayingReplay] = useState(false);
  const [currentReplayIndex, setCurrentReplayIndex] = useState<number | null>(null);
  const [replaySpeaker, setReplaySpeaker] = useState<'AI' | 'CANDIDATE' | null>(null);
  const isPlayingRef = React.useRef(false);

  // Manual highlight for deep-links from claim evaluations into the transcript
  // (reuses the same highlight styling as the replay's currentReplayIndex).
  const [highlightedTurn, setHighlightedTurn] = useState<number | null>(null);

  // Stop Replay on unmount
  React.useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  const findHistoryIndex = (te: TurnEvaluation) => {
    let idx = history.findIndex(h => h.question === te.question && h.answer === te.answer);
    if (idx === -1) idx = history.findIndex(h => h.question === te.question);
    return idx;
  };

  const jumpToTurn = (index: number) => {
    if (index < 0) return;
    setHighlightedTurn(index);
    const el = document.getElementById(`transcript-turn-${index}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setHighlightedTurn(prev => (prev === index ? null : prev)), 2500);
  };

  const toggleReplay = async () => {
    if (isPlayingReplay) {
      setIsPlayingReplay(false);
      isPlayingRef.current = false;
      setCurrentReplayIndex(null);
      setReplaySpeaker(null);
      stopAudio();
      return;
    }

    setIsPlayingReplay(true);
    isPlayingRef.current = true;

    for (let i = 0; i < history.length; i++) {
      if (!isPlayingRef.current) break;
      setCurrentReplayIndex(i);

      // Play AI Turn
      setReplaySpeaker('AI');
      try {
        const audioBase64 = await generateTTS(history[i].question);
        if (!isPlayingRef.current) break;
        if (audioBase64) {
          await playTTS(audioBase64);
        } else {
          await fallbackTTS(history[i].question); // Fallback if generation fails
        }
      } catch (e) {
        if (isPlayingRef.current) await fallbackTTS(history[i].question);
      }

      if (!isPlayingRef.current) break;

      // Play Candidate Turn (using Browser Voice to distinguish speaker)
      setReplaySpeaker('CANDIDATE');
      if (history[i].answer) {
         await fallbackTTS(history[i].answer);
      }
    }

    if (isPlayingRef.current) {
      setIsPlayingReplay(false);
      isPlayingRef.current = false;
      setCurrentReplayIndex(null);
      setReplaySpeaker(null);
    }
  };

  const generateReportText = () => {
    let text = `AI Interview Report for ${candidateInfo.name}\n\n`;
    text += `Overall Score: ${report.overallScore}/100\n`;
    text += `Recommendation: ${report.overallRecommendation}\n\n`;
    text += `Summary:\n${report.summary}\n\n`;

    text += `Strongest Areas:\n`;
    (report.strongestAreas ?? []).forEach(a => text += `- ${a}\n`);

    if ((report.riskFlags ?? []).length > 0) {
      text += `\nRisk Flags:\n`;
      (report.riskFlags ?? []).forEach(r => text += `- ${r}\n`);
    }

    text += `\nClaim Evaluations:\n`;
    (report.claimEvaluations ?? []).forEach(c => {
      text += `\n[${c.verificationStatus?.toUpperCase() ?? 'UNKNOWN'}] ${c.claimText}\n`;
      text += `Strengths: ${(c.strengths ?? []).join(', ')}\n`;
      text += `Weaknesses: ${(c.weaknesses ?? []).join(', ')}\n`;
    });

    return text;
  };

  const handleDownloadRecord = () => {
    let fullText = generateReportText();
    fullText += `\n\n=================================\n`;
    fullText += `          FULL TRANSCRIPT          \n`;
    fullText += `=================================\n\n`;

    history.forEach((turn, i) => {
      fullText += `[Turn ${i + 1}]\n`;
      if (turn.claimText) fullText += `Target Claim: ${turn.claimText}\n`;
      fullText += `AI: ${turn.question}\n`;
      fullText += `Candidate: ${turn.answer}\n`;
      if (turn.answerStatus) fullText += `Status: ${getStatusMeta(turn.answerStatus).label}\n`;
      fullText += `\n`;
    });

    const blob = new Blob([fullText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Interview_Record_${candidateInfo.name.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailTo) return;

    setIsSending(true);
    setSendStatus('IDLE');

    try {
      const messageBody = generateReportText();

      // L1 fix: send through the authenticated backend proxy so EmailJS
      // credentials stay server-side (out of the client bundle).
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      const res = await fetch('/api/send-report-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          toEmail: emailTo,
          candidateName: candidateInfo.name,
          message: messageBody,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      setSendStatus('SUCCESS');
      setEmailTo('');
      setTimeout(() => setSendStatus('IDLE'), 3000);
    } catch (err: any) {
      console.error("Failed to send email", err);
      setSendStatus('ERROR');
      alert(`Failed to send email: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSending(false);
    }
  };

  if (!report) {
    return (
      <div className="min-h-screen bg-background text-white flex flex-col items-center justify-center p-6 text-center font-body">
        <div className="max-w-md w-full bg-white/5 rounded-2xl shadow-sm border border-white/10 p-8">
          <AlertTriangle className="text-amber-400 mx-auto mb-4" size={40} />
          <h2 className="text-2xl font-bold text-white mb-2">报告数据不可用</h2>
          <p className="text-white/60">Report data is unavailable.</p>
        </div>
      </div>
    );
  }

  // Calculate average scores across all evaluated claims
  const avgScores = (report.claimEvaluations ?? []).reduce((acc, evaluation) => {
    if (evaluation.scores) {
      acc.relevance += evaluation.scores.relevance;
      acc.specificity += evaluation.scores.specificity;
      acc.technicalDepth += evaluation.scores.technicalDepth;
      acc.ownership += evaluation.scores.ownership;
      acc.evidence += evaluation.scores.evidence;
      acc.clarity += evaluation.scores.clarity;
      acc.count++;
    }
    return acc;
  }, { relevance: 0, specificity: 0, technicalDepth: 0, ownership: 0, evidence: 0, clarity: 0, count: 0 });

  const chartData = avgScores.count > 0 ? [
    { subject: 'Relevance', A: avgScores.relevance / avgScores.count, fullMark: 10 },
    { subject: 'Specificity', A: avgScores.specificity / avgScores.count, fullMark: 10 },
    { subject: 'Tech Depth', A: avgScores.technicalDepth / avgScores.count, fullMark: 10 },
    { subject: 'Ownership', A: avgScores.ownership / avgScores.count, fullMark: 10 },
    { subject: 'Evidence', A: avgScores.evidence / avgScores.count, fullMark: 10 },
    { subject: 'Clarity', A: avgScores.clarity / avgScores.count, fullMark: 10 },
  ] : [];

  return (
    <div className="min-h-screen bg-background text-white font-body py-12 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-5xl mx-auto space-y-8"
      >
        {/* DECISION HEADER — conclusion-first: name, score, recommendation, one-line summary */}
        <div className="relative overflow-hidden bg-white/5 rounded-2xl shadow-lg border border-white/10 p-8">
          <div className={`absolute inset-x-0 top-0 h-1.5 ${getRecommendationAccent(report.overallRecommendation)}`} />
          <div className="flex flex-col md:flex-row justify-between items-start gap-6">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">Hiring Decision</div>
              <h1 className="text-3xl font-display font-bold text-white mb-1">{candidateInfo.name}</h1>
              <p className="text-white/50 text-sm mb-4">Interview Evaluation Report</p>
              <div className={`inline-flex items-center px-4 py-2 rounded-lg border text-sm font-bold uppercase tracking-wider ${getRecommendationColor(report.overallRecommendation)}`}>
                {report.overallRecommendation.replace(/_/g, ' ')}
              </div>
              <p className="text-white/80 leading-relaxed mt-4 max-w-2xl">{report.summary}</p>
            </div>

            <div className="shrink-0 flex flex-col items-center justify-center bg-black/20 border border-white/10 rounded-xl px-8 py-5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-1">Overall</span>
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-display font-bold text-white">{report.overallScore}</span>
                <span className="text-white/40 font-medium">/100</span>
              </div>
            </div>
          </div>
        </div>

        {/* Secondary Action Bar: forward report + save record (demoted below the decision) */}
        <div className="bg-white/5 rounded-2xl shadow-sm border border-white/10 p-4 flex flex-col sm:flex-row items-center gap-6">
          <div className="flex-1 flex flex-col sm:flex-row items-center gap-4 w-full">
            <div className="flex items-center gap-2 text-white/60 shrink-0">
              <Send size={20} className="text-primary" />
              <span className="font-medium text-sm">Forward Report</span>
            </div>

            <form onSubmit={handleSendEmail} className="flex flex-1 w-full gap-2">
              <input
                type="email"
                placeholder="Enter HR email..."
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="flex-1 bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary min-w-[200px]"
                required
              />
              <button
                type="submit"
                disabled={isSending || !emailTo}
                className="bg-primary text-background px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 disabled:opacity-50 flex items-center gap-2 transition-opacity shrink-0"
              >
                {isSending ? <Loader2 size={16} className="animate-spin" /> : 'Send'}
              </button>
            </form>
            {sendStatus === 'SUCCESS' && <span className="text-emerald-400 text-sm font-medium flex items-center gap-1 shrink-0"><CheckCircle size={16} /> Sent!</span>}
          </div>

          <div className="hidden sm:block w-px h-8 bg-white/10"></div>

          <button
            onClick={handleDownloadRecord}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 hover:border-white/20 px-5 py-2 rounded-lg text-sm font-bold transition-all shrink-0"
          >
            <Download size={18} />
            Save Record
          </button>
        </div>

        {/* Replay Controls bar (audio replay, demoted below decision + actions) */}
        <div className="bg-black/30 rounded-2xl shadow-lg border border-white/10 p-4 flex justify-between items-center px-6">
           <div className="flex items-center gap-4">
             <button
                onClick={toggleReplay}
                className={`flex items-center justify-center w-12 h-12 rounded-full transition-all ${isPlayingReplay ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20 shadow-lg' : 'bg-primary hover:opacity-90 shadow-primary/20 shadow-lg'}`}
             >
                {isPlayingReplay ? (
                   <div className="w-4 h-4 rounded-sm bg-white" />
                ) : (
                   <div className="w-0 h-0 border-t-8 border-t-transparent border-l-[14px] border-l-background border-b-8 border-b-transparent ml-1" />
                )}
             </button>
             <div>
               <h3 className="font-bold text-white tracking-wide">Synthesized Replay</h3>
               <p className="text-sm text-white/50">
                 {isPlayingReplay && replaySpeaker === 'AI' ? "🔴 AI Interviewer Speaking..." :
                  isPlayingReplay && replaySpeaker === 'CANDIDATE' ? "🟢 Candidate Speaking..." :
                  "Listen to the interview transcript."}
               </p>
             </div>
           </div>

           {isPlayingReplay && (
             <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                <div className="flex gap-1">
                  <span className={`w-1 h-3 rounded-full animate-bounce ${replaySpeaker === 'AI' ? 'bg-primary' : 'bg-emerald-400'}`} style={{animationDelay: '0ms'}}></span>
                  <span className={`w-1 h-3 rounded-full animate-bounce ${replaySpeaker === 'AI' ? 'bg-primary' : 'bg-emerald-400'}`} style={{animationDelay: '150ms'}}></span>
                  <span className={`w-1 h-3 rounded-full animate-bounce ${replaySpeaker === 'AI' ? 'bg-primary' : 'bg-emerald-400'}`} style={{animationDelay: '300ms'}}></span>
                </div>
                <span className="text-xs font-medium text-white/60 ml-1 uppercase tracking-wider">LIVE</span>
             </div>
           )}
        </div>

        <div className="grid md:grid-cols-3 gap-8">

          {/* Left Column: Radar Chart & Claim Evaluations */}
          <div className="md:col-span-2 space-y-8">

            <div className="bg-white/5 rounded-2xl shadow-sm border border-white/10 p-8">
              <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
                <Award className="text-emerald-400" />
                Performance Dimensions
              </h2>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={chartData}>
                    <PolarGrid stroke="rgba(255,255,255,0.12)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 500 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fill: 'rgba(255,255,255,0.4)' }} />
                    <Radar name="Candidate" dataKey="A" stroke="#00f0ff" fill="#00f0ff" fillOpacity={0.35} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Claim Evaluations */}
            <div className="space-y-8">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Target className="text-primary" />
                Claim Evaluations
              </h2>
              {(report.claimEvaluations ?? []).map((claimEval, idx) => (
                <div key={idx} className="bg-white/5 rounded-2xl shadow-sm border border-white/10 overflow-hidden">
                  <div className="p-6 border-b border-white/10 bg-white/[0.02] flex justify-between items-start gap-4">
                    <div>
                      <div className="text-xs font-bold text-primary uppercase tracking-wider mb-1">
                        {claimEval.experienceName || 'General Experience'}
                      </div>
                      <h3 className="text-lg font-medium text-white">{claimEval.claimText}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap border ${
                        claimEval.verificationStatus === 'strong' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        claimEval.verificationStatus === 'partial' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                        claimEval.verificationStatus === 'weak' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                        claimEval.verificationStatus === 'unverified' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        'bg-white/5 text-white/60 border-white/10'
                      }`}>
                        {claimEval.verificationStatus.toUpperCase()}
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap border ${
                        claimEval.riskLevel === 'low' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        claimEval.riskLevel === 'medium' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                        claimEval.riskLevel === 'high' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        'bg-white/5 text-white/60 border-white/10'
                      }`}>
                        RISK: {claimEval.riskLevel?.toUpperCase() || 'UNKNOWN'}
                      </div>
                    </div>
                  </div>

                  <div className="p-6 space-y-6">
                    {/* Scores */}
                    {claimEval.scores && (
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {Object.entries(claimEval.scores).map(([key, val]) => (
                          <div key={key} className="bg-white/5 rounded p-2 text-center border border-white/10">
                            <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                            <div className="font-semibold text-white">{val}/10</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Strengths & Weaknesses */}
                    <div className="grid sm:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
                          <CheckCircle size={16} className="text-emerald-400" /> Strengths
                        </h4>
                        <ul className="space-y-1.5">
                          {(claimEval.strengths ?? []).map((s, i) => (
                            <li key={i} className="text-sm text-white/70 flex items-start gap-1.5">
                              <span className="text-emerald-400 mt-0.5">•</span> <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-6">
                        <div>
                          <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
                            <AlertTriangle size={16} className="text-amber-400" /> Weaknesses
                          </h4>
                          <ul className="space-y-1.5">
                            {(claimEval.weaknesses ?? []).map((w, i) => (
                              <li key={i} className="text-sm text-white/70 flex items-start gap-1.5">
                                <span className="text-amber-400 mt-0.5">•</span> <span>{w}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {claimEval.missingPoints && claimEval.missingPoints.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
                              <Target size={16} className="text-red-400" /> Missing Points
                            </h4>
                            <ul className="space-y-1.5">
                              {claimEval.missingPoints.map((m, i) => (
                                <li key={i} className="text-sm text-white/70 flex items-start gap-1.5">
                                  <span className="text-red-400 mt-0.5">•</span> <span>{m}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Supporting Evidence — deep-links into the single-source transcript below
                        (de-duplicated: the full Q&A text lives only in the transcript). */}
                    <div className="mt-6 pt-6 border-t border-white/10">
                      <h4 className="text-sm font-medium text-white/70 mb-3 flex items-center gap-1.5">
                        <Target size={16} className="text-primary" />
                        Supporting Transcript ({(claimEval.turnEvaluations ?? []).length} turns)
                      </h4>
                      <div className="space-y-2">
                        {(claimEval.turnEvaluations ?? []).map((turn, tIdx) => {
                          const historyIdx = findHistoryIndex(turn);
                          return (
                            <div key={tIdx} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2">
                              <StatusPill status={turn.answerStatus} />
                              <span className="text-sm text-white/70 flex-1 min-w-[12rem] truncate">{turn.question}</span>
                              {historyIdx >= 0 && (
                                <button
                                  type="button"
                                  onClick={() => jumpToTurn(historyIdx)}
                                  className="text-xs font-medium text-primary hover:underline flex items-center gap-1 shrink-0"
                                >
                                  <ArrowDownRight size={14} /> Jump to turn {historyIdx + 1}
                                </button>
                              )}
                              {turn.notes && (
                                <p className="w-full text-xs text-white/50"><span className="font-semibold text-white/60">Note:</span> {turn.notes}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* Right Column: Strengths, Risks, Next Steps */}
          <div className="space-y-8">

            <div className="bg-white/5 rounded-2xl shadow-sm border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <CheckCircle className="text-emerald-400" size={20} />
                Strongest Areas
              </h3>
              <ul className="space-y-3">
                {(report.strongestAreas ?? []).map((area, i) => (
                  <li key={i} className="flex items-start gap-2 text-white/70 text-sm">
                    <ChevronRight size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                    <span>{area}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white/5 rounded-2xl shadow-sm border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <AlertTriangle className="text-amber-400" size={20} />
                Risk Flags
              </h3>
              {(report.riskFlags ?? []).length > 0 ? (
                <ul className="space-y-3">
                  {(report.riskFlags ?? []).map((risk, i) => (
                    <li key={i} className="flex items-start gap-2 text-white/70 text-sm">
                      <ChevronRight size={16} className="text-amber-400 mt-0.5 shrink-0" />
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/40 italic">No significant risk flags identified.</p>
              )}
            </div>

            <div className="bg-white/5 rounded-2xl shadow-sm border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Suggested Next Round Focus</h3>
              <ul className="space-y-3">
                {(report.suggestedNextRoundFocus ?? []).map((focus, i) => (
                  <li key={i} className="flex items-start gap-2 text-white/70 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    <span>{focus}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>

        </div>

        {/* Transcript Section — single source of truth for the interview Q&A */}
        <div className="bg-white/5 rounded-2xl shadow-sm border border-white/10 overflow-hidden mt-8">
          <div className="px-6 py-5 border-b border-white/10 bg-white/[0.02]">
            <h3 className="text-lg font-medium text-white flex items-center gap-2">
              <Target className="text-primary" size={20} />
              Full Interview Transcript
            </h3>
          </div>
          <div className="divide-y divide-white/5">
            {history.map((turn, index) => {
              const isActive = currentReplayIndex === index || highlightedTurn === index;
              return (
              <div
                key={index}
                id={`transcript-turn-${index}`}
                className={`p-6 transition-colors duration-500 scroll-mt-6 ${isActive ? 'bg-primary/5' : 'hover:bg-white/[0.03]'}`}
              >
                <div className="flex gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 transition-colors ${currentReplayIndex === index && replaySpeaker === 'AI' ? 'bg-primary text-background shadow-lg shadow-primary/30' : 'bg-primary/10 text-primary'}`}>
                    <span className="font-bold text-sm">AI</span>
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium transition-colors ${currentReplayIndex === index && replaySpeaker === 'AI' ? 'text-white' : 'text-white/90'}`}>{turn.question}</p>
                  </div>
                </div>

                <div className="flex gap-4 mt-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 transition-colors ${currentReplayIndex === index && replaySpeaker === 'CANDIDATE' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'bg-emerald-500/10 text-emerald-400'}`}>
                    <span className="font-bold text-sm">
                      {candidateInfo.name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className={`whitespace-pre-wrap transition-colors ${currentReplayIndex === index && replaySpeaker === 'CANDIDATE' ? 'text-emerald-200 font-medium' : 'text-white/70'}`}>{turn.answer}</p>

                    {/* Per-turn evaluation status pill */}
                    {turn.answerStatus && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-white/40">
                        <span className="uppercase tracking-wider">Status</span>
                        <StatusPill status={turn.answerStatus} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>



      </motion.div>
    </div>
  );
}
