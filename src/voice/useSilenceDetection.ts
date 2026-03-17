import { useState, useEffect, useRef } from 'react';

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

  useEffect(() => {
    onSilenceTimeoutRef.current = onSilenceTimeout;
  }, [onSilenceTimeout]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  // Auto-submit after silence (if they have spoken something)
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    const fullText = (transcript + ' ' + interimTranscript).trim();
    if (isListening && fullText) {
      const endsWithPunctuation = /[.!?。！？]$/.test(fullText);
      
      // Reduced timeouts for snappier feel.
      // If the browser still thinks speech is happening (e.g. background noise), 
      // we wait a bit longer to be safe, but we STILL submit eventually to prevent getting stuck.
      let timeoutDuration = 2500;
      if (endsWithPunctuation) {
        timeoutDuration = isSpeechDetected ? 800 : 400;
      } else {
        timeoutDuration = isSpeechDetected ? 2500 : 1800;
      }
      
      timeoutId = setTimeout(() => {
        onSubmitRef.current();
      }, timeoutDuration);
    }
    return () => clearTimeout(timeoutId);
  }, [isListening, isSpeechDetected, transcript, interimTranscript]);

  // Escalating silence timeout (if they haven't spoken anything yet)
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (isListening && !transcript.trim() && !interimTranscript.trim()) {
      if (silenceLevel === 0) {
        timeoutId = setTimeout(() => {
          setSilenceLevel(1);
        }, 4000);
      } else if (silenceLevel === 1) {
        timeoutId = setTimeout(() => {
          setSilenceLevel(2);
          onSilenceTimeoutRef.current('voice');
        }, 4000);
      } else if (silenceLevel === 2) {
        timeoutId = setTimeout(() => {
          onSilenceTimeoutRef.current('skip');
        }, 10000);
      }
    }
    return () => clearTimeout(timeoutId);
  }, [isListening, transcript, interimTranscript, silenceLevel]);

  return { silenceLevel, setSilenceLevel };
}
