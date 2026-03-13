import React, { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, Video, VideoOff } from 'lucide-react';
import { CandidateInfo } from '../agent/types';
import { useAudio, useCamera, useSilenceDetection, useInterruptionHandling } from '../voice';
import { ChatDisplay } from '../ui/ChatDisplay';
import { MicButton } from '../ui/MicButton';
import { Camera } from '../ui/Camera';
import { AudioPlaybackState } from '../ui/AudioPlaybackState';

interface InterviewScreenProps {
  candidateInfo: CandidateInfo;
  currentQuestion: string | null;
  isAiSpeaking: boolean;
  isEvaluating: boolean;
  isPreparingAudio: boolean;
  onAnswerSubmit: (answer: string) => void;
  onSilenceTimeout: (level: 'voice' | 'skip') => void;
}

export function InterviewScreen({ 
  candidateInfo, 
  currentQuestion, 
  isAiSpeaking, 
  isEvaluating,
  isPreparingAudio,
  onAnswerSubmit,
  onSilenceTimeout
}: InterviewScreenProps) {
  const { videoRef, hasVideo } = useCamera();
  const { isListening, isSpeechDetected, transcript, interimTranscript, startListening, stopListening, setTranscript } = useAudio();
  const [showCamera, setShowCamera] = useState(true);
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

  return (
    <div className="h-screen max-h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">
            {candidateInfo.name.charAt(0)}
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">{candidateInfo.name}</h2>
            <p className="text-xs text-gray-500">Technical Interview in progress</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowCamera(!showCamera)}
            className={`p-2 rounded-lg ${showCamera ? 'bg-gray-100 text-gray-700' : 'bg-red-50 text-red-600'}`}
          >
            {showCamera ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Interview Area */}
        <main className="flex-1 flex flex-col relative">
          
          {/* AI Interviewer Visualization */}
          <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
            
            <Camera showCamera={showCamera} hasVideo={hasVideo} videoRef={videoRef} />

            <div className="relative">
              {/* Pulsing rings when speaking */}
              {isAiSpeaking && (
                <>
                  <motion.div 
                    animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 bg-indigo-400 rounded-full blur-xl"
                  />
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0.2, 0.8] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
                    className="absolute inset-0 bg-indigo-500 rounded-full blur-lg"
                  />
                </>
              )}
              
              <div className="w-32 h-32 bg-gray-900 rounded-full flex items-center justify-center relative z-10 shadow-2xl border-4 border-white">
                <Bot size={48} className="text-white" />
              </div>
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
          </div>

          {/* Controls & Input */}
          <div className="bg-white border-t border-gray-200 p-6 shrink-0">
            <div className="max-w-3xl mx-auto">
              
              <ChatDisplay 
                transcript={transcript}
                interimTranscript={interimTranscript}
                isListening={isListening}
                scrollRef={scrollRef}
              />

              <MicButton 
                isListening={isListening}
                isEvaluating={isEvaluating}
                isAiSpeaking={isAiSpeaking}
                startListening={startListening}
                stopListening={stopListening}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
