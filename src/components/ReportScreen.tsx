import React from 'react';
import { InterviewReport, CandidateInfo, NextStep } from '../agent';
import { CheckCircle, AlertTriangle, Target, Award, ChevronRight } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { motion } from 'motion/react';

interface ReportScreenProps {
  report: InterviewReport;
  candidateInfo: CandidateInfo;
  history: { q: string, a: string, evaluation?: NextStep }[];
  onRestart: () => void;
}

export default function ReportScreen({ report, candidateInfo, history, onRestart }: ReportScreenProps) {
  
  // Calculate average scores across all evaluated claims
  const avgScores = report.claimEvaluations.reduce((acc, evaluation) => {
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

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'STRONG_HIRE': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'HIRE': return 'bg-green-100 text-green-800 border-green-200';
      case 'LEAN_HIRE': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'LEAN_NO_HIRE': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'NO_HIRE': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-5xl mx-auto space-y-8"
      >
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Interview Evaluation Report</h1>
            <p className="text-lg text-gray-600">Candidate: <span className="font-semibold text-gray-900">{candidateInfo.name}</span></p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center justify-center bg-indigo-50 border border-indigo-100 rounded-xl px-6 py-3">
              <span className="text-sm font-medium text-indigo-600 uppercase tracking-wider mb-1">Overall Score</span>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-indigo-900">{report.overallScore}</span>
                <span className="text-indigo-400 font-medium">/100</span>
              </div>
            </div>
            <div className={`px-6 py-5 rounded-xl border-2 font-bold text-lg h-full flex items-center ${getRecommendationColor(report.overallRecommendation)}`}>
              {report.overallRecommendation.replace('_', ' ')}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          
          {/* Left Column: Summary & Radar Chart */}
          <div className="md:col-span-2 space-y-8">
            
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Target className="text-indigo-500" />
                Executive Summary
              </h2>
              <p className="text-gray-700 leading-relaxed">{report.summary}</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
                <Award className="text-emerald-500" />
                Performance Dimensions
              </h2>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={chartData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#4b5563', fontSize: 12, fontWeight: 500 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fill: '#9ca3af' }} />
                    <Radar name="Candidate" dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Claim Evaluations */}
            <div className="space-y-8">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <Target className="text-indigo-500" />
                Claim Evaluations
              </h2>
              {report.claimEvaluations.map((claimEval, idx) => (
                <div key={idx} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-start gap-4">
                    <div>
                      <div className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1">
                        {claimEval.experienceName || 'General Experience'}
                      </div>
                      <h3 className="text-lg font-medium text-gray-900">{claimEval.claimText}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
                        claimEval.verificationStatus === 'strong' ? 'bg-emerald-100 text-emerald-800' :
                        claimEval.verificationStatus === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                        claimEval.verificationStatus === 'weak' ? 'bg-orange-100 text-orange-800' :
                        claimEval.verificationStatus === 'unverified' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {claimEval.verificationStatus.toUpperCase()}
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
                        claimEval.riskLevel === 'low' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                        claimEval.riskLevel === 'medium' ? 'bg-yellow-50 text-yellow-600 border border-yellow-200' :
                        claimEval.riskLevel === 'high' ? 'bg-red-50 text-red-600 border border-red-200' :
                        'bg-gray-50 text-gray-600 border border-gray-200'
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
                          <div key={key} className="bg-gray-50 rounded p-2 text-center border border-gray-100">
                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                            <div className="font-semibold text-gray-900">{val}/10</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Strengths & Weaknesses */}
                    <div className="grid sm:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
                          <CheckCircle size={16} className="text-emerald-500" /> Strengths
                        </h4>
                        <ul className="space-y-1.5">
                          {claimEval.strengths.map((s, i) => (
                            <li key={i} className="text-sm text-gray-600 flex items-start gap-1.5">
                              <span className="text-emerald-500 mt-0.5">•</span> <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-6">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
                            <AlertTriangle size={16} className="text-amber-500" /> Weaknesses
                          </h4>
                          <ul className="space-y-1.5">
                            {claimEval.weaknesses.map((w, i) => (
                              <li key={i} className="text-sm text-gray-600 flex items-start gap-1.5">
                                <span className="text-amber-500 mt-0.5">•</span> <span>{w}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {claimEval.missingPoints && claimEval.missingPoints.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
                              <Target size={16} className="text-red-500" /> Missing Points
                            </h4>
                            <ul className="space-y-1.5">
                              {claimEval.missingPoints.map((m, i) => (
                                <li key={i} className="text-sm text-gray-600 flex items-start gap-1.5">
                                  <span className="text-red-500 mt-0.5">•</span> <span>{m}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Supporting Evidence (Turns) */}
                    <div className="mt-6 pt-6 border-t border-gray-100">
                      <details className="group">
                        <summary className="text-sm font-medium text-indigo-600 cursor-pointer select-none flex items-center gap-1">
                          <ChevronRight size={16} className="group-open:rotate-90 transition-transform" />
                          View Supporting Transcript ({claimEval.turnEvaluations.length} turns)
                        </summary>
                        <div className="mt-4 space-y-4 pl-5 border-l-2 border-indigo-100">
                          {claimEval.turnEvaluations.map((turn, tIdx) => (
                            <div key={tIdx} className="space-y-2">
                              <div className="flex gap-2">
                                <span className="text-xs font-bold text-gray-400 mt-0.5">Q:</span>
                                <p className="text-sm font-medium text-gray-900">{turn.question}</p>
                              </div>
                              <div className="flex gap-2">
                                <span className="text-xs font-bold text-gray-400 mt-0.5">A:</span>
                                <p className="text-sm text-gray-600">{turn.answer}</p>
                              </div>
                              <div className="flex gap-2 bg-gray-50 p-2 rounded text-xs text-gray-500">
                                <span className="font-semibold">Note:</span> {turn.notes}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* Right Column: Strengths, Risks, Next Steps */}
          <div className="space-y-8">
            
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <CheckCircle className="text-emerald-500" size={20} />
                Strongest Areas
              </h3>
              <ul className="space-y-3">
                {report.strongestAreas.map((area, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700 text-sm">
                    <ChevronRight size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                    <span>{area}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <AlertTriangle className="text-amber-500" size={20} />
                Risk Flags
              </h3>
              {report.riskFlags.length > 0 ? (
                <ul className="space-y-3">
                  {report.riskFlags.map((risk, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-700 text-sm">
                      <ChevronRight size={16} className="text-amber-500 mt-0.5 shrink-0" />
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500 italic">No significant risk flags identified.</p>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Suggested Next Round Focus</h3>
              <ul className="space-y-3">
                {report.suggestedNextRoundFocus.map((focus, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-2 shrink-0" />
                    <span>{focus}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>

        </div>

        {/* Transcript Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-8">
          <div className="px-6 py-5 border-b border-gray-200 bg-gray-50">
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <Target className="text-indigo-600" size={20} />
              Full Interview Transcript
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {history.map((turn, index) => (
              <div key={index} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-indigo-600 font-bold text-sm">AI</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-900 font-medium">{turn.q}</p>
                  </div>
                </div>
                
                <div className="flex gap-4 mt-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-emerald-700 font-bold text-sm">
                      {candidateInfo.name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-700 whitespace-pre-wrap">{turn.a}</p>
                    
                    {/* Implicit Lightweight Scores (Debug/Context) */}
                    {turn.evaluation && turn.evaluation.lightweightScores && (
                      <details className="mt-3 text-xs text-gray-400 opacity-60 hover:opacity-100 transition-opacity">
                        <summary className="cursor-pointer font-medium select-none">AI Evaluation (Debug)</summary>
                        <div className="mt-2 pl-3 border-l-2 border-gray-200 flex flex-col gap-1.5">
                          <span title="Answer Status">Status: <span className="font-medium text-gray-500">{turn.evaluation.answerStatus}</span></span>
                          <span title="Reason for next step">{turn.evaluation.decision}: {turn.evaluation.decisionRationale}</span>
                          {turn.evaluation.missingPoints && turn.evaluation.missingPoints.length > 0 && (
                            <span title="Missing points">Missing: {turn.evaluation.missingPoints.join(', ')}</span>
                          )}
                          {turn.evaluation.coveredPoints && turn.evaluation.coveredPoints.length > 0 && (
                            <span title="Covered points">Covered: {turn.evaluation.coveredPoints.join(', ')}</span>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-center pt-8">
          <button
            onClick={onRestart}
            className="px-8 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 transition-colors shadow-sm"
          >
            Start New Interview
          </button>
        </div>

      </motion.div>
    </div>
  );
}
