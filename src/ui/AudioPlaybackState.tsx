import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Mic } from 'lucide-react';

interface AudioPlaybackStateProps {
  isEvaluating: boolean;
  isAiSpeaking: boolean;
  isPreparingAudio: boolean;
  isListening: boolean;
  currentQuestion: string | null;
  silenceLevel: number;
  isSpeechDetected: boolean;
  transcript: string;
  interimTranscript: string;
}

export function AudioPlaybackState({
  isEvaluating,
  isAiSpeaking,
  isPreparingAudio,
  isListening,
  currentQuestion,
  silenceLevel,
  isSpeechDetected,
  transcript,
  interimTranscript
}: AudioPlaybackStateProps) {
  return (
    <div className="mt-8 max-w-3xl text-center min-h-[120px] flex flex-col items-center justify-center relative">
      <AnimatePresence>
        {isListening && silenceLevel >= 1 && !isSpeechDetected && !transcript.trim() && !interimTranscript.trim() && !isEvaluating && !isPreparingAudio && !isAiSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white px-4 py-2 rounded-full shadow-lg text-sm flex items-center gap-2 z-50 whitespace-nowrap"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for your response...
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {isEvaluating ? (
          <motion.div
            key="evaluating"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-xl font-medium text-gray-500 flex items-center justify-center gap-2"
          >
            <Loader2 className="animate-spin" size={24} />
            AI is thinking...
          </motion.div>
        ) : currentQuestion ? (
          <motion.div
            key="question"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col items-center gap-4"
          >
            {isAiSpeaking && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
            {isPreparingAudio && (
              <div className="text-sm font-medium text-gray-500 flex items-center justify-center gap-2 mt-2">
                <Loader2 className="animate-spin" size={16} />
                Preparing audio...
              </div>
            )}
            {isListening && !isAiSpeaking && !isPreparingAudio && (
              <div className="text-sm font-medium text-indigo-600 flex items-center justify-center gap-2 mt-2">
                <Mic size={16} className="animate-pulse" />
                Listening...
              </div>
            )}
          </motion.div>
        ) : isListening ? (
          <motion.div
            key="listening"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-2xl font-medium text-gray-900 flex items-center gap-2"
          >
            <Mic size={24} className="text-indigo-600 animate-pulse" />
            Listening...
          </motion.div>
        ) : (
          <motion.div
            key="waiting"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-xl font-medium text-gray-400"
          >
            Waiting...
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
