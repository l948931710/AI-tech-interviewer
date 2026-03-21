import { useState, useEffect, useRef } from 'react';

const GRACE_PERIOD_MS = 5000; // Grace period after mic turns on before silence escalation

export function useSilenceDetection(
  isListening: boolean,
  isSpeechDetected: boolean,
  transcript: string,
  interimTranscript: string,
  onSilenceTimeout: (level: 'voice' | 'skip') => void,
  onSubmit: () => void
) {
  const [silenceLevel, setSilenceLevel] = useState<0 | 1 | 2>(0);
  
  const onSilenceTimeoutRef = useRef(onSilenceTimeout);
  const onSubmitRef = useRef(onSubmit);
  const listeningStartTimeRef = useRef<number>(0);

  useEffect(() => {
    onSilenceTimeoutRef.current = onSilenceTimeout;
  }, [onSilenceTimeout]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  // Track when listening starts (for grace period calculation)
  useEffect(() => {
    if (isListening) {
      listeningStartTimeRef.current = Date.now();
    }
  }, [isListening]);

  // Auto-submit after silence (if they have spoken something)
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    const fullText = (transcript + ' ' + interimTranscript).trim();
    if (isListening && fullText) {
      const endsWithPunctuation = /[.!?。！？]$/.test(fullText);
      
      let timeoutDuration = 2500;
      if (endsWithPunctuation) {
        timeoutDuration = isSpeechDetected ? 1500 : 1200;
      } else {
        timeoutDuration = isSpeechDetected ? 3000 : 2200;
      }
      
      timeoutId = setTimeout(() => {
        onSubmitRef.current();
      }, timeoutDuration);
    }
    return () => clearTimeout(timeoutId);
  }, [isListening, isSpeechDetected, transcript, interimTranscript]);

  // Escalating silence timeout (if they haven't spoken anything yet)
  // Includes a grace period after TTS ends to give the candidate time to think
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (isListening && !transcript.trim() && !interimTranscript.trim()) {
      const elapsed = Date.now() - listeningStartTimeRef.current;
      const remainingGrace = Math.max(0, GRACE_PERIOD_MS - elapsed);

      if (silenceLevel === 0) {
        // Level 0 → 1: grace period + 8s (total ~13s from TTS end)
        timeoutId = setTimeout(() => {
          setSilenceLevel(1);
        }, remainingGrace + 8000);
      } else if (silenceLevel === 1) {
        // Level 1 → 2: 6s after visual indicator appears, speak reminder
        timeoutId = setTimeout(() => {
          setSilenceLevel(2);
          onSilenceTimeoutRef.current('voice');
        }, 6000);
      } else if (silenceLevel === 2) {
        // Level 2 → skip: 12s after voice reminder
        timeoutId = setTimeout(() => {
          onSilenceTimeoutRef.current('skip');
        }, 12000);
      }
    }
    return () => clearTimeout(timeoutId);
  }, [isListening, transcript, interimTranscript, silenceLevel]);

  return { silenceLevel, setSilenceLevel };
}
