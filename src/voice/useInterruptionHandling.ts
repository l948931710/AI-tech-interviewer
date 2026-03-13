import { useEffect, useRef } from 'react';

export function useInterruptionHandling(
  isAiSpeaking: boolean,
  isEvaluating: boolean,
  isPreparingAudio: boolean,
  startListening: () => void,
  stopListening: () => void
) {
  const prevIsAiSpeaking = useRef(isAiSpeaking);
  
  // Auto-start/stop mic based on AI speaking state
  useEffect(() => {
    if (prevIsAiSpeaking.current && !isAiSpeaking && !isEvaluating && !isPreparingAudio) {
      startListening();
    } else if (!prevIsAiSpeaking.current && isAiSpeaking) {
      stopListening();
    }
    prevIsAiSpeaking.current = isAiSpeaking;
  }, [isAiSpeaking, isEvaluating, isPreparingAudio, startListening, stopListening]);
}
