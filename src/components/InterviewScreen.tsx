import React, { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Video, VideoOff, Clock, Loader2, RefreshCw, Timer } from 'lucide-react';
import { CandidateInfo, Claim } from '../agent/types';
import { InterviewMemory } from '../agent/memory';
import { useAudio, useCamera, useSilenceDetection, useInterruptionHandling } from '../voice';
import type { AsrError } from '../voice';
import { ChatDisplay } from '../ui/ChatDisplay';
import { MicButton } from '../ui/MicButton';
import { Camera } from '../ui/Camera';
import { AudioPlaybackState } from '../ui/AudioPlaybackState';

interface InterviewScreenProps {
  candidateInfo: CandidateInfo;
  claims: Claim[];
  memory: InterviewMemory | null;
  currentQuestion: string | null;
  isAiSpeaking: boolean;
  isEvaluating: boolean;
  isPreparingAudio: boolean;
  isReminderSpeaking: boolean;
  onAnswerSubmit: (answer: string) => void;
  onSilenceTimeout: (level: 'voice' | 'skip') => void;
  onBargeIn?: () => void;
  onEndSession?: () => void;
  language?: 'zh-CN' | 'en-US';
  // --- New optional props (contract D) ---
  asrError?: AsrError | null;
  onRetryAsr?: () => void;
  elapsedMs?: number;
  claimIndex?: number;
  claimTotal?: number;
  onRequestMoreTime?: () => void;
  // Real candidate identifier (replaces the old hardcoded fake ID)
  candidateId?: string;
  // Optional hook so the parent can play a short "thinking" filler audio during evaluation
  onThinkingFiller?: () => void;
  // Called when the evaluating watchdog surfaces a soft retry affordance
  onEvaluatingRetry?: () => void;
  // True once the interview has ended and the final report is being generated
  isGeneratingReport?: boolean;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function InterviewScreen({ 
  candidateInfo,
  claims,
  memory,
  currentQuestion, 
  isAiSpeaking, 
  isEvaluating,
  isPreparingAudio,
  isReminderSpeaking,
  onAnswerSubmit,
  onSilenceTimeout,
  onBargeIn,
  onEndSession,
  language = 'zh-CN',
  asrError: asrErrorProp,
  onRetryAsr,
  elapsedMs,
  claimIndex,
  claimTotal,
  onRequestMoreTime,
  candidateId,
  onThinkingFiller,
  onEvaluatingRetry,
  isGeneratingReport = false
}: InterviewScreenProps) {
  const { videoRef, hasVideo } = useCamera();
  const {
    isListening,
    isSpeechDetected,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    setTranscript,
    asrError: asrErrorFromHook,
    retryListening
  } = useAudio(language);
  const [showCamera, setShowCamera] = useState(true);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  // 1.14 — candidate has explicitly asked for more time; pauses auto-skip escalation.
  const [extraTimeRequested, setExtraTimeRequested] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isZh = language === 'zh-CN';

  // Prefer an explicitly-provided ASR error/retry (contract D) but fall back to the
  // local hook so the caption still reflects real recognition failures.
  const asrError = asrErrorProp ?? asrErrorFromHook ?? null;
  const handleRetryAsr = useCallback(() => {
    if (onRetryAsr) onRetryAsr();
    else retryListening();
  }, [onRetryAsr, retryListening]);

  const handleSubmit = useCallback(() => {
    const finalAnswer = transcript;
    if (finalAnswer.trim()) {
      onAnswerSubmit(finalAnswer);
      setTranscript('');
      stopListening();
    }
  }, [transcript, onAnswerSubmit, setTranscript, stopListening]);

  const { silenceLevel, setSilenceLevel, cancelPendingSubmit } = useSilenceDetection(
    isListening,
    isSpeechDetected,
    transcript,
    interimTranscript,
    onSilenceTimeout,
    handleSubmit,
    { isAsrHealthy: !asrError, escalationPaused: extraTimeRequested }
  );

  const handleRequestMoreTime = useCallback(() => {
    setExtraTimeRequested(true);
    cancelPendingSubmit?.();
    onRequestMoreTime?.();
  }, [cancelPendingSubmit, onRequestMoreTime]);

  useInterruptionHandling(
    isAiSpeaking,
    isEvaluating,
    isPreparingAudio,
    isSpeechDetected,
    isReminderSpeaking,
    startListening,
    stopListening,
    onBargeIn
  );

  // Reset reminder state when question changes
  useEffect(() => {
    setSilenceLevel(0);
    setExtraTimeRequested(false);
  }, [currentQuestion, setSilenceLevel]);

  // 4.2 / 4.4 — Evaluating watchdog. Track how long we've been in the silent
  // "evaluating" gap so we can escalate the copy and eventually surface a retry
  // affordance instead of leaving an unbounded frozen indicator.
  const [evalElapsedMs, setEvalElapsedMs] = useState(0);
  useEffect(() => {
    if (!isEvaluating) {
      setEvalElapsedMs(0);
      return;
    }
    // 4.2 — optimistic acknowledgement: optionally trigger a filler-audio hook.
    onThinkingFiller?.();
    const start = Date.now();
    setEvalElapsedMs(0);
    const id = setInterval(() => setEvalElapsedMs(Date.now() - start), 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEvaluating]);

  const evalStage = evalElapsedMs >= 15000 ? 2 : evalElapsedMs >= 4000 ? 1 : 0;
  const evalCopy = evalStage >= 1
    ? (isZh ? '还在思考…' : 'Still thinking…')
    : (isZh ? '正在处理你的回答…' : 'Processing your answer…');

  // 4.8 — Report-generation wait. Staged copy so the dedicated waiting screen
  // never looks frozen while the final evaluation is being generated.
  const [reportElapsedMs, setReportElapsedMs] = useState(0);
  useEffect(() => {
    if (!isGeneratingReport) {
      setReportElapsedMs(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setReportElapsedMs(Date.now() - start), 500);
    return () => clearInterval(id);
  }, [isGeneratingReport]);

  const reportStages = isZh
    ? ['正在生成你的评估…', '正在整理你的回答…', '正在打分与撰写反馈…', '马上就好…']
    : ['Generating your evaluation…', 'Organizing your responses…', 'Scoring and writing feedback…', 'Almost done…'];
  const reportStageIndex = Math.min(reportStages.length - 1, Math.floor(reportElapsedMs / 6000));

  // Auto-scroll to bottom of transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, interimTranscript, currentQuestion]);

  // Auto-submit if browser speech recognition stops on its own (e.g. pause timeout)
  const prevIsListening = useRef(isListening);
  useEffect(() => {
    if (prevIsListening.current && !isListening && transcript.trim() && !isEvaluating) {
      handleSubmit();
    }
    prevIsListening.current = isListening;
  }, [isListening, transcript, isEvaluating, handleSubmit]);

  const stages = ['Intro', 'Technical Experience', 'Wrap Up'];
  
  // Determine current high-level stage:
  // 0 = Intro
  // 1 = Technical Experience (Claims)
  // 2 = Wrap Up
  let currentStageIndex = 0;
  let activeClaimName = '';

  if (memory) {
     const claimIndex = memory.getCurrentClaimIndex();
     const isWrapUp = memory.isLastClaim() && memory.getFollowUpCountForCurrentClaim() >= 2; // Approximation of ending

     if (isWrapUp) {
       currentStageIndex = 2;
     } else if (memory.getClaimStates().length > 0) {
       currentStageIndex = 1;
       const currentClaim = memory.getCurrentClaim();
       if (currentClaim) {
         activeClaimName = currentClaim.experienceName || 'General Experience';
       }
     } else {
       currentStageIndex = 0; // Still in Intro
     }
  }

  // 2.6 — Compact progress data (falls back to memory/claims when props absent).
  const derivedClaimTotal = claimTotal ?? claims.length;
  const derivedClaimIndex = claimIndex ?? (memory ? memory.getCurrentClaimIndex() : 0);
  const topicLabel = derivedClaimTotal > 0
    ? `${Math.min(derivedClaimIndex + 1, derivedClaimTotal)}/${derivedClaimTotal}`
    : '';
  const hasElapsed = typeof elapsedMs === 'number';

  // 4.8 — Dedicated report-generation waiting screen (rendered instead of a
  // frozen last frame once the interview has ended).
  if (isGeneratingReport) {
    return (
      <div className="bg-background text-white font-body antialiased overflow-hidden relative flex h-screen w-full flex-col items-center justify-center">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full aura-gradient opacity-[0.07] blur-[150px]"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full aura-gradient opacity-[0.07] blur-[150px]"></div>
        </div>
        <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center">
          <div className="size-16 rounded-full glass-panel flex items-center justify-center border border-primary/30 shadow-[0_0_25px_rgba(198,242,78,0.2)]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
          <AnimatePresence mode="wait">
            <motion.h2
              key={reportStageIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-2xl font-bold font-display tracking-tight aura-gradient-text"
            >
              {reportStages[reportStageIndex]}
            </motion.h2>
          </AnimatePresence>
          <p className="text-sm text-white/50 max-w-sm font-light leading-relaxed">
            {isZh
              ? '请稍候，这通常只需要几秒钟。请不要关闭此页面。'
              : 'This usually takes just a few seconds. Please keep this page open.'}
          </p>
          <div className="flex items-center gap-1.5 mt-2">
            {reportStages.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-500 ${i <= reportStageIndex ? 'w-8 aura-gradient' : 'w-4 bg-white/10'}`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background text-white font-body antialiased overflow-hidden relative flex h-screen w-full flex-col">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full aura-gradient opacity-[0.07] blur-[150px]"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full aura-gradient opacity-[0.07] blur-[150px]"></div>
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 pb-8 shrink-0 z-10 relative">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold font-display tracking-tight aura-gradient-text">AURA</h2>
        </div>

        {/* Compact mobile progress indicator (2.6) */}
        {(hasElapsed || topicLabel) && (
          <div className="flex md:hidden items-center gap-3 mx-auto px-3 py-1.5 rounded-full glass-panel border border-primary/20">
            {hasElapsed && (
              <span className="flex items-center gap-1.5 text-[11px] font-bold tabular-nums text-white/90">
                <Clock size={12} className="text-primary" />
                {formatElapsed(elapsedMs as number)}
              </span>
            )}
            {hasElapsed && topicLabel && <span className="w-px h-3 bg-white/15" />}
            {topicLabel && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/70">
                <span className="text-[9px] uppercase tracking-[0.1em] text-white/40">{isZh ? '主题' : 'Topic'}</span>
                {topicLabel}
              </span>
            )}
          </div>
        )}

        {/* Progress Tracker */}
        <div className="flex-1 max-w-2xl mx-auto px-12 hidden md:block">
          <div className="relative flex items-center justify-between">
            {/* Progress Line Background */}
            <div className="absolute top-1/2 left-0 w-full h-[1px] bg-white/10 -translate-y-1/2"></div>
            {/* Active Progress Line */}
            <div className="absolute top-1/2 left-0 h-[1px] aura-gradient -translate-y-1/2 transition-all duration-500" style={{ width: `${(currentStageIndex / (stages.length - 1)) * 100}%` }}></div>
            
            {stages.map((stage, idx) => {
              const isCompleted = currentStageIndex > idx;
              const isCurrent = currentStageIndex === idx;
              
              return (
                <div key={idx} className="relative flex flex-col items-center gap-2 group cursor-default">
                  {isCompleted ? (
                    <div className="size-4 rounded-full aura-gradient flex items-center justify-center ring-4 ring-background relative z-10 transition-colors duration-300 shadow-[0_0_10px_rgba(198,242,78,0.4)]">
                    </div>
                  ) : isCurrent ? (
                    <div className="size-4 rounded-full bg-transparent border-2 border-primary flex items-center justify-center ring-4 ring-background relative z-10 transition-colors duration-300 shadow-[0_0_15px_rgba(198,242,78,0.6)]">
                      <div className="size-1.5 rounded-full bg-primary animate-pulse"></div>
                    </div>
                  ) : (
                     <div className="size-4 rounded-full bg-white/10 flex items-center justify-center ring-4 ring-background relative z-10 transition-colors duration-300">
                     </div>
                  )}
                  <div className="absolute top-6 flex flex-col items-center">
                    <span className={`text-[10px] font-bold uppercase tracking-[0.1em] whitespace-nowrap ${isCompleted || isCurrent ? 'text-white' : 'text-white/40'}`}>
                      {stage}
                    </span>
                    {idx === 1 && isCurrent && activeClaimName && (
                      <span className="text-[9px] text-primary/80 mt-0.5 max-w-[120px] truncate" title={activeClaimName}>
                        {activeClaimName}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Elapsed timer — visible on desktop where the compact mobile pill is hidden (2.6) */}
          {hasElapsed && (
            <span className="hidden md:flex items-center gap-1.5 text-xs font-bold tabular-nums text-white/80 px-3 py-1.5 rounded-full glass-panel border border-primary/20">
              <Clock size={12} className="text-primary" />
              {formatElapsed(elapsedMs as number)}
            </span>
          )}
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-white">{candidateInfo.name}</p>
            {candidateId && (
              <p className="text-xs text-white/50">{isZh ? '候选人编号' : 'Candidate ID'}: {candidateId}</p>
            )}
          </div>
          <div className="size-10 rounded-full glass-panel flex items-center justify-center border border-primary/30 overflow-hidden text-primary font-display font-bold shadow-[0_0_15px_rgba(198,242,78,0.15)]">
            {candidateInfo.name.charAt(0)}
          </div>
          <button 
            onClick={() => setShowCamera(!showCamera)}
            className={`p-2 rounded-lg ml-2 transition-colors ${showCamera ? 'bg-white/10 hover:bg-white/20 text-white/90' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}`}
          >
            {showCamera ? <Video size={18} /> : <VideoOff size={18} />}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center relative px-6 overflow-hidden">
        
        {/* Status Indicator */}
        <div className={`mb-8 flex items-center gap-3 px-5 py-2.5 rounded-full transition-all duration-500 glass-panel border-primary/20 shadow-[0_0_20px_rgba(198,242,78,0.1)] ${
          isAiSpeaking ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-[pulse_1s_ease-in-out_infinite]"></span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#e8e6e1] animate-[pulse_1s_ease-in-out_0.2s_infinite]"></span>
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-[pulse_1s_ease-in-out_0.4s_infinite]"></span>
          </div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/90">Aura is Speaking</span>
        </div>

        <AudioPlaybackState
          isEvaluating={isEvaluating}
          isAiSpeaking={isAiSpeaking}
          isPreparingAudio={isPreparingAudio}
          isListening={isListening}
          currentQuestion={currentQuestion}
          silenceLevel={silenceLevel}
          isSpeechDetected={isSpeechDetected}
          transcript={transcript}
          interimTranscript={interimTranscript}
          asrError={asrError}
          onRetryAsr={handleRetryAsr}
        />

        {/* 4.2 / 4.4 — Thinking-gap filler + evaluating watchdog. Gives the
            candidate an immediate acknowledgement, escalates the copy, and
            surfaces a soft retry after ~15s so the indicator is never frozen. */}
        <AnimatePresence>
          {isEvaluating && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mt-4 flex flex-col items-center gap-3 z-20"
            >
              <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel border border-primary/20 text-sm text-white/90">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>{evalCopy}</span>
              </div>
              {evalStage >= 2 && (
                onEvaluatingRetry ? (
                  <button
                    onClick={onEvaluatingRetry}
                    className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-primary hover:text-white transition-colors"
                  >
                    <RefreshCw size={12} />
                    {isZh ? '重试' : 'Retry'}
                  </button>
                ) : (
                  <p className="text-xs text-white/50 max-w-xs text-center">
                    {isZh
                      ? '这次评估花的时间比平常长，请再稍等片刻。'
                      : 'This is taking longer than usual — please hang on a moment.'}
                  </p>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-8 w-full max-w-xl z-20">
          <ChatDisplay 
            transcript={transcript}
            interimTranscript={interimTranscript}
            isListening={isListening}
            scrollRef={scrollRef}
          />
        </div>

        {/* Candidate Floating Video Feed */}
        <Camera showCamera={showCamera} hasVideo={hasVideo} videoRef={videoRef} />
      </main>

      {/* Footer Controls */}
      <footer className="px-8 py-8 flex items-center justify-center gap-6 shrink-0 relative z-20">
        <MicButton
          isListening={isListening}
          isEvaluating={isEvaluating}
          isAiSpeaking={isAiSpeaking}
          startListening={startListening}
          stopListening={stopListening}
        />

        {/* 1.14 — Pause auto-skip: let the candidate ask for more time. */}
        {isListening && !isEvaluating && !isAiSpeaking && (
          extraTimeRequested ? (
            <span className="px-6 h-12 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center gap-2 font-bold text-[11px] tracking-widest uppercase backdrop-blur-md">
              <Timer size={14} />
              {isZh ? '已暂停自动跳过' : 'Auto-skip paused'}
            </span>
          ) : (
            <button
              onClick={handleRequestMoreTime}
              className="px-6 h-12 rounded-full bg-white/5 text-white/80 border border-white/10 flex items-center justify-center gap-2 font-bold text-[11px] tracking-widest uppercase hover:bg-white/10 hover:text-white transition-all backdrop-blur-md"
            >
              <Timer size={14} />
              {isZh ? '需要更多时间?' : 'Need more time?'}
            </button>
          )
        )}

        {onEndSession && (
          <button 
            onClick={() => setShowEndConfirm(true)}
            className="px-8 h-12 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center font-bold text-[11px] tracking-widest uppercase hover:bg-red-500 hover:text-white transition-all shadow-sm backdrop-blur-md"
          >
            End Session
          </button>
        )}
      </footer>

      {/* End Session Confirmation Modal */}
      <AnimatePresence>
        {showEndConfirm && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xl px-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="glass-panel rounded-3xl p-10 max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent"></div>
              
              <h3 className="text-2xl font-bold mb-4 text-white font-display tracking-tight">End Session?</h3>
              <p className="text-white/60 mb-8 font-light leading-relaxed">
                Are you sure you want to conclude this interview? Your progress has been securely recorded.
              </p>
              <div className="flex gap-4 justify-end">
                <button 
                  onClick={() => setShowEndConfirm(false)}
                  className="px-6 py-2.5 rounded-xl font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setShowEndConfirm(false);
                    onEndSession?.();
                  }}
                  className="px-6 py-2.5 rounded-xl font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white transition-colors shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                >
                  Confirm End
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
