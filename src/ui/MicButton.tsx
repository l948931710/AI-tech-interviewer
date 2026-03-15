import React from 'react';

interface MicButtonProps {
  isListening: boolean;
  isEvaluating: boolean;
  isAiSpeaking: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export function MicButton({ isListening, isEvaluating, isAiSpeaking, startListening, stopListening }: MicButtonProps) {
  return (
    <button
      onClick={isListening ? stopListening : startListening}
      disabled={isEvaluating || isAiSpeaking}
      className={`size-14 rounded-full flex items-center justify-center transition-all ${
        isListening 
          ? 'bg-primary text-white hover:bg-green-600 shadow-[0_0_15px_rgba(17,212,17,0.4)] scale-110' 
          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
      } ${(isEvaluating || isAiSpeaking) ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>
        {isListening ? 'mic' : 'mic_off'}
      </span>
    </button>
  );
}
