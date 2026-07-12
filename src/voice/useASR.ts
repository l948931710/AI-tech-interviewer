import { useState, useEffect, useCallback, useRef } from 'react';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export type AsrError = {
  kind: 'denied' | 'no-device' | 'network' | 'service' | 'unknown';
  message: string;
};

export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unknown';

// Cap consecutive automatic restarts so a persistently failing recognition
// engine (e.g. network flapping, service errors) can't spin an infinite
// onend -> start() loop. After this many rapid restarts we surface an error
// and stop instead.
const MAX_AUTO_RESTARTS = 3;
// Restarts spaced further apart than this are treated as "healthy" recovery
// (candidate paused, engine cycled) and reset the counter.
const AUTO_RESTART_WINDOW_MS = 2000;

function mapAsrError(error: string, isZh: boolean): AsrError | null {
  switch (error) {
    case 'no-speech':
      // Expected/benign; not surfaced as an error.
      return null;
    case 'aborted':
      // Caused by our own stop()/restart; not a user-facing error.
      return null;
    case 'not-allowed':
      return { kind: 'denied', message: isZh ? '麦克风权限被拒绝。请允许麦克风访问后重试。' : 'Microphone permission was denied. Please allow mic access and retry.' };
    case 'audio-capture':
      return { kind: 'no-device', message: isZh ? '未检测到麦克风。请连接麦克风后重试。' : 'No microphone was found. Please connect a mic and retry.' };
    case 'network':
      return { kind: 'network', message: isZh ? '语音识别的网络连接中断。请检查网络后重试。' : 'Speech recognition lost its network connection. Check your connection and retry.' };
    case 'service-not-allowed':
      return { kind: 'service', message: isZh ? '语音识别服务暂不可用。请重试。' : 'The speech recognition service is unavailable. Please retry.' };
    default:
      return { kind: 'unknown', message: isZh ? `语音识别出错：${error}` : `Speech recognition error: ${error}` };
  }
}

export function useASR(language: 'zh-CN' | 'en-US' = 'zh-CN') {
  const isSupported = typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const [isListening, setIsListening] = useState(false);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [asrError, setAsrError] = useState<AsrError | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState>('unknown');

  const recognitionRef = useRef<any>(null);
  const isIntentionalStopRef = useRef(false);
  // Auto-restart bookkeeping for onend -> start() loop protection.
  const restartCountRef = useRef(0);
  const lastRestartTimeRef = useRef(0);
  // Mirrors isListening for non-reactive readers (effect cleanups).
  const isListeningRef = useRef(false);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  // Set by the [language] effect's cleanup so the re-run can seamlessly restart
  // recognition in the new language instead of leaving a dead engine behind
  // while the UI still claims to be listening.
  const restartAfterRecreateRef = useRef(false);

  // Best-effort permission state via the Permissions API. Not available in
  // every browser (notably Safari historically), so guard carefully.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      return;
    }
    let permStatus: any = null;
    let cancelled = false;
    try {
      // 'microphone' is not in the TS PermissionName union in all lib versions.
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (cancelled) return;
          permStatus = status;
          setPermissionState(status.state as PermissionState);
          status.onchange = () => setPermissionState(status.state as PermissionState);
        })
        .catch(() => {
          // Some browsers throw for the 'microphone' name; leave as 'unknown'.
        });
    } catch {
      // Ignore: Permissions API unsupported for this descriptor.
    }
    return () => {
      cancelled = true;
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  useEffect(() => {
    const isZh = language === 'zh-CN';
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = language;

      recognitionRef.current.onresult = (event: any) => {
        setIsSpeechDetected(true);
        let final = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        if (final) {
          // Normalize joins: trim the incoming chunk and join with a single
          // space, avoiding the leading-space artifact of the old `prev + ' '`
          // approach. Empty prev stays clean too.
          const chunk = final.trim();
          if (chunk) {
            setTranscript((prev) => (prev ? `${prev} ${chunk}` : chunk));
          }
        }
        setInterimTranscript(interim);
      };

      recognitionRef.current.onspeechstart = () => setIsSpeechDetected(true);
      recognitionRef.current.onspeechend = () => setIsSpeechDetected(false);
      recognitionRef.current.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          console.error('Speech recognition error', event.error);
        }
        if (event.error === 'not-allowed') {
          isIntentionalStopRef.current = true;
          setPermissionState('denied');
          setIsListening(false);
        }
        const mapped = mapAsrError(event.error, isZh);
        if (mapped) {
          setAsrError(mapped);
        }
      };
      recognitionRef.current.onend = () => {
        setIsSpeechDetected(false);
        if (isIntentionalStopRef.current) {
          setIsListening(false);
          return;
        }

        // Auto-restart with a cap so a persistently failing engine can't spin
        // an infinite loop. Restarts that are spaced out (candidate simply
        // paused) reset the counter; rapid ones accumulate.
        const now = Date.now();
        if (now - lastRestartTimeRef.current > AUTO_RESTART_WINDOW_MS) {
          restartCountRef.current = 0;
        }
        lastRestartTimeRef.current = now;
        restartCountRef.current += 1;

        if (restartCountRef.current > MAX_AUTO_RESTARTS) {
          setIsListening(false);
          setAsrError((prev) => prev ?? {
            kind: 'service',
            message: isZh ? '语音识别持续中断，请重试。' : 'Speech recognition kept dropping. Please retry.',
          });
          return;
        }

        try {
          recognitionRef.current.start();
          // Reconcile state: a retry clicked mid-winddown can reach here with
          // isListening=false — the engine is now genuinely running, say so.
          setIsListening(true);
        } catch (e) {
          setIsListening(false);
        }
      };
    }

    // A language switch tore down a live engine — start the new one so the
    // candidate isn't left with a dead mic behind a "listening" UI.
    if (restartAfterRecreateRef.current && recognitionRef.current) {
      restartAfterRecreateRef.current = false;
      isIntentionalStopRef.current = false;
      restartCountRef.current = 0;
      lastRestartTimeRef.current = 0;
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }

    const recognition = recognitionRef.current;
    return () => {
      if (recognition) {
        // If the engine was live, flag the next effect run (language change) to
        // restart it. On real unmount the flag is simply never read again.
        restartAfterRecreateRef.current = isListeningRef.current;
        // Prevent onend from auto-restarting recognition after unmount/re-run.
        isIntentionalStopRef.current = true;
        // Detach handlers so no post-unmount callbacks fire setState.
        recognition.onend = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onspeechstart = null;
        recognition.onspeechend = null;
        try {
          recognition.stop();
        } catch (e) {
          // Ignore: recognition may already be stopped or never started.
        }
      }
    };
  }, [language]);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      setTranscript('');
      setInterimTranscript('');
      setIsSpeechDetected(false);
      setAsrError(null);
      isIntentionalStopRef.current = false;
      restartCountRef.current = 0;
      lastRestartTimeRef.current = 0;
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e: any) {
        // InvalidStateError = the engine is ALREADY running (e.g. leftover
        // barge-in detection session) — reconcile state instead of staying
        // visually "off" while audio is being captured.
        if (e?.name === 'InvalidStateError') {
          setIsListening(true);
        } else {
          console.error(e);
        }
      }
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      isIntentionalStopRef.current = true;
      recognitionRef.current.stop();
      setIsListening(false);
      setIsSpeechDetected(false);
    }
  }, [isListening]);

  // Clears both transcripts WITHOUT restarting recognition. Needed at turn
  // boundaries (AI finished speaking) where the mic may already be running for
  // barge-in detection: startListening() is a no-op then, so any echo of the
  // AI's own voice captured during playback would otherwise survive into the
  // candidate's turn and could be auto-submitted as their answer.
  const resetTranscripts = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  // Clears the current error and restarts recognition from a clean slate.
  // NOTE: any words spoken between the error and this retry are lost — the
  // Web Speech API gives us no buffer to recover them across a hard restart.
  const retryListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setAsrError(null);
    restartCountRef.current = 0;
    lastRestartTimeRef.current = 0;
    isIntentionalStopRef.current = false;
    // Ensure any lingering session is torn down before restarting.
    try {
      recognitionRef.current.stop();
    } catch {
      // Ignore: may not be running.
    }
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      // start() throws if called while the engine is still winding down; the
      // onend handler will attempt the restart in that case.
      isIntentionalStopRef.current = false;
    }
  }, []);

  return {
    isListening,
    isSpeechDetected,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    setTranscript,
    resetTranscripts,
    isSupported,
    asrError,
    permissionState,
    retryListening
  };
}
