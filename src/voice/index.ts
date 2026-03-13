export * from './useASR';
export * from './usePlaybackControl';
export * from './useSilenceDetection';
export * from './useInterruptionHandling';
export * from './tts';

import { useASR } from './useASR';
import { usePlaybackControl } from './usePlaybackControl';
import { useState, useEffect, useRef } from 'react';

export function useAudio() {
  const asr = useASR();
  const playback = usePlaybackControl();

  return {
    ...asr,
    ...playback
  };
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    
    async function setupCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setHasVideo(true);
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setHasVideo(false);
      }
    }

    setupCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return { videoRef, hasVideo };
}

export * from './tts';
