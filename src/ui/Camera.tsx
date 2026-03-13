import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface CameraProps {
  showCamera: boolean;
  hasVideo: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function Camera({ showCamera, hasVideo, videoRef }: CameraProps) {
  return (
    <AnimatePresence>
      {showCamera && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className="absolute top-6 right-6 w-48 aspect-video bg-black rounded-xl overflow-hidden shadow-lg border-2 border-white z-10"
        >
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover"
          />
          {!hasVideo && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-xs">
              Camera unavailable
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
