import { useEffect, useRef } from 'react';

const REMINDER_BARGE_IN_MIN_MS = 1000;   // Allow barge-in after 1s of reminder playback
const REMINDER_BARGE_IN_DEBOUNCE_MS = 300; // Candidate must speak for 300ms to confirm

export function useInterruptionHandling(
  isAiSpeaking: boolean,
  isEvaluating: boolean,
  isPreparingAudio: boolean,
  isSpeechDetected: boolean,
  isReminderSpeaking: boolean,
  startListening: () => void,
  stopListening: () => void,
  onBargeIn?: () => void
) {
  const prevIsAiSpeaking = useRef(isAiSpeaking);
  const aiSpeakingStartTime = useRef<number>(0);
  const bargeInTimerRef = useRef<NodeJS.Timeout | null>(null);
  const micReEnableTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-start/stop mic based on AI speaking state
  useEffect(() => {
    if (!prevIsAiSpeaking.current && isAiSpeaking) {
      // AI started speaking → stop mic
      stopListening();
      aiSpeakingStartTime.current = Date.now();

      // For reminder TTS only: re-enable mic after minimum playback for barge-in detection
      if (isReminderSpeaking && onBargeIn) {
        micReEnableTimerRef.current = setTimeout(() => {
          startListening();
        }, REMINDER_BARGE_IN_MIN_MS);
      }
    } else if (prevIsAiSpeaking.current && !isAiSpeaking && !isEvaluating && !isPreparingAudio) {
      // AI stopped speaking → clear pending timers and start listening
      if (micReEnableTimerRef.current) {
        clearTimeout(micReEnableTimerRef.current);
        micReEnableTimerRef.current = null;
      }
      startListening();
    }
    prevIsAiSpeaking.current = isAiSpeaking;
  }, [isAiSpeaking, isEvaluating, isPreparingAudio, isReminderSpeaking, startListening, stopListening, onBargeIn]);

  // Barge-in detection: speech detected during REMINDER TTS only
  useEffect(() => {
    if (isAiSpeaking && isReminderSpeaking && isSpeechDetected && onBargeIn) {
      const elapsed = Date.now() - aiSpeakingStartTime.current;
      if (elapsed >= REMINDER_BARGE_IN_MIN_MS) {
        // Debounce: confirm it's real speech, not a blip
        bargeInTimerRef.current = setTimeout(() => {
          onBargeIn();
        }, REMINDER_BARGE_IN_DEBOUNCE_MS);
      }
    } else {
      // Speech stopped or conditions no longer met — cancel pending barge-in
      if (bargeInTimerRef.current) {
        clearTimeout(bargeInTimerRef.current);
        bargeInTimerRef.current = null;
      }
    }

    return () => {
      if (bargeInTimerRef.current) {
        clearTimeout(bargeInTimerRef.current);
        bargeInTimerRef.current = null;
      }
    };
  }, [isAiSpeaking, isReminderSpeaking, isSpeechDetected, onBargeIn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (micReEnableTimerRef.current) clearTimeout(micReEnableTimerRef.current);
      if (bargeInTimerRef.current) clearTimeout(bargeInTimerRef.current);
    };
  }, []);
}
