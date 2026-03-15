import React, { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, Video, VideoOff, CheckCircle2, Circle } from 'lucide-react';
import { CandidateInfo, Claim } from '../agent/types';
import { InterviewMemory } from '../agent/memory';
import { useAudio, useCamera, useSilenceDetection, useInterruptionHandling } from '../voice';
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
  onAnswerSubmit: (answer: string) => void;
  onSilenceTimeout: (level: 'voice' | 'skip') => void;
  onEndSession?: () => void;
}

export function InterviewScreen({ 
  candidateInfo,
  claims,
  memory,
  currentQuestion, 
  isAiSpeaking, 
  isEvaluating,
  isPreparingAudio,
  onAnswerSubmit,
  onSilenceTimeout,
  onEndSession
}: InterviewScreenProps) {
  const { videoRef, hasVideo } = useCamera();
  const { isListening, isSpeechDetected, transcript, interimTranscript, startListening, stopListening, setTranscript } = useAudio();
  const [showCamera, setShowCamera] = useState(true);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(() => {
    const finalAnswer = transcript;
    if (finalAnswer.trim()) {
      onAnswerSubmit(finalAnswer);
      setTranscript('');
      stopListening();
    }
  }, [transcript, onAnswerSubmit, setTranscript, stopListening]);

  const { silenceLevel, setSilenceLevel } = useSilenceDetection(
    isListening,
    isSpeechDetected,
    transcript,
    interimTranscript,
    onSilenceTimeout,
    handleSubmit
  );

  useInterruptionHandling(
    isAiSpeaking,
    isEvaluating,
    isPreparingAudio,
    startListening,
    stopListening
  );

  // Reset reminder state when question changes
  useEffect(() => {
    setSilenceLevel(0);
  }, [currentQuestion, setSilenceLevel]);

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

  return (
    <div className="bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-slate-100 antialiased overflow-hidden relative flex h-screen w-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 pb-12 shrink-0 z-10 relative">
        <div className="flex items-center gap-3">
          <div className="size-8 text-primary">
            <svg fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M24 0.757355L47.2426 24L24 47.2426L0.757355 24L24 0.757355ZM21 35.7574V12.2426L9.24264 24L21 35.7574Z" fill="currentColor"></path>
            </svg>
          </div>
          <h2 className="text-xl font-bold tracking-tight">Fuling USA</h2>
        </div>

        {/* Progress Tracker */}
        <div className="flex-1 max-w-2xl mx-auto px-12 hidden md:block">
          <div className="relative flex items-center justify-between">
            {/* Progress Line Background */}
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-200 dark:bg-slate-800 -translate-y-1/2"></div>
            {/* Active Progress Line */}
            <div className="absolute top-1/2 left-0 h-0.5 bg-primary -translate-y-1/2 transition-all duration-500" style={{ width: `${(currentStageIndex / (stages.length - 1)) * 100}%` }}></div>
            
            {stages.map((stage, idx) => {
              const isCompleted = currentStageIndex > idx;
              const isCurrent = currentStageIndex === idx;
              
              return (
                <div key={idx} className="relative flex flex-col items-center gap-2 group cursor-default">
                  {isCompleted ? (
                    <div className="size-6 rounded-full bg-primary flex items-center justify-center text-white ring-4 ring-background-light dark:ring-background-dark relative z-10 transition-colors duration-300">
                      <span className="material-symbols-outlined text-sm font-bold">check</span>
                    </div>
                  ) : isCurrent ? (
                    <div className="size-6 rounded-full bg-primary flex items-center justify-center text-background-dark font-bold text-xs ring-4 ring-background-light dark:ring-background-dark shadow-[0_0_15px_rgba(17,212,17,0.4)] relative z-10 transition-colors duration-300">
                      {idx + 1}
                    </div>
                  ) : (
                     <div className="size-6 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-500 font-bold text-xs ring-4 ring-background-light dark:ring-background-dark relative z-10 transition-colors duration-300">
                        {idx + 1}
                     </div>
                  )}
                  <div className="absolute top-8 flex flex-col items-center">
                    <span className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${isCompleted || isCurrent ? 'text-primary' : 'text-slate-400 dark:text-slate-600'}`}>
                      {stage}
                    </span>
                    {idx === 1 && isCurrent && activeClaimName && (
                      <span className="text-[9px] text-slate-500 mt-0.5 max-w-[120px] truncate" title={activeClaimName}>
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
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold">{candidateInfo.name}</p>
            <p className="text-xs text-slate-500">Candidate ID: #8821</p>
          </div>
          <div className="size-10 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary/30 overflow-hidden text-primary font-bold shadow-[0_0_10px_rgba(17,212,17,0.2)]">
            {candidateInfo.name.charAt(0)}
          </div>
          <button 
            onClick={() => setShowCamera(!showCamera)}
            className={`p-2 rounded-lg ml-2 transition-colors ${showCamera ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' : 'bg-red-500/10 text-red-500'}`}
          >
            {showCamera ? <Video size={18} /> : <VideoOff size={18} />}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center relative px-6 overflow-hidden">
        
        {/* Status Indicator */}
        <div className={`mb-12 flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 ${
          isAiSpeaking ? 'bg-primary/10 border border-primary/20 opacity-100' : 'opacity-0 translate-y-2'
        }`}>
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
          </span>
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">AI is Speaking</span>
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
        />

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
      <footer className="px-8 py-6 flex items-center justify-center gap-6 shrink-0 relative z-20">
        <MicButton 
          isListening={isListening}
          isEvaluating={isEvaluating}
          isAiSpeaking={isAiSpeaking}
          startListening={startListening}
          stopListening={stopListening}
        />
        
        {onEndSession && (
          <button 
            onClick={() => setShowEndConfirm(true)}
            className="px-8 h-12 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center font-bold text-sm tracking-wide hover:bg-red-500 hover:text-white transition-all shadow-sm"
          >
            END SESSION
          </button>
        )}
      </footer>

      {/* Background subtle decor */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]"></div>
      </div>

      {/* End Session Confirmation Modal */}
      <AnimatePresence>
        {showEndConfirm && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md px-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white dark:bg-slate-900 rounded-2xl p-8 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800"
            >
              <h3 className="text-xl font-bold mb-4 text-slate-900 dark:text-white font-display">End Session?</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-8 font-display">
                Are you sure you want to end this interview session? Your progress will be saved and evaluated up to this point.
              </p>
              <div className="flex gap-4 justify-end">
                <button 
                  onClick={() => setShowEndConfirm(false)}
                  className="px-6 py-2 rounded-lg font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-display"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setShowEndConfirm(false);
                    onEndSession?.();
                  }}
                  className="px-6 py-2 rounded-lg font-medium bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 font-display"
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
