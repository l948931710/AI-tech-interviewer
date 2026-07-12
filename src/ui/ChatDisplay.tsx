import React from 'react';

interface ChatDisplayProps {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** The AI's current question — rendered as a persistent AI-role bubble. */
  currentQuestion?: string | null;
  /** True while the AI is evaluating the just-submitted answer. */
  isEvaluating?: boolean;
  /**
   * The answer the candidate just submitted. While `isEvaluating` is true the
   * live transcript is cleared by the parent, so pass the submitted text here
   * to keep it visible as a "sent" bubble instead of blanking the conversation.
   */
  submittedAnswer?: string | null;
  language?: 'zh-CN' | 'en-US';
}

export function ChatDisplay({
  transcript,
  interimTranscript,
  isListening,
  scrollRef,
  currentQuestion,
  isEvaluating,
  submittedAnswer,
  language = 'zh-CN'
}: ChatDisplayProps) {
  const isZh = language === 'zh-CN';
  const hasLiveAnswer = !!(transcript || interimTranscript);
  // While evaluating, the live transcript is blanked by the parent — fall back
  // to the preserved submitted answer so we never visually drop the candidate's
  // last turn mid-evaluation.
  const sentAnswer = isEvaluating && !hasLiveAnswer ? submittedAnswer : null;
  const showCandidate = hasLiveAnswer || !!sentAnswer;

  // Nothing to show at all.
  if (!currentQuestion && !showCandidate) return null;

  return (
    <div
      className="w-full bg-black/30 backdrop-blur-sm rounded-2xl p-6 border border-white/8 max-h-56 overflow-y-auto flex flex-col gap-4"
      ref={scrollRef}
    >
      {/* AI role bubble — the question, always visible while set */}
      {currentQuestion && (
        <div className="flex items-start gap-4">
          <div className="size-8 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0 border border-primary/30">
            <span className="material-symbols-outlined text-sm">smart_toy</span>
          </div>
          <div className="flex-1 mt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">AI</span>
            <p className="text-sm font-medium leading-relaxed text-white/90">
              {currentQuestion}
            </p>
          </div>
        </div>
      )}

      {/* Candidate role bubble — live transcript, or preserved "sent" answer */}
      {showCandidate && (
        <div className="flex items-start gap-4 flex-row-reverse text-right">
          <div className="size-8 rounded-full bg-white/10 text-white/70 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-sm">person</span>
          </div>
          <div className="flex-1 mt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center justify-end gap-1">
              {isZh ? '你' : 'You'}
              {sentAnswer && (
                <span className="material-symbols-outlined text-[12px] leading-none text-primary">check</span>
              )}
            </span>
            <div className="text-sm font-medium leading-relaxed">
              {sentAnswer ? (
                <span className="text-white/50">{sentAnswer}</span>
              ) : (
                <>
                  <span className="text-white/90">{transcript}</span>
                  <span className="text-white/40 italic ml-1">{interimTranscript}</span>
                  {isListening && transcript.trim() && !interimTranscript.trim() && (
                    <span className="inline-block ml-2 w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
