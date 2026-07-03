import { useState, useEffect, useRef, useCallback } from 'react';

const GRACE_PERIOD_MS = 5000; // Grace period after mic turns on before silence escalation

export type SilenceDetectionOptions = {
  // When false, ASR is known to be unhealthy (errored / unsupported). We must
  // NOT escalate a "no speech" silence to a skip in that case — the candidate
  // may be talking and we simply aren't hearing them.
  isAsrHealthy?: boolean;
  // When true, an external "give me more time" request is active: pause the
  // no-speech escalation entirely and keep resetting it so it doesn't fire.
  escalationPaused?: boolean;
};

export function useSilenceDetection(
  isListening: boolean,
  isSpeechDetected: boolean,
  transcript: string,
  interimTranscript: string,
  onSilenceTimeout: (level: 'voice' | 'skip') => void,
  onSubmit: () => void,
  options?: SilenceDetectionOptions
) {
  const { isAsrHealthy = true, escalationPaused = false } = options ?? {};

  const [silenceLevel, setSilenceLevel] = useState<0 | 1 | 2>(0);
  // Observable auto-submit countdown for the UI ring. `pendingSubmit` is true
  // while an auto-submit is scheduled; `submitRemainingMs` counts down to 0.
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [submitRemainingMs, setSubmitRemainingMs] = useState(0);

  const onSilenceTimeoutRef = useRef(onSilenceTimeout);
  const onSubmitRef = useRef(onSubmit);
  const listeningStartTimeRef = useRef<number>(0);

  // Imperative timer/interval handles so an external cancel can truly stop a
  // scheduled submit (not just rely on effect cleanup).
  const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const clearSubmitTimers = useCallback(() => {
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current);
      submitTimeoutRef.current = null;
    }
    if (submitIntervalRef.current) {
      clearInterval(submitIntervalRef.current);
      submitIntervalRef.current = null;
    }
  }, []);

  // Cancels any scheduled auto-submit. Wire this to new speech / a manual click
  // so the countdown ring resets instead of firing.
  const cancelPendingSubmit = useCallback(() => {
    clearSubmitTimers();
    setPendingSubmit(false);
    setSubmitRemainingMs(0);
  }, [clearSubmitTimers]);

  // Auto-submit after silence (if they have spoken something).
  useEffect(() => {
    const fullText = (transcript + ' ' + interimTranscript).trim();
    if (isListening && fullText) {
      const endsWithPunctuation = /[.!?。！？]$/.test(fullText);

      let timeoutDuration: number;
      if (endsWithPunctuation) {
        timeoutDuration = isSpeechDetected ? 1500 : 1200;
      } else {
        // Lengthened no-punctuation window so mid-answer pauses (thinking,
        // breathing) aren't cut off prematurely.
        timeoutDuration = isSpeechDetected ? 4500 : 3500;
      }

      const deadline = Date.now() + timeoutDuration;
      setPendingSubmit(true);
      setSubmitRemainingMs(timeoutDuration);

      submitTimeoutRef.current = setTimeout(() => {
        clearSubmitTimers();
        setPendingSubmit(false);
        setSubmitRemainingMs(0);
        onSubmitRef.current();
      }, timeoutDuration);

      // Tick the remaining time for the UI ring.
      submitIntervalRef.current = setInterval(() => {
        setSubmitRemainingMs(Math.max(0, deadline - Date.now()));
      }, 100);
    } else {
      // No text / not listening — ensure nothing is pending.
      clearSubmitTimers();
      setPendingSubmit(false);
      setSubmitRemainingMs(0);
    }
    return () => {
      clearSubmitTimers();
    };
    // Re-arming on any transcript/interim change is what makes new speech cancel
    // and restart the countdown.
  }, [isListening, isSpeechDetected, transcript, interimTranscript, clearSubmitTimers]);

  // Escalating silence timeout (if they haven't spoken anything yet).
  // Includes a grace period after TTS ends to give the candidate time to think.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // While an external "more time" request is active, hold the escalation at
    // level 0 and don't schedule anything.
    if (escalationPaused) {
      if (silenceLevel !== 0) setSilenceLevel(0);
      return;
    }

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
        // Level 2 → skip: 12s after voice reminder. Only escalate to skip when
        // ASR is actually healthy; otherwise we can't trust the silence.
        if (isAsrHealthy) {
          timeoutId = setTimeout(() => {
            onSilenceTimeoutRef.current('skip');
          }, 12000);
        }
      }
    }
    return () => clearTimeout(timeoutId);
  }, [isListening, transcript, interimTranscript, silenceLevel, isAsrHealthy, escalationPaused]);

  return {
    silenceLevel,
    setSilenceLevel,
    pendingSubmit,
    submitRemainingMs,
    cancelPendingSubmit
  };
}
