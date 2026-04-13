import { useCallback, useRef } from 'react';

export function usePlaybackControl(language: 'zh-CN' | 'en-US' = 'zh-CN') {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackIdRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

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
    const myId = playbackIdRef.current;
    
    return new Promise<void>(async (resolve, reject) => {
      let isFirstChunk = true;
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const audioCtx = audioCtxRef.current;
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        
        if (myId !== playbackIdRef.current) return resolve();
        
        let nextStartTime = audioCtx.currentTime;
        let lastSource: AudioBufferSourceNode | null = null;

        for await (const base64Audio of audioStream) {
          if (myId !== playbackIdRef.current) {
            resolve();
            return;
          }
          
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
            resolve();
            return;
          }
          
          if (isFirstChunk) {
            nextStartTime = audioCtx.currentTime;
            isFirstChunk = false;
            if (onStartPlaying) onStartPlaying();
          }

          source.start(nextStartTime);
          activeSourcesRef.current.push(source);
          nextStartTime += audioBuffer.duration;
          
          lastSource = source;
        }

        if (myId !== playbackIdRef.current) {
          resolve();
          return;
        }

        if (lastSource) {
          lastSource.onended = () => {
            activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== lastSource);
            if (myId === playbackIdRef.current) {
              resolve();
            }
          };
          
          setTimeout(() => {
            if (myId === playbackIdRef.current) {
              resolve();
            }
          }, (nextStartTime - audioCtx.currentTime + 1) * 1000);
        } else {
          resolve();
        }

      } catch (e) {
        console.error("Audio stream playback failed", e);
        if (isFirstChunk && myId === playbackIdRef.current) {
          reject(e);
        } else {
          resolve();
        }
      }
    });
  }, [stopAudio]);

  const fallbackTTS = useCallback((text: string) => {
    stopAudio();
    const myId = playbackIdRef.current;
    
    return new Promise<void>((resolve) => {
      if (!window.speechSynthesis) {
        resolve();
        return;
      }
      
      if (myId !== playbackIdRef.current) return resolve();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.rate = 1.0;
      
      const voices = window.speechSynthesis.getVoices();
      const targetVoice = language === 'zh-CN' 
        ? voices.find(v => v.lang.includes('zh') || v.lang.includes('cmn'))
        : voices.find(v => v.lang.includes('en') && (v.lang.includes('US') || v.lang.includes('GB')));
        
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
  }, [stopAudio]);

  return {
    playTTS,
    playTTSStream,
    fallbackTTS,
    stopAudio
  };
}
