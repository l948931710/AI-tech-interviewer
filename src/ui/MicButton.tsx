import React from 'react';
import { Mic, MicOff } from 'lucide-react';

interface MicButtonProps {
  isListening: boolean;
  isEvaluating: boolean;
  isAiSpeaking: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export function MicButton({ isListening, isEvaluating, isAiSpeaking, startListening, stopListening }: MicButtonProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="flex items-center gap-4">
        <button
          onClick={isListening ? stopListening : startListening}
          disabled={isEvaluating || isAiSpeaking}
          className={`p-6 rounded-full flex-shrink-0 transition-all ${
            isListening 
              ? 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 scale-110' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          } ${(isEvaluating || isAiSpeaking) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isListening ? <MicOff size={32} /> : <Mic size={32} />}
        </button>
      </div>
      
      <p className="text-sm text-gray-500">
        {isListening ? "Listening... We will automatically submit when you stop speaking." : "Click the microphone to start speaking."}
      </p>
    </div>
  );
}
