export * from './useASR';
export * from './usePlaybackControl';
export * from './useSilenceDetection';
export * from './useInterruptionHandling';
export * from './tts';

import { useASR } from './useASR';
import { usePlaybackControl } from './usePlaybackControl';
import { useState, useEffect, useRef } from 'react';

export function useAudio(language: 'zh-CN' | 'en-US' = 'zh-CN') {
  const asr = useASR(language);
  const playback = usePlaybackControl(language);

  return {
    ...asr,
    ...playback
  };
}

// `active: false` fully releases the device (browser camera light turns off) —
// hiding the self-view must not keep capturing in the background.
export function useCamera(active: boolean = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (cancelled) {
          // Unmounted before getUserMedia resolved: stop the just-obtained
          // stream and do not touch videoRef/state on an unmounted component.
          stream.getTracks().forEach(track => track.stop());
          streamRef.current = null;
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setHasVideo(true);
      } catch (err) {
        console.error("Error accessing camera:", err);
        if (!cancelled) {
          setHasVideo(false);
        }
      }
    }

    if (active) {
      setupCamera();
    } else {
      setHasVideo(false);
    }

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [active]);

  return { videoRef, hasVideo };
}

export * from './tts';
