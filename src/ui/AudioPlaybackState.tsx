import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';

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

  const waveHeights = [
    'h-4', 'h-8', 'h-16', 'h-24', 'h-40', 'h-56', 'h-64', 'h-48', 
    'h-64', 'h-56', 'h-40', 'h-24', 'h-16', 'h-8', 'h-4'
  ];
  
  const baseOpacities = [
    'bg-primary/20', 'bg-primary/30', 'bg-primary/40', 'bg-primary/60',
    'bg-primary', 'bg-primary shadow-[0_0_20px_rgba(17,212,17,0.4)]', 'bg-primary shadow-[0_0_25px_rgba(17,212,17,0.5)]',
    'bg-primary', 'bg-primary shadow-[0_0_25px_rgba(17,212,17,0.5)]', 'bg-primary shadow-[0_0_20px_rgba(17,212,17,0.4)]',
    'bg-primary', 'bg-primary/60', 'bg-primary/40', 'bg-primary/30', 'bg-primary/20'
  ];

  return (
    <div className="w-full max-w-2xl flex flex-col items-center justify-center relative min-h-[160px]">
       
       <AnimatePresence>
        {isListening && silenceLevel >= 1 && !isSpeechDetected && !transcript.trim() && !interimTranscript.trim() && !isEvaluating && !isPreparingAudio && !isAiSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute -top-12 bg-primary text-white px-4 py-2 rounded-full shadow-lg text-sm flex items-center gap-2 z-50 whitespace-nowrap tracking-wide"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for your response...
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative w-full aspect-[21/9] flex items-center justify-center gap-1.5 overflow-hidden py-4">
        {waveHeights.map((h, i) => {
           let animateConfig: any = { scaleY: 0.1 };
           let transitionConfig: any = { duration: 0.5 };
           
           if (isEvaluating) {
              animateConfig = { scaleY: [0.2, 0.5, 0.2] };
              transitionConfig = { duration: 1.5, repeat: Infinity, delay: i * 0.1 };
           } else if (isPreparingAudio) {
              animateConfig = { scaleY: [0.1, 0.3, 0.1] };
              transitionConfig = { duration: 1, repeat: Infinity, delay: i * 0.05 };
           } else if (isAiSpeaking || isSpeechDetected) {
              const peak = [0.4, 0.6, 0.8, 1.2, 0.9, 1.1, 0.5, 1.0, 1.2, 0.8, 1.1, 0.7, 0.9, 0.5, 0.4][i];
              animateConfig = { scaleY: [0.3, peak, 0.3] };
              transitionConfig = { duration: 0.6, repeat: Infinity, ease: "easeInOut", delay: (i % 3) * 0.15 };
           } else if (isListening) {
              animateConfig = { scaleY: 0.3 };
           }

           return (
             <motion.div 
               key={i}
               initial={{ scaleY: 0.1 }}
               animate={animateConfig}
               transition={transitionConfig}
               className={`${h} w-1.5 ${baseOpacities[i]} rounded-full origin-center`}
             />
           );
        })}
      </div>

      <AnimatePresence mode="wait">
         {isEvaluating && (
           <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute bottom-0 text-sm font-bold uppercase tracking-widest text-primary flex flex-col items-center gap-2"
           >
             <Loader2 className="animate-spin w-5 h-5 mx-auto" />
             AI is evaluating...
           </motion.div>
         )}
         {isPreparingAudio && (
           <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute bottom-0 text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2"
           >
             <Loader2 className="animate-spin w-4 h-4" />
             Preparing response...
           </motion.div>
         )}
      </AnimatePresence>
    </div>
  );
}
