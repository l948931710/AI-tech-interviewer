import { useEffect, useRef } from 'react';

// Barge-in tuning. Applies to ALL AI speech (questions, feedback, reminders),
// not just the reminder, so a candidate can cut in whenever the AI is talking.
// The debounce must be long enough that speaker echo of the AI's own voice
// (when browser echo-cancellation fails) doesn't confirm a phantom barge-in —
// 300ms proved trivially passable by continuous echo; ~900ms of sustained
// speech is a deliberate interruption while still feeling responsive.
const BARGE_IN_MIN_MS = 1500;      // Ignore the first ~1.5s of AI playback (avoids self-trigger on onset)
const BARGE_IN_DEBOUNCE_MS = 900;  // Sustained speech required to confirm a real barge-in

export function useInterruptionHandling(
  isAiSpeaking: boolean,
  isEvaluating: boolean,
  isPreparingAudio: boolean,
  isSpeechDetected: boolean,
  isReminderSpeaking: boolean,
  startListening: () => void,
  stopListening: () => void,
  onBargeIn?: () => void,
  // Clears transcripts at the AI→candidate turn boundary. Required because
  // startListening() is a no-op while the mic is already running for barge-in
  // detection, so it alone cannot discard echo captured during AI playback.
  resetTranscripts?: () => void
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
      // Discard anything transcribed during AI playback (speaker echo picked up
      // by the barge-in detection mic). The candidate's turn starts clean.
      resetTranscripts?.();
      startListening();
    }
    prevIsAiSpeaking.current = isAiSpeaking;
  }, [isAiSpeaking, isEvaluating, isPreparingAudio, isReminderSpeaking, startListening, stopListening, onBargeIn, resetTranscripts]);

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
