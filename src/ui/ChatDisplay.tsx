import React from 'react';

interface ChatDisplayProps {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatDisplay({ transcript, interimTranscript, isListening, scrollRef }: ChatDisplayProps) {
  if (!transcript && !interimTranscript) return null;
  
  return (
    <div 
      className="w-full bg-white/40 dark:bg-black/20 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-white/5 max-h-48 overflow-y-auto" 
      ref={scrollRef}
    >
      <div className="flex items-start gap-4">
        <div className="size-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-sm">person</span>
        </div>
        <div className="flex-1 text-sm font-medium leading-relaxed mt-1">
          <span className="text-slate-900 dark:text-slate-100">{transcript}</span>
          <span className="text-slate-500 italic ml-1">{interimTranscript}</span>
          {isListening && transcript.trim() && !interimTranscript.trim() && (
            <span className="inline-block ml-2 w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
