import { useCallback, useEffect, useRef, useState } from 'react';

// If no new audio chunk arrives within this window mid-stream, treat the TTS
// stream as stalled: stop playback, surface an error, and stop "speaking".
const STREAM_IDLE_WATCHDOG_MS = 5000;
// Small jitter buffer before the first chunk so the scheduler has slack and
// doesn't underrun mid-sentence on slow chunk delivery.
const FIRST_CHUNK_DELAY_S = 0.2; // ~200ms

export function usePlaybackControl(language: 'zh-CN' | 'en-US' = 'zh-CN') {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackIdRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  // Cached fallback-TTS voice so we don't re-resolve (and re-race getVoices) each call.
  const cachedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Unmount-only cleanup: close the AudioContext so repeated mounts
  // (report replay, candidate reconnects) don't leak contexts until the
  // browser hits its ~6-context cap and audio silently stops. Bumping
  // playbackIdRef invalidates any in-flight playback loop so it stops too.
  useEffect(() => () => {
    playbackIdRef.current += 1;
    try {
      audioCtxRef.current?.close();
    } catch {}
  }, []);

  const stopAudio = useCallback(() => {
    playbackIdRef.current += 1;
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    activeSourcesRef.current = [];
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const playTTS = useCallback(async (base64Audio: string) => {
    stopAudio();
    const myId = playbackIdRef.current;

    return new Promise<void>(async (resolve) => {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const audioCtx = audioCtxRef.current;
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        setAudioUnlocked(audioCtx.state === 'running');

        if (myId !== playbackIdRef.current) return resolve();

        const binaryString = window.atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }
        const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
        audioBuffer.getChannelData(0).set(float32Array);

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);

        if (myId !== playbackIdRef.current) return resolve();

        const duration = audioBuffer.duration;
        const timeoutId = setTimeout(() => {
          if (myId === playbackIdRef.current) {
            console.warn("Audio playback timed out");
          }
          resolve();
        }, (duration * 1000) + 1000);

        source.onended = () => {
          activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
          clearTimeout(timeoutId);
          resolve();
        };

        activeSourcesRef.current.push(source);
        source.start();
      } catch (e) {
        console.error("Audio playback failed", e);
        resolve();
      }
    });
  }, [stopAudio]);

  const playTTSStream = useCallback(async (audioStream: AsyncGenerator<string, void, unknown>, onStartPlaying?: () => void) => {
    stopAudio();
    setPlaybackError(null);
    const myId = playbackIdRef.current;

    return new Promise<void>(async (resolve, reject) => {
      let isFirstChunk = true;
      // Inter-chunk watchdog: reset on each received chunk. If it fires, the
      // stream stalled — stop playback and surface an error.
      let watchdogId: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const clearWatchdog = () => {
        if (watchdogId) {
          clearTimeout(watchdogId);
          watchdogId = null;
        }
      };
      const armWatchdog = () => {
        clearWatchdog();
        watchdogId = setTimeout(() => {
          if (settled || myId !== playbackIdRef.current) return;
          settled = true;
          // Invalidate + stop any scheduled sources, then surface the stall.
          stopAudio();
          setPlaybackError('The interviewer audio stalled. You can read the question above while we recover.');
          resolve();
        }, STREAM_IDLE_WATCHDOG_MS);
      };

      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const audioCtx = audioCtxRef.current;
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        setAudioUnlocked(audioCtx.state === 'running');

        if (myId !== playbackIdRef.current) return resolve();

        let nextStartTime = audioCtx.currentTime;
        let lastSource: AudioBufferSourceNode | null = null;

        // NOTE: the watchdog guards *inter-chunk* gaps only. The initial wait
        // for the first chunk (cold start / TTS generation) is covered by the
        // fetch abort timeout in generateTTSStream, so we don't arm it here.

        for await (const base64Audio of audioStream) {
          if (settled) return;
          if (myId !== playbackIdRef.current) {
            clearWatchdog();
            resolve();
            return;
          }
          // Fresh chunk arrived — cancel any pending stall.
          clearWatchdog();

          const binaryString = window.atob(base64Audio);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const int16Array = new Int16Array(bytes.buffer);
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
          }
          const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
          audioBuffer.getChannelData(0).set(float32Array);

          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);

          if (myId !== playbackIdRef.current) {
            clearWatchdog();
            resolve();
            return;
          }

          if (isFirstChunk) {
            // Jitter buffer: start slightly in the future so the scheduler has
            // slack for the chunks that follow.
            nextStartTime = audioCtx.currentTime + FIRST_CHUNK_DELAY_S;
            isFirstChunk = false;
            if (onStartPlaying) onStartPlaying();
          }

          // Clamp: if we've fallen behind real time (underrun), don't schedule
          // in the past — that would drop/garble audio. Restart from now.
          if (nextStartTime < audioCtx.currentTime) {
            nextStartTime = audioCtx.currentTime;
          }

          source.start(nextStartTime);
          activeSourcesRef.current.push(source);
          nextStartTime += audioBuffer.duration;

          lastSource = source;

          // Arm the stall watchdog for the NEXT chunk.
          armWatchdog();
        }

        // Stream ended cleanly — no more chunks expected, so the watchdog is done.
        clearWatchdog();

        if (settled) return;
        if (myId !== playbackIdRef.current) {
          resolve();
          return;
        }

        if (lastSource) {
          lastSource.onended = () => {
            activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== lastSource);
            if (myId === playbackIdRef.current && !settled) {
              settled = true;
              resolve();
            }
          };

          setTimeout(() => {
            if (myId === playbackIdRef.current && !settled) {
              settled = true;
              resolve();
            }
          }, (nextStartTime - audioCtx.currentTime + 1) * 1000);
        } else {
          if (!settled) {
            settled = true;
            resolve();
          }
        }

      } catch (e) {
        clearWatchdog();
        console.error("Audio stream playback failed", e);
        if (settled) return;
        if (isFirstChunk && myId === playbackIdRef.current) {
          settled = true;
          reject(e);
        } else {
          settled = true;
          resolve();
        }
      }
    });
  }, [stopAudio]);

  // Resolve (and cache) a fallback-TTS voice, handling the getVoices() race:
  // some browsers return [] until the async 'voiceschanged' event fires.
  const resolveVoice = useCallback((): Promise<SpeechSynthesisVoice | null> => {
    if (cachedVoiceRef.current) {
      return Promise.resolve(cachedVoiceRef.current);
    }
    const pick = (voices: SpeechSynthesisVoice[]) => {
      const targetVoice = language === 'zh-CN'
        ? voices.find(v => v.lang.includes('zh') || v.lang.includes('cmn'))
        : voices.find(v => v.lang.includes('en') && (v.lang.includes('US') || v.lang.includes('GB')));
      cachedVoiceRef.current = targetVoice || null;
      return cachedVoiceRef.current;
    };

    const initial = window.speechSynthesis.getVoices();
    if (initial.length > 0) {
      return Promise.resolve(pick(initial));
    }

    // Wait for voiceschanged, but don't hang forever if it never fires.
    return new Promise<SpeechSynthesisVoice | null>((resolve) => {
      let done = false;
      const finish = (voices: SpeechSynthesisVoice[]) => {
        if (done) return;
        done = true;
        window.speechSynthesis.onvoiceschanged = null;
        clearTimeout(timeoutId);
        resolve(pick(voices));
      };
      const timeoutId = setTimeout(() => finish(window.speechSynthesis.getVoices()), 1500);
      window.speechSynthesis.onvoiceschanged = () => finish(window.speechSynthesis.getVoices());
    });
  }, [language]);

  const fallbackTTS = useCallback((text: string) => {
    stopAudio();
    const myId = playbackIdRef.current;

    return new Promise<void>(async (resolve) => {
      if (!window.speechSynthesis) {
        // Browser has no speech synthesis at all — do NOT silently resolve.
        // Surface an error so the UI can tell the candidate to read the text.
        setPlaybackError('Audio is unavailable in this browser — please read the question above.');
        resolve();
        return;
      }

      if (myId !== playbackIdRef.current) return resolve();

      const utterance = new SpeechSynthesisUtterance(text);
      // Set lang first so the engine can pick a sensible default even before
      // our specific voice resolves.
      utterance.lang = language;
      utterance.rate = 1.0;

      const targetVoice = await resolveVoice();
      if (myId !== playbackIdRef.current) return resolve();
      if (targetVoice) {
        utterance.voice = targetVoice;
      }

      const timeoutId = setTimeout(() => {
        if (myId === playbackIdRef.current) {
          console.warn("Fallback TTS timed out");
        }
        resolve();
      }, 60000);

      utterance.onend = () => {
        clearTimeout(timeoutId);
        if (myId === playbackIdRef.current) {
          resolve();
        }
      };
      utterance.onerror = (e) => {
        clearTimeout(timeoutId);
        if (myId === playbackIdRef.current) {
          console.error("Fallback TTS Error:", e);
          resolve();
        }
      };

      if (myId === playbackIdRef.current) {
        window.speechSynthesis.speak(utterance);
      } else {
        clearTimeout(timeoutId);
        resolve();
      }
    });
  }, [stopAudio, language, resolveVoice]);

  /**
   * Pre-initialize and unlock the AudioContext on a user gesture.
   * Call this early (e.g. on "Start Interview" click) so the context
   * is warm and ready when the first audio chunk arrives.
   * The lazy init inside playTTS/playTTSStream remains as a fallback
   * for reconnection paths that lack a user gesture.
   */
  const initAudioContext = useCallback(async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    setAudioUnlocked(audioCtxRef.current.state === 'running');
  }, []);

  /**
   * Unlock audio from a user gesture (required by iOS/Safari autoplay policy).
   * Creates + resumes the AudioContext. After resume, if the state is still not
   * 'running' the context remains unusable — audioUnlocked stays false so the
   * caller can prompt the user to tap again.
   */
  const unlockAudio = useCallback(async () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      const running = audioCtxRef.current.state === 'running';
      setAudioUnlocked(running);
      if (running) {
        // Clear any prior "audio unavailable" error now that we're unlocked.
        setPlaybackError(null);
      }
    } catch (e) {
      console.error('Audio unlock failed', e);
      setAudioUnlocked(false);
    }
  }, []);

  return {
    playTTS,
    playTTSStream,
    fallbackTTS,
    stopAudio,
    initAudioContext,
    unlockAudio,
    audioUnlocked,
    playbackError
  };
}
