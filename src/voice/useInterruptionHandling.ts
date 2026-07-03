import { useEffect, useRef } from 'react';

// Barge-in tuning. Applies to ALL AI speech (questions, feedback, reminders),
// not just the reminder, so a candidate can cut in whenever the AI is talking.
const BARGE_IN_MIN_MS = 1000;      // Ignore the first ~1s of AI playback (avoids self-trigger on onset)
const BARGE_IN_DEBOUNCE_MS = 300;  // Candidate must speak for ~300ms to confirm a real barge-in

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

  // Auto-start/stop mic based on AI speaking state.
  useEffect(() => {
    if (!prevIsAiSpeaking.current && isAiSpeaking) {
      // AI started speaking → stop the mic to avoid capturing our own audio.
      stopListening();
      aiSpeakingStartTime.current = Date.now();

      // Re-enable the mic after a minimum playback window so we can detect a
      // barge-in during ANY AI speech. This is a lightweight *detection* pass:
      // whatever it transcribes (including echo of the AI's own voice) is
      // discarded on confirmed barge-in, because onBargeIn → stopAudio →
      // startListening resets the transcript. Full ASR that we keep only runs
      // after a confirmed interruption.
      if (onBargeIn) {
        micReEnableTimerRef.current = setTimeout(() => {
          startListening();
        }, BARGE_IN_MIN_MS);
      }
    } else if (prevIsAiSpeaking.current && !isAiSpeaking && !isEvaluating && !isPreparingAudio) {
      // AI stopped speaking → clear pending timers and start listening.
      if (micReEnableTimerRef.current) {
        clearTimeout(micReEnableTimerRef.current);
        micReEnableTimerRef.current = null;
      }
      startListening();
    }
    prevIsAiSpeaking.current = isAiSpeaking;
  }, [isAiSpeaking, isEvaluating, isPreparingAudio, isReminderSpeaking, startListening, stopListening, onBargeIn]);

  // Barge-in detection: speech detected during ANY AI TTS (after the min window).
  useEffect(() => {
    if (isAiSpeaking && isSpeechDetected && onBargeIn) {
      const elapsed = Date.now() - aiSpeakingStartTime.current;
      if (elapsed >= BARGE_IN_MIN_MS) {
        // Debounce: confirm it's real speech, not a blip / echo transient.
        bargeInTimerRef.current = setTimeout(() => {
          onBargeIn();
        }, BARGE_IN_DEBOUNCE_MS);
      }
    } else {
      // Speech stopped or conditions no longer met — cancel pending barge-in.
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
  }, [isAiSpeaking, isSpeechDetected, onBargeIn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (micReEnableTimerRef.current) clearTimeout(micReEnableTimerRef.current);
      if (bargeInTimerRef.current) clearTimeout(bargeInTimerRef.current);
    };
  }, []);
}
